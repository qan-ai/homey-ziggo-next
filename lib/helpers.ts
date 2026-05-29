/** Helper functions (port of helpers.py). */

const ID_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Create a random alphanumeric id with the given length. */
export function makeId(length = 10): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length));
  }
  return out;
}

/** Redact sensitive fields from data before logging. */
export function redactSensitive<T>(data: T): T {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }
  const redacted: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const key of [
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'token',
    'password',
  ]) {
    if (key in redacted) {
      redacted[key] = '***REDACTED***';
    }
  }
  return redacted as unknown as T;
}

/** Sleep for the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
