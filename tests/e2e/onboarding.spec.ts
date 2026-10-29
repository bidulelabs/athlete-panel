import { isolatedDatabaseUrl } from '../support/test-database';
import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

const target = isolatedDatabaseUrl('E2E_DATABASE_URL');
const sql = postgres(target, { max: 1, onnotice: () => {} });
let savedProfile: any;
async function setSetup(status = 'pending') {
  await sql`insert into host.settings(key,value) values('onboarding',${sql.json({ version: 1, status, step: 1, revision: 1, updatedAt: new Date().toISOString(), completedAt: null })}) on conflict(key) do update set value=excluded.value`;
}
test.beforeEach(async () => {
  [savedProfile] = await sql`select * from athlete.records where kind='profile' and id='owner'`;
  await setSetup();
  await sql`delete from host.settings where key in ('garmin','garminToken')`;
  await sql`delete from host.jobs where plugin_id='garmin'`;
});
test.afterEach(async () => {
  if (savedProfile)
    await sql`insert into athlete.records(kind,id,data,revision,deleted) values('profile','owner',${sql.json(savedProfile.data)},${savedProfile.revision},${savedProfile.deleted}) on conflict(kind,id) do update set data=excluded.data,revision=excluded.revision,deleted=excluded.deleted`;
  await setSetup('existing-owner');
  await sql`delete from host.settings where key in ('garmin','garminToken')`;
  await sql`delete from host.jobs where plugin_id='garmin'`;
});
test.afterAll(async () => {
  await sql.end();
});
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Welcome to Athlete Panel' });

test('Escape closes onboarding after a backdrop click moves focus to body', async ({
  page,
}, info) => {
  await login(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const welcome = dialog(page);
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') {
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
    }
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(welcome.getByRole('heading', { name: /Step 1 of 3/ })).toBeFocused();
    await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 2, y: 2 } });
    await expect(welcome).toBeVisible();
    await expect(page.locator('body')).toBeFocused();
    await page.screenshot({
      path: `.runtime/plans-review/onboarding-backdrop-${info.project.name}-${theme}.png`,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(welcome).not.toBeVisible();
    await expect
      .poll(
        async () =>
          (await sql`select value from host.settings where key='onboarding'`)[0].value.status,
      )
      .toBe('deferred');
  }
});

test('new owner saves, reloads, skips Garmin and opens the calendar in both themes', async ({
  page,
}, info) => {
  await sql`delete from athlete.records where kind='profile' and id='owner'`;
  await login(page);
  const welcome = dialog(page);
  await expect(welcome).toBeVisible();
  await expect(welcome.getByLabel('Timezone', { exact: true })).toHaveValue('Europe/Paris');
  await expect(welcome.getByLabel('Measurement units')).toHaveValue('metric');
  await expect(welcome.getByLabel('First day of the week')).toHaveValue('auto');
  await expect(welcome.getByRole('heading', { name: /Step 1 of 3/ })).toBeFocused();
  await welcome.getByLabel('Timezone', { exact: true }).selectOption('America/New_York');
  await welcome.getByLabel('Measurement units').selectOption('imperial');
  await welcome.getByLabel('First day of the week').selectOption('sunday');
  await welcome.screenshot({
    path: `.runtime/browser/onboarding-preferences-${info.project.name}-dark.png`,
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await welcome.screenshot({
    path: `.runtime/browser/onboarding-preferences-${info.project.name}-light.png`,
  });
  await welcome.getByRole('button', { name: 'Save and continue' }).click();
  await expect(welcome.getByRole('heading', { name: /Step 2 of 3/ })).toBeVisible();
  await page.reload();
  await expect(welcome.getByRole('heading', { name: /Step 2 of 3/ })).toBeVisible();
  await welcome.getByLabel('Garmin Personal API key').fill('synthetic-unsaved-key');
  await welcome.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(welcome.getByLabel('Timezone', { exact: true })).toHaveValue('America/New_York');
  await welcome.getByRole('button', { name: 'Save and continue' }).click();
  await expect(welcome.getByLabel('Garmin Personal API key')).toHaveValue('');
  await welcome.getByRole('button', { name: 'Skip for now' }).click();
  await expect(welcome.getByText('America/New_York', { exact: true })).toBeVisible();
  await welcome.getByRole('button', { name: 'Open my calendar' }).click();
  await expect(welcome).not.toBeVisible();
  await page.reload();
  await expect(welcome).not.toBeVisible();
  expect(await sql`select * from host.jobs where plugin_id='garmin'`).toHaveLength(0);
});

test('close defers, Settings resumes, and stored key does not require waiting for a worker', async ({
  page,
}, info) => {
  await login(page);
  const welcome = dialog(page);
  await welcome.getByRole('button', { name: 'Save and continue' }).click();
  await welcome.getByLabel('Garmin Personal API key').fill('synthetic-discard-me');
  await page.keyboard.press('Escape');
  await expect(welcome).not.toBeVisible();
  await expect
    .poll(
      async () =>
        (await sql`select value from host.settings where key='onboarding'`)[0].value.status,
    )
    .toBe('deferred');
  await page.reload();
  await expect(welcome).not.toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
  await expect(welcome.getByLabel('Garmin Personal API key')).toHaveValue('');
  await welcome.getByLabel('Garmin Personal API key').fill('synthetic-onboarding-browser-key');
  await welcome.getByRole('button', { name: 'Connect Garmin', exact: true }).click();
  await expect(welcome.getByLabel('Garmin Personal API key')).toHaveCount(0);
  await expect(welcome.getByText(/Your key is saved/)).toBeVisible();
  await welcome.screenshot({ path: `.runtime/browser/onboarding-garmin-${info.project.name}.png` });
  await welcome.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(welcome.getByRole('heading', { name: /Ready to start/ })).toBeVisible();
  await welcome.getByRole('button', { name: 'Open my calendar' }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  expect(
    await sql`select * from host.jobs where plugin_id='garmin' and status='queued'`,
  ).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    ),
  ).not.toContain('synthetic-onboarding-browser-key');
});

test('existing owners are not interrupted; failed saves retain drafts; 320px fits', async ({
  page,
}) => {
  await setSetup('existing-owner');
  await login(page);
  await expect(dialog(page)).not.toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Run welcome setup' }).click();
  await page.setViewportSize({ width: 320, height: 700 });
  const welcome = dialog(page);
  await welcome.getByLabel('Timezone', { exact: true }).selectOption('UTC');
  await page.route(
    '**/api/plugins/athlete/onboarding',
    (route) =>
      route.fulfill({ status: 503, json: { error: { message: 'Synthetic save unavailable' } } }),
    { times: 1 },
  );
  await welcome.getByRole('button', { name: 'Save and continue' }).click();
  await expect(welcome.getByRole('alert')).toContainText('Synthetic save unavailable');
  await expect(welcome.getByLabel('Timezone', { exact: true })).toHaveValue('UTC');
  await expect(welcome.getByRole('heading', { name: /Step 1 of 3/ })).toBeVisible();
  expect(await welcome.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await welcome.getByRole('button', { name: 'Save and continue' }).click();
  await expect(welcome.getByRole('heading', { name: /Step 2 of 3/ })).toBeVisible();
  await welcome.getByRole('button', { name: 'Finish setup later' }).click();
  await expect(welcome).not.toBeVisible();
  await expect(page.getByLabel('Timezone', { exact: true })).toHaveValue('UTC');
});

test('status and mutations require an owner session and origin; agent pairing is not obscured', async ({
  page,
  request,
}) => {
  expect((await request.get('/api/onboarding')).status()).toBe(401);
  expect(
    (
      await request.post('/api/plugins/athlete/onboarding', {
        data: { action: 'complete', expectedRevision: 1, idempotencyKey: randomUUID() },
      })
    ).ok(),
  ).toBe(false);
  await login(page);
  await dialog(page).getByRole('button', { name: 'Finish setup later' }).click();
  const rejected = await page.request.post('/api/plugins/athlete/onboarding', {
    headers: { Origin: 'https://untrusted.example' },
    data: { action: 'resume', expectedRevision: 1, idempotencyKey: randomUUID() },
  });
  expect(rejected.status()).toBe(403);
  await setSetup();
  await page.goto(`/agent?connect=${randomUUID()}`);
  await expect(page.getByRole('heading', { name: /Connect your training agent/ })).toBeVisible();
  await expect(dialog(page)).not.toBeVisible();
});

test('closing during an accepted save defers the saved step instead of losing it', async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  let accepted!: () => void;
  const saved = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/api/plugins/athlete/onboarding',
    async (route) => {
      const response = await route.fetch();
      accepted();
      await hold;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  const welcome = dialog(page);
  await welcome.getByRole('button', { name: 'Save and continue' }).click();
  await saved;
  await welcome.getByRole('button', { name: 'Finish setup later' }).click();
  await expect(welcome).not.toBeVisible();
  release();
  await expect
    .poll(async () => (await sql`select value from host.settings where key='onboarding'`)[0].value)
    .toMatchObject({ status: 'deferred', step: 2 });
  await page.reload();
  await expect(welcome).not.toBeVisible();
});

test('disabled Garmin onboarding can be skipped without mounting provider controls', async ({
  page,
}) => {
  await page.route('**/api/workspace?*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.plugins = body.plugins.map((plugin: { id: string; enabled: boolean }) =>
      plugin.id === 'garmin' ? { ...plugin, enabled: false } : plugin,
    );
    await route.fulfill({ response, json: body });
  });
  const providerRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/plugins/garmin/')) providerRequests.push(request.url());
  });
  await login(page);
  const welcome = dialog(page);
  await welcome.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(
    welcome.getByText('Garmin is disabled. You can enable it later in Plugins.'),
  ).toBeVisible();
  await expect(welcome.getByLabel('Personal API key', { exact: true })).toHaveCount(0);
  await welcome.getByRole('button', { name: 'Skip for now', exact: true }).click();
  await expect(welcome.getByText('Garmin is disabled.', { exact: true })).toBeVisible();
  expect(providerRequests).toEqual([]);
});
