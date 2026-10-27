import { createHash } from 'node:crypto';
import JSONBigInt from 'json-bigint';

export const GARMIN_ORIGIN = 'https://personal.connectapi.garmin.com';
export const GARMIN_TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const json = JSONBigInt({
  storeAsString: true,
  strict: true,
  protoAction: 'error',
  constructorAction: 'error',
});

export type GarminErrorCode =
  | 'invalid_configuration'
  | 'invalid_payload'
  | 'credentials_rejected'
  | 'forbidden'
  | 'rate_limited'
  | 'upstream_error'
  | 'request_failed'
  | 'request_timeout'
  | 'aborted'
  | 'account_identity_unavailable'
  | 'account_mismatch'
  | 'pagination_stalled';

/** Never contains provider response bodies, URLs with parameters, tokens or fetch error messages. */
export class GarminError extends Error {
  constructor(
    public readonly code: GarminErrorCode,
    message: string,
    public readonly status: number | null = null,
    public readonly retryAfterMs: number | null = null,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'GarminError';
  }
}

export type CachedGarminToken = {
  credentialGeneration: string;
  keyFingerprint: string;
  accessToken: string;
  expiresAt: number;
};
export type GarminTokenCache = {
  load(generation: string): Promise<CachedGarminToken | null>;
  save(token: CachedGarminToken): Promise<void>;
  clear?(generation: string): Promise<void>;
};
export type GarminQuery = Record<string, string | number | boolean>;
export type GarminReader = { get(path: string, query?: GarminQuery): Promise<unknown> };
export type GarminClientOptions = {
  apiKey: string;
  credentialGeneration: string | number;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  tokenCache?: GarminTokenCache;
  signal?: AbortSignal;
  requestIntervalMs?: number;
  timeoutMs?: number;
};

export function parseGarminJson(text: string): unknown {
  try {
    return json.parse(text);
  } catch {
    throw new GarminError('invalid_payload', 'Garmin returned invalid JSON.');
  }
}

export function retryAfterMilliseconds(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : null;
  const result = seconds === null ? Date.parse(value) - now : seconds * 1000;
  return Number.isFinite(result) ? Math.max(1000, result) : null;
}

const sleep = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GarminError('aborted', 'Garmin request was cancelled.'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new GarminError('aborted', 'Garmin request was cancelled.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });

function tokenExpiration(token: string, now: number): number {
  try {
    const pieces = token.split('.');
    const payload = pieces[1];
    if (pieces.length !== 3 || payload === undefined) throw new Error();
    // exp is used only for cache expiry, never as proof of identity or authorization.
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const expiry = (claims as { exp?: unknown })?.exp;
    if (typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry * 1000 <= now)
      throw new Error();
    return Math.min(expiry * 1000, now + 24 * 60 * 60 * 1000);
  } catch {
    throw new GarminError('invalid_payload', 'Garmin returned an invalid or expired access token.');
  }
}

const allowedGet =
  /^(?:\/activitylist-service\/activities\/search\/activities|\/sleep-service\/sleep\/dailySleepSummariesByDate|\/usersummary-service\/v2\/dailysummaries|\/hrv-service\/hrv\/daily\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}|\/usersummary-service\/stats\/(?:steps|stress)\/daily\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}|\/wellness-service\/wellness\/bodyBattery\/reports\/daily)$/;

export function createGarminClient(options: GarminClientOptions): GarminReader {
  const apiKey = options.apiKey.trim();
  const generation = String(options.credentialGeneration);
  const interval = options.requestIntervalMs ?? 1100;
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (
    !apiKey ||
    !generation ||
    !Number.isFinite(interval) ||
    interval < 0 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new GarminError(
      'invalid_configuration',
      'Garmin credentials or request settings are invalid.',
    );
  }
  const fingerprint = createHash('sha256').update(apiKey).digest('hex');
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const delay = options.sleep ?? sleep;
  let token: CachedGarminToken | null = null;
  let loaded = false;
  let lastRequest = Number.NEGATIVE_INFINITY;
  // Serializing complete calls avoids duplicate refreshes and overlapping requests per client.
  let queue = Promise.resolve();

  async function request(
    path: string,
    method: 'GET' | 'POST',
    authorization: string,
    query?: GarminQuery,
  ): Promise<string | null> {
    if (options.signal?.aborted) throw new GarminError('aborted', 'Garmin request was cancelled.');
    const wait = interval - (now() - lastRequest);
    if (wait > 0) await delay(wait, options.signal);
    if (options.signal?.aborted) throw new GarminError('aborted', 'Garmin request was cancelled.');
    const url = new URL(path, GARMIN_ORIGIN);
    for (const [key, value] of Object.entries(query ?? {}))
      url.searchParams.set(key, String(value));
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    lastRequest = now();
    try {
      const response = await fetcher(url, {
        method,
        headers: {
          Authorization: authorization,
          Accept: method === 'POST' ? '*/*' : 'application/json',
        },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401 || (method === 'POST' && response.status === 403))
          throw new GarminError(
            'credentials_rejected',
            'Garmin credentials were rejected. Replace or renew the Personal API key.',
            response.status,
          );
        if (response.status === 403)
          throw new GarminError('forbidden', 'Garmin denied access to this data stream.', 403);
        if (response.status === 429)
          throw new GarminError(
            'rate_limited',
            'Garmin rate limit reached. Sync will retry later.',
            429,
            retryAfterMilliseconds(response.headers.get('Retry-After'), now()) ?? 60_000,
            true,
          );
        throw new GarminError(
          'upstream_error',
          'Garmin could not complete this request.',
          response.status,
          null,
          response.status >= 500,
        );
      }
      if (response.status === 204) return null;
      const text = await response.text();
      return text.trim() || null;
    } catch (error) {
      if (error instanceof GarminError) throw error;
      if (timedOut)
        throw new GarminError('request_timeout', 'Garmin request timed out.', null, null, true);
      if (options.signal?.aborted)
        throw new GarminError('aborted', 'Garmin request was cancelled.');
      throw new GarminError('request_failed', 'Garmin could not be reached.', null, null, true);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  async function obtainToken(force = false): Promise<string> {
    if (!loaded && !force) {
      token = (await options.tokenCache?.load(generation)) ?? null;
      loaded = true;
    }
    if (
      !force &&
      token?.credentialGeneration === generation &&
      token.keyFingerprint === fingerprint &&
      token.expiresAt - now() > 60_000
    )
      return token.accessToken;
    token = null;
    if (force) await options.tokenCache?.clear?.(generation);
    const raw = await request(GARMIN_TOKEN_PATH, 'POST', `ApiKey ${apiKey}`);
    if (!raw) throw new GarminError('invalid_payload', 'Garmin returned an empty access token.');
    token = {
      credentialGeneration: generation,
      keyFingerprint: fingerprint,
      accessToken: raw,
      expiresAt: tokenExpiration(raw, now()),
    };
    loaded = true;
    await options.tokenCache?.save(token);
    return raw;
  }

  return {
    get(path, query) {
      if (!allowedGet.test(path))
        return Promise.reject(
          new GarminError(
            'invalid_configuration',
            'This Garmin endpoint is not allowed by the import plugin.',
          ),
        );
      const operation = queue.then(async () => {
        let bearer = await obtainToken();
        let response: string | null;
        try {
          response = await request(path, 'GET', `Bearer ${bearer}`, query);
        } catch (error) {
          if (!(error instanceof GarminError) || error.status !== 401) throw error;
          bearer = await obtainToken(true);
          response = await request(path, 'GET', `Bearer ${bearer}`, query);
        }
        return response === null ? null : parseGarminJson(response);
      });
      queue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  };
}
