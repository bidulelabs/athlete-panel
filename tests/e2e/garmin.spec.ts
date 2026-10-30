import { test, expect } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password)
  throw new Error('Set E2E_PASSWORD for the isolated synthetic browser-test instance.');

test.afterEach(async ({ page }) => {
  // Finish mocked requests before Playwright disposes their API responses.
  await page.unrouteAll({ behavior: 'wait' });
});

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
    await expect(page.getByRole('heading', { name: 'Checking connection' })).toBeVisible();
    await page.getByRole('button', { name: 'Automatic recovery', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Import Garmin history', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
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
    page.getByText('Some history needs attention. Open History coverage for details.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'History coverage', exact: true }).click();
  await page.getByLabel('Show history windows').selectOption('failed');
  await expect(page.getByRole('cell', { name: /^(From )?2001-01-01$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Retry this period' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('From date')).toHaveValue('2001-01-01');
  await expect(dialog.getByLabel('Through date')).toHaveValue('2001-01-28');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('coverage distinguishes unscanned and rejected windows and retries only their stream', async ({
  page,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  let reimportQueued = false;
  let refreshPending = false;
  let releaseRefresh: () => void = () => undefined;
  const heldRefresh = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    if (reimportQueued) {
      refreshPending = true;
      await heldRefresh;
    }
    const body = await response.json();
    body.garmin = {
      ...body.garmin,
      connected: true,
      verified: true,
      paused: false,
      currentJob: null,
      coverageSummary: {
        windows: 1,
        failed: 0,
        unavailable: 0,
        empty: 0,
        complete: 0,
        rejected: 1,
      },
      recovery: {
        catchup: {
          status: 'queued',
          stream: 'steps',
          from: '2025-01-01',
          to: '2025-01-28',
          nextRunAt: null,
        },
        reconciliation: null,
        unscannedWindows: 40,
        retryStreams: [],
        nextReconcileAt: null,
      },
    };
    body.jobs = [];
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/plugins/garmin/coverage', async (route) => {
    const { filter } = route.request().postDataJSON();
    const rejected = filter !== 'unscanned';
    await route.fulfill({
      json: {
        total: 1,
        offset: 0,
        limit: 50,
        rows: [
          {
            stream: 'steps',
            from: '2025-01-01',
            to: '2025-01-28',
            records: 0,
            missingDays: 0,
            unknownMetrics: 0,
            error: null,
            status: rejected ? 'partial' : 'unscanned',
            scanState: rejected ? 'scanned' : 'unscanned',
            rejectedRecords: rejected ? 2 : 0,
            diagnostics: rejected
              ? [
                  {
                    stream: 'steps',
                    from: '2025-01-01',
                    to: '2025-01-28',
                    pageOffset: 0,
                    index: 0,
                    date: '2025-01-01',
                    fields: ['totalSteps'],
                    code: 'schema_validation',
                  },
                ]
              : [],
          },
        ],
      },
    });
  });
  await page.goto('/garmin');
  await page.getByRole('button', { name: 'Automatic recovery', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Automatic recovery', exact: true })).toContainText(
    '40 unscanned windows',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'History coverage', exact: true }).click();
  await page.getByLabel('Show history windows').selectOption('unscanned');
  await expect(page.getByRole('cell', { name: /^(Records )?—$/ })).toBeVisible();
  await page.getByLabel('Show history windows').selectOption('rejected');
  await expect(page.getByRole('cell', { name: /scanned · partial/ })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'rejected' }).click();
  await expect(page.getByText(/totalSteps/)).toBeVisible();
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({
      path: `.runtime/browser/recovery-${info.project.name}-${theme}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.route('**/api/plugins/garmin/sync', async (route) => {
    reimportQueued = true;
    await route.fulfill({ json: { id: '00000000-0000-4000-8000-000000000099', status: 'queued' } });
  });
  await page.getByRole('button', { name: 'Retry this period' }).click();
  const dialog = page.getByRole('dialog', { name: 'Retry this period', exact: true });
  await expect(dialog.getByLabel('Data to refresh')).toHaveCount(0);
  const submit = dialog.getByRole('button', { name: /Queue|Retry|Import/i });
  const submitted = page.waitForRequest((request) => request.url().endsWith('/garmin/sync'));
  try {
    await submit.click();
    expect((await submitted).postDataJSON()).toMatchObject({
      mode: 'full',
      stream: 'steps',
      from: '2025-01-01',
      to: '2025-01-28',
    });
    // Receiving the request is not completion: exercise a deliberately held workspace refresh.
    await expect.poll(() => refreshPending).toBe(true);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  } finally {
    releaseRefresh();
  }
  await expect(dialog).not.toBeVisible();
});

test('manual refresh defaults to Both, keeps failed drafts and submits each data scope', async ({
  page,
}, info) => {
  await page.clock.install();
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  let reportedStatus: string | null = null;
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.garmin = {
      ...body.garmin,
      connected: true,
      verified: true,
      paused: false,
      currentJob: {
        id: '00000000-0000-4000-8000-000000000098',
        kind: 'garmin-recent',
        status: 'queued',
        progress: '',
        nextRunAt: null,
        retrying: false,
      },
      recovery: {
        catchup: null,
        reconciliation: null,
        nextReconcileAt: null,
        unscannedWindows: 0,
        retryStreams: [],
      },
    };
    body.jobs = reportedStatus
      ? [
          {
            id: '00000000-0000-4000-8000-000000000099',
            kind: 'garmin-history',
            status: reportedStatus,
            progress: '',
            nextRunAt: new Date().toISOString(),
            attempts: 0,
            error: null,
          },
        ]
      : [];
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/plugins/garmin/coverage', (route) =>
    route.fulfill({ json: { rows: [], total: 0, offset: 0, limit: 50 } }),
  );
  let fail = true;
  const submitted: unknown[] = [];
  await page.route('**/api/plugins/garmin/sync', async (route) => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill(
      fail
        ? {
            status: 409,
            json: { error: 'import_busy', message: 'Finish the current import before refreshing.' },
          }
        : { json: { id: '00000000-0000-4000-8000-000000000099', status: 'queued' } },
    );
    fail = false;
  });
  await page.goto('/garmin');
  await expect(page.getByText(/Older changes:/)).toBeVisible();
  await expect(page.getByText('Historical reconciliation', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/at most one step every five minutes/)).toHaveCount(0);
  for (const scope of ['activities', 'health', 'both']) {
    await page.getByRole('button', { name: 'Refresh date range', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Data to refresh')).toHaveValue('both');
    await dialog.getByLabel('Data to refresh').selectOption(scope);
    await dialog.getByLabel('From date').fill('2025-01-01');
    await dialog.getByLabel('Through date').fill('2025-03-01');
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.screenshot({
        path: `.runtime/browser/refresh-${scope}-${info.project.name}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await dialog.getByRole('button', { name: 'Queue refresh', exact: true }).click();
    if (scope === 'activities') {
      await expect(
        dialog.getByRole('button', { name: 'Queue refresh', exact: true }),
      ).toBeEnabled();
      await expect(dialog.getByLabel('Data to refresh')).toHaveValue(scope);
      await expect(dialog.getByLabel('From date')).toHaveValue('2025-01-01');
      await expect(dialog.getByRole('alert')).toBeVisible();
      await dialog.getByRole('button', { name: 'Queue refresh', exact: true }).click();
    }
    await expect(dialog).not.toBeVisible();
    expect(submitted.at(-1)).toEqual({ mode: 'full', from: '2025-01-01', to: '2025-03-01', scope });
    const receipt = page.locator('.garmin-refresh-receipt');
    await expect(receipt).toContainText(
      `${scope === 'both' ? 'Activities and health' : scope === 'health' ? 'Health' : 'Activities'} refresh queued`,
    );
    await expect(receipt).toContainText('2025');
    await expect(receipt).not.toContainText('completed');
    if (scope === 'health') {
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        await page.screenshot({
          path: `.runtime/garmin-simplify/receipt-${info.project.name}-${theme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    await receipt.getByRole('button', { name: 'View progress' }).click();
    await expect(page.getByRole('dialog', { name: 'Import log', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(receipt.getByRole('button', { name: 'View progress' })).toBeFocused();
  }
  // The acknowledgement follows only an observed workspace job state.
  for (const [status, text] of [
    ['running', 'in progress'],
    ['paused', 'paused'],
    ['failed', 'failed'],
    ['completed', 'completed'],
  ]) {
    reportedStatus = status!;
    await page.clock.runFor(10_000);
    await expect(page.locator('.garmin-refresh-receipt')).toContainText(
      `Activities and health refresh ${text}`,
    );
  }
  await page.getByRole('button', { name: 'Refresh date range', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh date range', exact: true })).toBeFocused();
});

test('a queued history import leaves Sync available and polls only a visible tab', async ({
  page,
}, info) => {
  await page.clock.install();
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  let refreshes = 0;
  let jobKind = 'garmin-history';
  let jobStatus = 'queued';
  await page.route('**/api/workspace?**', async (route) => {
    refreshes++;
    const response = await route.fetch(),
      body = await response.json();
    body.garmin = {
      ...body.garmin,
      connected: true,
      verified: true,
      paused: false,
      lastError: null,
      lastErrorCode: null,
      currentJob: {
        id: '00000000-0000-4000-8000-000000000098',
        kind: jobKind,
        status: jobStatus,
        progress: '',
        nextRunAt: null,
        retrying: false,
      },
    };
    await route.fulfill({ response, json: body });
  });
  await page.goto('/garmin');
  await expect(
    page.getByRole('button', { name: 'Refresh date range', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sync latest data', exact: true })).toBeEnabled();
  const refreshButton = page.getByRole('button', { name: 'Refresh date range', exact: true });
  await expect(refreshButton).toHaveAccessibleDescription(
    'Available after the current history import finishes',
  );
  await expect(refreshButton).toHaveCSS('opacity', '1');
  const reason = page.getByText('Available after the current history import finishes', {
    exact: true,
  });
  const buttonBox = (await refreshButton.boundingBox())!;
  const reasonBox = (await reason.boundingBox())!;
  expect(reasonBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
  expect(reasonBox.y - buttonBox.y - buttonBox.height).toBeLessThan(12);
  if (page.viewportSize()!.width > 760) {
    const headerBox = (await page.locator('.garmin-page .page-header').boundingBox())!;
    const syncBox = (await page
      .getByRole('button', { name: 'Sync latest data', exact: true })
      .boundingBox())!;
    expect(Math.abs(buttonBox.x + buttonBox.width - headerBox.x - headerBox.width)).toBeLessThan(1);
    expect(Math.abs(syncBox.y - buttonBox.y)).toBeLessThan(1);
    expect(buttonBox.x - syncBox.x - syncBox.width).toBeGreaterThanOrEqual(8);
    expect(buttonBox.x - syncBox.x - syncBox.width).toBeLessThanOrEqual(16);
    expect(reasonBox.width).toBeLessThanOrEqual(buttonBox.width + 1);
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      window.scrollTo(0, 0);
    }, theme);
    await page.screenshot({
      path: `.runtime/garmin-simplify/history-wait-${info.project.name}-${theme}.png`,
      animations: 'disabled',
    });
  }
  const visibleStart = refreshes;
  await page.clock.runFor(10_000);
  await expect.poll(() => refreshes).toBeGreaterThan(visibleStart);
  jobKind = 'garmin-recent';
  await page.clock.runFor(10_000);
  const sync = page.getByRole('button', { name: 'Sync latest data', exact: true });
  await expect(sync).toBeDisabled();
  await expect(sync).toHaveAccessibleDescription('Sync already queued.');
  jobStatus = 'running';
  await page.clock.runFor(10_000);
  await expect(sync).toHaveAccessibleDescription('Sync in progress.');
  await expect(sync).toBeDisabled();
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { value: true }));
  const hiddenStart = refreshes;
  await page.clock.runFor(30_000);
  expect(refreshes).toBe(hiddenStart);
});

for (const theme of ['dark', 'light']) {
  test(`Garmin controls and detail dialogs stay usable in ${theme}`, async ({ page }, info) => {
    await page.goto('/login');
    await page.getByLabel('Password', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Training calendar', exact: true }),
    ).toBeVisible();
    let syncFails = true;
    let needsAttention = false;
    let awaitingHistory = false;
    let connected = true;
    let paused = false;
    let verified = true;
    let coverageRequests = 0;
    let coverageFails = true;
    const operations: { operation: string; data: unknown }[] = [];
    await page.route('**/api/workspace?**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.garmin = {
        ...body.garmin,
        connected,
        paused,
        verified,
        lastSync: awaitingHistory ? null : '2026-10-29T08:30:00.000Z',
        lastError: null,
        lastErrorCode: null,
        currentJob: awaitingHistory
          ? {
              id: '00000000-0000-4000-8000-000000000097',
              kind: 'garmin-history',
              status: 'cancelled',
              progress: '',
              nextRunAt: null,
              retrying: false,
            }
          : null,
        historyStatus: 'completed',
        coverageSummary: {
          windows: awaitingHistory ? 0 : 1,
          failed: needsAttention ? 1 : 0,
          unavailable: 0,
          empty: 0,
          complete: awaitingHistory || needsAttention ? 0 : 1,
        },
        recovery: {
          catchup: null,
          reconciliation: null,
          nextReconcileAt: null,
          unscannedWindows: awaitingHistory ? 2101 : needsAttention ? 2 : 0,
          retryStreams: needsAttention ? ['steps'] : [],
        },
      };
      body.jobs = [
        {
          id: '00000000-0000-4000-8000-000000000098',
          kind: 'garmin-catchup',
          status: 'failed',
          progress: 'steps · 2025-01-01 – 2025-01-28',
          error: 'Synthetic temporary outage',
          nextRunAt: '2026-10-29T08:30:00.000Z',
          attempts: 1,
        },
      ];
      await route.fulfill({ response, json: body });
    });
    await page.route('**/api/plugins/garmin/coverage', async (route) => {
      coverageRequests++;
      await route.fulfill(
        coverageFails
          ? { status: 503, json: { error: 'unavailable' } }
          : { json: { rows: [], total: 0, offset: 0, limit: 50 } },
      );
    });
    for (const operation of ['pause', 'disconnect', 'configure', 'sync']) {
      await page.route(`**/api/plugins/garmin/${operation}`, async (route) => {
        const data = route.request().postDataJSON();
        operations.push({ operation, data });
        if (operation === 'sync' && syncFails) {
          syncFails = false;
          await route.fulfill({
            status: 503,
            json: { error: { message: 'Synthetic Garmin request failed' } },
          });
          return;
        }
        if (operation === 'pause') paused = data.paused;
        if (operation === 'disconnect') connected = false;
        if (operation === 'configure') verified = false;
        await route.fulfill({
          json:
            operation === 'sync'
              ? { id: '00000000-0000-4000-8000-000000000099', status: 'queued' }
              : operation === 'pause'
                ? { paused }
                : { connected },
        });
      });
    }
    await page.goto('/garmin');
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(page.getByRole('heading', { name: 'Connected', exact: true })).toBeVisible();
    await expect(
      page.getByText('Recent data: The latest seven days refresh every hour.', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'How Garmin updates', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Refresh policy' }).getByRole('listitem'),
    ).toHaveText([
      'Recent data: The latest seven days refresh every hour.',
      'History: Earlier data and dates not yet checked are imported automatically.',
      'Older changes: Use Refresh date range for corrections or late uploads affecting previously checked dates older than seven days.',
    ]);
    const importDetails = page.getByRole('region', { name: 'Import details', exact: true });
    await expect(
      importDetails.getByRole('heading', { name: 'Import details', exact: true }),
    ).toBeVisible();
    for (const [index, label] of ['Import log', 'History coverage', 'Automatic recovery'].entries())
      await expect(importDetails.getByRole('button').nth(index)).toHaveAccessibleName(label);
    await expect(page.getByLabel('Show history windows')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sync now', exact: true })).toHaveCount(0);
    expect(coverageRequests).toBe(0);
    const capture = async (state: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.runtime/garmin-ui/${state}-${info.project.name}-${theme}.png`,
        animations: 'disabled',
        fullPage: (await page.getByRole('dialog').count()) === 0,
      });
    };
    const summary = page.getByRole('region', { name: 'Connection and sync summary' });
    await expect(summary).toContainText('Last synced');
    await expect(summary.getByRole('status')).toHaveCount(0);
    await expect(summary).not.toContainText('Garmin connected');
    await expect(summary).not.toContainText('History import');
    await expect(
      page.getByRole('button', { name: 'History coverage', exact: true }),
    ).toHaveAccessibleDescription('No history errors reported');
    await expect(
      page.getByRole('button', { name: 'Automatic recovery', exact: true }),
    ).toHaveAccessibleDescription('No recovery import running');
    await expect(
      page.getByRole('button', { name: 'Import log', exact: true }),
    ).toHaveAccessibleDescription(/Last successful sync/);
    const policyBox = (await page.getByRole('region', { name: 'Refresh policy' }).boundingBox())!;
    const linksBox = (await page.getByRole('region', { name: 'Import details' }).boundingBox())!;
    if (page.viewportSize()!.width >= 1280) {
      expect(Math.abs(policyBox.y - linksBox.y)).toBeLessThan(2);
      expect(linksBox.x).toBeGreaterThan(policyBox.x + policyBox.width);
    } else {
      expect(linksBox.y).toBeGreaterThan(policyBox.y + policyBox.height);
    }
    await capture('healthy');
    awaitingHistory = true;
    await page.reload();
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(
      page.getByRole('button', { name: 'History coverage', exact: true }),
    ).toHaveAccessibleDescription('History has not been checked yet');
    await expect(
      page.getByRole('button', { name: 'Automatic recovery', exact: true }),
    ).toHaveAccessibleDescription('Waiting to check older dates');
    await expect(
      page.getByRole('button', { name: 'Import log', exact: true }),
    ).toHaveAccessibleDescription('Last import cancelled');
    await expect(importDetails).not.toContainText('2101');
    await capture('history-waiting');
    await page.getByRole('button', { name: 'Automatic recovery', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Automatic recovery', exact: true }),
    ).toContainText('2101 unscanned windows');
    await page.keyboard.press('Escape');
    awaitingHistory = false;
    needsAttention = true;
    await page.reload();
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(
      page.getByRole('button', { name: 'History coverage', exact: true }),
    ).toHaveAccessibleDescription('1 failed period needs attention');
    await expect(
      page.getByRole('button', { name: 'Automatic recovery', exact: true }),
    ).toHaveAccessibleDescription('Recovery needs an explicit retry');
    await capture('connected');
    if (info.project.name === 'mobile') {
      for (const label of [
        'Sync latest data',
        'Refresh date range',
        'Pause',
        'Replace API key',
        'Disconnect',
        'History coverage',
        'Automatic recovery',
        'Import log',
      ]) {
        const box = (await page.getByRole('button', { name: label, exact: true }).boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
    for (const label of ['History coverage', 'Automatic recovery', 'Import log']) {
      const trigger = page.getByRole('button', { name: label, exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: label, exact: true });
      await expect(dialog).toBeVisible();
      if (label === 'History coverage') {
        await expect(dialog.getByRole('alert')).toContainText('History coverage could not refresh');
        coverageFails = false;
        await dialog.getByRole('button', { name: 'Reload coverage' }).click();
        await expect(dialog.getByText('No matching windows.')).toBeVisible();
      }
      if (label === 'Automatic recovery') {
        await expect(dialog).toContainText('A retry is needed for: steps');
        const coverageTrigger = dialog.getByRole('button', {
          name: 'History coverage',
          exact: true,
        });
        await coverageTrigger.click();
        const coverageDialog = page.getByRole('dialog', { name: 'History coverage', exact: true });
        await expect(coverageDialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(coverageDialog).not.toBeVisible();
        await expect(dialog).toBeVisible();
        await expect(coverageTrigger).toBeFocused();
      }
      if (label === 'Import log') {
        await expect(dialog).toContainText('Synthetic temporary outage');
        await expect(dialog.getByRole('button', { name: /Sync/ })).toHaveCount(0);
      }
      await capture(label.toLowerCase().replaceAll(' ', '-'));
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    }
    const sync = page.getByRole('button', { name: 'Sync latest data', exact: true });
    await expect(sync).toHaveAttribute('data-variant', 'default');
    await expect(
      page.getByRole('button', { name: 'Refresh date range', exact: true }),
    ).toHaveAttribute('data-variant', 'outline');
    await sync.click();
    await expect(page.locator('.garmin-page').getByRole('alert')).toContainText(
      'Synthetic Garmin request failed',
    );
    await expect(sync).toBeEnabled();
    await sync.click();
    await expect(page.locator('.garmin-page').getByRole('alert')).toHaveCount(0);
    await expect.poll(() => operations.some((item) => item.operation === 'sync')).toBe(true);
    expect(operations.at(-1)).toEqual({ operation: 'sync', data: { mode: 'recent' } });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    expect(operations.at(-1)).toEqual({ operation: 'pause', data: { paused: true } });
    await expect(
      page.getByRole('button', { name: 'Refresh date range', exact: true }),
    ).toBeDisabled();
    await capture('paused');
    await expect(sync).toBeDisabled();
    await expect(sync).toHaveAccessibleDescription('Resume imports to sync the latest data.');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Refresh date range', exact: true }),
    ).toBeEnabled();
    expect(operations.at(-1)).toEqual({ operation: 'pause', data: { paused: false } });
    await page.getByRole('button', { name: 'Replace API key', exact: true }).click();
    const keyDialog = page.getByRole('dialog', { name: 'Replace API key', exact: true });
    await capture('replace-key');
    const keyInput = keyDialog.getByLabel('Personal API key');
    await expect(keyInput).toHaveAttribute('type', 'password');
    const toggle = keyDialog.getByRole('button', { name: 'Show key', exact: true });
    const inputBox = (await keyInput.boundingBox())!;
    const toggleBox = (await toggle.boundingBox())!;
    expect(toggleBox.width).toBeGreaterThanOrEqual(44);
    expect(toggleBox.height).toBeGreaterThanOrEqual(44);
    expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width + 1);
    expect(toggleBox.y).toBeGreaterThanOrEqual(inputBox.y);
    expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(inputBox.y + inputBox.height + 1);
    await keyInput.fill('synthetic-replacement-key-never-valid');
    await toggle.click();
    await expect(keyInput).toHaveAttribute('type', 'text');
    await expect(keyInput).toHaveValue('synthetic-replacement-key-never-valid');
    await capture('replace-key-visible');
    await keyDialog.getByRole('button', { name: 'Hide key', exact: true }).press('Space');
    await expect(keyInput).toHaveAttribute('type', 'password');
    await expect(keyInput).toHaveValue('synthetic-replacement-key-never-valid');
    await toggle.press('Enter');
    await expect(keyInput).toHaveAttribute('type', 'text');
    expect(operations.some((item) => item.operation === 'configure')).toBe(false);
    await keyDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Replace API key', exact: true }).click();
    await expect(keyInput).toHaveValue('');
    await expect(keyInput).toHaveAttribute('type', 'password');
    await keyDialog.getByLabel('Personal API key').fill('synthetic-replacement-key-never-valid');
    await keyDialog.getByRole('button', { name: 'Save connection', exact: true }).click();
    await expect(keyDialog).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Checking connection', exact: true }),
    ).toBeVisible();
    expect(operations.at(-1)).toMatchObject({
      operation: 'configure',
      data: { key: 'synthetic-replacement-key-never-valid', idempotencyKey: expect.any(String) },
    });
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Imported activities and health records will be kept.');
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(operations.some((item) => item.operation === 'disconnect')).toBe(false);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect Garmin', exact: true })).toBeVisible();
    await capture('disconnected');
  });
}
