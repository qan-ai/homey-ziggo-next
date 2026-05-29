/** LG Horizon set-top box (port of lghorizon_device.py). */

import { LGHorizonAuth } from './auth';
import { makeId, sleep } from './helpers';
import { LGHorizonMqttClient } from './mqtt-client';
import { LGHorizonDeviceStateProcessor } from './state-processor';
import {
  LGHorizonAdBreak,
  LGHorizonChannel,
  LGHorizonDeviceState,
  LGHorizonRunningState,
  LGHorizonStatusMessage,
  LGHorizonUIStatusMessage,
} from './models';
import {
  MEDIA_KEY_CHANNEL_DOWN,
  MEDIA_KEY_CHANNEL_UP,
  MEDIA_KEY_ENTER,
  MEDIA_KEY_FAST_FORWARD,
  MEDIA_KEY_PLAY_PAUSE,
  MEDIA_KEY_POWER,
  MEDIA_KEY_RECORD,
  MEDIA_KEY_REWIND,
  MEDIA_KEY_STOP,
  PLATFORM_TYPES,
} from './const';

export type BoxChangeCallback = (deviceId: string) => Promise<void> | void;

export class LGHorizonBox {
  readonly deviceId: string;
  readonly hashedCpeId: string;
  readonly deviceFriendlyName: string;
  readonly platformType: string;

  deviceState = new LGHorizonDeviceState();
  localRecordingCapacity: number | null = null;
  lastUiMessageTimestamp = 0;

  private _changeCallback: BoxChangeCallback | null = null;

  constructor(
    deviceJson: any,
    private _mqttClient: LGHorizonMqttClient,
    private _stateProcessor: LGHorizonDeviceStateProcessor,
    private _auth: LGHorizonAuth,
    private _channels: Record<string, LGHorizonChannel>,
  ) {
    this.deviceId = deviceJson.deviceId;
    this.hashedCpeId = deviceJson.hashedCPEId;
    this.deviceFriendlyName = deviceJson.settings.deviceFriendlyName;
    this.platformType = deviceJson.platformType;
  }

  get manufacturer(): string {
    return PLATFORM_TYPES[this.platformType]?.manufacturer ?? 'unknown';
  }

  get model(): string {
    return PLATFORM_TYPES[this.platformType]?.model ?? 'unknown';
  }

  get isAvailable(): boolean {
    return (
      this.deviceState.state === LGHorizonRunningState.ONLINE_RUNNING ||
      this.deviceState.state === LGHorizonRunningState.ONLINE_STANDBY
    );
  }

  updateChannels(channels: Record<string, LGHorizonChannel>): void {
    this._channels = channels;
  }

  async registerMqtt(): Promise<void> {
    const topic = `${this._auth.householdId}/${this._mqttClient.clientId}/status`;
    const payload = {
      source: this._mqttClient.clientId,
      state: LGHorizonRunningState.ONLINE_RUNNING,
      deviceType: 'HGO',
    };
    await this._mqttClient.publishMessage(topic, JSON.stringify(payload));
  }

  async setCallback(callback: BoxChangeCallback): Promise<void> {
    this._changeCallback = callback;
    await this.registerMqtt();
    await this._requestSettopBoxState();
    await this._requestSettopBoxLocalRecordingCapacity();
  }

  async handleStatusMessage(statusMessage: LGHorizonStatusMessage): Promise<void> {
    const oldState = this.deviceState.state;
    const newState = statusMessage.runningState;
    if (oldState === newState) return;
    await this._stateProcessor.processState(this.deviceState, statusMessage);
    if (this.deviceState.state === LGHorizonRunningState.ONLINE_RUNNING) {
      await this._requestSettopBoxState();
    }
    await this._triggerCallback();
    await this._requestSettopBoxLocalRecordingCapacity();
  }

  async handleUiStatusMessage(statusMessage: LGHorizonUIStatusMessage): Promise<void> {
    await this._stateProcessor.processUiState(this.deviceState, statusMessage);
    this.lastUiMessageTimestamp = statusMessage.messageTimestamp;
    await this._triggerCallback();
  }

  updateLocalRecordingCapacity(payload: any): void {
    if (!('CPE.capacity' in payload) || !('used' in payload)) return;
    this.localRecordingCapacity = payload.used;
  }

  private async _triggerCallback(): Promise<void> {
    if (this._changeCallback) {
      await this._changeCallback(this.deviceId);
    }
  }

  // --- power / playback commands -------------------------------------------

  async turnOn(): Promise<void> {
    // Attempt to wake the box for ANY non-running state (standby, network
    // standby, offline/eco or unknown). The MQTT power key only reaches the box
    // when it still holds a broker connection (network standby); for deep "eco"
    // standby the box drops off the network entirely and cannot be woken
    // remotely — enable "Snel opstarten"/active standby on the box for that.
    if (this.deviceState.state !== LGHorizonRunningState.ONLINE_RUNNING) {
      await this.sendKeyToBox(MEDIA_KEY_POWER);
    }
  }

  async turnOff(): Promise<void> {
    if (this.deviceState.state === LGHorizonRunningState.ONLINE_RUNNING) {
      await this.sendKeyToBox(MEDIA_KEY_POWER);
      this.deviceState.reset();
    }
  }

  async pause(): Promise<void> {
    if (
      this.deviceState.state === LGHorizonRunningState.ONLINE_RUNNING &&
      !this.deviceState.paused
    ) {
      await this.sendKeyToBox(MEDIA_KEY_PLAY_PAUSE);
    }
  }

  async play(): Promise<void> {
    if (
      this.deviceState.state === LGHorizonRunningState.ONLINE_RUNNING &&
      this.deviceState.paused
    ) {
      await this.sendKeyToBox(MEDIA_KEY_PLAY_PAUSE);
    }
  }

  async stop(): Promise<void> {
    if (this.deviceState.state === LGHorizonRunningState.ONLINE_RUNNING) {
      await this.sendKeyToBox(MEDIA_KEY_STOP);
    }
  }

  async nextChannel(): Promise<void> {
    if (this.deviceState.state === LGHorizonRunningState.ONLINE_RUNNING) {
      await this.sendKeyToBox(MEDIA_KEY_CHANNEL_UP);
    }
  }

  async previousChannel(): Promise<void> {
    if (this.deviceState.state === LGHorizonRunningState.ONLINE_RUNNING) {
      await this.sendKeyToBox(MEDIA_KEY_CHANNEL_DOWN);
    }
  }

  async pressEnter(): Promise<void> {
    if (this.deviceState.state === LGHorizonRunningState.ONLINE_RUNNING) {
      await this.sendKeyToBox(MEDIA_KEY_ENTER);
    }
  }

  async rewind(): Promise<void> {
    if (this.deviceState.state === LGHorizonRunningState.ONLINE_RUNNING) {
      await this.sendKeyToBox(MEDIA_KEY_REWIND);
    }
  }

  async fastForward(): Promise<void> {
    if (this.deviceState.state === LGHorizonRunningState.ONLINE_RUNNING) {
      await this.sendKeyToBox(MEDIA_KEY_FAST_FORWARD);
    }
  }

  async record(): Promise<void> {
    if (this.deviceState.state === LGHorizonRunningState.ONLINE_RUNNING) {
      await this.sendKeyToBox(MEDIA_KEY_RECORD);
    }
  }

  async setPlayerPosition(position: number): Promise<void> {
    const payload = {
      source: this.deviceId,
      type: 'CPE.setPlayerPosition',
      runtimeType: 'setPlayerposition',
      id: makeId(),
      version: '1.3.11',
      status: { relativePosition: position },
    };
    await this._mqttClient.publishMessage(
      `${this._auth.householdId}/${this.deviceId}`,
      JSON.stringify(payload),
    );
  }

  getCurrentAdBreak(): LGHorizonAdBreak | null {
    const ds = this.deviceState;
    if (ds.adBreaks.length === 0 || ds.position === null || ds.lastPositionUpdate === null) {
      return null;
    }
    const elapsed = Date.now() / 1000 - ds.lastPositionUpdate;
    const speed = ds.speed ?? 1;
    const currentPositionMs = Math.floor((ds.position + elapsed * speed) * 1000);
    for (const ab of ds.adBreaks) {
      if (ab.startMs <= currentPositionMs && currentPositionMs < ab.endMs) {
        return ab;
      }
    }
    return null;
  }

  async skipAdBreak(): Promise<boolean> {
    const adBreak = this.getCurrentAdBreak();
    if (adBreak === null) return false;
    await this.setPlayerPosition(adBreak.endMs);
    return true;
  }

  async displayMessage(sourceType: string, message: string): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const payload = {
        id: makeId(8),
        type: 'CPE.pushToTV',
        source: {
          clientId: this._mqttClient.clientId,
          friendlyDeviceName: `\n\n${message}`,
        },
        status: {
          sourceType,
          source: { channelId: '1234' },
          title: 'Nieuwe melding',
          relativePosition: 0,
          speed: 1,
        },
      };
      await this._mqttClient.publishMessage(
        `${this._auth.householdId}/${this.deviceId}`,
        JSON.stringify(payload),
      );
      if (i < 2) await sleep(3000);
    }
  }

  async setChannel(source: string): Promise<void> {
    const channel = Object.values(this._channels).find((c) => c.title === source);
    if (!channel) throw new Error(`Channel '${source}' not found`);
    await this._tuneToChannel(channel);
  }

  async setChannelByNumber(channelNumber: string | number): Promise<void> {
    const numberStr = String(channelNumber);
    const channel = Object.values(this._channels).find(
      (c) => String(c.channelNumber) === numberStr,
    );
    if (!channel) throw new Error(`Channel number '${numberStr}' not found`);
    await this._tuneToChannel(channel);
  }

  /** Tune to a channel by its id directly (used by flow autocomplete). */
  async setChannelById(channelId: string): Promise<void> {
    const channel = this._channels[channelId];
    if (!channel) throw new Error(`Channel id '${channelId}' not found`);
    await this._tuneToChannel(channel);
  }

  private async _tuneToChannel(channel: LGHorizonChannel): Promise<void> {
    const payload = {
      id: makeId(8),
      type: 'CPE.pushToTV',
      source: {
        clientId: this._mqttClient.clientId,
        friendlyDeviceName: 'Homey',
      },
      status: {
        sourceType: 'linear',
        source: { channelId: channel.id },
        relativePosition: 0,
        speed: 1,
      },
    };
    await this._mqttClient.publishMessage(
      `${this._auth.householdId}/${this.deviceId}`,
      JSON.stringify(payload),
    );
  }

  async playRecording(recordingId: string): Promise<void> {
    const payload = {
      id: makeId(8),
      type: 'CPE.pushToTV',
      source: {
        clientId: this._mqttClient.clientId,
        friendlyDeviceName: 'Homey',
      },
      status: {
        sourceType: 'nDVR',
        source: { recordingId },
        relativePosition: 0,
      },
    };
    await this._mqttClient.publishMessage(
      `${this._auth.householdId}/${this.deviceId}`,
      JSON.stringify(payload),
    );
  }

  async sendKeyToBox(key: string): Promise<void> {
    const payload = {
      type: 'CPE.KeyEvent',
      runtimeType: 'key',
      id: 'ha',
      source: this.deviceId.toLowerCase(),
      status: { w3cKey: key, eventType: 'keyDownUp' },
    };
    await this._mqttClient.publishMessage(
      `${this._auth.householdId}/${this.deviceId}`,
      JSON.stringify(payload),
    );
  }

  private async _requestSettopBoxState(): Promise<void> {
    const topic = `${this._auth.householdId}/${this.deviceId}`;
    const payload = {
      id: makeId(8),
      type: 'CPE.getUiStatus',
      source: this._mqttClient.clientId,
    };
    await this._mqttClient.publishMessage(topic, JSON.stringify(payload));
  }

  private async _requestSettopBoxLocalRecordingCapacity(): Promise<void> {
    const topic = `${this._auth.householdId}/${this.deviceId}`;
    const payload = {
      id: makeId(8),
      type: 'CPE.capacity',
      source: this._mqttClient.clientId,
    };
    await this._mqttClient.publishMessage(topic, JSON.stringify(payload));
  }
}
