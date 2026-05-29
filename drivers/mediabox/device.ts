'use strict';

import Homey from 'homey';
import type ZiggoNextApp from '../../app';
import type { LGHorizonApi } from '../../lib/api';
import type { LGHorizonBox } from '../../lib/box';
import { LGHorizonRunningState, LGHorizonSourceType } from '../../lib/models';

interface AutocompleteItem {
  name: string;
  id: string;
  description?: string;
}

interface StoreCreds {
  countryCode: string;
  username: string;
  password: string;
  platformType?: string;
  refreshToken?: string;
}

const QUOTA_REFRESH_MS = 30 * 60 * 1000;

export default class MediaboxDevice extends Homey.Device {
  private api!: LGHorizonApi;
  box!: LGHorizonBox;
  private albumArt: Homey.Image | null = null;
  private quotaTimer: ReturnType<typeof setInterval> | null = null;

  // Previous values, for edge-triggered flow cards.
  private prevOn: boolean | null = null;
  private prevPlaying: boolean | null = null;
  private prevChannel: string | null = null;
  private prevTitle: string | null = null;

  private get app(): ZiggoNextApp {
    return this.homey.app as ZiggoNextApp;
  }

  async onInit(): Promise<void> {
    const creds = this.getStore() as StoreCreds;
    const deviceId = (this.getData() as { id: string }).id;

    try {
      this.api = await this.app.acquireApi(deviceId, {
        countryCode: creds.countryCode ?? 'nl',
        username: creds.username,
        password: creds.password,
        refreshToken: creds.refreshToken,
        onRefreshToken: (token) => {
          this.setStoreValue('refreshToken', token).catch((e) =>
            this.error('Failed to persist refresh token', e),
          );
        },
      });
    } catch (err) {
      this.error('Failed to initialize API', err);
      await this.setUnavailable(this.homey.__('errors.connection')).catch(() => undefined);
      return;
    }

    const box = this.api.getDevices()[deviceId];
    if (!box) {
      await this.setUnavailable(this.homey.__('errors.box_not_found')).catch(() => undefined);
      return;
    }
    this.box = box;

    await this._setupAlbumArt();
    this._registerCapabilityListeners();

    // setCallback publishes MQTT messages; fire-and-forget so a stalled publish
    // can never block device initialization.
    this.box
      .setCallback(async () => {
        await this._syncFromBox();
      })
      .catch((e) => this.error('setCallback failed', e));

    await this._syncFromBox();

    await this._refreshQuota();
    this.quotaTimer = this.homey.setInterval(() => {
      void this._refreshQuota();
    }, QUOTA_REFRESH_MS);

    this.log(`Mediabox device "${this.getName()}" initialized`);
  }

  private async _setupAlbumArt(): Promise<void> {
    try {
      this.albumArt = await this.homey.images.createImage();
      await this.setAlbumArtImage(this.albumArt);
    } catch (err) {
      this.error('Failed to set up album art', err);
    }
  }

  private _registerCapabilityListeners(): void {
    this.registerCapabilityListener('onoff', async (value: boolean) => {
      if (value) await this.box.turnOn();
      else await this.box.turnOff();
    });

    this.registerCapabilityListener('speaker_playing', async (value: boolean) => {
      if (value) await this.box.play();
      else await this.box.pause();
    });

    this.registerCapabilityListener('speaker_next', async () => {
      await this.box.nextChannel();
    });

    this.registerCapabilityListener('speaker_prev', async () => {
      await this.box.previousChannel();
    });
  }

  /** Map the box's current state onto Homey capabilities and fire flow cards. */
  private async _syncFromBox(): Promise<void> {
    const ds = this.box.deviceState;

    // Keep the device available (controllable) regardless of the box's power
    // state. When the box goes to standby/eco it reports offline, but we must
    // still allow "turn on" to be triggered (from the UI or a flow). Genuine
    // connection problems are handled in onInit / on API failure instead.
    // The off/standby state is reflected through the onoff capability below.
    await this.setAvailable().catch(() => undefined);

    const isOn = ds.state === LGHorizonRunningState.ONLINE_RUNNING;
    const isPlaying = isOn && !ds.paused;
    const channel = ds.channelName ?? '';
    const title = ds.showTitle ?? '';
    const source = this._sourceLabel(ds.sourceType);

    await this._safeSet('onoff', isOn);
    await this._safeSet('speaker_playing', isPlaying);
    await this._safeSet('mediabox_channel', channel);
    await this._safeSet('mediabox_title', title);
    await this._safeSet('mediabox_source', source);

    if (this.albumArt && ds.image) {
      this.albumArt.setUrl(ds.image);
      await this.albumArt.update().catch(() => undefined);
    }

    await this._fireTriggers(isOn, isPlaying, channel, title);
  }

  private async _fireTriggers(
    isOn: boolean,
    isPlaying: boolean,
    channel: string,
    title: string,
  ): Promise<void> {
    try {
      if (this.prevOn !== null && isOn !== this.prevOn) {
        await this._trigger(isOn ? 'box_turned_on' : 'box_turned_off');
      }
      if (this.prevPlaying !== null && isPlaying !== this.prevPlaying) {
        await this._trigger(isPlaying ? 'playback_resumed' : 'playback_paused');
      }
      if (channel && channel !== this.prevChannel) {
        await this._trigger('channel_changed', { channel });
      }
      if (title && title !== this.prevTitle) {
        await this._trigger('now_playing_changed', { title, channel });
      }
    } catch (err) {
      this.error('Error firing triggers', err);
    } finally {
      this.prevOn = isOn;
      this.prevPlaying = isPlaying;
      if (channel) this.prevChannel = channel;
      if (title) this.prevTitle = title;
    }
  }

  private async _trigger(id: string, tokens: Record<string, unknown> = {}): Promise<void> {
    await this.homey.flow.getDeviceTriggerCard(id).trigger(this, tokens).catch((e) => {
      this.error(`Trigger ${id} failed`, e);
    });
  }

  private _sourceLabel(sourceType: LGHorizonSourceType): string {
    switch (sourceType) {
      case LGHorizonSourceType.LINEAR:
        return this.homey.__('source.linear');
      case LGHorizonSourceType.REPLAY:
        return this.homey.__('source.replay');
      case LGHorizonSourceType.NDVR:
      case LGHorizonSourceType.LOCALDVR:
        return this.homey.__('source.recording');
      case LGHorizonSourceType.REVIEWBUFFER:
        return this.homey.__('source.reviewbuffer');
      case LGHorizonSourceType.VOD:
        return this.homey.__('source.vod');
      default:
        return '';
    }
  }

  private async _refreshQuota(): Promise<void> {
    if (!this.hasCapability('mediabox_recording_quota')) return;
    try {
      if (!this.api.hasRecording) return;
      const quota = await this.api.getRecordingQuota();
      await this._safeSet('mediabox_recording_quota', Math.round(quota.percentageUsed));
    } catch (err) {
      this.error('Failed to refresh recording quota', err);
    }
  }

  private async _safeSet(capability: string, value: unknown): Promise<void> {
    if (!this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value as any).catch((e) =>
      this.error(`Failed to set ${capability}`, e),
    );
  }

  // --- autocomplete helpers (called from the driver flow cards) -------------

  getChannelAutocomplete(query: string): AutocompleteItem[] {
    const q = (query || '').toLowerCase();
    const channels = this.api.getProfileChannels();
    return Object.values(channels)
      .map((c): AutocompleteItem => ({
        name: c.title,
        id: c.id,
        description: String(c.channelNumber),
      }))
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => Number(a.description) - Number(b.description));
  }

  async getRecordingAutocomplete(query: string): Promise<AutocompleteItem[]> {
    const q = (query || '').toLowerCase();
    try {
      const list = await this.api.getAllRecordings();
      return list.recordings
        .map((r): AutocompleteItem => ({ name: r.title, id: r.id }))
        .filter((r) => r.name.toLowerCase().includes(q));
    } catch (err) {
      this.error('Failed to load recordings', err);
      return [];
    }
  }

  /** Resolve the program currently airing on a channel and return flow tokens. */
  async getCurrentProgram(
    channelId: string,
    channelName: string,
  ): Promise<{
    title: string;
    description: string;
    channel: string;
    start_time: string;
    end_time: string;
  }> {
    const empty = {
      title: '',
      description: '',
      channel: channelName ?? '',
      start_time: '',
      end_time: '',
    };
    try {
      const epg = await this.api.getEpg();
      const events = epg.getChannelEvents(channelId);
      const nowSec = Math.floor(Date.now() / 1000);
      const current = events.find(
        (e) =>
          e.startTime !== null &&
          e.endTime !== null &&
          e.startTime <= nowSec &&
          nowSec < e.endTime,
      );
      if (!current) return empty;

      let description = '';
      try {
        if (current.eventId) {
          const detail = await this.api.getEventDetail(current.eventId);
          description = detail.description ?? '';
        }
      } catch (err) {
        this.error('Failed to fetch event detail', err);
      }

      return {
        title: current.title,
        description,
        channel: channelName ?? '',
        start_time: this._formatTime(current.startTime),
        end_time: this._formatTime(current.endTime),
      };
    } catch (err) {
      this.error('Failed to fetch current program', err);
      return empty;
    }
  }

  private _formatTime(epochSeconds: number | null): string {
    if (epochSeconds === null) return '';
    const tz = this.homey.clock.getTimezone();
    return new Date(epochSeconds * 1000).toLocaleTimeString('nl-NL', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });
  }

  async onDeleted(): Promise<void> {
    await this._cleanup();
  }

  async onUninit(): Promise<void> {
    await this._cleanup();
  }

  private async _cleanup(): Promise<void> {
    if (this.quotaTimer) {
      this.homey.clearInterval(this.quotaTimer);
      this.quotaTimer = null;
    }
    const creds = this.getStore() as StoreCreds;
    const deviceId = (this.getData() as { id: string }).id;
    if (creds?.username) {
      await this.app.releaseApi(deviceId, creds.username).catch((e) =>
        this.error('Error releasing API', e),
      );
    }
  }
}

module.exports = MediaboxDevice;
