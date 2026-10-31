import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays } from '../../plugins/training/dates';
const password = process.env.E2E_PASSWORD!;
test('historical browser approval explains read-only access, validates dates and supports CLI review in both themes', async ({
  page,
  baseURL,
}, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'history-browser-')),
    config = join(directory, 'agent.json');
  const terminal = spawn(
    process.execPath,
    ['--import', 'tsx', 'scripts/agent.ts', 'connect', '--no-open', '--url', baseURL!],
    {
      env: { ...process.env, ATHLETE_PANEL_AGENT_CONFIG: config },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  terminal.stdout.on('data', (data) => (output += data.toString()));
  terminal.stderr.on('data', (data) => (output += data.toString()));
  const done = new Promise<number | null>((resolve) => terminal.once('exit', resolve));
  try {
    await expect.poll(() => output).toContain('Open:');
    await page.goto(output.match(/Open: (http[^\s]+)/)![1]!);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page
      .getByLabel('Approval code', { exact: true })
      .fill(output.match(/Approval code: ([A-F0-9-]+)/)![1]!);
    await page.getByLabel('Access purpose').selectOption('history');
    await page.getByLabel('History from', { exact: true }).fill('2021-10-31');
    await page.getByLabel('History through', { exact: true }).fill('2026-11-01');
    await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
    await expect(
      page.getByText(/Choose an end date from 2021-10-31 through 2026-10-31/),
    ).toBeVisible();
    await page.getByLabel('History through', { exact: true }).fill('2026-10-31');
    await expect(page.getByText('This connection is read-only.', { exact: false })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await page.screenshot({
        path: `.runtime/browser/history-approval-${info.project.name}-${theme}.png`,
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
    expect(await done).toBe(0);
    const saved = JSON.parse(await readFile(config, 'utf8'));
    expect(output).not.toContain(saved.token);
    const headers = { Authorization: `Bearer ${saved.token}` };
    expect((await page.request.get('/api/agent/context', { headers })).status()).toBe(403);
    const history = await page.request.post('/api/agent/history-summary', {
      headers,
      data: { from: '2021-10-31', to: '2026-10-31', period: 'month' },
    });
    expect(history.ok(), await history.text()).toBe(true);
    expect((await history.json()).scope.includeNotes).toBe(false);
    const runCli = async (args: string[]) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/agent.ts', ...args], {
        env: { ...process.env, ATHLETE_PANEL_AGENT_CONFIG: config },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let text = '';
      child.stdout.on('data', (data) => (text += data.toString()));
      child.stderr.on('data', (data) => (text += data.toString()));
      const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
      expect(text).not.toContain(saved.token);
      expect(code, text).toBe(0);
    };
    await runCli(['history', 'discover', '--out', join(directory, 'history.json')]);
    await runCli([
      'history',
      'summary',
      '--review-file',
      join(directory, 'history.json'),
      '--all',
      '--out',
      join(directory, 'overview.json'),
    ]);
    const overview = JSON.parse(await readFile(join(directory, 'overview.json'), 'utf8'));
    expect(overview.summaries.length).toBeGreaterThan(100);
    expect(overview.nextCursor).toBeNull();

    const revoked = await page.request.post('/api/plugins/agent-bridge/revoke', {
      headers: { Origin: baseURL! },
      data: { id: saved.grantId },
    });
    expect(revoked.ok()).toBe(true);
    expect(
      (
        await page.request.post('/api/agent/history-records', {
          headers,
          data: { category: 'activities' },
        })
      ).status(),
    ).toBe(401);
  } finally {
    if (terminal.exitCode === null) {
      terminal.kill('SIGTERM');
      await done;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
test('one annual proposal stays pending until owner acknowledgement and applies atomically', async ({
  page,
  request,
  baseURL,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  const owner = (operation: string, data: unknown) =>
    page.request.post(`/api/plugins/${operation}`, { headers: { Origin: baseURL! }, data });
  const grantResponse = await owner('agent-bridge/grant', {
    label: 'Annual browser',
    version: 2,
    history: null,
    planning: { from: '2027-11-01', to: '2028-11-01', includeNotes: false },
  });
  expect(grantResponse.ok()).toBe(true);
  const { token, grant } = await grantResponse.json();
  const headers = { Authorization: `Bearer ${token}` },
    context = await (await request.get('/api/agent/context', { headers })).json(),
    summary = `Annual review ${info.project.name} ${randomUUID()}`;
  const proposed = await request.post('/api/agent/propose', {
    headers,
    data: {
      summary,
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
      commands: Array.from({ length: 366 }, (_, day) => ({
        action: 'workout.create',
        values: {
          title: `Annual session ${day}`,
          sport: 'running',
          schedule: { kind: 'independent', date: addDays('2027-11-01', day) },
          durationSeconds: 1800,
        },
      })),
    },
  });
  expect(proposed.ok()).toBe(true);
  const stored = await proposed.json();
  expect(
    (await request.post('/api/agent/apply', { headers, data: { id: stored.id } })).status(),
  ).toBe(403);
  await page.goto('/agent');
  await page
    .locator('.proposal-row')
    .filter({ hasText: summary })
    .getByRole('button', { name: 'Review', exact: true })
    .click();
  const dialog = page.getByRole('dialog'),
    apply = dialog.getByRole('button', { name: 'Apply reviewed changes', exact: true });
  await expect(apply).toBeDisabled();
  await expect(dialog.getByText('366 changes', { exact: true })).toBeVisible();
  await expect(
    dialog.getByText('I have reviewed these changes and want to apply them.'),
  ).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    await page.screenshot({
      path: `.runtime/browser/annual-review-${info.project.name}-${theme}.png`,
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await dialog.getByRole('checkbox').check();
  await apply.click();
  await expect(dialog).toHaveCount(0);
  const envelope = await (
    await page.request.get('/api/workspace?from=2027-11-01&to=2027-11-07')
  ).json();
  const audit = envelope.changes.find((entry: { summary: string }) => entry.summary === summary);
  expect(audit.changes).toHaveLength(366);
  expect(
    (await owner('agent-bridge/undo', { id: audit.id, idempotencyKey: randomUUID() })).ok(),
  ).toBe(true);
  await owner('agent-bridge/revoke', { id: grant.id });
});
