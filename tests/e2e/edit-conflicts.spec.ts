import { test, expect, type Page } from '@playwright/test';
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
test('retrying a workspace reload preserves an old draft revision and offers explicit recovery', async ({
  page,
}) => {
  await login(page);
  await page.route(
    '**/api/workspace?**',
    (route) => route.fulfill({ status: 503, json: { error: 'Synthetic reload outage' } }),
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
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
test('a proxy error page on sign-in does not show a parser error', async ({ page }) => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }),
  );
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Unable to reach this instance.', { exact: false })).toBeVisible();
});

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
