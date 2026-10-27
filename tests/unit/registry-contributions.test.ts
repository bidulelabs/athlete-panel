import { registry } from '../../instance/registry.metadata';
import { manifestSchema, validateComposition } from '../../packages/plugin-sdk/src';
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it('omits disabled optional contributions from generated imports without changing migration files', () => {
  const root = mkdtempSync(join(tmpdir(), 'athlete-registry-'));
  roots.push(root);
  const composition = JSON.parse(readFileSync('instance/composition.json', 'utf8'));
  const copy = (file: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(file, join(root, file));
  };
  copy('packages/host/migrations/001-host.sql');
  for (const entry of composition.plugins) {
    copy(`${entry.path}/manifest.json`);
    const manifest = JSON.parse(readFileSync(`${entry.path}/manifest.json`, 'utf8'));
    for (const migration of manifest.migrations ?? []) copy(`${entry.path}/${migration}`);
  }
  mkdirSync(join(root, 'instance'), { recursive: true });
  const generate = () => {
    writeFileSync(join(root, 'instance/composition.json'), JSON.stringify(composition));
    execFileSync(
      process.execPath,
      ['--import', import.meta.resolve('tsx'), resolve('scripts/registry.ts')],
      { cwd: root, stdio: 'pipe' },
    );
    return readFileSync(join(root, 'instance/registry.client.ts'), 'utf8');
  };
  const enabled = generate();
  expect(enabled).toContain('../plugins/garmin/client');
  expect(enabled).toContain('"kind":"onboarding"');
  composition.plugins.find((entry: { path: string }) => entry.path === 'plugins/garmin').enabled =
    false;
  const disabled = generate();
  expect(disabled).not.toContain('../plugins/garmin/client');
  expect(disabled).not.toContain('"kind":"onboarding"');
  expect(disabled).toContain('../plugins/athlete/client');
});

it('rejects a prior provider version for the new public interfaces while retaining 1.0 extensions', () => {
  const manifests = registry.map((entry) => manifestSchema.parse(entry.manifest));
  const enabled = registry.filter((entry) => entry.enabled).map((entry) => entry.manifest.id);
  expect(() => validateComposition(manifests, enabled)).not.toThrow();
  const older = manifests.map((manifest) =>
    manifest.id === 'training' ? { ...manifest, version: '1.0.0' } : manifest,
  );
  expect(() => validateComposition(older, enabled)).toThrow(/Unsatisfied dependency/);
});
