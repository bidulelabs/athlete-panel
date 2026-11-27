import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { WorkspaceState } from '@athlete-panel/contracts';
import {
  appleBatch,
  appleConnectionTest,
  appleRoutePoints,
  appleWorkout,
  appleWorkoutDate,
} from '../fixtures/apple-health';
import { ownerCommand, signIn } from './race-helpers';

for (const theme of ['dark', 'light'] as const) {
  test(`pairs an iPhone, opens an Apple workout and downloads its route in ${theme}`, async ({
    page,
  }) => {
    await signIn(page, theme);
    await page.goto('/apple-health');
    await expect(page.getByRole('heading', { name: 'Apple Health', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: /^(Create|Rotate) upload token$/ }).click();
    const token = page.getByRole('textbox', { name: 'Upload token', exact: true });
    await expect(token).toHaveValue(/^[A-Za-z0-9_-]{43}$/);
    const headers = { Authorization: `Bearer ${await token.inputValue()}` };
    const upload = (data: unknown) =>
      page.request.post('/api/apple-health/workouts', { headers, data });
    expect((await upload(appleConnectionTest)).status()).toBe(204);
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await expect(page.getByText('Connection tested', { exact: true })).toBeVisible();

    const source = `Synthetic Watch ${randomUUID().slice(0, 8)}`;
    expect(
      (
        await upload(
          appleBatch({
            allenamenti: [
              appleWorkout(1, { uuid: randomUUID(), fonte: source, percorso: appleRoutePoints }),
            ],
          }),
        )
      ).status(),
    ).toBe(204);
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await expect(page.getByRole('button', { name: `Exclude ${source}` })).toBeVisible();
    await page.goto('/calendar');
    await page.getByLabel('Go to date').fill(appleWorkoutDate);
    const card = page.getByRole('button', { name: 'Open activity Running', exact: true });
    await expect(card).toContainText('Apple Health');
    const week = page.locator('.calendar-week').filter({ has: card });
    await week.getByRole('button', { name: /^Expand summary/ }).click();
    await week.getByRole('button', { name: 'Show details' }).click();
    await expect(
      week.getByRole('button', { name: 'View recorded session Running', exact: true }),
    ).toContainText('Apple Health');
    await card.click();
    await expect(page.getByText(`Apple Health · ${source}`, { exact: true })).toBeVisible();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download GPX', exact: true }).click();
    expect((await downloaded).suggestedFilename()).toBe(`apple-health-${appleWorkoutDate}.gpx`);

    await page.goto('/activities');
    await page.getByLabel('Go to date').fill(appleWorkoutDate);
    await page.getByRole('button', { name: 'View Running', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Running', exact: true });
    await expect(details.getByRole('button', { name: 'Link workout', exact: true })).toBeDisabled();
    await expect(details.getByRole('button', { name: 'Saving…', exact: true })).toHaveCount(0);

    await page.goto('/apple-health');
    await page.getByRole('button', { name: `Exclude ${source}` }).click();
    await expect(page.getByRole('button', { name: `Include ${source}` })).toBeVisible();
    await page.goto('/calendar');
    await page.getByLabel('Go to date').fill(appleWorkoutDate);
    await expect(card).toHaveCount(0);
  });
}

test('keeps a rejected correction visible and shows prior annotations after deletion', async ({
  page,
  baseURL,
}) => {
  await signIn(page, 'light');
  const origin = baseURL!;
  const issued = await page.request.post('/api/plugins/apple-health/issue-token', {
    headers: { Origin: origin },
    data: {},
  });
  expect(issued.ok()).toBe(true);
  const { token } = await issued.json();
  const upload = async (overrides: Record<string, unknown>) => {
    const response = await page.request.post('/api/apple-health/workouts', {
      headers: { Authorization: `Bearer ${token}` },
      data: appleBatch(overrides),
    });
    expect(response.status(), await response.text()).toBe(204);
  };
  const id = randomUUID();
  const uuid = randomUUID();
  const date = '2020-11-17';
  const title = `Watch session ${id.slice(0, 8)}`;
  const run = appleWorkout(1, { uuid, inizio: date + 'T10:00:00Z', fine: date + 'T10:45:00Z' });
  await ownerCommand(page, origin, {
    action: 'workout.create',
    values: { id, title, sport: 'running', schedule: { kind: 'independent', date } },
  });
  await upload({ allenamenti: [run] });
  const workspace = await page.request.get(`/api/workspace?from=${date}&to=${date}`);
  const { state } = (await workspace.json()) as { state: WorkspaceState };
  const activity = state.activities.find((item) => item.externalId === `apple-health:${uuid}`)!;
  await ownerCommand(page, origin, {
    action: 'workout.link',
    id,
    expectedRevision: 1,
    activityId: activity.id,
  });
  await ownerCommand(page, origin, {
    action: 'workout.complete',
    id,
    expectedRevision: 2,
    values: {
      status: 'partial',
      performedDate: date,
      notes: 'Steady effort uphill',
      rpe: 7,
      reason: 'Stopped at the summit',
    },
  });
  await upload({ inviato: '2026-11-28T10:00:00Z', allenamenti: [{ ...run, attivita: 'cycling' }] });
  const otherUuid = randomUUID();
  await upload({ allenamenti: [{ ...run, uuid: otherUuid }] });
  await page.goto('/apple-health');
  await page.getByText('Unresolved workout issues (1)', { exact: true }).click();
  await expect(page.getByText(new RegExp(`linked to “${title}”`))).toBeVisible();

  await upload({ eliminati: [uuid, otherUuid] });
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByText(/Unresolved workout issues/)).toHaveCount(0);
  await page.goto('/plans');
  await page.getByRole('button', { name: 'Recent changes' }).click();
  const entry = page
    .locator('.training-history-entry')
    .filter({ hasText: 'Apple Health deleted an activity' })
    .first();
  await entry.getByRole('button', { name: 'View details' }).click();
  await expect(entry.getByRole('heading', { name: title })).toBeVisible();
  await expect(entry.getByText('Steady effort uphill', { exact: false })).toBeVisible();
  await expect(entry.getByText('Stopped at the summit', { exact: false })).toBeVisible();
  await expect(entry.getByText('7 / 10', { exact: false })).toBeVisible();
  await expect(entry.locator('dd').filter({ hasText: 'Before: Partial' })).toContainText(
    'After: Planned',
  );
});
