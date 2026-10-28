import { afterEach, expect, it, vi } from 'vitest';
import { isolatedDatabaseUrl } from '../support/test-database';

afterEach(() => vi.unstubAllEnvs());

it('accepts only a loopback database whose name ends in _test', () => {
  for (const accepted of [
    'postgres://user:pw@127.0.0.1:5432/app_ui_test',
    'postgres://user:pw@[::1]:5432/app_ui_test',
  ]) {
    vi.stubEnv('E2E_DATABASE_URL', accepted);
    expect(isolatedDatabaseUrl('E2E_DATABASE_URL')).toBe(accepted);
  }
  for (const refused of [
    undefined,
    '',
    'postgres://user:pw@db.example.com:5432/app_test',
    'postgres://user:pw@127.0.0.1:5432/app',
  ]) {
    vi.stubEnv('TEST_DATABASE_URL', refused);
    expect(() => isolatedDatabaseUrl()).toThrow('TEST_DATABASE_URL');
  }
});
