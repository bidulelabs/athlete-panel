import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  appleBatch,
  appleConnectionTest,
  appleRoutePoints,
  appleWorkout,
  appleWorkoutDate,
} from '../fixtures/apple-health';
import { signIn } from './race-helpers';

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
