import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function savedProfile(page: Page) {
  const response = await page.request.get('/api/workspace?from=2030-01-01&to=2030-01-07');
  expect(response.ok()).toBe(true);
  return (await response.json()).state.profile;
}

test('Settings saves resting and maximum heart rate and refuses a resting rate at the maximum', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  const original = await savedProfile(page);
  try {
    await page.goto('/settings');
    const resting = page.getByRole('spinbutton', { name: /Resting heart rate/ });
    const maximum = page.getByRole('spinbutton', { name: /Maximum heart rate/ });
    const save = page.getByRole('button', { name: 'Save profile', exact: true });
    await resting.fill('47');
    await maximum.fill('196');
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Profile saved.');
    expect(await savedProfile(page)).toMatchObject({
      restingHeartRateBpm: 47,
      maxHeartRateBpm: 196,
      displayName: original.displayName,
      heartRateZones: original.heartRateZones,
      weeklyAvailability: original.weeklyAvailability,
    });
    await resting.fill('110');
    await maximum.fill('110');
    await save.click();
    await expect(
      page.getByText('Resting heart rate must be lower than maximum heart rate.'),
    ).toBeVisible();
    await resting.fill('');
    await maximum.fill('');
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Profile saved.');
    expect(await savedProfile(page)).toMatchObject({
      restingHeartRateBpm: null,
      maxHeartRateBpm: null,
    });
  } finally {
    const current = await savedProfile(page);
    const { id: _id, revision: _revision, ...values } = original;
    const response = await page.request.post('/api/plugins/training/mutate', {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        idempotencyKey: randomUUID(),
        commands: [{ action: 'profile.set', expectedRevision: current.revision, values }],
      },
    });
    expect(response.ok()).toBe(true);
  }
});
