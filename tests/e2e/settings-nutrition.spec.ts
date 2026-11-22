import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import { isolatedDatabaseUrl } from '../support/test-database';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Set E2E_PASSWORD for the isolated synthetic instance.');

async function signIn(page: Page, theme: string) {
  await page.addInitScript((value) => localStorage.setItem('athlete-panel-theme', value), theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
}
async function savedProfile(page: Page) {
  const response = await page.request.get('/api/workspace?from=2030-01-01&to=2030-01-07');
  expect(response.ok()).toBe(true);
  return (await response.json()).state.profile;
}
async function setProfile(page: Page, values: Record<string, unknown>) {
  const current = await savedProfile(page);
  const response = await page.request.post('/api/plugins/training/mutate', {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      idempotencyKey: randomUUID(),
      commands: [{ action: 'profile.set', expectedRevision: current?.revision ?? null, values }],
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
const sql = postgres(isolatedDatabaseUrl('E2E_DATABASE_URL'), { max: 1, onnotice: () => {} });
test.afterAll(() => sql.end());
const emptyNutrition = { products: [], carryCapacityMillilitres: null, preferences: '' };
async function openNutrition(page: Page) {
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Nutrition', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Products you use', exact: true })).toBeVisible();
}

for (const theme of ['light', 'dark']) {
  test(`add, edit and remove a product, save capacity and preferences (${theme})`, async ({
    page,
  }, info) => {
    await signIn(page, theme);
    await setProfile(page, { nutrition: emptyNutrition });
    try {
      await openNutrition(page);
      await expect(page.getByText('No products yet', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Add product', exact: true }).focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      await page.getByRole('button', { name: 'Add product', exact: true }).click();
      await dialog.getByLabel('Name', { exact: true }).fill('Synthetic citrus gel');
      await expect(dialog.getByLabel('Carbs · g', { exact: true })).toHaveAttribute('max', '500');
      await dialog.getByLabel('Carbs · g', { exact: true }).fill('30');
      await dialog.getByLabel('Caffeine · mg', { exact: true }).fill('0');
      await dialog.getByRole('button', { name: 'Add product', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const row = page.getByRole('row', { name: /Synthetic citrus gel/ });
      await expect(row.getByText('30 g', { exact: true })).toBeVisible();
      await expect(row.getByText('0 mg', { exact: true })).toHaveCount(1);
      await expect(row.getByText('unknown', { exact: true })).toHaveCount(2);
      await expect(row.getByText('Not tested', { exact: true })).toBeVisible();
      await expect(row.getByText('—')).toHaveCount(0);

      await page.getByRole('button', { name: 'Edit Synthetic citrus gel', exact: true }).click();
      await dialog
        .getByRole('combobox', { name: 'Your tolerance', exact: true })
        .selectOption('poor');
      await dialog
        .getByRole('combobox', { name: 'Values from', exact: true })
        .selectOption('estimate');
      await dialog.getByLabel('Sodium · mg', { exact: true }).fill('50');
      await dialog.getByLabel('Caffeine · mg', { exact: true }).fill('75');
      await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(row.getByText('Poor', { exact: true })).toHaveClass(/tolerance-poor/);
      await expect(row.getByText(/Gel · your estimate/)).toBeVisible();
      await expect(row.getByText('50 mg', { exact: true })).toBeVisible();
      if (info.project.name === 'mobile') {
        await expect(row.getByText('· 75 mg caffeine')).toBeVisible();
        await expect(row.getByText('75 mg', { exact: true })).toBeHidden();
        const edit = await page
          .getByRole('button', { name: 'Edit Synthetic citrus gel', exact: true })
          .boundingBox();
        expect(edit?.height).toBe(44);
      } else {
        await expect(row.getByText('75 mg', { exact: true })).toBeVisible();
        await expect(row.getByText('· 75 mg caffeine')).toBeHidden();
      }

      await page.getByLabel('Carry capacity · ml').fill('1000');
      await page.getByLabel('Diet and preferences').fill('Vegetarian.');
      await page
        .getByRole('button', { name: 'Save capacity and preferences', exact: true })
        .click();
      await expect(page.getByRole('status')).toHaveText('Capacity and preferences saved.');
      await expect(page.getByText(/Your nutrition changed elsewhere/)).toHaveCount(0);
      const saved = (await savedProfile(page)).nutrition;
      expect(saved).toMatchObject({ carryCapacityMillilitres: 1000, preferences: 'Vegetarian.' });
      expect(saved.products).toEqual([
        expect.objectContaining({
          name: 'Synthetic citrus gel',
          carbohydrateGrams: 30,
          fluidMillilitres: null,
          sodiumMilligrams: 50,
          caffeineMilligrams: 75,
          source: 'estimate',
          tolerance: 'poor',
        }),
      ]);

      if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );

      await page.getByRole('tab', { name: 'Profile & zones', exact: true }).click();
      await page.getByRole('button', { name: 'Save profile', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText('Profile saved.');
      expect((await savedProfile(page)).nutrition).toEqual(saved);

      await page.getByRole('tab', { name: 'Nutrition', exact: true }).click();
      await page.getByRole('button', { name: 'Remove Synthetic citrus gel', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
      await expect(page.getByText('No products yet', { exact: true })).toBeVisible();
      expect((await savedProfile(page)).nutrition).toMatchObject({
        products: [],
        carryCapacityMillilitres: 1000,
        preferences: 'Vegetarian.',
      });
    } finally {
      await setProfile(page, { nutrition: emptyNutrition });
    }
  });
}

test('refuses a nutrition save over a profile changed elsewhere, then loads it', async ({
  page,
}) => {
  await signIn(page, 'light');
  await setProfile(page, { nutrition: emptyNutrition });
  try {
    await openNutrition(page);
    await page.getByLabel('Diet and preferences').fill('Draft preferences');
    await setProfile(page, { nutrition: { ...emptyNutrition, preferences: 'Saved elsewhere' } });
    await page.getByRole('button', { name: 'Save capacity and preferences', exact: true }).click();
    await page.getByRole('button', { name: 'Reload saved data', exact: true }).click();
    await expect(page.getByText(/Your nutrition changed elsewhere/)).toBeVisible();
    await expect(page.getByLabel('Diet and preferences')).toHaveValue('Draft preferences');
    await page.getByRole('button', { name: 'Load saved nutrition', exact: true }).click();
    await expect(page.getByLabel('Diet and preferences')).toHaveValue('Saved elsewhere');
    await page.getByLabel('Diet and preferences').fill('Final preferences');
    await page.getByRole('button', { name: 'Save capacity and preferences', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Capacity and preferences saved.');
    expect((await savedProfile(page)).nutrition.preferences).toBe('Final preferences');
  } finally {
    await setProfile(page, { nutrition: emptyNutrition });
  }
});

test('refuses to save a product removed elsewhere', async ({ page }) => {
  await signIn(page, 'light');
  const product = {
    id: randomUUID(),
    name: 'Synthetic drink mix',
    kind: 'drink',
    carbohydrateGrams: 15,
    fluidMillilitres: 250,
    sodiumMilligrams: 200,
    caffeineMilligrams: 0,
    source: 'label',
    tolerance: 'comfortable',
  };
  await setProfile(page, { nutrition: { ...emptyNutrition, products: [product] } });
  try {
    await openNutrition(page);
    await page.getByRole('button', { name: 'Edit Synthetic drink mix', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Carbs · g', { exact: true }).fill('20');
    await setProfile(page, { nutrition: emptyNutrition });
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await dialog.getByRole('button', { name: 'Reload saved data', exact: true }).click();
    await expect(
      dialog.getByText('Saved data reloaded. Review it before saving again.'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog.getByText('This product was removed elsewhere.')).toBeVisible();
    expect((await savedProfile(page)).nutrition.products).toEqual([]);
  } finally {
    await setProfile(page, { nutrition: emptyNutrition });
  }
});

test('asks to save the profile before nutrition on an instance without one', async ({ page }) => {
  await signIn(page, 'light');
  await sql`update athlete.records set deleted=true where kind='profile' and id='owner'`;
  try {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Nutrition', exact: true }).click();
    await expect(page.getByText('Save your profile first', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add product', exact: true })).toHaveCount(0);
  } finally {
    await sql`update athlete.records set deleted=false where kind='profile' and id='owner'`;
  }
});
