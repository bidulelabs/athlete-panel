import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { systemEnvironment } from '../../scripts/lib/local-config';

it.each([
  undefined,
  'postgres://synthetic:only@remote.example.invalid/preview_test',
  'postgres://synthetic:only@127.0.0.1/ordinary_data',
])('refuses unsafe preview storage before build or database work (%s)', (testUrl) => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/preview-history.ts'], {
    env: {
      ...systemEnvironment(),
      TEST_DATABASE_URL: testUrl,
      DATABASE_URL: 'postgres://ignored:sentinel@production.example.invalid/real_data',
      ADMIN_DATABASE_URL: 'postgres://ignored:sentinel@production.example.invalid/real_data',
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(child.status).not.toBe(0);
  expect(child.stderr).toContain('TEST_DATABASE_URL');
  expect(child.stdout).not.toContain('Synthetic preview:');
  expect(child.stderr).not.toContain('sentinel');
});
