import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { calendarFixture } from '../fixtures/calendar';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
}
async function preview(page: Page) {
  const fixture = calendarFixture();
  let mutations = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/plugins/')) mutations++;
  });
  await page.route('**/api/workspace?**', async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    await route.fulfill({ response, json: { ...envelope, state: fixture } });
  });
  await login(page);
  await page.getByLabel('Go to date').fill('2030-01-06');
  await expect(page.locator('[data-date="2030-01-06"]')).toBeVisible();
  return { fixture, mutations: () => mutations };
}
const dialog = (page: Page) => page.getByRole('dialog');
const metric = (page: Page, name: string) =>
  dialog(page)
    .locator('dl > div')
    .filter({ has: page.locator('dt').filter({ hasText: new RegExp(`^${name}$`) }) });
async function close(page: Page) {
  await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
}

test('sleep cards show complete, incomplete and score-only data with accessible details', async ({
  page,
}, info) => {
  const previewState = await preview(page);
  const sleep = page
    .locator('[data-date="2030-01-06"]')
    .getByRole('button', { name: /Open sleep details/ });
  await expect(sleep).toContainText('8h sleep');
  await expect(sleep).toContainText('87 / 100');
  await expect(sleep).toContainText('HRV 58 ms');
  await sleep.focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page).getByRole('heading', { name: 'Sleep summary' })).toBeVisible();
  await expect(metric(page, 'Deep')).toContainText('1h 30m');
  await expect(metric(page, 'Light')).toContainText('5h');
  await expect(metric(page, 'REM')).toContainText('1h 30m');
  await expect(metric(page, 'Awake')).toContainText('30m');
  await expect(metric(page, 'Overnight HRV')).toContainText('58 ms');
  await expect(dialog(page).getByRole('img')).toHaveAttribute(
    'aria-label',
    /Deep:.*18%.*Light:.*59%.*Awake:.*6%/,
  );
  await page.screenshot({
    path: `.runtime/browser/calendar-sleep-${info.project.name}-dark.png`,
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(dialog(page)).not.toBeVisible();
  await expect(sleep).toBeFocused();
  await page.screenshot({
    path: `.runtime/browser/calendar-cards-${info.project.name}-dark.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page
    .getByRole('button', {
      name: info.project.name === 'mobile' ? 'Change color theme' : 'Switch to light mode',
      exact: true,
    })
    .click();
  await sleep.click();
  await page.screenshot({
    path: `.runtime/browser/calendar-sleep-${info.project.name}-light.png`,
    animations: 'disabled',
  });
  const box = await dialog(page).boundingBox();
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  await close(page);
  await page.screenshot({
    path: `.runtime/browser/calendar-cards-${info.project.name}-light.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page
    .locator('[data-date="2030-01-07"]')
    .getByRole('button', { name: /Open sleep details/ })
    .click();
  await expect(metric(page, 'Deep')).toContainText('0m');
  await expect(metric(page, 'Light')).toContainText('Unavailable');
  await expect(
    dialog(page).getByText('Stage data is incomplete. Percentages are unavailable.'),
  ).toBeVisible();
  await expect(dialog(page).getByRole('img')).toHaveCount(0);
  await close(page);
  await page
    .locator('[data-date="2030-01-08"]')
    .getByRole('button', { name: /Open sleep details/ })
    .click();
  await expect(dialog(page).locator('.sleep-detail-score')).toContainText('0 / 100');
  await expect(dialog(page).getByText('Stage data unavailable for this night.')).toBeVisible();
  await close(page);
  await expect(
    page.locator('[data-date="2030-01-09"]').getByRole('button', { name: /Open sleep details/ }),
  ).toHaveCount(0);
  expect(previewState.mutations()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('notes, events and dated constraints open full details under either week start', async ({
  page,
}) => {
  const { fixture, mutations } = await preview(page);
  await page.getByRole('button', { name: 'Open note Travel day', exact: true }).click();
  await expect(dialog(page).locator('.calendar-detail-prose')).toHaveText(fixture.notes[0].body);
  await expect(dialog(page).locator('b')).toHaveCount(0);
  await expect(dialog(page).getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await close(page);
  await page.getByRole('button', { name: 'Open note Protect the easy day', exact: true }).click();
  await expect(metric(page, 'Training plan')).toContainText('Winter base · Day 2');
  await close(page);
  await page.getByRole('button', { name: 'Open event Coastal 10 km', exact: true }).click();
  await expect(metric(page, 'Event type')).toContainText('Race');
  await expect(dialog(page).locator('.calendar-detail-prose')).toHaveText(fixture.events[0].notes);
  await close(page);
  const knee = page.getByRole('button', { name: 'Open injury Left knee', exact: true });
  await expect(knee).toHaveCount(4);
  await page
    .locator('[data-date="2030-01-08"]')
    .getByRole('button', { name: 'Open injury Left knee', exact: true })
    .click();
  await expect(metric(page, 'Severity')).toContainText('Moderate');
  await expect(metric(page, 'Active through')).toContainText('8 January 2030');
  await expect(dialog(page).getByText('Stop if pain increases.')).toBeVisible();
  await close(page);
  await expect(
    page
      .locator('[data-date="2030-01-09"]')
      .getByRole('button', { name: 'Open injury Left knee', exact: true }),
  ).toHaveCount(0);
  await page
    .locator('[data-date="2030-01-09"]')
    .getByRole('button', { name: 'Open injury Right shoulder', exact: true })
    .click();
  await expect(metric(page, 'Active through')).toContainText('Ongoing');
  await close(page);
  fixture.profile!.weekStartsOnPreference = 'sunday';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByLabel('Go to date')).toHaveValue('2030-01-06');
  await expect(
    page
      .locator('[data-date="2030-01-06"]')
      .getByRole('button', { name: 'Open note Travel day', exact: true }),
  ).toBeVisible();
  expect(mutations()).toBe(0);
});

test('activity details preserve recorded dates, units and links without navigating away', async ({
  page,
}) => {
  const { fixture, mutations } = await preview(page);
  await page.getByRole('button', { name: 'Open activity River path run', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(dialog(page).getByText('Running · Sunday, 6 January 2030')).toBeVisible();
  await expect(metric(page, 'Distance')).toContainText('8.0 km');
  await expect(metric(page, 'Elevation gain')).toContainText('0 m');
  await expect(metric(page, 'Average heart rate')).toContainText('Unavailable');
  await close(page);
  fixture.profile!.units = 'imperial';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open activity River path run', exact: true }),
  ).toContainText('5.0 mi');
  await page.getByRole('button', { name: 'Open activity Mobility session', exact: true }).click();
  await expect(metric(page, 'Duration')).toContainText('0m');
  await expect(metric(page, 'Distance')).toContainText('Unavailable');
  await close(page);
  await expect(
    page.getByRole('button', { name: 'Open activity Morning ride', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Steady endurance ride', exact: true }).click();
  await page.getByRole('button', { name: 'View imported activity', exact: true }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Morning ride' })).toBeVisible();
  await expect(metric(page, 'Elevation gain')).toContainText('820 ft');
  await dialog(page).getByRole('button', { name: 'Steady endurance ride', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Morning ride', exact: true })).not.toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Workout details' })).toBeVisible();
  expect(mutations()).toBe(0);
});

async function workspace(page: Page) {
  const response = await page.request.get('/api/workspace?from=2031-01-06&to=2031-01-26');
  expect(response.ok()).toBe(true);
  return (await response.json()).state;
}
async function save(page: Page, commands: unknown[]) {
  const response = await page.request.post('/api/plugins/training/mutate', {
    headers: { Origin: new URL(page.url()).origin },
    data: { commands, idempotencyKey: randomUUID() },
  });
  expect(response.ok()).toBe(true);
}

test('context cards use existing edit, confirmed delete and retry flows', async ({
  page,
}, info) => {
  await login(page);
  const noteId = randomUUID(),
    eventId = randomUUID(),
    injuryId = randomUUID();
  const title = `Card note ${info.project.name} ${Date.now()}`;
  const date = '2031-01-08';
  try {
    await save(page, [
      {
        action: 'note.create',
        values: {
          id: noteId,
          title,
          body: 'Full original note.',
          schedule: { kind: 'independent', date },
        },
      },
      {
        action: 'event.create',
        values: {
          id: eventId,
          title: `${title} event`,
          date,
          kind: 'goal',
          notes: 'A training goal.',
        },
      },
      {
        action: 'injury.create',
        values: {
          id: injuryId,
          bodyPart: `${title} knee`,
          startDate: date,
          endDate: '2031-01-09',
          severity: 'mild',
          description: 'Take it easy.',
        },
      },
    ]);
    await page.getByLabel('Go to date').fill(date);
    await page.getByRole('button', { name: `Open note ${title}`, exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(dialog(page).getByRole('heading', { name: 'Edit note' })).toBeVisible();
    await dialog(page)
      .getByRole('textbox', { name: 'Note', exact: true })
      .fill('Updated note.\nSecond line.');
    await dialog(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog(page)).not.toBeVisible();
    await page.getByRole('button', { name: `Open note ${title}`, exact: true }).click();
    await expect(dialog(page).locator('.calendar-detail-prose')).toHaveText(
      'Updated note.\nSecond line.',
    );
    await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Keep note', exact: true })
      .click();
    await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await page.route(
      '**/api/plugins/training/mutate',
      (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Synthetic outage. Retry deletion.' }),
        }),
      { times: 1 },
    );
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirm delete', exact: true })
      .click();
    await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText(
      'Synthetic outage',
    );
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirm delete', exact: true })
      .click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(page.getByRole('button', { name: `Open note ${title}`, exact: true })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: `Open event ${title} event`, exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Edit', exact: true }).click();
    await dialog(page)
      .getByRole('textbox', { name: 'Notes', exact: true })
      .fill('Updated goal details.');
    await dialog(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: `Open event ${title} event`, exact: true }),
    ).toContainText('Updated goal details.');
    const injury = page.getByRole('button', { name: `Open injury ${title} knee`, exact: true });
    await expect(injury).toHaveCount(2);
    await injury.first().click();
    await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      page.getByRole('alertdialog').getByText('Delete this constraint from every affected day?'),
    ).toBeVisible();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirm delete', exact: true })
      .click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(injury).toHaveCount(0);
  } finally {
    const data = await workspace(page);
    const commands = [
      ...data.notes
        .filter((record: { id: string }) => record.id === noteId)
        .map((record: { id: string; revision: number }) => ({
          action: 'note.delete',
          id: record.id,
          expectedRevision: record.revision,
        })),
      ...data.events
        .filter((record: { id: string }) => record.id === eventId)
        .map((record: { id: string; revision: number }) => ({
          action: 'event.delete',
          id: record.id,
          expectedRevision: record.revision,
        })),
      ...data.injuries
        .filter((record: { id: string }) => record.id === injuryId)
        .map((record: { id: string; revision: number }) => ({
          action: 'injury.delete',
          id: record.id,
          expectedRevision: record.revision,
        })),
    ];
    if (commands.length) await save(page, commands);
  }
});

test('a stale editor keeps the draft and does not overwrite a newer note', async ({ page }) => {
  await login(page);
  const id = randomUUID();
  const title = `Concurrent note ${id}`;
  try {
    await save(page, [
      {
        action: 'note.create',
        values: {
          id,
          title,
          body: 'Original',
          schedule: { kind: 'independent', date: '2031-01-08' },
        },
      },
    ]);
    await page.getByLabel('Go to date').fill('2031-01-08');
    await page.getByRole('button', { name: `Open note ${title}`, exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Edit', exact: true }).click();
    await dialog(page)
      .getByRole('textbox', { name: 'Note', exact: true })
      .fill('Unsaved local draft');
    await save(page, [
      { action: 'note.update', id, expectedRevision: 1, values: { body: 'Saved elsewhere' } },
    ]);
    await dialog(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog(page).getByRole('alert')).toBeVisible();
    await expect(dialog(page).getByRole('textbox', { name: 'Note', exact: true })).toHaveValue(
      'Unsaved local draft',
    );
    expect((await workspace(page)).notes.find((note: { id: string }) => note.id === id).body).toBe(
      'Saved elsewhere',
    );
  } finally {
    const note = (await workspace(page)).notes.find((note: { id: string }) => note.id === id);
    if (note) await save(page, [{ action: 'note.delete', id, expectedRevision: note.revision }]);
  }
});
