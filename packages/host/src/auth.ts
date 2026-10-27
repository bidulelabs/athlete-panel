import { requiredRow } from './rows';
import { connection } from './db';
import { initialOnboarding, writeOnboarding } from './onboarding';
import {
  digest,
  passwordHashAsync,
  passwordNeedsRehash,
  DUMMY_PASSWORD_HASH,
  randomToken,
  verifyPasswordAsync,
} from './crypto';
import { isIP } from 'node:net';
import { AppError, assert } from './errors';
import { checkSchema } from './schema';

export const SESSION_COOKIE = 'athlete_panel_session';
export async function ownerConfigured() {
  return (await connection()`select id from host.owner limit 1`).length > 0;
}
export async function bootstrapOwner(password: string, recover = false) {
  assert(
    password.length >= 12 && password.length <= 256,
    'invalid_password',
    'Use a password between 12 and 256 characters.',
  );
  const encoded = await passwordHashAsync(password);
  await connection().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(736147001)`;
    const owner = await tx`select id from host.owner`;
    if (owner.length && !recover)
      throw new AppError(
        'owner_exists',
        'Owner already exists. Use the console recovery operation.',
      );
    if (!owner.length && recover) throw new AppError('owner_missing', 'Bootstrap the owner first.');
    await tx`insert into host.owner (id,password_hash) values ('owner',${encoded}) on conflict(id) do update set password_hash=excluded.password_hash`;
    if (!owner.length) await writeOnboarding(tx, initialOnboarding());
    await tx`delete from host.sessions`;
    await tx`delete from host.login_attempts`;
    await tx`update host.grants set revoked=true`;
  });
}
/** The production proxy overwrites this header; the web port must stay private. */
export function loginClient(request: Request): string {
  if (process.env.TRUST_PROXY_CLIENT_IP !== 'true') return 'local';
  const address = request.headers.get('x-athlete-panel-client-ip');
  assert(
    address && isIP(address),
    'proxy_unconfigured',
    'The trusted proxy must supply the client address.',
    503,
  );
  // Aggregate IPv6 privacy addresses to /64 so rotating interface IDs cannot evade limits.
  const normalized =
    isIP(address) === 6 ? new URL(`http://[${address}]`).hostname.slice(1, -1) : address;
  if (isIP(address) === 6) {
    const [left, right = ''] = normalized.split('::');
    const first = left ? left.split(':') : [],
      last = right ? right.split(':') : [];
    const words = normalized.includes('::')
      ? [...first, ...Array(8 - first.length - last.length).fill('0'), ...last]
      : first;
    if (
      words.slice(0, 5).every((word) => parseInt(word, 16) === 0) &&
      parseInt(words[5], 16) === 65535
    ) {
      return words
        .slice(6)
        .flatMap((word) => {
          const value = parseInt(word, 16);
          return [value >>> 8, value & 255];
        })
        .join('.');
    }
    return words
      .slice(0, 4)
      .map((word) => word.padStart(4, '0'))
      .join(':');
  }
  return normalized;
}
let passwordChecks = 0;
export async function login(password: string, client = 'local') {
  await checkSchema();
  const sql = connection();
  // Keep address-derived keys only for the current window, never the raw address.
  const key = `client:${digest(client)}`;
  await sql`delete from host.login_attempts where reset_at<now()`;
  const attempts = await sql<
    { count: number }[]
  >`insert into host.login_attempts (key,count,reset_at) values (${key},1,now()+interval '15 minutes')
    on conflict(key) do update set count=case when host.login_attempts.reset_at<now() then 1 else host.login_attempts.count+1 end,
    reset_at=case when host.login_attempts.reset_at<now() then now()+interval '15 minutes' else host.login_attempts.reset_at end returning count`;
  assert(
    requiredRow(attempts).count <= 20,
    'rate_limited',
    'Too many login attempts. Try again in 15 minutes.',
    429,
  );
  assert(passwordChecks < 2, 'login_busy', 'Sign-in is busy. Try again shortly.', 429);
  passwordChecks++;
  try {
    return await createVerifiedSession(password, key);
  } finally {
    passwordChecks--;
  }
}

async function createVerifiedSession(password: string, attemptKey: string): Promise<string> {
  const sql = connection();
  // A concurrent login upgrade or console recovery may replace the verified hash.
  // Retry outside the lock once; never grant a session from an obsolete snapshot.
  for (let attempt = 0; attempt < 2; attempt++) {
    const [owner] = await sql<
      { password_hash: string }[]
    >`select password_hash from host.owner where id='owner'`;
    const encoded = owner?.password_hash ?? DUMMY_PASSWORD_HASH;
    const valid = await verifyPasswordAsync(password, encoded);
    assert(
      owner && valid,
      'invalid_credentials',
      'Incorrect password or owner not configured.',
      401,
    );
    const replacement = passwordNeedsRehash(encoded) ? await passwordHashAsync(password) : null;
    const token = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(736147001)`;
      const [current] = await tx<
        { password_hash: string }[]
      >`select password_hash from host.owner where id='owner'`;
      if (current?.password_hash !== encoded) return null;
      if (replacement) {
        const changed = requiredRow(
          await tx<
            { upgraded: boolean }[]
          >`select host.upgrade_password_hash(${encoded},${replacement}) as upgraded`,
        );
        if (!changed.upgraded) return null;
      }
      const token = randomToken();
      await tx`delete from host.login_attempts where key=${attemptKey}`;
      await tx`delete from host.sessions where expires_at<now()`;
      await tx`insert into host.sessions (token_hash,expires_at) values (${digest(token)},now()+interval '7 days')`;
      return token;
    });
    if (token) return token;
  }
  throw new AppError('invalid_credentials', 'Credentials changed during sign-in. Try again.', 401);
}

export async function requireSession(token?: string | null) {
  assert(token, 'unauthorized', 'Sign in to continue.', 401);
  await checkSchema();
  const rows =
    await connection()`select token_hash from host.sessions where token_hash=${digest(token)} and expires_at>now()`;
  assert(rows.length, 'unauthorized', 'Your session has expired. Sign in again.', 401);
}
export async function logout(token?: string | null) {
  if (token) await connection()`delete from host.sessions where token_hash=${digest(token)}`;
}
export function requireOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN;
  assert(configured, 'origin_unconfigured', 'APP_ORIGIN is required.', 503);
  const expected = new URL(configured);
  const allowed = new Set([expected.origin]);
  // Local browsers commonly use either name. Keep the protocol and port exact;
  // do not expand the trusted origins of an HTTPS or proxy-hosted instance.
  if (
    expected.protocol === 'http:' &&
    ['127.0.0.1', 'localhost'].includes(expected.hostname) &&
    process.env.COOKIE_SECURE === 'false' &&
    process.env.TRUST_PROXY_CLIENT_IP !== 'true'
  ) {
    const alias = new URL(expected.origin);
    alias.hostname = expected.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    allowed.add(alias.origin);
  }
  assert(
    allowed.has(request.headers.get('origin') ?? ''),
    'invalid_origin',
    `Request origin is not allowed. Open ${expected.origin} and try again.`,
    403,
  );
}
