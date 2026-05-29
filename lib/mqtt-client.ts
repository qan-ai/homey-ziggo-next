/** Async MQTT-over-websockets client (port of lghorizon_mqtt_client.py). */

import mqtt, { MqttClient } from 'mqtt';
import { LGHorizonAuth, Logger } from './auth';
import { makeId } from './helpers';

export type OnConnected = () => Promise<void> | void;
export type OnMessage = (payload: any, topic: string) => Promise<void> | void;

const noopLogger: Logger = () => undefined;

export class LGHorizonMqttClient {
  private _client: MqttClient | null = null;
  private _brokerUrl = '';
  private _token = '';
  clientId = '';

  private _disconnectRequested = false;
  private _connected = false;

  // FIFO processing of incoming messages so handlers never overlap.
  private _messageQueue: Array<{ topic: string; payload: Buffer }> = [];
  private _processing = false;

  private constructor(
    private _auth: LGHorizonAuth,
    private _onConnected: OnConnected,
    private _onMessage: OnMessage,
    private _log: Logger,
  ) {}

  get isConnected(): boolean {
    return this._client !== null && this._connected;
  }

  static async create(
    auth: LGHorizonAuth,
    onConnected: OnConnected,
    onMessage: OnMessage,
    logger: Logger = noopLogger,
  ): Promise<LGHorizonMqttClient> {
    const instance = new LGHorizonMqttClient(auth, onConnected, onMessage, logger);
    const serviceConfig = await auth.getServiceConfig();
    instance._brokerUrl = serviceConfig.getServiceUrl('mqttBroker');
    instance.clientId = makeId();
    instance._token = await auth.getMqttToken();
    return instance;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      this._log('MQTT client is already connected.');
      return;
    }
    this._disconnectRequested = false;

    this._client = mqtt.connect(this._brokerUrl, {
      clientId: this.clientId,
      username: this._auth.householdId,
      password: this._token,
      protocolVersion: 4,
      clean: true,
      keepalive: 60,
      reconnectPeriod: 2000,
      connectTimeout: 30000,
      resubscribe: true,
    });

    this._client.on('connect', () => {
      this._connected = true;
      this._log('MQTT client connected successfully.');
      Promise.resolve(this._onConnected()).catch((e) =>
        this._log('Error in MQTT onConnected callback', e),
      );
    });

    this._client.on('message', (topic: string, payload: Buffer) => {
      this._messageQueue.push({ topic, payload });
      void this._drainQueue();
    });

    this._client.on('error', (err: Error) => {
      this._log('MQTT error:', err.message);
      if (/not authorized/i.test(err.message)) {
        void this._refreshTokenAndReconnect();
      }
    });

    this._client.on('close', () => {
      this._connected = false;
      if (!this._disconnectRequested) {
        this._log('MQTT disconnected unexpectedly; mqtt.js will reconnect.');
      }
    });

    // Wait for the first successful connect (or a hard error).
    await new Promise<void>((resolve, reject) => {
      if (!this._client) return reject(new Error('MQTT client not initialized'));
      const onConn = () => {
        cleanup();
        resolve();
      };
      const onErr = (e: Error) => {
        cleanup();
        reject(e);
      };
      const cleanup = () => {
        this._client?.removeListener('connect', onConn);
        this._client?.removeListener('error', onErr);
      };
      this._client.once('connect', onConn);
      this._client.once('error', onErr);
    });
  }

  private async _refreshTokenAndReconnect(): Promise<void> {
    try {
      this._token = await this._auth.getMqttToken();
      if (this._client) {
        (this._client.options as any).password = this._token;
        this._client.reconnect();
      }
    } catch (e) {
      this._log('Failed to refresh MQTT token:', e);
    }
  }

  async disconnect(): Promise<void> {
    this._disconnectRequested = true;
    this._connected = false;
    if (this._client) {
      await new Promise<void>((resolve) => this._client!.end(true, {}, () => resolve()));
      this._client = null;
    }
  }

  async subscribe(topic: string): Promise<void> {
    if (!this._client) throw new Error('MQTT client not initialized');
    // Resolve even when the broker NACKs a single subscription (e.g. a wildcard
    // it does not allow), so one failed topic never aborts the rest. Paho (the
    // Python original) is fire-and-forget and behaves the same way.
    await new Promise<void>((resolve) => {
      this._client!.subscribe(topic, (err) => {
        if (err) this._log(`MQTT subscribe failed for '${topic}':`, err.message);
        resolve();
      });
    });
  }

  /** Publish a message (QoS 2, matching the original). */
  async publishMessage(topic: string, jsonPayload: string): Promise<void> {
    if (!this._client) throw new Error('MQTT client not initialized');
    await new Promise<void>((resolve, reject) => {
      this._client!.publish(topic, jsonPayload, { qos: 2 }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  private async _drainQueue(): Promise<void> {
    if (this._processing) return;
    this._processing = true;
    try {
      while (this._messageQueue.length > 0) {
        const { topic, payload } = this._messageQueue.shift()!;
        try {
          const json = JSON.parse(payload.toString());
          await this._onMessage(json, topic);
        } catch (e) {
          this._log('Error processing MQTT message', e);
        }
      }
    } finally {
      this._processing = false;
    }
  }
}
