import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Isolated E2E_PASSWORD required.');

test('owner reviews readable changes and applies the exact stored proposal', async ({
  page,
  request,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin,
    id = randomUUID(),
    summary = `Readable review ${info.project.name} ${id.slice(0, 6)}`;
  const owner = (operation: string, data: unknown) =>
    page.request.post('/api/plugins/' + operation, { headers: { Origin: origin }, data });
  const created = await owner('training/mutate', {
    idempotencyKey: randomUUID(),
    commands: [
      {
        action: 'workout.create',
        values: {
          id,
          title: 'Synthetic easy run',
          sport: 'running',
          schedule: { kind: 'independent', date: '2026-10-27' },
          durationSeconds: 1800,
        },
      },
    ],
  });
  expect(created.ok()).toBe(true);
  const grantResponse = await owner('agent-bridge/grant', {
    label: 'Synthetic reviewer',
    from: '2026-10-26',
    to: '2026-11-01',
    includeNotes: true,
  });
  const { token, grant } = await grantResponse.json();
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const context = await (await request.get('/api/agent/context', { headers })).json();
    const workout = context.context.workouts.find((value: { id: string }) => value.id === id);
    const proposed = await request.post('/api/agent/propose', {
      headers,
      data: {
        contextDigest: context.contextDigest,
        idempotencyKey: randomUUID(),
        summary,
        commands: [
          {
            action: 'workout.update',
            id,
            expectedRevision: workout.revision,
            values: { durationSeconds: 2700, notes: '**Keep** an easy conversational effort.' },
          },
        ],
      },
    });
    expect(proposed.ok()).toBe(true);
    const stored = await proposed.json();
    expect(
      (
        await request.post('/api/plugins/agent-bridge/review', {
          headers: { Origin: origin },
          data: { id: stored.id, digest: stored.digest },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.post('/api/plugins/agent-bridge/review', {
          headers: { ...headers, Origin: origin },
          data: { id: stored.id, digest: stored.digest },
        })
      ).status(),
    ).toBe(401);
    const addContext = (bodyPart: string) =>
      owner('training/mutate', {
        idempotencyKey: randomUUID(),
        commands: [
          {
            action: 'injury.create',
            values: { id: randomUUID(), bodyPart, startDate: '2026-10-27', endDate: '2026-10-27' },
          },
        ],
      });
    expect((await addContext('Synthetic review context')).ok()).toBe(true);
    await page.goto('/agent');
    await page
      .locator('.proposal-row')
      .filter({ hasText: summary })
      .getByRole('button', { name: 'Review', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('region', { name: 'Proposed edits' })
      .getByText('Synthetic easy run', { exact: true })
      .click();
    await expect(
      dialog
        .getByRole('region', { name: 'Proposed edits' })
        .getByRole('row')
        .filter({ hasText: 'Duration' }),
    ).toContainText('30 min');
    await expect(
      dialog
        .getByRole('region', { name: 'Proposed edits' })
        .getByRole('row')
        .filter({ hasText: 'Duration' }),
    ).toContainText('45 min');
    await expect(
      dialog
        .getByRole('region', { name: 'Proposed edits' })
        .getByRole('row')
        .filter({ hasText: 'Workout description' }),
    ).toContainText('**Keep** an easy conversational effort.');
    await expect(dialog.locator('.review-technical pre').first()).not.toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Apply reviewed changes' })).toBeDisabled();
    await expect(
      dialog.getByRole('heading', { name: 'Context changed since submission' }),
    ).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Changed context' })).toContainText(
      'Synthetic review context',
    );
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.screenshot({
        path: `.runtime/browser/proposal-review-${info.project.name}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await dialog.getByRole('checkbox').check();
    expect((await addContext('Synthetic context changed again')).ok()).toBe(true);
    const conflict = page.waitForResponse((value) => value.url().endsWith('/agent-bridge/apply'));
    await dialog.getByRole('button', { name: 'Apply reviewed changes' }).click();
    expect((await conflict).status()).toBe(409);
    await expect(dialog.getByRole('region', { name: 'Changed context' })).toContainText(
      'Synthetic context changed again',
    );
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Apply reviewed changes' })).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    const applied = page.waitForRequest((value) => value.url().endsWith('/agent-bridge/apply'));
    await dialog.getByRole('button', { name: 'Apply reviewed changes' }).click();
    expect((await applied).postDataJSON()).toMatchObject({ id: stored.id, digest: stored.digest });
    await expect(dialog).not.toBeVisible();
    const updated = await (
      await page.request.get('/api/workspace?from=2026-10-26&to=2026-11-01')
    ).json();
    expect(
      updated.state.workouts.find((value: { id: string }) => value.id === id).durationSeconds,
    ).toBe(2700);
  } finally {
    await owner('agent-bridge/revoke', { id: grant.id });
    const state = await (
      await page.request.get('/api/workspace?from=2026-10-26&to=2026-11-01')
    ).json();
    const saved = state.state.workouts.find((value: { id: string }) => value.id === id);
    if (saved)
      await owner('training/mutate', {
        idempotencyKey: randomUUID(),
        commands: [{ action: 'workout.delete', id, expectedRevision: saved.revision }],
      });
  }
});

test('owner reviews a multi-week proposal one line per record, grouped by week', async ({
  page,
  request,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await page.route('**/api/workspace?*', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.state.profile.weekStartsOnPreference = 'monday';
    await route.fulfill({ response, json: body });
  });
  const origin = new URL(page.url()).origin,
    tag = randomUUID().slice(0, 6),
    summary = `Weekly review ${info.project.name} ${tag}`,
    planTitle = `Synthetic base block ${tag}`,
    [planId, intervalsId, longRunId, restId, noteId, movedId, removedId] = Array.from(
      { length: 7 },
      (): string => randomUUID(),
    );
  const owner = (operation: string, data: unknown) =>
    page.request.post('/api/plugins/' + operation, { headers: { Origin: origin }, data });
  const independentRun = (id: string, title: string, date: string) => ({
    action: 'workout.create',
    values: {
      id,
      title,
      sport: 'running',
      schedule: { kind: 'independent', date },
      durationSeconds: 2400,
    },
  });
  let grantId: string | undefined, proposalId: string | undefined;
  try {
    expect(
      (
        await owner('training/mutate', {
          idempotencyKey: randomUUID(),
          commands: [
            independentRun(movedId, 'Synthetic moved run', '2027-03-02'),
            independentRun(removedId, 'Synthetic removed run', '2027-03-04'),
          ],
        })
      ).ok(),
    ).toBe(true);
    const { token, grant } = await (
      await owner('agent-bridge/grant', {
        label: 'Synthetic weekly reviewer',
        from: '2027-03-01',
        to: '2027-03-21',
        includeNotes: true,
      })
    ).json();
    grantId = grant.id;
    const headers = { Authorization: `Bearer ${token}` };
    const context = await (await request.get('/api/agent/context', { headers })).json();
    const revision = (id: string) =>
      context.context.workouts.find((value: { id: string }) => value.id === id).revision;
    const interval = (kind: string, durationSeconds: number) => ({
      kind,
      durationSeconds,
      distanceMeters: null,
      target: null,
      notes: '',
    });
    const proposed = await request.post('/api/agent/propose', {
      headers,
      data: {
        contextDigest: context.contextDigest,
        idempotencyKey: randomUUID(),
        summary,
        commands: [
          {
            action: 'plan.create',
            values: { id: planId, title: planTitle, startDate: '2027-03-02' },
          },
          {
            action: 'workout.create',
            values: {
              id: intervalsId,
              title: 'Synthetic intervals',
              sport: 'running',
              schedule: { kind: 'plan', planId, day: 1 },
              durationSeconds: 3600,
              distanceMeters: 10000,
              steps: [
                interval('warmup', 900),
                {
                  kind: 'repeat',
                  times: 5,
                  steps: [interval('work', 180), interval('recovery', 120)],
                },
                interval('cooldown', 600),
              ],
            },
          },
          {
            action: 'workout.create',
            values: {
              id: longRunId,
              title: 'Synthetic long run',
              sport: 'running',
              schedule: { kind: 'plan', planId, day: 12 },
              durationSeconds: 5400,
            },
          },
          {
            action: 'workout.create',
            values: {
              id: restId,
              title: 'Synthetic rest',
              kind: 'rest',
              sport: null,
              schedule: { kind: 'plan', planId, day: 4 },
            },
          },
          {
            action: 'note.create',
            values: {
              id: noteId,
              title: 'Synthetic travel note',
              body: 'Away for work.',
              schedule: { kind: 'independent', date: '2027-03-11' },
            },
          },
          {
            action: 'workout.update',
            id: movedId,
            expectedRevision: revision(movedId),
            values: { schedule: { kind: 'independent', date: '2027-03-10' } },
          },
          { action: 'workout.delete', id: removedId, expectedRevision: revision(removedId) },
        ],
      },
    });
    expect(proposed.ok()).toBe(true);
    proposalId = (await proposed.json()).id;
    if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/agent');
    await page
      .locator('.proposal-row')
      .filter({ hasText: summary })
      .getByRole('button', { name: 'Review', exact: true })
      .click();
    const edits = page.getByRole('dialog').getByRole('region', { name: 'Proposed edits' });
    const week = (name: string) => edits.getByRole('region', { name, exact: true });
    const line = (title: string) =>
      edits.locator('details.proposal-diff').filter({
        has: page.locator('summary.proposal-diff-summary').getByText(title, { exact: true }),
      });
    await expect(edits.getByRole('region')).toHaveCount(3);
    await expect(edits.locator('details.proposal-diff')).toHaveCount(7);
    await expect(week('Plans').locator('summary.proposal-diff-summary')).toHaveText([
      `Create ${planTitle} starts Tue 2 Mar`,
    ]);
    await expect(week('Week of 1 Mar 2027').locator('summary.proposal-diff-summary')).toHaveText([
      'Create Synthetic intervals Tue 2 Mar · Running · 1h · 10.0 km',
      'Delete Synthetic removed run Thu 4 Mar · Running · 40m',
      'Create Synthetic rest Fri 5 Mar · Rest day',
    ]);
    await expect(week('Week of 8 Mar 2027').locator('summary.proposal-diff-summary')).toHaveText([
      'Update Synthetic moved run Wed 10 Mar · moved from 2 Mar · Running · 40m',
      'Create Synthetic travel note Thu 11 Mar',
      'Create Synthetic long run Sat 13 Mar · Running · 1h 30m',
    ]);
    for (const details of await edits.locator('details.proposal-diff').all())
      await expect(details).not.toHaveAttribute('open');
    const intervals = line('Synthetic intervals');
    await expect(intervals.getByRole('table')).toBeHidden();
    await intervals.locator('summary.proposal-diff-summary').click();
    await expect(intervals.getByRole('row').filter({ hasText: 'Schedule · Plan' })).toContainText(
      planTitle,
    );
    await expect(intervals.getByRole('table')).not.toContainText(planId!);
    await expect(
      intervals.getByRole('row').filter({ hasText: 'Intervals · Step 2 · Repetitions' }),
    ).toContainText('5');
    await expect(intervals.locator('.review-technical pre').first()).toBeHidden();
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.screenshot({
        path: `.runtime/browser/proposal-weeks-${info.project.name}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await page
          .getByRole('dialog')
          .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
      ).toBe(true);
    }
  } finally {
    if (proposalId) await owner('agent-bridge/reject', { id: proposalId });
    if (grantId) await owner('agent-bridge/revoke', { id: grantId });
    const state = await (
      await page.request.get('/api/workspace?from=2027-03-01&to=2027-03-21')
    ).json();
    const commands = state.state.workouts
      .filter((value: { id: string }) => [movedId, removedId].includes(value.id))
      .map((value: { id: string; revision: number }) => ({
        action: 'workout.delete',
        id: value.id,
        expectedRevision: value.revision,
      }));
    if (commands.length) await owner('training/mutate', { idempotencyKey: randomUUID(), commands });
  }
});

test('instance status explains worker and backup problems', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  await page.route('**/api/workspace?*', async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.operational = [
      { key: 'worker', value: { lastSeen: '2020-01-01T00:00:00Z' } },
      { key: 'backupAttempt', value: { state: 'failed' } },
    ];
    await route.fulfill({ response, json: body });
  });
  await page.goto('/plugins');
  await expect(page.getByText('Worker is not responding', { exact: true })).toBeVisible();
  await expect(page.getByText('Last backup attempt failed', { exact: true })).toBeVisible();
  await expect(page.getByText('The worker has stopped or failed.', { exact: false })).toBeVisible();
});
