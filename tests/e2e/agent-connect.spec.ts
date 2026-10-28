import { isolatedDatabaseUrl } from '../support/test-database';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import postgres from 'postgres';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('E2E_PASSWORD is required for the synthetic instance.');
const database = isolatedDatabaseUrl('E2E_DATABASE_URL');
const sql = postgres(database, { max: 1, onnotice: () => {} });
test.beforeEach(async () => {
  await sql`delete from host.request_budgets where namespace='agent-enrollment'`;
});
test.afterAll(() => sql.end());

async function cli(origin: string, config: string, args: string[]) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/agent.ts', ...args], {
    cwd: resolve('.'),
    env: { ...process.env, ATHLETE_PANEL_AGENT_CONFIG: config, APP_ORIGIN: origin },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data.toString();
  });
  child.stderr.on('data', (data) => {
    output += data.toString();
  });
  const done = new Promise<number | null>((resolve) => child.once('exit', resolve));
  return { child, done, output: () => output };
}

test('connect signs in, approves scope, saves privately, exports context and disconnects', async ({
  page,
  baseURL,
}, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'athlete-panel-connect-e2e-'));
  const config = join(directory, 'agent.json');
  const label = `Synthetic ${info.project.name} ${Date.now()}`;
  const process = await cli(baseURL!, config, ['connect', '--no-open', '--label', label]);
  try {
    await expect.poll(process.output).toContain('Approval code:');
    const code = process.output().match(/Approval code: ([A-F0-9-]+)/)![1];
    const link = process.output().match(/Open: (http[^\s]+)/)![1];
    await page.goto(link);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connect your training agent' })).toBeVisible();
    await expect(page.getByLabel('Approval code', { exact: true })).toHaveText(code);
    const approve = page.getByRole('button', { name: 'Approve connection', exact: true });
    await expect(approve).toBeDisabled();
    await page.getByLabel('This code matches my terminal').check();
    await page.getByLabel('Access expires after').selectOption('4');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await page.screenshot({
      path: `.runtime/browser/agent-connect-${info.project.name}-light.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await page.screenshot({
      path: `.runtime/browser/agent-connect-${info.project.name}-dark.png`,
      fullPage: true,
      animations: 'disabled',
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await approve.click();
    await expect(page.getByRole('heading', { name: 'Agent access approved' })).toBeVisible();
    expect(await process.done).toBe(0);
    const saved = JSON.parse(await readFile(config, 'utf8'));
    expect((await stat(config)).mode & 0o777).toBe(0o600);
    expect(process.output()).not.toContain(saved.token);
    expect(await page.content()).not.toContain(saved.token);
    const context = await cli(baseURL!, config, [
      'context',
      '--out',
      join(directory, 'context.json'),
    ]);
    expect(await context.done).toBe(0);
    const exported = JSON.parse(await readFile(join(directory, 'context.json'), 'utf8'));
    expect(exported.scope.includeNotes).toBe(false);
    await page.getByRole('button', { name: 'Back to Agent workspace' }).click();
    const row = page.locator('.proposal-row').filter({ hasText: label });
    await row.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(row).toContainText('Disconnected');
    const disconnected = await cli(baseURL!, config, [
      'context',
      '--out',
      join(directory, 'denied.json'),
    ]);
    expect(await disconnected.done).toBe(1);
    expect(disconnected.output()).toContain('pnpm agent connect');
  } finally {
    if (process.child.exitCode === null) {
      process.child.kill('SIGTERM');
      await process.done;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('declining preserves an existing local credential and never issues agent access', async ({
  page,
  baseURL,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'athlete-panel-connect-deny-'));
  const config = join(directory, 'agent.json');
  const existing = JSON.stringify({ url: baseURL, token: 'A'.repeat(43) });
  await writeFile(config, existing, { mode: 0o600 });
  const process = await cli(baseURL!, config, ['connect', '--no-open']);
  try {
    await expect.poll(process.output).toContain('Open:');
    await page.goto(process.output().match(/Open: (http[^\s]+)/)![1]);
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Decline', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connection not approved' })).toBeVisible();
    expect(await process.done).toBe(1);
    expect(process.output()).toContain('declined');
    expect(await readFile(config, 'utf8')).toBe(existing);
  } finally {
    if (process.child.exitCode === null) {
      process.child.kill('SIGTERM');
      await process.done;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('connection approval requires an owner session and the correct origin', async ({
  page,
  request,
  baseURL,
}) => {
  const started = await request.post('/api/agent/connect', {
    data: { label: 'Synthetic authorization check' },
  });
  expect(started.status()).toBe(200);
  const pending = await started.json();
  const body = {
    id: pending.id,
    code: pending.code,
    label: 'Scoped',
    from: '2026-10-01',
    to: '2026-10-31',
    expiresInHours: 1,
  };
  try {
    const ownerless = await request.post('/api/plugins/agent-bridge/approve-connection', {
      headers: { Origin: baseURL!, Authorization: `Bearer ${pending.token}` },
      data: body,
    });
    expect(ownerless.status()).toBe(401);
    await page.goto('/login');
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Training calendar', exact: true }),
    ).toBeVisible();
    const foreign = await page.request.post('/api/plugins/agent-bridge/approve-connection', {
      headers: { Origin: 'https://untrusted.invalid' },
      data: body,
    });
    expect(foreign.status()).toBe(403);
    const context = await request.get('/api/agent/context', {
      headers: { Authorization: `Bearer ${pending.token}` },
    });
    expect(context.status()).toBe(401);
    const browserStart = await page.request.post('/api/agent/connect', {
      headers: { Origin: baseURL! },
      data: { label: 'Unwanted browser request' },
    });
    expect(browserStart.status()).toBe(403);
  } finally {
    await request.post('/api/agent/connect-cancel', {
      headers: { Authorization: `Bearer ${pending.token}` },
      data: {},
    });
  }
});

test('cancelling from the terminal closes its pending request without saving a credential', async ({
  page,
  baseURL,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'athlete-panel-connect-cancel-'));
  const config = join(directory, 'agent.json');
  const terminal = await cli(baseURL!, config, ['connect', '--no-open']);
  try {
    await expect.poll(terminal.output).toContain('Open:');
    const link = terminal.output().match(/Open: (http[^\s]+)/)![1];
    const id = new URL(link).searchParams.get('connect');
    terminal.child.kill('SIGINT');
    expect(await terminal.done).toBe(1);
    expect(terminal.output()).toContain('Connection cancelled.');
    await expect(stat(config)).rejects.toMatchObject({ code: 'ENOENT' });
    await page.goto('/login');
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Training calendar', exact: true }),
    ).toBeVisible();
    const result = await page.request.post('/api/plugins/agent-bridge/connection', {
      headers: { Origin: baseURL! },
      data: { id },
    });
    expect(result.status()).toBe(200);
    expect((await result.json()).status).toBe('cancelled');
  } finally {
    if (terminal.child.exitCode === null) {
      terminal.child.kill('SIGTERM');
      await terminal.done;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
