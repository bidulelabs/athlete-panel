import {
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { AppError } from './errors';
export function digest(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
      .join(',') +
    '}'
  );
}
export const PASSWORD_PARAMETERS = { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 } as const;
const legacyParameters = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 } as const;
const passwordPrefix = 'scrypt$1$65536$8$2$';
// Dummy work for an unconfigured owner; no real credential and no module-load KDF.
export const DUMMY_PASSWORD_HASH = `${passwordPrefix}${'0'.repeat(32)}$${'0'.repeat(128)}`;

function parsedPassword(encoded: string) {
  const current = /^scrypt\$1\$65536\$8\$2\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  if (current?.[0] === encoded && current[1] && current[2])
    return {
      salt: Buffer.from(current[1], 'hex'),
      expected: Buffer.from(current[2], 'hex'),
      options: PASSWORD_PARAMETERS,
      legacy: false,
    };
  const legacy = /^([a-f0-9]{32}):([a-f0-9]{128})$/.exec(encoded);
  if (legacy?.[0] === encoded && legacy[1] && legacy[2])
    // Legacy scrypt received the hex salt as UTF-8, not as decoded bytes.
    return {
      salt: legacy[1],
      expected: Buffer.from(legacy[2], 'hex'),
      options: legacyParameters,
      legacy: true,
    };
  return null;
}
export function passwordNeedsRehash(encoded: string): boolean {
  return parsedPassword(encoded)?.legacy === true;
}
function derivePassword(
  password: string,
  salt: string | Buffer,
  options: typeof PASSWORD_PARAMETERS | typeof legacyParameters,
) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 64, options, (error, key) => (error ? reject(error) : resolve(key))),
  );
}
export function passwordHash(password: string) {
  const salt = randomBytes(16);
  return `${passwordPrefix}${salt.toString('hex')}$${scryptSync(password, salt, 64, PASSWORD_PARAMETERS).toString('hex')}`;
}
export async function passwordHashAsync(password: string) {
  const salt = randomBytes(16);
  const hash = await derivePassword(password, salt, PASSWORD_PARAMETERS);
  return `${passwordPrefix}${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(password: string, encoded: string) {
  const parsed = parsedPassword(encoded);
  if (!parsed) return false;
  const actual = scryptSync(password, parsed.salt, 64, parsed.options);
  return timingSafeEqual(actual, parsed.expected);
}
export async function verifyPasswordAsync(password: string, encoded: string): Promise<boolean> {
  const parsed = parsedPassword(encoded);
  if (!parsed) return false;
  const actual = await derivePassword(password, parsed.salt, parsed.options);
  return timingSafeEqual(actual, parsed.expected);
}
export function randomToken() {
  return randomBytes(32).toString('base64url');
}
function key() {
  const encoded = process.env.ENCRYPTION_KEY ?? '';
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== encoded)
    throw new AppError(
      'encryption_unconfigured',
      'ENCRYPTION_KEY must contain 32 random bytes encoded as base64.',
      503,
    );
  return decoded;
}
export function encrypt(secret: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((x) => x.toString('base64')).join('.');
}
export function decrypt(value: string) {
  try {
    const segments = value.split('.');
    if (segments.length !== 3) throw new Error('Invalid encrypted envelope.');
    const [iv, tag, data] = segments.map((segment) => {
      const decoded = Buffer.from(segment, 'base64');
      if (decoded.toString('base64') !== segment) throw new Error('Invalid base64.');
      return decoded;
    });
    if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !data)
      throw new Error('Invalid encrypted envelope.');
    const cipher = createDecipheriv('aes-256-gcm', key(), iv, { authTagLength: 16 });
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
  } catch {
    throw new AppError(
      'secret_unavailable',
      'Secret cannot be decrypted with this instance key.',
      503,
    );
  }
}
