/** LG Horizon API client (port of lghorizon_api.py). */

import { LGHorizonAuth, Logger, TokenRefreshCallback } from './auth';
import { LGHorizonBox } from './box';
import { LGHorizonMessageFactory } from './message-factory';
import { LGHorizonMqttClient } from './mqtt-client';
import { LGHorizonRecordingFactory } from './recording-factory';
import { LGHorizonDeviceStateProcessor } from './state-processor';
import {
  LGHorizonChannel,
  LGHorizonCustomer,
  LGHorizonEntitlements,
  LGHorizonEpg,
  LGHorizonEpgEntry,
  LGHorizonEventDetail,
  LGHorizonManagedRecordingList,
  LGHorizonMessageType,
  LGHorizonProfile,
  LGHorizonRecordingList,
  LGHorizonRecordingQuota,
  LGHorizonReplayChannel,
  LGHorizonRunningState,
  LGHorizonServicesConfig,
  LGHorizonShowRecordingList,
  LGHorizonStatusMessage,
  LGHorizonUIStatusMessage,
} from './models';

const noopLogger: Logger = () => undefined;

export class LGHorizonApi {
  auth: LGHorizonAuth;
  private _profileId: string | null;
  private _channels: Record<string, LGHorizonChannel> = {};
  private _devices: Record<string, LGHorizonBox> = {};
  private _messageFactory = new LGHorizonMessageFactory();
  private _recordingFactory = new LGHorizonRecordingFactory();
  private _serviceConfig!: LGHorizonServicesConfig;
  private _customer!: LGHorizonCustomer;
  private _entitlements!: LGHorizonEntitlements;
  private _stateProcessor: LGHorizonDeviceStateProcessor | null = null;
  private _mqttClient: LGHorizonMqttClient | null = null;
  private _tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private _initialized = false;
  private _log: Logger;

  constructor(auth: LGHorizonAuth, profileId: string | null = null, logger: Logger = noopLogger) {
    this.auth = auth;
    this._profileId = profileId;
    this._log = logger;
  }

  async initialize(): Promise<void> {
    this._serviceConfig = await this.auth.getServiceConfig();
    this._customer = await this._getCustomerInfo();
    if (!this._profileId) {
      this._profileId = Object.keys(this._customer.profiles)[0];
    }
    await this._refreshEntitlements();
    await this._refreshChannels();
    this._mqttClient = await this._createMqttClient();
    await this._mqttClient.connect();
    this._stateProcessor = new LGHorizonDeviceStateProcessor(
      this.auth,
      this._channels,
      this._customer,
      this._profileId!,
      this._log,
    );
    await this._registerDevices();
    this._initialized = true;
    this._startTokenRefreshLoop();
  }

  setTokenRefreshCallback(cb: TokenRefreshCallback): void {
    this.auth.tokenRefreshCallback = cb;
  }

  getDevices(): Record<string, LGHorizonBox> {
    this._assertInitialized();
    return this._devices;
  }

  getProfiles(): Record<string, LGHorizonProfile> {
    this._assertInitialized();
    return this._customer.profiles;
  }

  getChannels(): Record<string, LGHorizonChannel> {
    return this._channels;
  }

  get hasCloudRecording(): boolean {
    this._assertInitialized();
    return this._customer.hasCloudRecording;
  }
  get hasPvr(): boolean {
    this._assertInitialized();
    return this._entitlements.hasPvr;
  }
  get hasLocalDvr(): boolean {
    this._assertInitialized();
    return this._entitlements.hasLocalDvr;
  }
  get hasRecording(): boolean {
    this._assertInitialized();
    return this._entitlements.hasRecording;
  }

  private _assertInitialized(): void {
    if (!this._initialized) throw new Error('LGHorizonApi not initialized');
  }

  getProfileChannels(profileId?: string): Record<string, LGHorizonChannel> {
    const pid = profileId ?? this._profileId ?? undefined;
    let profile = pid ? this._customer.profiles[pid] : undefined;
    const profilesList = Object.values(this._customer.profiles);
    if (!profile && profilesList.length > 0) {
      profile = profilesList[0];
    }

    let channels: Record<string, LGHorizonChannel>;
    if (profile && profile.favoriteChannels.length > 0) {
      const favIds = new Set(profile.favoriteChannels);
      channels = {};
      for (const channel of Object.values(this._channels)) {
        if (favIds.has(channel.id)) channels[channel.id] = channel;
      }
    } else {
      channels = { ...this._channels };
    }

    // Deduplicate by channel number, keeping the last entry (typically HD over SD).
    const seenNumbers: Record<string, string> = {};
    for (const channel of Object.values(channels)) {
      seenNumbers[String(channel.channelNumber)] = channel.id;
    }
    const out: Record<string, LGHorizonChannel> = {};
    for (const cid of Object.values(seenNumbers)) {
      out[cid] = channels[cid];
    }
    return out;
  }

  private async _registerDevices(): Promise<void> {
    this._log('Registering devices...');
    this._devices = {};
    const channels = this.getProfileChannels(this._profileId ?? undefined);
    for (const rawBox of this._customer.assignedDevices) {
      const box = new LGHorizonBox(
        rawBox,
        this._mqttClient!,
        this._stateProcessor!,
        this.auth,
        channels,
      );
      this._devices[box.deviceId] = box;
    }
  }

  async disconnect(): Promise<void> {
    if (this._tokenRefreshTimer) {
      clearInterval(this._tokenRefreshTimer);
      this._tokenRefreshTimer = null;
    }
    if (this._mqttClient) {
      await this._mqttClient.disconnect();
    }
    this._initialized = false;
  }

  private _startTokenRefreshLoop(): void {
    this._tokenRefreshTimer = setInterval(async () => {
      try {
        if (this.auth.isTokenExpiring()) {
          this._log('Token auto-refresh: refreshing proactively');
          await this.auth.fetchAccessToken();
        }
      } catch (e) {
        this._log('Token auto-refresh failed:', e);
      }
    }, 3600 * 1000);
  }

  private async _createMqttClient(): Promise<LGHorizonMqttClient> {
    return LGHorizonMqttClient.create(
      this.auth,
      () => this._onMqttConnected(),
      (payload, topic) => this._onMqttMessage(payload, topic),
      this._log,
    );
  }

  private async _onMqttConnected(): Promise<void> {
    const hh = this.auth.householdId;
    const cid = this._mqttClient!.clientId;
    await this._mqttClient!.subscribe(hh);
    await this._mqttClient!.subscribe(`${hh}/${cid}`);
    await this._mqttClient!.subscribe(`${hh}/+/status`);
    await this._mqttClient!.subscribe(`${hh}/+/networkRecordings`);
    await this._mqttClient!.subscribe(`${hh}/+/networkRecordings/capacity`);
    await this._mqttClient!.subscribe(`${hh}/+/localRecordings`);
    await this._mqttClient!.subscribe(`${hh}/+/localRecordings/capacity`);
    await this._mqttClient!.subscribe(`${hh}/watchlistService`);
    await this._mqttClient!.subscribe(`${hh}/purchaseService`);
    await this._mqttClient!.subscribe(`${hh}/personalizationService`);
    await this._mqttClient!.subscribe(`${hh}/recordingStatus`);
    await this._mqttClient!.subscribe(`${hh}/recordingStatus/lastUserAction`);
    // Wildcard last: some brokers NACK it; keep it from blocking the rest.
    await this._mqttClient!.subscribe('#');
  }

  private async _onMqttMessage(message: any, topic: string): Promise<void> {
    if (message?.type === 'CPE.capacity') {
      const source = message.source;
      if (source) {
        const device = this._devices[source];
        if (device) device.updateLocalRecordingCapacity(message);
      }
      return;
    }

    const msg = this._messageFactory.createMessage(topic, message);
    switch (msg.messageType) {
      case LGHorizonMessageType.STATUS: {
        const statusMessage = msg as LGHorizonStatusMessage;
        const device = this._devices[statusMessage.source];
        if (!device) return;
        await device.handleStatusMessage(statusMessage);
        break;
      }
      case LGHorizonMessageType.UI_STATUS: {
        const uiStatusMessage = msg as LGHorizonUIStatusMessage;
        const device = this._devices[uiStatusMessage.source];
        if (!device) return;
        if (device.deviceState.state !== LGHorizonRunningState.ONLINE_RUNNING) return;
        await device.handleUiStatusMessage(uiStatusMessage);
        break;
      }
      default:
        break;
    }
  }

  private async _getCustomerInfo(): Promise<LGHorizonCustomer> {
    const serviceUrl = this._serviceConfig.getServiceUrl('personalizationService');
    const result = await this.auth.request(
      serviceUrl,
      `/v1/customer/${this.auth.householdId}?with=profiles%2Cdevices`,
    );
    return new LGHorizonCustomer(result);
  }

  private async _refreshEntitlements(): Promise<void> {
    const serviceUrl = this._serviceConfig.getServiceUrl('purchaseService');
    const result = await this.auth.request(
      serviceUrl,
      `/v2/customers/${this.auth.householdId}/entitlements?enableDaypass=true`,
    );
    this._entitlements = new LGHorizonEntitlements(result);
  }

  private async _refreshChannels(): Promise<void> {
    const serviceUrl = this._serviceConfig.getServiceUrl('linearService');
    const lang = this._customer.getProfileLang(this._profileId);
    const channelsJson = await this.auth.request(
      serviceUrl,
      `/v2/channels?cityId=${this._customer.cityId}&language=${lang}&productClass=Orion-DASH`,
    );
    const entitlementIds = new Set(this._entitlements.entitlementIds);
    for (const channelJson of channelsJson) {
      const channel = new LGHorizonChannel(channelJson);
      const hasCommon = channel.linearProducts.some((p) => entitlementIds.has(p));
      if (!hasCommon) continue;
      this._channels[channel.id] = channel;
    }
  }

  async getAllRecordings(): Promise<LGHorizonRecordingList> {
    if (!this._entitlements.hasRecording) return new LGHorizonRecordingList([]);
    const serviceUrl = this._serviceConfig.getServiceUrl('recordingService');
    const lang = this._customer.getProfileLang(this._profileId);
    const json = await this.auth.request(
      serviceUrl,
      `/customers/${this.auth.householdId}/recordings?isAdult=false&offset=0&limit=100&sort=time&sortOrder=desc&profileId=${this._profileId}&language=${lang}`,
    );
    return this._recordingFactory.createRecordings(json);
  }

  async getShowRecordings(showId: string, channelId: string): Promise<LGHorizonShowRecordingList> {
    if (!this._entitlements.hasRecording) {
      return new LGHorizonShowRecordingList(null, null, []);
    }
    const serviceUrl = this._serviceConfig.getServiceUrl('recordingService');
    const lang = this._customer.getProfileLang(this._profileId);
    const json = await this.auth.request(
      serviceUrl,
      `/customers/${this.auth.householdId}/episodes/shows/${showId}?source=recording&isAdult=false&offset=0&limit=100&profileId=${this._profileId}&language=${lang}&channelId=${channelId}&sort=time&sortOrder=asc`,
    );
    return this._recordingFactory.createEpisodes(json);
  }

  async getRecordingQuota(): Promise<LGHorizonRecordingQuota> {
    if (!this._entitlements.hasRecording) return new LGHorizonRecordingQuota({});
    const serviceUrl = this._serviceConfig.getServiceUrl('recordingService');
    const json = await this.auth.request(
      serviceUrl,
      `/customers/${this.auth.householdId}/quota`,
    );
    return new LGHorizonRecordingQuota(json);
  }

  /** EPG for a date, merging the four six-hour segments (00/06/12/18). */
  async getEpg(epgDate?: Date, language?: string): Promise<LGHorizonEpg> {
    const date = epgDate ?? new Date();
    const lang = language ?? this._customer.getProfileLang(this._profileId);
    const baseCountryCode = this.auth.countryCode.slice(0, 2);
    const epgBase = this._serviceConfig.getServiceUrl('epgPackager-lite');
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const dateStr = `${y}${m}${d}`;

    const allEntries: Record<string, any[]> = {};
    for (const segment of ['00', '06', '12', '18']) {
      const path = `/${baseCountryCode}/${lang}/events/segments/${dateStr}${segment}0000`;
      try {
        const result = await this.auth.request(epgBase, path);
        for (const entry of result.entries ?? []) {
          const chId = entry.channelId ?? '';
          if (!allEntries[chId]) allEntries[chId] = [];
          allEntries[chId].push(...(entry.events ?? []));
        }
      } catch {
        this._log(`EPG segment ${dateStr}${segment}0000 not available`);
      }
    }

    const entries = Object.entries(allEntries).map(
      ([chId, events]) => new LGHorizonEpgEntry({ channelId: chId, events }),
    );
    return new LGHorizonEpg(entries);
  }

  async getEventDetail(eventId: string, language?: string): Promise<LGHorizonEventDetail> {
    const linearUrl = this._serviceConfig.getServiceUrl('linearService');
    const lang = language ?? this._customer.getProfileLang(this._profileId);
    const result = await this.auth.request(
      linearUrl,
      `/v2/replayEvent/${eventId}?returnLinearContent=true&forceLinearResponse=true&language=${lang}`,
    );
    return new LGHorizonEventDetail(result);
  }

  async getReplayChannels(language?: string): Promise<LGHorizonReplayChannel[]> {
    const replayUrl = this._serviceConfig.getServiceUrl('replayCatalogService');
    const lang = language ?? this._customer.getProfileLang(this._profileId);
    const result = await this.auth.request(replayUrl, `/channels?language=${lang}`);
    return (result.replayChannels ?? []).map((ch: any) => new LGHorizonReplayChannel(ch));
  }

  async getManagedRecordings(limit = 500, offset = 0): Promise<LGHorizonManagedRecordingList> {
    const recUrl = this._serviceConfig.getServiceUrl('recordingManagementService');
    const result = await this.auth.request(
      recUrl,
      `/customers/${this.auth.householdId}/recordings?limit=${limit}&offset=${offset}`,
    );
    return new LGHorizonManagedRecordingList(result);
  }
}
