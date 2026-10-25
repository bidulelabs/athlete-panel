import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { manifestSchema, validateComposition, type PluginManifest } from '../../packages/plugin-sdk/src';
import { scaffoldPlugin } from '../../scripts/scaffold-plugin';
import { syncSkills } from '../../scripts/sync-skills';

const plugin = (id: string, overrides: Partial<PluginManifest> = {}) => manifestSchema.parse({ id, name: id, description: 'Synthetic plugin', version: '1.0.0', hostApi: '^1.0.0', ...overrides });
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function temporary() { const directory = await mkdtemp(join(tmpdir(), 'athlete-panel-plugins-')); directories.push(directory); return directory; }

describe('trusted plugin composition contract', () => {
  it('places enabled dependencies before consumers regardless of manifest input order', () => {
    const manifests = [plugin('dashboard', { dependencies: { records: '^1.0.0' } }), plugin('records', { dependencies: { athlete: '^1.0.0' } }), plugin('athlete')];
    expect(validateComposition(manifests, ['dashboard', 'athlete', 'records']).map(m => m.id)).toEqual(['athlete', 'records', 'dashboard']);
  });
  it('rejects duplicate IDs and unknown enabled plugins before loading source', () => {
    expect(() => validateComposition([plugin('records'), plugin('records')], ['records'])).toThrow(/Duplicate plugin ID/);
    expect(() => validateComposition([plugin('records')], ['absent'])).toThrow(/Unknown enabled plugin/);
  });
  it('rejects missing, disabled and incompatible required dependencies', () => {
    const consumer = plugin('dashboard', { dependencies: { records: '^2.0.0' } });
    expect(() => validateComposition([consumer], ['dashboard'])).toThrow(/Unsatisfied dependency/);
    expect(() => validateComposition([consumer, plugin('records', { version: '2.0.0' })], ['dashboard'])).toThrow(/Unsatisfied dependency/);
    expect(() => validateComposition([consumer, plugin('records')], ['dashboard', 'records'])).toThrow(/Unsatisfied dependency/);
  });
  it('preserves required foundations and refuses host API incompatibility', () => {
    expect(() => validateComposition([plugin('athlete', { required: true })], [])).toThrow(/cannot be disabled/);
    expect(() => validateComposition([plugin('dashboard', { hostApi: '^2.0.0' })], ['dashboard'])).toThrow(/Incompatible host API/);
  });
  it('rejects dependency cycles and enabled route collisions', () => {
    expect(() => validateComposition([plugin('aa', { dependencies: { bb: '^1' } }), plugin('bb', { dependencies: { aa: '^1' } })], ['aa', 'bb'])).toThrow(/cycle/);
    const route = { path: '/insights', title: 'Insights' };
    expect(() => validateComposition([plugin('aa', { routes: [route] }), plugin('bb', { routes: [route] })], ['aa', 'bb'])).toThrow(/Duplicate route/);
    expect(validateComposition([plugin('aa', { routes: [route] }), plugin('bb', { routes: [route] })], ['aa'])).toHaveLength(1);
  });
  it('allows missing optional features but checks compatible versions when enabled', () => {
    const consumer = plugin('dashboard', { optionalDependencies: { sleep: '^1' } });
    expect(validateComposition([consumer], ['dashboard'])).toHaveLength(1);
    expect(validateComposition([consumer, plugin('sleep', { version: '2.0.0' })], ['dashboard'])).toHaveLength(1);
    expect(() => validateComposition([consumer, plugin('sleep', { version: '2.0.0' })], ['dashboard', 'sleep'])).toThrow(/Incompatible optional dependency/);
  });
  it('validates semantic versions and explicit manifest fields', () => {
    expect(() => plugin('records', { version: 'latest' })).toThrow();
    expect(() => manifestSchema.parse({ ...plugin('records'), remoteInstallUrl: 'https://example.com/plugin.js' })).toThrow();
  });
  it('rejects plugin entry and migration paths that escape their source directory', () => {
    for (const client of ['../host.ts', '/tmp/evil.ts', 'https://example.com/plugin.ts', "client.ts';import 'evil", 'nested/../host.ts']) {
      expect(() => plugin('records', { client })).toThrow();
    }
    expect(() => plugin('records', { migrations: ['../host.sql'] })).toThrow();
    expect(plugin('records', { client: 'src/client.tsx', migrations: ['migrations/001.sql'] }).client).toBe('src/client.tsx');
  });
  it('reserves host routes and schema ownership while permitting distinct plugin namespaces', () => {
    for (const route of ['/', '/login', '/plugins', '/api', '/api/agent']) {
      expect(() => validateComposition([plugin('report', { routes: [{ path: route, title: 'Synthetic' }] })], ['report'])).toThrow(/Reserved host route/);
    }
    expect(() => validateComposition([plugin('aa', { schema: 'shared' }), plugin('bb', { schema: 'shared' })], ['aa', 'bb'])).toThrow(/Duplicate owned schema/);
    expect(() => validateComposition([plugin('aa', { schema: 'host' })], ['aa'])).toThrow(/Duplicate owned schema/);
    expect(validateComposition([plugin('aa', { schema: 'aa' }), plugin('bb', { schema: 'bb' })], ['aa', 'bb'])).toHaveLength(2);
  });
});

describe('plugin-development tooling', () => {
  it('creates a valid personal source plugin without editing composition, and refuses overwrite or traversal', async () => {
    const root = await temporary(); await mkdir(join(root, 'instance')); await writeFile(join(root, 'instance/composition.json'), 'retained composition');
    const target = await scaffoldPlugin(root, 'ride-report', 'Ride report');
    const manifest = manifestSchema.parse(JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')));
    expect(validateComposition([plugin('activity-records'), manifest], ['activity-records', manifest.id]).map(value => value.id)).toEqual(['activity-records', 'ride-report']);
    expect(await readFile(join(root, 'instance/composition.json'), 'utf8')).toBe('retained composition');
    await expect(scaffoldPlugin(root, 'ride-report', 'Overwritten')).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(scaffoldPlugin(root, '../outside', 'Invalid')).rejects.toThrow(/plugin ID/);
    expect(JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')).name).toBe('Ride report');
  });
  it('generates discoverable Claude adapters, detects drift and preserves non-generated skills', async () => {
    const root = await temporary(); const canonical = join(root, '.agents/skills/training-example');
    await mkdir(canonical, { recursive: true });
    const original = '---\nname: training-example\ndescription: Submit a training proposal.\n---\n\nUse public contracts.\n';
    await writeFile(join(canonical, 'SKILL.md'), original);
    expect(await syncSkills(root)).toBe(1); expect(await syncSkills(root, true)).toBe(1);
    const adapter = join(root, '.claude/skills/training-example/SKILL.md');
    expect((await readFile(adapter, 'utf8')).startsWith('---\nname: training-example')).toBe(true);
    await writeFile(join(canonical, 'SKILL.md'), original.replace('public contracts', 'bounded public contracts'));
    await expect(syncSkills(root, true)).rejects.toThrow(/stale/);
    await syncSkills(root); expect(await syncSkills(root, true)).toBe(1);
    await writeFile(adapter, 'Existing user-owned skill');
    await expect(syncSkills(root)).rejects.toThrow(/non-generated/);
    expect(await readFile(adapter, 'utf8')).toBe('Existing user-owned skill');
  });
});
