import { randomUUID } from 'node:crypto';
import { addDays } from '../../plugins/training/dates';
import { isolatedDatabaseUrl } from '../support/test-database';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, type APIRequestContext } from '@playwright/test';
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
    await expect(
      page.getByRole('heading', { name: 'Connect your training assistant' }),
    ).toBeVisible();
    await expect(page.getByText(code)).toHaveCount(0);
    const approve = page.getByRole('button', { name: 'Approve connection', exact: true });
    const codeField = page.getByLabel('Approval code', { exact: true });
    await codeField.fill(code.toLowerCase());
    await page.getByLabel('Access expires after').selectOption('4');
    await expect(page.getByLabel('Allow proposals to create races and goals')).toBeChecked();
    await expect(page.getByRole('region', { name: 'Access summary' })).toContainText(
      'Create races and goals: permitted',
    );
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
    await codeField.fill(code === '0000-0000' ? '1111-1111' : '0000-0000');
    await approve.click();
    await expect(page.getByText('The connection code does not match.')).toBeVisible();
    await codeField.fill(` ${code.replace('-', ' ').toLowerCase()} `);
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
    expect(exported.scope.allowEventCreation).toBe(true);
    expect(exported.scope.allowPhaseChanges).toBe(true);
    expect(process.output()).toContain(
      'Create races and goals: permitted within the proposal dates',
    );
    expect(process.output()).toContain(
      'Change plan phases: permitted for phases within the proposal dates',
    );
    const headers = { Authorization: `Bearer ${saved.token}` };
    const discovery = await page.request.post('/api/agent/history-discover', { headers, data: {} });
    expect(discovery.ok()).toBe(true);
    const readScope = (await discovery.json()).scope;
    expect(readScope.to).toBe(exported.scope.from);
    expect(readScope.from).toBe(addDays(exported.scope.from, -27));
    expect(exported.scope.to).toBe(addDays(exported.scope.from, 13));
    // Reading yesterday must not authorize a proposal for yesterday.
    const outOfScope = await page.request.post('/api/agent/propose', {
      headers,
      data: {
        summary: 'Synthetic history must not widen proposals',
        contextDigest: exported.contextDigest,
        idempotencyKey: randomUUID(),
        commands: [
          {
            action: 'workout.create',
            values: {
              title: 'Outside proposal dates',
              sport: 'running',
              schedule: { kind: 'independent', date: addDays(exported.scope.from, -1) },
            },
          },
        ],
      },
    });
    expect(outOfScope.ok()).toBe(false);
    expect((await outOfScope.json()).error.code).toBe('out_of_scope');
    await page.getByRole('button', { name: 'Back to Agent workspace' }).click();
    const row = page.locator('.agent-connection-row').filter({ hasText: label });
    await row.getByRole('button', { name: 'Access details' }).click();
    await expect(row).toContainText('Create races and goals: permitted within the proposal dates');
    await row.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Disconnect agent', exact: true })
      .click();
    await page.locator('.agent-archive > summary').click();
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

function proposePeriod(
  request: APIRequestContext,
  headers: Record<string, string>,
  contextDigest: string,
  date: string,
) {
  return request.post('/api/agent/propose', {
    headers,
    data: {
      summary: 'Synthetic denied period',
      idempotencyKey: randomUUID(),
      contextDigest,
      commands: [
        {
          action: 'period.create',
          values: {
            name: 'Denied base',
            role: 'base',
            startDate: date,
            endDate: date,
            weeklyDurationSeconds: {
              firstWeek: { min: 3600, max: 7200 },
              lastWeek: { min: 3600, max: 7200 },
            },
          },
        },
      ],
    },
  });
}

for (const analysisOnly of [false, true]) {
  test(`event and phase permissions are denied after ${analysisOnly ? 'choosing analysis only' : 'opting out'}`, async ({
    page,
    request,
    baseURL,
  }) => {
    const started = await request.post('/api/agent/connect', {
      data: { label: 'Synthetic event opt-out' },
    });
    expect(started.ok()).toBe(true);
    const pending = await started.json();
    let grantId: string | undefined;
    try {
      await page.goto(`/agent?connect=${pending.id}`);
      await page.getByLabel('Password', { exact: true }).fill(password!);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      const checkbox = page.getByLabel('Allow proposals to create races and goals');
      const outlineCheckbox = page.getByLabel('Allow proposals to change plan phases');
      await expect(checkbox).toBeChecked();
      await expect(outlineCheckbox).toBeChecked();
      if (analysisOnly) {
        await page.getByLabel('Can it suggest training changes?').selectOption('no');
        await expect(checkbox).toHaveCount(0);
        await expect(outlineCheckbox).toHaveCount(0);
      } else {
        await checkbox.uncheck();
        await outlineCheckbox.uncheck();
        await expect(page.getByRole('region', { name: 'Access summary' })).toContainText(
          'Create races and goals: not permitted',
        );
        await expect(page.getByRole('region', { name: 'Access summary' })).toContainText(
          'Change plan phases: not permitted',
        );
      }
      await page.getByLabel('Approval code', { exact: true }).fill(pending.code);
      const response = page.waitForResponse((r) =>
        r.url().endsWith('/agent-bridge/approve-connection'),
      );
      await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
      const approved = await (await response).json();
      grantId = approved.grant.id;
      expect(approved.grant.planning).toEqual(
        analysisOnly
          ? null
          : expect.objectContaining({
              allowEventCreation: false,
              allowPhaseChanges: false,
            }),
      );
      const headers = { Authorization: `Bearer ${pending.token}` };
      const contextResponse = await request.get('/api/agent/context', { headers });
      expect(contextResponse.status()).toBe(analysisOnly ? 403 : 200);
      const context = analysisOnly ? null : await contextResponse.json();
      const denied = await request.post('/api/agent/propose', {
        headers,
        data: {
          summary: 'Synthetic denied event',
          idempotencyKey: randomUUID(),
          contextDigest: context?.contextDigest ?? 'a'.repeat(64),
          commands: [
            {
              action: 'event.create',
              values: {
                title: 'Denied race',
                kind: 'race',
                date: context?.scope.from ?? '2026-11-08',
              },
            },
          ],
        },
      });
      expect(denied.status()).toBe(403);
      expect((await denied.json()).error.code).toBe('forbidden');
      const deniedPeriod = await proposePeriod(
        request,
        headers,
        context?.contextDigest ?? 'a'.repeat(64),
        context?.scope.from ?? '2026-11-08',
      );
      expect(deniedPeriod.status()).toBe(403);
      expect((await deniedPeriod.json()).error.code).toBe('forbidden');
    } finally {
      if (grantId)
        await page.request.post('/api/plugins/agent-bridge/revoke', {
          headers: { Origin: baseURL! },
          data: { id: grantId },
        });
      else
        await request.post('/api/agent/connect-cancel', {
          headers: { Authorization: `Bearer ${pending.token}` },
          data: {},
        });
    }
  });
}

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
