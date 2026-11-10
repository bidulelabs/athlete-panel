import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Synthetic E2E_PASSWORD required.');

const planWithPhase = (name: string, planId: string, range: { from: string; to: string }) => [
  {
    action: 'plan.create',
    values: { id: planId, title: `Spring ${name}`, startDate: range.from },
  },
  {
    action: 'workout.create',
    values: {
      title: `Easy run ${name}`,
      sport: 'running',
      schedule: { kind: 'plan', planId, day: 1 },
      durationSeconds: 3600,
    },
  },
  {
    action: 'period.create',
    values: {
      name,
      role: 'base',
      focus: 'Aerobic volume',
      startDate: range.from,
      endDate: range.to,
      weeklyDurationSeconds: {
        firstWeek: { min: 28800, max: 32400 },
        lastWeek: { min: 36000, max: 39600 },
      },
    },
  },
];

test('review, apply and undo a plan with a phase and its first workout in one proposal', async ({
  page,
  request,
  baseURL,
}, info) => {
  const year = info.project.name === 'mobile' ? 2034 : 2033;
  const range = { from: `${year}-01-02`, to: `${year}-03-31` };
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  const owner = (operation: string, data: unknown) =>
    page.request.post(`/api/plugins/agent-bridge/${operation}`, {
      headers: { Origin: baseURL! },
      data,
    });
  const access = await owner('grant', {
    label: 'Synthetic phase proposal',
    version: 2,
    history: null,
    planning: { ...range, allowPhaseChanges: true, includeNotes: false },
  });
  expect(access.ok()).toBe(true);
  const { token, grant } = await access.json();
  const headers = { Authorization: `Bearer ${token}` };
  const name = `Agent base ${info.project.name} ${randomUUID().slice(0, 8)}`;
  const summary = `Outline ${name}`;
  const planTitle = `Spring ${name}`;
  const planId = randomUUID();
  let proposalId: string | undefined;
  let auditId: string | undefined;
  let undone = false;
  try {
    const context = await (await request.get('/api/agent/context', { headers })).json();
    const proposed = await request.post('/api/agent/propose', {
      headers,
      data: {
        summary,
        contextDigest: context.contextDigest,
        idempotencyKey: randomUUID(),
        commands: planWithPhase(name, planId, range),
      },
    });
    expect(proposed.ok(), await proposed.text()).toBe(true);
    proposalId = (await proposed.json()).id;
    await page.goto('/agent');
    await page
      .locator('.proposal-row')
      .filter({ hasText: summary })
      .getByRole('button', { name: 'Review', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Review proposed changes' });
    const periodRow = dialog
      .locator('.proposal-diff[data-type="period"]')
      .filter({ hasText: name });
    await expect(periodRow.locator('summary')).toContainText('Create');
    await expect(periodRow.locator('summary')).toContainText('Base phase until');
    await expect(periodRow.locator('summary')).toContainText('Aerobic volume');
    await periodRow.locator('summary').first().click();
    await expect(periodRow).toContainText('Focus');
    await expect(periodRow).toContainText('Weekly hours · First week · Minimum');
    await expect(periodRow).toContainText('8 h');
    await dialog.getByRole('checkbox').check();
    const appliedResponse = page.waitForResponse((r) => r.url().endsWith('/agent-bridge/apply'));
    await dialog.getByRole('button', { name: 'Apply reviewed changes' }).click();
    const applied = await appliedResponse;
    expect(applied.ok(), await applied.text()).toBe(true);
    auditId = (await applied.json()).id;
    await page.goto('/plans');
    await page.getByRole('button', { name: `Open ${planTitle}` }).click();
    const plan = page.getByRole('dialog', { name: planTitle });
    const phase = plan.getByRole('group', { name: `${name} phase` });
    await expect(phase).toContainText('Aerobic volume');
    await expect(phase).toContainText('Target 8–9 → 10–11 h a week');
    await expect(plan.getByRole('region', { name: 'Week 1' })).toContainText(`Easy run ${name}`);
    await page.goto('/agent');
    await page.getByRole('tab', { name: 'Change history' }).click();
    const row = page
      .locator('.proposal-row')
      .filter({ has: page.getByText(summary, { exact: true }) });
    await row.getByRole('button', { name: 'Undo', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirm', exact: true })
      .click();
    await expect(row).toContainText('Undone');
    undone = true;
    await page.goto('/plans');
    await expect(page.getByRole('button', { name: `Open ${planTitle}` })).toHaveCount(0);
  } finally {
    if (auditId && !undone) await owner('undo', { id: auditId, idempotencyKey: randomUUID() });
    if (proposalId && !auditId) await owner('reject', { id: proposalId });
    await owner('revoke', { id: grant.id });
  }
});
