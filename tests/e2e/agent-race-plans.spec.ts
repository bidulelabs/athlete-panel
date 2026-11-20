import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { syntheticGpx } from '../fixtures/race-analysis';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Synthetic E2E_PASSWORD required.');

const daysFromToday = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

test('connect an agent to one race, then review, apply and undo its race plan', async ({
  page,
  request,
  baseURL,
}, info) => {
  const raceId = randomUUID();
  const raceTitle = `Synthetic race ${info.project.name} ${raceId.slice(0, 8)}`;
  const raceBeyondAYearTitle = `Far race ${raceId.slice(0, 8)}`;
  const raceBeyondAYearId = randomUUID();
  const raceDate = daysFromToday(120);
  const started = await request.post('/api/agent/connect', {
    data: { label: 'Synthetic race preparation' },
  });
  expect(started.ok()).toBe(true);
  const pending = await started.json();
  await page.goto(`/agent?connect=${pending.id}`);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Approval code', { exact: true })).toBeVisible();
  const owner = (path: string, data: unknown) =>
    page.request.post(`/api/plugins/${path}`, { headers: { Origin: baseURL! }, data });
  const ownerCommands = async (commands: unknown[]) => {
    const response = await owner('training/mutate', { idempotencyKey: randomUUID(), commands });
    expect(response.ok(), await response.text()).toBe(true);
  };
  let grantId: string | undefined;
  let auditId: string | undefined;
  try {
    await ownerCommands([
      {
        action: 'event.create',
        values: { id: raceId, title: raceTitle, kind: 'race', date: raceDate },
      },
      {
        action: 'event.create',
        values: {
          id: raceBeyondAYearId,
          title: raceBeyondAYearTitle,
          kind: 'race',
          date: daysFromToday(400),
        },
      },
    ]);
    const uploaded = await page.request.post('/api/plugins/race-analysis/uploads/track', {
      headers: { Origin: baseURL! },
      multipart: {
        file: {
          name: 'synthetic-course.gpx',
          mimeType: 'application/gpx+xml',
          buffer: Buffer.from(syntheticGpx()),
        },
        metadata: JSON.stringify({
          raceId,
          purpose: 'course',
          expectedRevision: 0,
          idempotencyKey: randomUUID(),
        }),
      },
    });
    expect(uploaded.ok(), await uploaded.text()).toBe(true);
    await page.reload();

    const raceToPrepare = page.getByRole('combobox', { name: 'Race to prepare', exact: true });
    await expect(raceToPrepare.locator('option', { hasText: raceBeyondAYearTitle })).toHaveCount(0);
    await raceToPrepare.selectOption(raceId);
    await expect(page.locator('input[name="to"]')).toHaveValue(raceDate);
    await expect(page.getByRole('region', { name: 'Access summary' })).toContainText(
      `Race preparation: ${raceTitle}`,
    );
    await page.getByLabel('Approval code', { exact: true }).fill(pending.code);
    const approval = page.waitForResponse((r) =>
      r.url().endsWith('/agent-bridge/approve-connection'),
    );
    await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
    const approved = await (await approval).json();
    grantId = approved.grant.id;
    expect(approved.grant.planning).toMatchObject({ raceId, to: raceDate });

    const headers = { Authorization: `Bearer ${pending.token}` };
    const read = await request.get('/api/agent/context', { headers });
    const { context, contextDigest } = await read.json();
    expect(context.raceCourse.sections.length).toBeGreaterThan(1);
    expect(context.racePlans).toEqual([]);
    expect(JSON.stringify(context.raceCourse)).not.toMatch(/latitude|longitude|synthetic-course/);
    const summary = `Prepare ${raceTitle}`;
    const proposed = await request.post('/api/agent/propose', {
      headers,
      data: {
        summary,
        contextDigest,
        idempotencyKey: randomUUID(),
        commands: [
          {
            action: 'racePlan.create',
            values: {
              eventId: raceId,
              briefing: 'Start easy, keep the long climb steady.',
              pacing: context.raceCourse.sections
                .slice(0, 2)
                .map((section: { fromMeters: number; toMeters: number }) => ({
                  fromMeters: section.fromMeters,
                  toMeters: section.toMeters,
                  effort: 'Easy, walk the steep ramps',
                })),
              assumptions: ['Dry trail'],
              openQuestions: ['Poles allowed?'],
              courseId: context.raceCourse.courseId,
            },
          },
          {
            action: 'period.create',
            values: {
              name: `Build ${raceId.slice(0, 8)}`,
              role: 'build',
              startDate: daysFromToday(7),
              endDate: daysFromToday(60),
            },
          },
          {
            action: 'workout.create',
            values: {
              title: `Long climb ${raceId.slice(0, 8)}`,
              sport: 'running',
              schedule: { kind: 'independent', date: daysFromToday(10) },
            },
          },
        ],
      },
    });
    expect(proposed.ok(), await proposed.text()).toBe(true);

    await page.goto('/agent');
    await page
      .locator('.proposal-row')
      .filter({ hasText: summary })
      .getByRole('button', { name: 'Review', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Review proposed changes' });
    const racePlanRow = dialog.locator('.proposal-diff[data-type="racePlan"]');
    await expect(racePlanRow.locator('summary')).toContainText('Race plan');
    await expect(racePlanRow.locator('summary')).toContainText(raceTitle);
    await expect(racePlanRow.locator('summary')).toContainText('2 sections');
    await expect(racePlanRow.locator('summary')).toContainText('1 open question');
    await racePlanRow.locator('summary').first().click();
    await expect(racePlanRow).toContainText('Pacing · Section 1 · Effort');
    await expect(racePlanRow).toContainText('Open questions · Open question 1');
    await dialog.getByRole('checkbox').check();
    const application = page.waitForResponse((r) => r.url().endsWith('/agent-bridge/apply'));
    await dialog.getByRole('button', { name: /^Apply all \d+ changes$/ }).click();
    const applied = await application;
    expect(applied.ok(), await applied.text()).toBe(true);
    auditId = (await applied.json()).id;

    await page.goto(`/races?race=${raceId}`);
    await page.getByRole('tab', { name: 'Preparation', exact: true }).click();
    await expect(page.getByLabel(/^Briefing/)).toHaveValue(
      'Start easy, keep the long climb steady.',
    );
    await expect(page.locator('.race-pacing input').first()).toHaveValue(
      'Easy, walk the steep ramps',
    );
    await expect(page.getByText(/changed after this strategy was written/)).toHaveCount(0);
    await page.goto('/calendar');
    await owner('agent-bridge/undo', { id: auditId, idempotencyKey: randomUUID() });
    auditId = undefined;
    await page.goto(`/races?race=${raceId}`);
    await page.getByRole('tab', { name: 'Preparation', exact: true }).click();
    await expect(page.getByLabel(/^Briefing/)).toHaveValue('');
  } finally {
    if (auditId) await owner('agent-bridge/undo', { id: auditId, idempotencyKey: randomUUID() });
    if (grantId) await owner('agent-bridge/revoke', { id: grantId });
    else
      await request.post('/api/agent/connect-cancel', {
        headers: { Authorization: `Bearer ${pending.token}` },
        data: {},
      });
  }
});
