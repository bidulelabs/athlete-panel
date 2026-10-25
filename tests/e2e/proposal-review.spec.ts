import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Isolated E2E_PASSWORD required.');

test('owner reviews readable changes and applies the exact stored proposal', async ({ page, request }, info) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin, id = randomUUID(), summary = `Readable review ${info.project.name} ${id.slice(0, 6)}`;
  const owner = (operation: string, data: unknown) => page.request.post('/api/plugins/' + operation, { headers: { Origin: origin }, data });
  const created = await owner('training/mutate', { idempotencyKey: randomUUID(), commands: [{ action: 'workout.create', values: { id, title: 'Synthetic easy run', sport: 'running', schedule: { kind: 'independent', date: '2026-10-27' }, durationSeconds: 1800 } }] });
  expect(created.ok()).toBe(true);
  const grantResponse = await owner('agent-bridge/grant', { label: 'Synthetic reviewer', from: '2026-10-26', to: '2026-11-01', includeNotes: true });
  const { token, grant } = await grantResponse.json();
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const context = await (await request.get('/api/agent/context', { headers })).json();
    const workout = context.context.workouts.find((value: { id: string }) => value.id === id);
    const proposed = await request.post('/api/agent/propose', { headers, data: { contextDigest: context.contextDigest, idempotencyKey: randomUUID(), summary, commands: [{ action: 'workout.update', id, expectedRevision: workout.revision, values: { durationSeconds: 2700, notes: 'Keep an easy conversational effort.' } }] } });
    expect(proposed.ok()).toBe(true);
    const stored = await proposed.json();
    await page.goto('/agent');
    await page.locator('.proposal-row').filter({ hasText: summary }).getByRole('button', { name: 'Review', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('row').filter({ hasText: 'Duration' })).toContainText('30 min');
    await expect(dialog.getByRole('row').filter({ hasText: 'Duration' })).toContainText('45 min');
    await expect(dialog.getByRole('row').filter({ hasText: 'Notes' })).toContainText('Keep an easy conversational effort.');
    await expect(dialog.locator('.review-technical pre').first()).not.toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Apply reviewed changes' })).toBeDisabled();
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await page.screenshot({ path: `.runtime/browser/proposal-review-${info.project.name}-${theme}.png`, fullPage: true, animations: 'disabled' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await dialog.getByRole('checkbox').check();
    const applied = page.waitForRequest(value => value.url().endsWith('/agent-bridge/apply'));
    await dialog.getByRole('button', { name: 'Apply reviewed changes' }).click();
    expect((await applied).postDataJSON()).toMatchObject({ id: stored.id, digest: stored.digest });
    await expect(dialog).not.toBeVisible();
    const updated = await (await page.request.get('/api/workspace?from=2026-10-26&to=2026-11-01')).json();
    expect(updated.state.workouts.find((value: { id: string }) => value.id === id).durationSeconds).toBe(2700);
  } finally {
    await owner('agent-bridge/revoke', { id: grant.id });
    const state = await (await page.request.get('/api/workspace?from=2026-10-26&to=2026-11-01')).json();
    const saved = state.state.workouts.find((value: { id: string }) => value.id === id);
    if (saved) await owner('training/mutate', { idempotencyKey: randomUUID(), commands: [{ action: 'workout.delete', id, expectedRevision: saved.revision }] });
  }
});

test('instance status explains worker and backup problems', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await page.route('**/api/workspace?*', async route => {
    const response = await route.fetch(), body = await response.json();
    body.operational = [{ key: 'worker', value: { lastSeen: '2020-01-01T00:00:00Z' } }, { key: 'backupAttempt', value: { state: 'failed' } }];
    await route.fulfill({ response, json: body });
  });
  await page.goto('/plugins');
  await expect(page.getByText('Worker is not responding', { exact: true })).toBeVisible();
  await expect(page.getByText('Last backup attempt failed', { exact: true })).toBeVisible();
  await expect(page.getByText('The worker has stopped or failed.', { exact: false })).toBeVisible();
});
