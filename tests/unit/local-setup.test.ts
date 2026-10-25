import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { acquireLocalLock, administrativeEnvironment, createLocalConfig, newLocalConfig, readLocalConfig, runtimeEnvironment, systemEnvironment, validateLocalConfig } from '../../scripts/lib/local-config';
import { requireFreePort, runCommand, supervise } from '../../scripts/lib/local-process';
import { validateLoginPassword } from '../../scripts/lib/local-password';

const directories: string[] = [];
async function temporary() { const root = await mkdtemp(join(tmpdir(), 'athlete-panel-local-unit-')); directories.push(root); return root; }
afterEach(async () => { for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('private local configuration', () => {
  it('generates independent secrets and consistent localhost URLs, publishes privately and never replaces existing bytes', async () => {
    const root = await temporary(), config = newLocalConfig();
    expect(new Set([config.values.POSTGRES_PASSWORD, config.values.APP_DATABASE_PASSWORD, config.values.ENCRYPTION_KEY]).size).toBe(3);
    expect(newLocalConfig().values.ENCRYPTION_KEY).not.toBe(config.values.ENCRYPTION_KEY);
    expect(Buffer.from(config.values.ENCRYPTION_KEY, 'base64')).toHaveLength(32);
    expect(await readLocalConfig(root)).toBeNull();
    await createLocalConfig(root, config);
    expect((await stat(join(root, '.env'))).mode & 0o777).toBe(0o600);
    expect(await readLocalConfig(root)).toEqual(config);
    const before = await readFile(join(root, '.env'));
    await expect(createLocalConfig(root, newLocalConfig())).rejects.toThrow('not overwritten');
    expect(await readFile(join(root, '.env'))).toEqual(before);
  });

  it('fails closed for invalid, exposed and symlink configuration without changing it', async () => {
    const root = await temporary();
    await createLocalConfig(root, newLocalConfig());
    await chmod(join(root, '.env'), 0o644);
    await expect(readLocalConfig(root)).rejects.toThrow('chmod 600');
    await rm(join(root, '.env'));
    await writeFile(join(root, 'target'), 'DATABASE_URL=private-synthetic-value', { mode: 0o600 });
    await symlink(join(root, 'target'), join(root, '.env'));
    await expect(readLocalConfig(root)).rejects.toThrow('symlink');
    expect(await readFile(join(root, 'target'), 'utf8')).toBe('DATABASE_URL=private-synthetic-value');
  });

  it('rejects remote targets, mismatched credentials, admin runtime access and invalid keys without exposing values', () => {
    const { values } = newLocalConfig();
    const changes: Record<string, string>[] = [
      { DATABASE_URL: values.ADMIN_DATABASE_URL },
      { DATABASE_URL: values.DATABASE_URL.replace('127.0.0.1', 'example.com') },
      { DATABASE_URL: values.DATABASE_URL + '?host=example.com' },
      { ENCRYPTION_KEY: 'synthetic-sensitive-invalid-key' },
      { APP_DATABASE_PASSWORD: values.POSTGRES_PASSWORD },
      { APP_ORIGIN: 'https://example.com' },
      { ATHLETE_PANEL_INSTANCE_PATH: '/other/instance.json' },
    ];
    for (const change of changes) expect(() => validateLocalConfig({ ...values, ...change })).toThrow('No credentials were replaced');
  });

  it('does not execute or interpolate .env contents', async () => {
    const root = await temporary(), config = newLocalConfig();
    await createLocalConfig(root, config);
    const path = join(root, '.env');
    await writeFile(path, await readFile(path, 'utf8') + '\nUNUSED=$(touch SHOULD_NOT_EXIST)\n');
    const loaded = await readLocalConfig(root);
    expect(loaded?.values.UNUSED).toBe('$(touch SHOULD_NOT_EXIST)');
    expect(await stat(join(root, 'SHOULD_NOT_EXIST')).catch(() => null)).toBeNull();
    expect(runtimeEnvironment(loaded!)).not.toHaveProperty('UNUSED');
  });

  it('isolates runtime credentials from ambient administration, injection and test flags', () => {
    const clean = systemEnvironment({ PATH: '/bin', NODE_ENV: 'production', ADMIN_DATABASE_URL: 'secret', NODE_OPTIONS: '--inspect', ATHLETE_PANEL_E2E: 'true', TEST_DATABASE_URL: 'secret', COMPOSE_FILE: 'other.yml' });
    expect(clean).toEqual({ PATH: '/bin', NODE_ENV: 'development' });
    const config = newLocalConfig(), runtime = runtimeEnvironment(config), admin = administrativeEnvironment(config);
    for (const key of ['ADMIN_DATABASE_URL', 'POSTGRES_PASSWORD', 'APP_DATABASE_PASSWORD', 'TEST_DATABASE_URL', 'ATHLETE_PANEL_E2E']) expect(runtime).not.toHaveProperty(key);
    expect(runtime.DATABASE_URL).toBe(config.values.DATABASE_URL);
    expect(admin.ADMIN_DATABASE_URL).toBe(config.values.ADMIN_DATABASE_URL);
    expect(admin.APP_DATABASE_PASSWORD).toBe(config.values.APP_DATABASE_PASSWORD);
  });

  it('serializes setup and local commands without removing an active lock', async () => {
    const root = await temporary(), unlock = await acquireLocalLock(root);
    await expect(acquireLocalLock(root)).rejects.toThrow('Another setup/local');
    await unlock();
    await (await acquireLocalLock(root))();
  });
});

describe('local process lifecycle', () => {
  it('detects occupied ports before attempting startup', async () => {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try { await expect(requireFreePort(port, 'test')).rejects.toThrow(`Port ${port}`); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    await requireFreePort(port, 'test');
  });

  it('redacts subprocess failures and aborts an active command', async () => {
    const root = await temporary();
    await expect(runCommand(process.execPath, ['-e', 'console.error("synthetic-secret"); process.exit(1)'], { root, message: 'Safe diagnostic' })).rejects.toThrow('Safe diagnostic');
    const controller = new AbortController();
    const result = runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { root, signal: controller.signal, message: 'Stopped' });
    const assertion = expect(result).rejects.toThrow('Cancelled');
    setTimeout(() => controller.abort(), 100);
    await assertion;
  });

  it('stops a live sibling when a service exits and reports failure', async () => {
    const root = await temporary(), marker = join(root, 'stopped');
    const live = `const fs=require('fs'); process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(marker)},'stopped');process.exit(0)});setInterval(()=>{},1000)`;
    await expect(supervise([
      { name: 'worker', command: process.execPath, args: ['-e', live], cwd: root, env: systemEnvironment() },
      { name: 'web', command: process.execPath, args: ['-e', 'setTimeout(()=>process.exit(2),300)'], cwd: root, env: systemEnvironment() },
    ], new AbortController().signal, 1000)).rejects.toThrow('web stopped unexpectedly');
    expect(await readFile(marker, 'utf8')).toBe('stopped');
  });

  it('stops complete descendant groups on cancellation', async () => {
    const root = await temporary(), pidFile = join(root, 'pid'), controller = new AbortController();
    const parent = `const {spawn}=require('child_process');const fs=require('fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000)`;
    const running = supervise([{ name: 'web', command: process.execPath, args: ['-e', parent], cwd: root, env: systemEnvironment() }], controller.signal, 1000);
    for (let i = 0; i < 50 && !await stat(pidFile).catch(() => null); i++) await sleep(20);
    const pid = Number(await readFile(pidFile, 'utf8'));
    controller.abort(); await running;
    // Give the OS init/reaper a moment to collect the terminated grandchild.
    for (let i = 0; i < 50; i++) { try { process.kill(pid, 0); await sleep(20); } catch { return; } }
    throw new Error('A descendant process survived shutdown.');
  });

  it('validates login passwords without silently trimming the chosen value', () => {
    expect(() => validateLoginPassword('short')).toThrow('12 and 256');
    expect(() => validateLoginPassword('a'.repeat(257))).toThrow('12 and 256');
    expect(() => validateLoginPassword('synthetic-password ')).toThrow('trailing whitespace');
    expect(() => validateLoginPassword('Synthetic pass phrase!')).not.toThrow();
  });
});
