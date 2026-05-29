/** Process incoming device state messages (port of device_state_processor.py). */

import { LGHorizonAuth, Logger } from './auth';
import {
  LGHorizonAppsState,
  LGHorizonChannel,
  LGHorizonCustomer,
  LGHorizonDeviceState,
  LGHorizonLinearSource,
  LGHorizonMediaType,
  LGHorizonNDVRSource,
  LGHorizonPlayerState,
  LGHorizonRecordingSingle,
  LGHorizonRecordingSource,
  LGHorizonReplayEvent,
  LGHorizonReplaySource,
  LGHorizonReviewBufferSource,
  LGHorizonRunningState,
  LGHorizonSourceType,
  LGHorizonStatusMessage,
  LGHorizonUIStateType,
  LGHorizonUIStatusMessage,
  LGHorizonVOD,
  LGHorizonVODSource,
  LGHorizonVODType,
} from './models';

const noopLogger: Logger = () => undefined;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class LGHorizonDeviceStateProcessor {
  constructor(
    private _auth: LGHorizonAuth,
    private _channels: Record<string, LGHorizonChannel>,
    private _customer: LGHorizonCustomer,
    private _profileId: string,
    private _log: Logger = noopLogger,
  ) {}

  async processState(
    deviceState: LGHorizonDeviceState,
    statusMessage: LGHorizonStatusMessage,
  ): Promise<void> {
    deviceState.reset();
    deviceState.state = statusMessage.runningState;
    if (
      statusMessage.runningState === LGHorizonRunningState.ONLINE_STANDBY ||
      statusMessage.runningState === LGHorizonRunningState.OFFLINE
    ) {
      deviceState.clearLinearMetadataCache();
    }
  }

  async processUiState(
    deviceState: LGHorizonDeviceState,
    uiStatusMessage: LGHorizonUIStatusMessage,
  ): Promise<void> {
    deviceState.reset();
    if (
      uiStatusMessage.uiState === null ||
      deviceState.state === LGHorizonRunningState.ONLINE_STANDBY
    ) {
      deviceState.reset();
      return;
    }

    switch (uiStatusMessage.uiState.uiStatus) {
      case LGHorizonUIStateType.MAINUI:
        if (uiStatusMessage.uiState.playerState === null) return;
        await this._processMainUiState(deviceState, uiStatusMessage.uiState.playerState);
        break;
      case LGHorizonUIStateType.APPS:
        if (uiStatusMessage.uiState.appsState === null) return;
        await this._processAppsState(deviceState, uiStatusMessage.uiState.appsState);
        break;
      default:
        break;
    }
  }

  private async _processMainUiState(
    deviceState: LGHorizonDeviceState,
    playerState: LGHorizonPlayerState,
  ): Promise<void> {
    deviceState.reset();
    deviceState.sourceType = playerState.sourceType;
    deviceState.uiStateType = LGHorizonUIStateType.MAINUI;
    deviceState.speed = playerState.speed;

    switch (playerState.sourceType) {
      case LGHorizonSourceType.LINEAR:
        await this._processLinearState(deviceState, playerState);
        break;
      case LGHorizonSourceType.REVIEWBUFFER:
        await this._processReviewBufferState(deviceState, playerState);
        break;
      case LGHorizonSourceType.REPLAY:
        await this._processReplayState(deviceState, playerState);
        break;
      case LGHorizonSourceType.VOD:
        await this._processVodState(deviceState, playerState);
        break;
      case LGHorizonSourceType.NDVR:
        await this._processNdvrState(deviceState, playerState);
        break;
      default:
        break;
    }
  }

  private async _processAppsState(
    deviceState: LGHorizonDeviceState,
    appsState: LGHorizonAppsState,
  ): Promise<void> {
    if (LGHorizonDeviceState.isLauncherApp(appsState.appName, appsState.logoPath)) {
      if (deviceState.restoreLinearMetadata()) {
        deviceState.uiStateType = LGHorizonUIStateType.MAINUI;
        return;
      }
    }
    deviceState.id = appsState.id;
    deviceState.showTitle = appsState.appName;
    deviceState.appName = appsState.appName;
    deviceState.image = appsState.logoPath;
    deviceState.uiStateType = LGHorizonUIStateType.APPS;
    deviceState.mediaType = LGHorizonMediaType.APP;
  }

  private async _fetchReplayEvent(eventId: string): Promise<LGHorizonReplayEvent> {
    const serviceConfig = await this._auth.getServiceConfig();
    const serviceUrl = serviceConfig.getServiceUrl('linearService');
    const lang = this._customer.getProfileLang(this._profileId);
    const path = `/v2/replayEvent/${eventId}?returnLinearContent=true&language=${lang}`;
    const json = await this._auth.request(serviceUrl, path);
    return new LGHorizonReplayEvent(json);
  }

  private _streamImageUrl(channel: LGHorizonChannel): string {
    const join = channel.streamImage.includes('?') ? '&' : '?';
    return `${channel.streamImage}${join}${Math.floor(Math.random() * 1000000)}`;
  }

  private async _processLinearState(
    deviceState: LGHorizonDeviceState,
    playerState: LGHorizonPlayerState,
  ): Promise<void> {
    if (playerState.source === null) return;
    const source = playerState.source as LGHorizonLinearSource;
    const replayEvent = await this._fetchReplayEvent(source.eventId);
    const channel = this._channels[replayEvent.channelId];
    if (!channel) return;

    deviceState.mediaType = LGHorizonMediaType.CHANNEL;
    deviceState.id = replayEvent.eventId;
    deviceState.sourceType = source.sourceType;
    deviceState.channelId = channel.id;
    deviceState.channelName = channel.title;
    deviceState.episodeTitle = replayEvent.episodeName;
    deviceState.seasonNumber = replayEvent.seasonNumber;
    deviceState.episodeNumber = replayEvent.episodeNumber;
    deviceState.showTitle = replayEvent.title;
    deviceState.lastPositionUpdate = nowSeconds();
    deviceState.startTime = replayEvent.startTime;
    deviceState.endTime = replayEvent.endTime;
    if (replayEvent.endTime !== null && replayEvent.startTime !== null) {
      deviceState.duration = replayEvent.endTime - replayEvent.startTime;
      deviceState.position = nowSeconds() - Math.floor(replayEvent.startTime);
    }
    deviceState.image = this._streamImageUrl(channel);
    deviceState.cacheLinearMetadata();
  }

  private async _processReviewBufferState(
    deviceState: LGHorizonDeviceState,
    playerState: LGHorizonPlayerState,
  ): Promise<void> {
    if (playerState.source === null) return;
    const source = playerState.source as LGHorizonReviewBufferSource;
    const replayEvent = await this._fetchReplayEvent(source.eventId);
    const channel = this._channels[replayEvent.channelId];
    if (!channel) return;

    deviceState.mediaType = LGHorizonMediaType.CHANNEL;
    deviceState.id = replayEvent.eventId;
    deviceState.sourceType = source.sourceType;
    deviceState.channelId = channel.id;
    deviceState.channelName = channel.title;
    deviceState.episodeTitle = replayEvent.episodeName;
    deviceState.seasonNumber = replayEvent.seasonNumber;
    deviceState.episodeNumber = replayEvent.episodeNumber;
    deviceState.showTitle = replayEvent.title;
    deviceState.lastPositionUpdate =
      playerState.lastSpeedChangeTime !== null
        ? Math.floor(playerState.lastSpeedChangeTime)
        : null;
    deviceState.position = Math.floor(playerState.relativePosition / 1000);
    deviceState.startTime = replayEvent.startTime;
    deviceState.endTime = replayEvent.endTime;
    if (replayEvent.endTime !== null && replayEvent.startTime !== null) {
      deviceState.duration = replayEvent.endTime - replayEvent.startTime;
    }
    deviceState.image = this._streamImageUrl(channel);
    deviceState.cacheLinearMetadata();
  }

  private async _processReplayState(
    deviceState: LGHorizonDeviceState,
    playerState: LGHorizonPlayerState,
  ): Promise<void> {
    if (playerState.source === null) return;
    const source = playerState.source as LGHorizonReplaySource;
    const replayEvent = await this._fetchReplayEvent(source.eventId);
    const channel = this._channels[replayEvent.channelId];

    deviceState.mediaType = LGHorizonMediaType.CHANNEL;
    deviceState.id = replayEvent.eventId;
    deviceState.sourceType = source.sourceType;
    deviceState.channelId = channel ? channel.id : replayEvent.channelId;
    deviceState.channelName = channel ? channel.title : null;
    deviceState.episodeTitle = replayEvent.episodeName;
    deviceState.seasonNumber = replayEvent.seasonNumber;
    deviceState.episodeNumber = replayEvent.episodeNumber;
    deviceState.showTitle = replayEvent.title;
    deviceState.lastPositionUpdate =
      playerState.lastSpeedChangeTime !== null
        ? Math.floor(playerState.lastSpeedChangeTime)
        : null;
    deviceState.startTime = replayEvent.startTime;
    deviceState.endTime = replayEvent.endTime;
    if (replayEvent.endTime !== null && replayEvent.startTime !== null) {
      deviceState.duration = replayEvent.endTime - replayEvent.startTime;
    }
    deviceState.position = Math.floor(playerState.relativePosition / 1000);
    deviceState.image = await this._getIntentImageUrl(replayEvent.eventId);
    deviceState.cacheLinearMetadata();
  }

  private async _processVodState(
    deviceState: LGHorizonDeviceState,
    playerState: LGHorizonPlayerState,
  ): Promise<void> {
    if (playerState.source === null) return;
    const source = playerState.source as LGHorizonVODSource;
    const serviceConfig = await this._auth.getServiceConfig();
    const serviceUrl = serviceConfig.getServiceUrl('vodService');
    const lang = this._customer.getProfileLang(this._profileId);
    const path = `/v2/detailscreen/${source.titleId}?language=${lang}&profileId=${this._profileId}&cityId=${this._customer.cityId}`;
    const vodJson = await this._auth.request(serviceUrl, path);
    const vod = new LGHorizonVOD(vodJson);

    deviceState.id = vod.id;
    if (vod.vodType === LGHorizonVODType.EPISODE) {
      deviceState.showTitle = vod.seriesTitle;
      deviceState.episodeTitle = vod.title;
      deviceState.seasonNumber = vod.season;
      deviceState.episodeNumber = vod.episode;
      deviceState.mediaType = LGHorizonMediaType.EPISODE;
    } else {
      deviceState.showTitle = vod.title;
      deviceState.mediaType = LGHorizonMediaType.MOVIE;
    }
    deviceState.duration = vod.duration;
    deviceState.lastPositionUpdate = nowSeconds();
    deviceState.position = Math.floor(playerState.relativePosition / 1000);
    deviceState.image = await this._getIntentImageUrl(vod.id);
  }

  private async _processNdvrState(
    deviceState: LGHorizonDeviceState,
    playerState: LGHorizonPlayerState,
  ): Promise<void> {
    if (playerState.source === null) return;
    const source = playerState.source as LGHorizonNDVRSource;
    const serviceConfig = await this._auth.getServiceConfig();
    const serviceUrl = serviceConfig.getServiceUrl('recordingService');
    const lang = this._customer.getProfileLang(this._profileId);
    const path = `/customers/${this._customer.customerId}/details/single/${source.recordingId}?profileId=${this._profileId}&language=${lang}`;
    const recordingJson = await this._auth.request(serviceUrl, path);
    const recording = new LGHorizonRecordingSingle(recordingJson);

    deviceState.id = recording.id;
    deviceState.channelId = recording.channelId;
    if (recording.channelId) {
      const channel = this._channels[recording.channelId];
      if (channel) deviceState.channelName = channel.title;
    }
    deviceState.episodeTitle = recording.episodeTitle;
    deviceState.seasonNumber = recording.seasonNumber;
    deviceState.episodeNumber = recording.episodeNumber;
    deviceState.lastPositionUpdate =
      playerState.lastSpeedChangeTime !== null
        ? Math.floor(playerState.lastSpeedChangeTime)
        : null;
    deviceState.position = Math.floor(playerState.relativePosition / 1000);
    deviceState.adBreaks = source.adManifest;

    const parsedStart = this._parseTimestamp(recording.startTime);
    const parsedEnd = this._parseTimestamp(recording.endTime);
    if (parsedStart !== null) deviceState.startTime = parsedStart;
    if (parsedEnd !== null) deviceState.endTime = parsedEnd;
    if (parsedStart !== null && parsedEnd !== null) {
      deviceState.duration = parsedEnd - parsedStart;
    }
    if (recording.source === LGHorizonRecordingSource.SHOW) {
      deviceState.showTitle = recording.title;
    } else {
      deviceState.showTitle = recording.showTitle;
    }
    deviceState.mediaType = LGHorizonMediaType.CHANNEL;
    deviceState.image = await this._getIntentImageUrl(recording.id);
  }

  private _parseTimestamp(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    try {
      if (typeof value === 'number') return Math.floor(value);
      const ms = Date.parse(String(value).replace('Z', '+00:00'));
      if (Number.isNaN(ms)) return null;
      return Math.floor(ms / 1000);
    } catch {
      return null;
    }
  }

  private async _getIntentImageUrl(intentId: string): Promise<string | null> {
    const serviceConfig = await this._auth.getServiceConfig();
    const intentsUrl = serviceConfig.getServiceUrl('imageService');
    const bodyJson = [{ id: intentId, intents: ['detailedBackground', 'posterTile'] }];
    const encoded = encodeURIComponent(JSON.stringify(bodyJson));
    const path = `/intent?jsonBody=${encoded}`;
    try {
      const result = await this._auth.request(intentsUrl, path);
      if (
        result[0] &&
        result[0].intents &&
        result[0].intents.length > 0 &&
        result[0].intents[0].url
      ) {
        return result[0].intents[0].url;
      }
    } catch (e) {
      this._log('Failed to fetch intent image', e);
    }
    return null;
  }
}
