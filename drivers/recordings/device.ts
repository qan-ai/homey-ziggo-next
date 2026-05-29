'use strict';

import Homey from 'homey';
import type ZiggoNextApp from '../../app';
import type { LGHorizonApi } from '../../lib/api';

interface StoreCreds {
  countryCode: string;
  username: string;
  password: string;
  refreshToken?: string;
}

const REFRESH_MS = 15 * 60 * 1000;

export default class RecordingsDevice extends Homey.Device {
  private api!: LGHorizonApi;
  private timer: ReturnType<typeof setInterval> | null = null;

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

    if (!this.api.hasRecording) {
      await this.setUnavailable(this.homey.__('errors.no_recording')).catch(() => undefined);
      return;
    }

    await this.setAvailable().catch(() => undefined);
    await this._refresh();
    this.timer = this.homey.setInterval(() => {
      void this._refresh();
    }, REFRESH_MS);

    this.log(`Recordings device "${this.getName()}" initialized`);
  }

  private async _refresh(): Promise<void> {
    try {
      const quota = await this.api.getRecordingQuota();
      await this._safeSet('mediabox_recording_quota', Math.round(quota.percentageUsed));
    } catch (err) {
      this.error('Failed to refresh quota', err);
    }

    try {
      const count = await this._fetchRecordingCount();
      if (count !== null) {
        await this._safeSet('mediabox_recording_count', count);
      }
    } catch (err) {
      this.error('Failed to refresh recording count', err);
    }
  }

  private async _fetchRecordingCount(): Promise<number | null> {
    // Prefer the management service (returns the full total); fall back to the
    // standard recordings list if it is unavailable on this account.
    try {
      const managed = await this.api.getManagedRecordings(1, 0);
      if (managed.total > 0 || managed.recordings.length > 0) return managed.total;
    } catch {
      // ignore and fall back
    }
    try {
      const list = await this.api.getAllRecordings();
      return list.total;
    } catch {
      return null;
    }
  }

  private async _safeSet(capability: string, value: unknown): Promise<void> {
    if (!this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value as any).catch((e) =>
      this.error(`Failed to set ${capability}`, e),
    );
  }

  async onDeleted(): Promise<void> {
    await this._cleanup();
  }

  async onUninit(): Promise<void> {
    await this._cleanup();
  }

  private async _cleanup(): Promise<void> {
    if (this.timer) {
      this.homey.clearInterval(this.timer);
      this.timer = null;
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

module.exports = RecordingsDevice;
