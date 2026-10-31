import { test, expect, type Page, type Route } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
}
async function settings(page: Page) {
  const opener = page.getByRole('button', { name: 'Open navigation' });
  if (await opener.isVisible()) await opener.click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Settings', exact: true })
    .click();
}
test('a stale save offers a reload without a preceding read failure and preserves the draft revision', async ({
  page,
}) => {
  await login(page);
  await settings(page);
  await page.getByLabel('Training goals').fill('My unsaved draft');
  const origin = new URL(page.url()).origin;
  const state = await page.request
    .get('/api/workspace?from=2026-10-19&to=2026-11-08')
    .then((r) => r.json());
  const { id: _id, revision, ...values } = state.state.profile;
  const result = await page.request.post('/api/plugins/training/mutate', {
    headers: { Origin: origin },
    data: {
      idempotencyKey: crypto.randomUUID(),
      commands: [
        {
          action: 'profile.set',
          expectedRevision: revision,
          values: { ...values, goals: 'Newer saved goals' },
        },
      ],
    },
  });
  expect(result.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reload saved data', exact: true }).click();
  await expect(page.getByText('This profile changed elsewhere.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Training goals')).toHaveValue('My unsaved draft');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.locator('.error-message')).toContainText(/changed|revision|stale/i);
  const after = await page.request
    .get('/api/workspace?from=2026-10-19&to=2026-11-08')
    .then((r) => r.json());
  expect(after.state.profile.goals).toBe('Newer saved goals');
  await page.getByRole('button', { name: 'Load saved profile' }).click();
  await expect(page.getByLabel('Training goals')).toHaveValue('Newer saved goals');
  await page.getByLabel('Training goals').fill('Reviewed goals');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
});

for (const theme of ['dark', 'light']) {
  test(`an uncertain save reloads inside its open dialog without resubmitting (${theme})`, async ({
    page,
  }, info) => {
    await login(page);
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const title = `Uncertain save ${theme} ${info.project.name} ${Date.now()}`;
    await page.getByRole('button', { name: 'Add workout', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Workout title').fill(title);
    await dialog.getByLabel('Workout description').fill('Preserve this draft through recovery.');
    let writes = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/plugins/')) writes++;
    });
    await page.route(
      '**/api/plugins/training/mutate',
      async (route) => {
        const saved = await route.fetch();
        expect(saved.ok()).toBe(true);
        await route.fulfill({
          status: 502,
          contentType: 'text/html',
          body: '<html>Gateway timeout</html>',
        });
      },
      { times: 1 },
    );
    await dialog.getByRole('button', { name: 'Add workout', exact: true }).click();
    await expect(dialog.locator('.error-message')).toContainText('The change may have been saved', {
      ignoreCase: true,
    });
    const reload = dialog.getByRole('button', { name: 'Reload saved data', exact: true });
    expect((await reload.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.route(
      '**/api/workspace?**',
      (route) => route.fulfill({ status: 503, json: { error: 'Synthetic reload outage' } }),
      { times: 1 },
    );
    await reload.click();
    await expect(dialog.getByRole('status')).toContainText('Saved data could not reload');
    await dialog.locator('.error-message').screenshot({
      path: `.runtime/pr56-review/recovery-${theme}-${info.project.name}.png`,
      animations: 'disabled',
    });
    await reload.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('status')).toContainText('Saved data reloaded');
    await expect(dialog.getByLabel('Workout title')).toHaveValue(title);
    await expect(dialog.getByLabel('Workout description')).toHaveValue(
      'Preserve this draft through recovery.',
    );
    expect(writes).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: `Open ${title}`, exact: true })).toHaveCount(1);
  });
}
test('failed date navigation retains last loaded dates and can retry', async ({ page }) => {
  await login(page);
  let imports = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/plugins/garmin/')) imports++;
  });
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
  const before = await page.getByLabel('Go to date').inputValue();
  await page.route('**/api/workspace?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Synthetic outage' } }),
    }),
  );
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(page.locator('.error-message')).toContainText('Synthetic outage');
  await expect(page.getByLabel('Go to date')).toHaveValue(before);
  await page.unroute('**/api/workspace?**');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByLabel('Go to date')).not.toHaveValue(before);
  expect(imports).toBe(0);
});
test('successful mutation with failed refresh is clearly reported without losing the saved edit', async ({
  page,
}) => {
  await login(page);
  await settings(page);
  await page.getByLabel('Training goals').fill('Saved during reload outage');
  await page.route('**/api/workspace?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":{"message":"Synthetic reload outage"}}',
    }),
  );
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(
    page.getByText('Your change was saved, but the workspace could not refresh.', { exact: false }),
  ).toBeVisible();
  await page.unroute('**/api/workspace?**');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Training goals')).toHaveValue('Saved during reload outage');
});

test('a proxy error page on save says the change may have been saved', async ({ page }) => {
  await login(page);
  await settings(page);
  await page.getByLabel('Training goals').fill('Saved behind a failing proxy');
  await page.route('**/api/plugins/training/mutate', (route) =>
    route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }),
  );
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('.error-message')).toContainText(
    'The server did not answer, so the change may have been saved.',
  );
  await page.unroute('**/api/plugins/training/mutate');
  await page.route('**/api/plugins/training/mutate', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: '{"error":{"code":"STALE_REVISION","message":"Synthetic conflict"}}',
    }),
  );
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('.error-message')).toContainText('Synthetic conflict');
  await page.unroute('**/api/plugins/training/mutate');
  await page.route('**/api/plugins/training/mutate', (route) => route.abort());
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('.error-message')).toContainText(
    'The server did not answer, so the change may have been saved.',
  );
});
for (const { failure, failLogin } of [
  {
    failure: 'a proxy error page',
    failLogin: (route: Route) =>
      route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }),
  },
  { failure: 'a network failure', failLogin: (route: Route) => route.abort() },
]) {
  test(`${failure} on sign-in says the instance cannot be reached`, async ({ page }) => {
    await page.route('**/api/auth/login', failLogin);
    await page.goto('/login');
    await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.error-message')).toContainText(
      'Unable to reach this instance. Please refresh and try again.',
    );
  });
}

test('an out-of-range year in Go to date keeps the current week', async ({ page }) => {
  await login(page);
  const field = page.getByLabel('Go to date');
  const before = await field.inputValue();
  await field.evaluate((input: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      '20261-01-01',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await expect(field).toHaveValue(before);
  await field.fill('9999-12-31');
  await expect(field).toHaveValue(before);
  await field.fill('2030-01-09');
  await expect(field).not.toHaveValue(before);
});
