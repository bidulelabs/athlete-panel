import { test, expect } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password)
  throw new Error('Set E2E_PASSWORD for the isolated synthetic browser-test instance.');

test('Garmin connects with a key alone and queues automatic history', async ({ page }, info) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  // This suite runs on a separate synthetic server without a provider worker.
  await page.request.post('/api/plugins/garmin/disconnect', {
    headers: { Origin: origin },
    data: {},
  });
  try {
    await page.goto('/garmin');
    await page.getByRole('button', { name: 'Connect Garmin', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('input[type="date"]')).toHaveCount(0);
    await expect(
      dialog.getByText('All available history is imported automatically. No start date is needed.'),
    ).toBeVisible();
    await expect(dialog.getByLabel('Personal API key')).toBeVisible();
    await dialog.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    const box = (await dialog.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
    await page.screenshot({
      path: `.runtime/browser/automatic-history-${info.project.name}.png`,
      fullPage: true,
    });
    await dialog.getByLabel('Personal API key').fill('synthetic-browser-key-never-valid');
    const submission = page.waitForRequest(
      (request) =>
        request.url().endsWith('/api/plugins/garmin/configure') && request.method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Save connection', exact: true }).click();
    expect((await submission).postDataJSON()).toMatchObject({
      key: 'synthetic-browser-key-never-valid',
      idempotencyKey: expect.any(String),
    });
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Verifying your Garmin connection' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Import Garmin history', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Choose a start date when connecting.')).toHaveCount(0);
    const workspace = await page.request.get('/api/workspace?from=2026-10-19&to=2026-11-08');
    expect(workspace.status()).toBe(200);
    const state = await workspace.json();
    expect(state.garmin.verified).toBe(false);
    await expect(
      page.getByText(
        'Your key is saved. Connection checking will start when the background worker is available.',
        { exact: true },
      ),
    ).toBeVisible();
    expect(state.garmin.earliestDate).toBe('2000-01-01');
    expect(
      state.jobs.some(
        (job: { kind: string; status: string }) =>
          job.kind === 'garmin-history' && job.status === 'queued',
      ),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await page.request.post('/api/plugins/garmin/disconnect', {
      headers: { Origin: origin },
      data: {},
    });
  }
});

test('old failed periods remain filterable and open a targeted retry', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.garmin = {
      ...body.garmin,
      connected: true,
      verified: true,
      paused: false,
      lastError: null,
      lastErrorCode: null,
      currentJob: null,
      coverageSummary: { windows: 303, failed: 1, unavailable: 1, empty: 301, complete: 0 },
    };
    body.jobs = [];
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/plugins/garmin/coverage', async (route) => {
    const { filter, offset } = route.request().postDataJSON();
    const failed = {
      stream: 'history-health',
      from: '2001-01-01',
      to: '2001-01-28',
      status: 'failed',
      records: 0,
      missingDays: 0,
      unknownMetrics: 0,
      error: 'Synthetic temporary outage',
    };
    await route.fulfill({
      json: {
        total: filter === 'failed' ? 1 : 303,
        offset,
        limit: 50,
        rows:
          filter === 'failed'
            ? [failed]
            : [{ ...failed, from: '2026-01-01', to: '2026-01-28', status: 'no-data', error: null }],
      },
    });
  });
  await page.goto('/garmin');
  await expect(
    page.getByText('Garmin connected. Some history needs attention.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Show history windows').selectOption('failed');
  await expect(page.getByRole('cell', { name: '2001-01-01', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry this period' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('From date')).toHaveValue('2001-01-01');
  await expect(dialog.getByLabel('Through date')).toHaveValue('2001-01-28');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
