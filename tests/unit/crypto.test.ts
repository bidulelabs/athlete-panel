import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import {
  decrypt,
  encrypt,
  passwordHash,
  passwordHashAsync,
  passwordNeedsRehash,
  verifyPassword,
  verifyPasswordAsync,
} from '../../packages/host/src/crypto';

const originalKey = process.env.ENCRYPTION_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

it('accepts existing and current GCM envelopes, including empty plaintext', () => {
  const key = randomBytes(32),
    iv = randomBytes(12);
  process.env.ENCRYPTION_KEY = key.toString('base64');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update('synthetic legacy', 'utf8'), cipher.final()]);
  const legacy = [iv, cipher.getAuthTag(), data].map((x) => x.toString('base64')).join('.');
  expect(decrypt(legacy)).toBe('synthetic legacy');
  for (const secret of ['', 'synthetic 🔐']) expect(decrypt(encrypt(secret))).toBe(secret);
});

it('rejects short tags, invalid IVs, noncanonical base64, extra segments and tampering', () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const envelope = encrypt('synthetic secret');
  const [iv, tag, data] = envelope.split('.') as [string, string, string];
  const invalid = [
    envelope + '.extra',
    `${iv}.${tag}`,
    `${iv}!.${tag}.${data}`,
    `${iv}.${tag.replace(/=+$/, '')}.${data}`,
    `${Buffer.alloc(11).toString('base64')}.${tag}.${data}`,
    `${iv}.${Buffer.from(tag, 'base64').subarray(0, 4).toString('base64')}.${data}`,
    `${iv}.${Buffer.alloc(16).toString('base64')}.${data}`,
    `${iv}.${tag}.${Buffer.from('changed').toString('base64')}`,
  ];
  for (const value of invalid)
    expect(() => decrypt(value)).toThrow(
      expect.objectContaining({ code: 'secret_unavailable', status: 503 }),
    );
  process.env.ENCRYPTION_KEY += '!';
  expect(() => encrypt('secret')).toThrow(
    expect.objectContaining({ code: 'encryption_unconfigured' }),
  );
  expect(() => decrypt(envelope)).toThrow(expect.objectContaining({ code: 'secret_unavailable' }));
});

it('preserves the legacy UTF-8 salt interpretation and creates strictly versioned hashes', async () => {
  const password = 'synthetic password';
  const salt = randomBytes(16).toString('hex');
  const legacy = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  const current = await passwordHashAsync(password);
  expect(current).toMatch(/^scrypt\$1\$65536\$8\$2\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  expect(passwordNeedsRehash(legacy)).toBe(true);
  expect(passwordNeedsRehash(current)).toBe(false);
  for (const hash of [legacy, current, passwordHash(password)]) {
    expect(verifyPassword(password, hash)).toBe(true);
    expect(await verifyPasswordAsync(password, hash)).toBe(true);
    expect(await verifyPasswordAsync('wrong', hash)).toBe(false);
  }
  for (const hash of [
    legacy + ':extra',
    legacy + '\n',
    current + '\n',
    legacy.slice(1),
    current + '$extra',
    current.replace('$1$', '$2$'),
    current.replace('$65536$', '$999999999$'),
    current.replace('$8$', '$9$'),
    'invalid',
  ]) {
    expect(verifyPassword(password, hash)).toBe(false);
    expect(await verifyPasswordAsync(password, hash)).toBe(false);
    expect(passwordNeedsRehash(hash)).toBe(false);
  }
});
