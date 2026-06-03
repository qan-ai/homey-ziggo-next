'use strict';

import Homey from 'homey';
import { LGHorizonApi } from './lib/api';
import { LGHorizonAuth } from './lib/auth';
import {
  LGHorizonApiConnectionError,
  LGHorizonApiUnauthorizedError,
} from './lib/exceptions';

export interface AccountCredentials {
  countryCode: string;
  username: string;
  password: string;
  refreshToken?: string;
  /** Called whenever a new refresh token is issued, so the device can persist it. */
  onRefreshToken?: (refreshToken: string) => void;
}

interface AccountEntry {
  api: LGHorizonApi;
  ready: Promise<LGHorizonApi>;
  refs: Set<string>;
}

/**
 * Ziggo Next Homey app.
 *
 * One Ziggo account maps to a single household, a single MQTT connection and a
 * single LGHorizonApi — but it can serve several set-top boxes. This app owns an
 * account manager that shares one LGHorizonApi per username and reference-counts
 * the box devices using it (the HA integration gets this for free via its config
 * entry; on Homey we manage it explicitly).
 */
export default class ZiggoNextApp extends Homey.App {
  private accounts = new Map<string, AccountEntry>();

  async onInit(): Promise<void> {
    this.log('Ziggo Next app initialized');
  }

  /**
   * Get (or create) the shared API for an account and register a using device.
   * Subsequent calls for the same username reuse the same connection.
   */
  async acquireApi(deviceId: string, creds: AccountCredentials): Promise<LGHorizonApi> {
    const key = creds.username.toLowerCase();
    let entry = this.accounts.get(key);

    if (!entry) {
      const auth = new LGHorizonAuth({
        countryCode: creds.countryCode,
        username: creds.username,
        password: creds.password,
        refreshToken: creds.refreshToken,
        tokenRefreshCallback: creds.onRefreshToken ?? null,
        logger: (msg, ...args) => this.log(`[${key}]`, msg, ...args),
      });
      const api = new LGHorizonApi(auth, null, (msg, ...args) =>
        this.log(`[${key}]`, msg, ...args),
      );
      const ready = api
        .initialize()
        .then(() => api)
        .catch((err) => {
          // Failed init: drop the entry so a later retry starts fresh.
          this.accounts.delete(key);
          throw this._normalizeError(err);
        });
      entry = { api, ready, refs: new Set() };
      this.accounts.set(key, entry);
    } else if (creds.onRefreshToken) {
      // Keep the most recent device's persistence callback active.
      entry.api.setTokenRefreshCallback(creds.onRefreshToken);
    }

    entry.refs.add(deviceId);
    return entry.ready;
  }

  /**
   * Force a full reconnect for an account: disconnect the shared API + MQTT,
   * drop the entry, then have every device on that account re-acquire a fresh
   * API and re-bind its box. Used by the "Reconnect" button/flow after e.g. a
   * network change leaves the cloud/MQTT link stale.
   */
  async reconnectAccount(username: string): Promise<void> {
    const key = username.toLowerCase();
    this.log(`[${key}] Reconnect requested`);
    const entry = this.accounts.get(key);
    if (entry) {
      try {
        await entry.api.disconnect();
      } catch (err) {
        this.error('Reconnect: disconnect failed', err);
      }
      this.accounts.delete(key);
    }
    // Re-bind every device on this account (the first one re-creates the shared API).
    for (const driverId of ['mediabox', 'recordings']) {
      let driver: Homey.Driver;
      try {
        driver = this.homey.drivers.getDriver(driverId);
      } catch {
        continue;
      }
      for (const device of driver.getDevices()) {
        const store = device.getStore() as { username?: string };
        if ((store?.username ?? '').toLowerCase() !== key) continue;
        const anyDevice = device as unknown as { rebindAfterReconnect?: () => Promise<void> };
        if (typeof anyDevice.rebindAfterReconnect === 'function') {
          await anyDevice.rebindAfterReconnect().catch((e) => this.error('Reconnect: rebind failed', e));
        }
      }
    }
    this.log(`[${key}] Reconnect complete`);
  }

  /**
   * Reconnect every account in use (read from the devices' stored credentials).
   * Works even when devices are unavailable — invoked from the app settings page.
   */
  async reconnectAllAccounts(): Promise<{ accounts: number }> {
    const usernames = new Set<string>();
    for (const driverId of ['mediabox', 'recordings']) {
      let driver: Homey.Driver;
      try {
        driver = this.homey.drivers.getDriver(driverId);
      } catch {
        continue;
      }
      for (const device of driver.getDevices()) {
        const store = device.getStore() as { username?: string };
        if (store?.username) usernames.add(store.username.toLowerCase());
      }
    }
    for (const username of usernames) {
      await this.reconnectAccount(username).catch((e) => this.error('reconnectAll', e));
    }
    return { accounts: usernames.size };
  }

  /** Release a device's reference; disconnects the API when the last one leaves. */
  async releaseApi(deviceId: string, username: string): Promise<void> {
    const key = username.toLowerCase();
    const entry = this.accounts.get(key);
    if (!entry) return;
    entry.refs.delete(deviceId);
    if (entry.refs.size === 0) {
      this.accounts.delete(key);
      try {
        await entry.api.disconnect();
      } catch (err) {
        this.error('Error disconnecting API', err);
      }
    }
  }

  /**
   * Validate credentials and read the account topology (household id + boxes).
   * Used during pairing. Creates a throwaway API that is disconnected before
   * returning.
   */
  async probeAccount(creds: AccountCredentials): Promise<{
    householdId: string;
    boxes: Array<{ deviceId: string; name: string; platformType: string }>;
  }> {
    const auth = new LGHorizonAuth({
      countryCode: creds.countryCode,
      username: creds.username,
      password: creds.password,
      refreshToken: creds.refreshToken,
      logger: (msg, ...args) => this.log('[pair]', msg, ...args),
    });
    const api = new LGHorizonApi(auth, null, (msg, ...args) => this.log('[pair]', msg, ...args));
    try {
      await api.initialize();
      const devices = api.getDevices();
      return {
        householdId: api.auth.householdId,
        boxes: Object.values(devices).map((box) => ({
          deviceId: box.deviceId,
          name: box.deviceFriendlyName,
          platformType: box.platformType,
        })),
      };
    } catch (err) {
      throw this._normalizeError(err);
    } finally {
      await api.disconnect().catch(() => undefined);
    }
  }

  private _normalizeError(err: unknown): Error {
    if (err instanceof LGHorizonApiUnauthorizedError) {
      return new Error(this.homey.__('errors.invalid_credentials'));
    }
    if (err instanceof LGHorizonApiConnectionError) {
      return new Error(this.homey.__('errors.connection'));
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

module.exports = ZiggoNextApp;
