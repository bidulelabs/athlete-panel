import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { isolatedDatabaseUrl } from '../support/test-database';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays } from '../../plugins/training/dates';
import { annualId, seedAnnualReview } from '../fixtures/annual-review';
const password = process.env.E2E_PASSWORD!;
const sql = postgres(isolatedDatabaseUrl('E2E_DATABASE_URL'), { max: 1, onnotice: () => {} });
test.beforeEach(async () => {
  await sql`delete from host.request_budgets where namespace='agent-enrollment'`;
});
test.afterAll(() => sql.end());
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
    await expect(
      page.getByRole('combobox', { name: 'Can it suggest training changes?', exact: true }),
    ).toHaveValue('yes');
    await page
      .getByRole('combobox', { name: 'Can it suggest training changes?', exact: true })
      .selectOption('no');
    const historyPeriod = page.getByRole('combobox', {
      name: 'How much history can your assistant read?',
      exact: true,
    });
    await historyPeriod.selectOption('1');
    await expect(page.getByRole('region', { name: 'Access summary' })).toContainText(
      await page.locator('input[name="historyFrom"]').inputValue(),
    );
    await historyPeriod.selectOption('5');
    await historyPeriod.selectOption('custom');
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
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        document.documentElement.classList.toggle('dark', value === 'dark');
      }, theme);
      await page.screenshot({
        path: `.runtime/browser/history-approval-${info.project.name}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
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
    const deniedAudit = await fetch(`${baseURL}/api/plugins/training/history-details`, {
      method: 'POST',
      headers: { ...headers, Origin: baseURL!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: randomUUID() }),
    });
    expect(deniedAudit.status).toBe(401);
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
    await runCli(['history', '--out', join(directory, 'overview.json')]);
    await runCli([
      'history',
      'records',
      '--category',
      'activities',
      '--from',
      '2026-10-01',
      '--to',
      '2026-10-31',
      '--out',
      join(directory, 'details.json'),
    ]);
    const savedReview = JSON.parse(await readFile(`${config}.history-review.json`, 'utf8'));
    expect(JSON.parse(await readFile(join(directory, 'details.json'), 'utf8')).reviewToken).toBe(
      savedReview.review.reviewToken,
    );
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
  const fixture = await sql.begin((tx) => seedAnnualReview(tx, '2027-11-01'));
  try {
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
        commands: fixture.commands,
      },
    });
    expect(proposed.ok()).toBe(true);
    const stored = await proposed.json();
    expect(
      (await request.post('/api/agent/apply', { headers, data: { id: stored.id } })).status(),
    ).toBe(403);
    await page.goto('/agent');
    const reviewStarted = performance.now();
    await page
      .locator('.proposal-row')
      .filter({ hasText: summary })
      .getByRole('button', { name: 'Review', exact: true })
      .click();
    const dialog = page.getByRole('dialog'),
      apply = dialog.getByRole('button', { name: /^Apply all \d+ changes?$/, exact: true });
    await expect(apply).toBeDisabled();
    await expect(apply).toHaveText('Apply all 1500 changes');
    await expect(dialog.locator('.proposal-apply-scope')).toHaveCount(0);
    await expect(
      dialog.getByText('I have reviewed all 1500 changes and want to apply them.'),
    ).toBeVisible();
    const reviewMs = performance.now() - reviewStarted;
    await expect(dialog.getByRole('region', { name: 'Proposal overview' })).toContainText(
      '500 workouts',
    );
    const month = dialog.locator('details.proposal-month').filter({
      has: page.locator('summary > strong').getByText('November 2027', { exact: true }),
    });
    await expect(dialog.locator('.proposal-week')).toHaveCount(0);
    await month.locator(':scope > summary').click();
    await month.locator('.proposal-week > details > summary').first().click();
    await month.locator('.proposal-diff-summary').first().click();
    await expect(month.getByRole('table').first()).toBeVisible();
    await month.locator(':scope > summary').click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        document.documentElement.classList.toggle('dark', value === 'dark');
      }, theme);
      await page.screenshot({
        path: `.runtime/browser/annual-review-${info.project.name}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await dialog.getByRole('button', { name: 'Find changes' }).click();
    await dialog.getByRole('combobox', { name: 'Item type', exact: true }).selectOption('workout');
    await expect(dialog.locator('.proposal-filter-result')).toContainText('Showing 1500 of 1500');
    await expect(dialog.locator('.proposal-diff')).toHaveCount(0);
    await expect(dialog.locator('.proposal-month[open]')).toHaveCount(0);
    await expect(month.locator('.proposal-deletions')).toContainText('deletion');
    await month.locator(':scope > summary').click();
    await expect(month.locator('.proposal-week > details[open]')).toHaveCount(0);
    await month.locator('.proposal-week > details > summary').first().click();
    await expect(month.locator('.proposal-diff').first()).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Action', exact: true }).selectOption('update');
    await expect(dialog.locator('.proposal-filter-result')).toContainText('Showing 500 of 1500');
    await expect(dialog.locator('.proposal-diff')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Clear filters' }).click();
    await dialog.getByLabel('Search changes').fill('s');
    await expect(dialog.locator('.proposal-filter-result')).toContainText('Showing 1500 of 1500');
    await expect(dialog.locator('.proposal-diff')).toHaveCount(0);
    for (const width of info.project.name === 'desktop' ? [1440] : [390, 320]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
          document.documentElement.classList.toggle('dark', value === 'dark');
        }, theme);
        await dialog.locator('.proposal-filter-result').scrollIntoViewIfNeeded();
        await expect(apply).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `.runtime/browser/annual-broad-filter-${info.project.name}-${width}-${theme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    await dialog.getByLabel('Search changes').fill('Synthetic new 1');
    await expect(dialog.locator('.proposal-diff')).toHaveCount(111);
    await expect(dialog.locator('.proposal-month:not([open])')).toHaveCount(0);
    await expect(dialog.locator('.proposal-week > details:not([open])')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Clear filters' }).click();
    await expect(dialog.locator('.proposal-week')).toHaveCount(0);
    await dialog.getByLabel('Search changes').fill('Synthetic new 1');
    await expect(dialog.locator('.proposal-diff')).toHaveCount(111);
    await expect(dialog.locator('.proposal-apply-scope')).toContainText(
      'Apply includes all 1500 changes',
    );
    await dialog.getByRole('checkbox').check();
    const applyStarted = performance.now();
    await apply.click();
    await expect(dialog).toHaveCount(0);
    const applyMs = performance.now() - applyStarted;
    const envelope = await (
      await page.request.get('/api/workspace?from=2027-11-01&to=2027-11-07')
    ).json();
    const audit = envelope.changes.find((entry: { summary: string }) => entry.summary === summary);
    expect(audit.affectedCount).toBe(1500);
    expect(audit).not.toHaveProperty('changes');
    const details = await owner('training/history-details', { id: audit.id });
    expect((await details.json()).changes).toHaveLength(1500);
    const undoStarted = performance.now();
    expect(
      (await owner('agent-bridge/undo', { id: audit.id, idempotencyKey: randomUUID() })).ok(),
    ).toBe(true);
    console.log(
      JSON.stringify({
        annualBrowser: info.project.name,
        commands: 1500,
        reviewMs,
        applyMs,
        undoMs: performance.now() - undoStarted,
      }),
    );
    await owner('agent-bridge/revoke', { id: grant.id });
  } finally {
    const ids = [
      fixture.plan.id,
      ...fixture.workouts.map((w) => w.id),
      ...Array.from({ length: 500 }, (_, i) => annualId(3000 + i)),
    ];
    await sql`delete from training.records where id=any(${ids})`;
  }
});

test('one assistant approval keeps the receipt, categories, notes and submitted scopes in agreement', async ({
  page,
  request,
}) => {
  const started = await request.post('/api/agent/connect', {
    data: { label: 'Synthetic combined approval' },
  });
  expect(started.ok()).toBe(true);
  const pending = await started.json();
  try {
    await page.goto(`/agent?connect=${pending.id}`);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Approval code', { exact: true }).fill(pending.code);
    const history = page.getByRole('combobox', {
      name: 'How much history can your assistant read?',
      exact: true,
    });
    const planning = page.getByRole('combobox', {
      name: 'Can it suggest training changes?',
      exact: true,
    });
    const period = page.getByRole('combobox', { name: 'Proposal period', exact: true });
    const receipt = page.getByRole('region', { name: 'Access summary' });
    await expect(history).toHaveValue('4weeks');
    await expect(planning).toHaveValue('yes');
    await expect(period).toHaveValue('short');
    // Presets submit exact independent bounds without exposing four unnecessary date inputs.
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
    const today = await page.locator('input[name="historyTo"]').inputValue();
    await expect(page.locator('input[name="historyFrom"]')).toHaveValue(addDays(today, -27));
    await expect(page.locator('input[name="from"]')).toHaveValue(today);
    await expect(page.locator('input[name="to"]')).toHaveValue(addDays(today, 13));
    await history.selectOption('none');
    await expect(receipt).toContainText('Only the proposal period, shown below.');
    await planning.selectOption('no');
    await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
    await expect(page.locator('.connection-access').getByRole('alert')).toContainText(
      'Choose a history period or allow training proposals',
    );
    await history.selectOption('5');
    await planning.selectOption('yes');
    await period.selectOption('year');
    await page.setViewportSize({ width: 320, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const historyFrom = await page.locator('input[name="historyFrom"]').inputValue();
    const planningFrom = await page.locator('input[name="from"]').inputValue();
    const planningTo = await page.locator('input[name="to"]').inputValue();
    await expect(receipt).toContainText(`${historyFrom} through ${today}`);
    await expect(receipt).toContainText(`${planningFrom} through ${planningTo}`);
    await expect(receipt).toContainText(
      'Can also read profile, goals, availability, zones, training, events, injuries, activities and health in this period.',
    );
    await period.selectOption('custom');
    await page.getByLabel('Proposals through', { exact: true }).fill(addDays(planningTo, 1));
    await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
    await expect(page.locator('.connection-access').getByRole('alert')).toContainText(
      `Choose an end date from ${planningFrom} through ${planningTo}`,
    );
    await page.getByLabel('Proposals through', { exact: true }).fill(planningTo);
    // Analysis-only hides proposal fields without losing the deliberate custom dates.
    await planning.selectOption('no');
    await expect(page.locator('input[name="from"]')).toHaveCount(0);
    await planning.selectOption('yes');
    await expect(period).toHaveValue('custom');
    await expect(page.getByLabel('Proposals through', { exact: true })).toHaveValue(planningTo);
    await page.getByText('Customize shared data', { exact: true }).click();
    await page.getByRole('checkbox', { name: 'Health measurements', exact: true }).uncheck();
    await page
      .getByRole('checkbox', { name: 'Include private notes in history', exact: true })
      .check();
    await page
      .getByRole('combobox', { name: 'Access expires after', exact: true })
      .selectOption('4');
    await expect(receipt).toContainText('Private notes: included');
    await expect(receipt).toContainText('Private notes: excluded');
    await expect(receipt).toContainText('4 hours after approval');
    const approval = page.waitForRequest((r) => r.url().endsWith('/approve-connection'));
    await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
    const submitted = (await approval).postDataJSON();
    expect(submitted).toMatchObject({
      version: 2,
      history: { from: historyFrom, includeNotes: true },
      planning: { from: planningFrom, to: planningTo, includeNotes: false },
      expiresInHours: 4,
    });
    expect(submitted.history.categories).not.toContain('health');
    await expect(
      page.getByText('Return to your terminal to finish connecting.', { exact: false }),
    ).toBeVisible();
  } finally {
    await request.post('/api/agent/connect-cancel', {
      headers: { Authorization: `Bearer ${pending.token}` },
      data: {},
    });
  }
});
