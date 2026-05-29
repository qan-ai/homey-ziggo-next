/** LG Horizon authentication + authenticated requests (port of LGHorizonAuth). */

import { COUNTRY_SETTINGS } from './const';
import { LGHorizonServicesConfig } from './models';
import {
  LGHorizonApiConnectionError,
  LGHorizonApiUnauthorizedError,
} from './exceptions';
import { redactSensitive, sleep } from './helpers';

export type TokenRefreshCallback = (refreshToken: string) => void;
export type Logger = (message: string, ...args: unknown[]) => void;

const noopLogger: Logger = () => undefined;

/**
 * Minimal cookie jar. The Spark/GNP API authenticates via cookies set on the
 * auth response and replayed on subsequent calls — aiohttp's ClientSession does
 * this transparently in the Python original, so we replicate it here.
 */
class CookieJar {
  private cookies = new Map<string, string>();

  store(response: Response): void {
    const headers = response.headers as any;
    let raw: string[] = [];
    if (typeof headers.getSetCookie === 'function') {
      raw = headers.getSetCookie();
    } else if (typeof headers.raw === 'function') {
      raw = headers.raw()['set-cookie'] ?? [];
    } else {
      const single = response.headers.get('set-cookie');
      if (single) raw = [single];
    }
    for (const cookie of raw) {
      const pair = cookie.split(';', 1)[0];
      const idx = pair.indexOf('=');
      if (idx > 0) {
        this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

export class LGHorizonAuth {
  private _refreshToken: string;
  private _accessToken: string | null = null;
  private _username: string;
  private _password: string;
  private _householdId = '';
  private _tokenExpiry: number | null = null;
  private readonly _countryCode: string;
  private readonly _host: string;
  private readonly _useRefreshToken: boolean;
  private _serviceConfig: LGHorizonServicesConfig | null = null;

  tokenRefreshCallback: TokenRefreshCallback | null;
  log: Logger;
  private readonly _jar = new CookieJar();

  constructor(opts: {
    countryCode: string;
    refreshToken?: string;
    username?: string;
    password?: string;
    tokenRefreshCallback?: TokenRefreshCallback | null;
    logger?: Logger;
  }) {
    const setting = COUNTRY_SETTINGS[opts.countryCode];
    if (!setting) {
      throw new Error(`Unknown country code '${opts.countryCode}'`);
    }
    this._countryCode = opts.countryCode;
    this._refreshToken = opts.refreshToken ?? '';
    this._username = opts.username ?? '';
    this._password = opts.password ?? '';
    this._host = setting.api_url;
    this._useRefreshToken = setting.use_refreshtoken || !!opts.refreshToken;
    this.tokenRefreshCallback = opts.tokenRefreshCallback ?? null;
    this.log = opts.logger ?? noopLogger;
  }

  get refreshToken(): string {
    return this._refreshToken;
  }
  set refreshToken(value: string) {
    this._refreshToken = value;
  }
  get accessToken(): string | null {
    return this._accessToken;
  }
  get username(): string {
    return this._username;
  }
  get password(): string {
    return this._password;
  }
  get householdId(): string {
    return this._householdId;
  }
  get tokenExpiry(): number | null {
    return this._tokenExpiry;
  }
  get countryCode(): string {
    return this._countryCode;
  }

  /** True when there is no valid token, or it expires within one day. */
  isTokenExpiring(): boolean {
    if (!this._accessToken || !this._tokenExpiry) return true;
    const now = Math.floor(Date.now() / 1000);
    return now >= this._tokenExpiry - 86400;
  }

  /** Fetch (or refresh) the access token. */
  async fetchAccessToken(): Promise<void> {
    this.log('Fetching access token');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      charset: 'utf-8',
    };

    let payload: Record<string, unknown>;
    let path: string;
    if (!this._useRefreshToken && this._accessToken === null) {
      payload = { password: this._password, username: this._username };
      headers['x-device-code'] = 'web';
      path = '/auth-service/v1/authorization';
    } else {
      payload = { refreshToken: this._refreshToken };
      path = '/auth-service/v1/authorization/refresh';
    }

    const cookie = this._jar.header();
    if (cookie) headers['cookie'] = cookie;

    let response: Response;
    try {
      response = await fetch(`${this._host}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    } catch (ex) {
      throw new LGHorizonApiConnectionError(String(ex));
    }
    this._jar.store(response);

    const authJson: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = authJson?.error;
      if (error && error.statusCode === 97401) {
        throw new LGHorizonApiUnauthorizedError('Invalid credentials');
      }
      if (error && error.statusCode === 97402) {
        throw new LGHorizonApiUnauthorizedError('Invalid token');
      }
      if (error) {
        throw new LGHorizonApiConnectionError(error.message);
      }
      throw new LGHorizonApiConnectionError('Unknown connection error');
    }

    this._householdId = authJson.householdId;
    this._accessToken = authJson.accessToken;
    this._refreshToken = authJson.refreshToken;
    if (this.tokenRefreshCallback) {
      this.tokenRefreshCallback(this._refreshToken);
    }
    this._username = authJson.username;
    this._tokenExpiry = authJson.refreshTokenExpiry;
    this.log('Access token fetched; refresh token expiry:', this._tokenExpiry);
  }

  /**
   * Make an authenticated GET request. Refreshes the token when it is about to
   * expire and retries once on a 401. Retries connection errors up to 3 times
   * with exponential backoff (port of backoff.on_exception).
   */
  async request(host: string, path: string, init?: RequestInit): Promise<any> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this._requestOnce(host, path, init);
      } catch (ex) {
        lastError = ex;
        if (ex instanceof LGHorizonApiUnauthorizedError) throw ex;
        if (!(ex instanceof LGHorizonApiConnectionError)) throw ex;
        if (attempt < 2) {
          await sleep(2 ** attempt * 1000);
        }
      }
    }
    throw lastError;
  }

  private async _requestOnce(host: string, path: string, init?: RequestInit): Promise<any> {
    const url = `${host}${path}`;
    if (this.isTokenExpiring()) {
      this.log('Access token is expiring, fetching a new one');
      await this.fetchAccessToken();
    }

    const doFetch = async (): Promise<Response> => {
      const headers: Record<string, string> = {
        ...(init?.headers as Record<string, string> | undefined),
      };
      const cookie = this._jar.header();
      if (cookie) headers['cookie'] = cookie;
      if (this._accessToken) {
        // The Spark API authenticates via cookies, but some endpoints also
        // accept the access token header; harmless when ignored.
        headers['X-OESP-Token'] = this._accessToken;
      }
      const response = await fetch(url, { method: 'GET', ...init, headers });
      this._jar.store(response);
      return response;
    };

    let response: Response;
    try {
      response = await doFetch();
      if (response.status === 401) {
        this.log('Got 401, refreshing token and retrying', url);
        await this.fetchAccessToken();
        response = await doFetch();
      }
      if (!response.ok) {
        throw new LGHorizonApiConnectionError(
          `Unable to call ${url}. Status: ${response.status}`,
        );
      }
      const json = await response.json();
      this.log('Response from', url, redactSensitive(json));
      return json;
    } catch (ex) {
      if (ex instanceof LGHorizonApiConnectionError) throw ex;
      throw new LGHorizonApiConnectionError(`Unable to call ${url}. Error: ${String(ex)}`);
    }
  }

  /** Get the MQTT token used as the broker password. */
  async getMqttToken(): Promise<string> {
    this.log('Fetching MQTT token');
    const config = await this.getServiceConfig();
    const serviceUrl = config.getServiceUrl('authorizationService');
    const result = await this.request(serviceUrl, '/v1/mqtt/token');
    return result.token;
  }

  /** Fetch (and cache) the service configuration with all service URLs. */
  async getServiceConfig(): Promise<LGHorizonServicesConfig> {
    if (this._serviceConfig === null) {
      const baseCountryCode = this._countryCode.slice(0, 2);
      const result = await this.request(
        this._host,
        `/${baseCountryCode}/en/config-service/conf/web/backoffice.json`,
      );
      this._serviceConfig = new LGHorizonServicesConfig(result);
    }
    return this._serviceConfig;
  }
}
