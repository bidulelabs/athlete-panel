import { afterEach, describe, expect, it } from 'vitest';
import { requireOrigin, loginClient } from '../../packages/host/src/auth';

const originalProxy = process.env.TRUST_PROXY_CLIENT_IP;
const originalOrigin = process.env.APP_ORIGIN;
const originalCookieSecure = process.env.COOKIE_SECURE;
afterEach(() => {
  if (originalProxy === undefined) delete process.env.TRUST_PROXY_CLIENT_IP;
  else process.env.TRUST_PROXY_CLIENT_IP = originalProxy;
  if (originalOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = originalOrigin;
  if (originalCookieSecure === undefined) delete process.env.COOKIE_SECURE;
  else process.env.COOKIE_SECURE = originalCookieSecure;
});

describe('owner mutation origin boundary', () => {
  const request = (origin?: string) =>
    new Request('https://training.example/api/plugins/training/mutate', {
      method: 'POST',
      headers: origin === undefined ? {} : { Origin: origin },
    });

  it('allows only the exact configured origin, including protocol and port', () => {
    process.env.APP_ORIGIN = 'https://training.example';
    expect(() => requireOrigin(request('https://training.example'))).not.toThrow();
    for (const origin of [
      undefined,
      'null',
      'http://training.example',
      'https://training.example:444',
      'https://training.example.attacker.invalid',
      'https://attacker.invalid',
    ]) {
      expect(() => requireOrigin(request(origin))).toThrow(
        expect.objectContaining({ code: 'invalid_origin', status: 403 }),
      );
    }
  });

  it('fails closed when the private instance origin is not configured', () => {
    delete process.env.APP_ORIGIN;
    expect(() => requireOrigin(request('https://training.example'))).toThrow(
      expect.objectContaining({ code: 'origin_unconfigured', status: 503 }),
    );
  });

  it('accepts only the two local HTTP names on the configured port', () => {
    process.env.COOKIE_SECURE = 'false';
    process.env.TRUST_PROXY_CLIENT_IP = 'false';
    for (const host of ['127.0.0.1', 'localhost']) {
      process.env.APP_ORIGIN = `http://${host}:3000`;
      for (const origin of ['http://127.0.0.1:3000', 'http://localhost:3000'])
        expect(() => requireOrigin(request(origin))).not.toThrow();
      for (const origin of [
        undefined,
        'null',
        'http://localhost:3001',
        'http://localhost',
        'https://localhost:3000',
        'http://localhost.attacker.invalid:3000',
        'http://127.0.0.2:3000',
        'http://[::1]:3000',
        'http://localhost:3000/path',
        'http://user@localhost:3000',
        'http://localhost:3000 http://attacker.invalid',
      ]) {
        expect(() => requireOrigin(request(origin))).toThrow(
          expect.objectContaining({ code: 'invalid_origin', status: 403 }),
        );
      }
    }
  });

  it('does not allow local aliases for secure cookies or a trusted proxy', () => {
    process.env.APP_ORIGIN = 'http://127.0.0.1:3000';
    process.env.COOKIE_SECURE = 'true';
    process.env.TRUST_PROXY_CLIENT_IP = 'false';
    expect(() => requireOrigin(request('http://localhost:3000'))).toThrow(
      expect.objectContaining({ code: 'invalid_origin' }),
    );
    process.env.COOKIE_SECURE = 'false';
    process.env.TRUST_PROXY_CLIENT_IP = 'true';
    expect(() => requireOrigin(request('http://localhost:3000'))).toThrow(
      expect.objectContaining({ code: 'invalid_origin' }),
    );
    expect(() => requireOrigin(request('http://127.0.0.1:3000'))).not.toThrow();
  });

  it('keeps non-local and HTTPS origins exact even when cookies are configured for local HTTP', () => {
    process.env.COOKIE_SECURE = 'false';
    process.env.TRUST_PROXY_CLIENT_IP = 'false';
    for (const configured of [
      'https://127.0.0.1:3000',
      'https://localhost:3000',
      'http://training.example:3000',
    ]) {
      process.env.APP_ORIGIN = configured;
      expect(() => requireOrigin(request(configured))).not.toThrow();
      for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000'])
        expect(() => requireOrigin(request(origin))).toThrow(
          expect.objectContaining({ code: 'invalid_origin' }),
        );
    }
  });
});

it('uses only an explicitly trusted proxy identity and groups IPv6 privacy addresses', () => {
  const request = (address: string) =>
    new Request('https://training.example/api/auth/login', {
      headers: { 'x-athlete-panel-client-ip': address, 'x-forwarded-for': '203.0.113.50' },
    });
  delete process.env.TRUST_PROXY_CLIENT_IP;
  expect(loginClient(request('203.0.113.1'))).toBe('local');
  process.env.TRUST_PROXY_CLIENT_IP = 'true';
  expect(loginClient(request('203.0.113.1'))).toBe('203.0.113.1');
  expect(loginClient(request('::ffff:203.0.113.1'))).toBe('203.0.113.1');
  expect(loginClient(request('2001:db8:1234:5678::1'))).toBe(
    loginClient(request('2001:db8:1234:5678::abcd')),
  );
  expect(() => loginClient(request('spoofed'))).toThrow(
    expect.objectContaining({ code: 'proxy_unconfigured' }),
  );
});
