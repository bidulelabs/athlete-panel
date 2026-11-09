import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { isolatedDatabaseUrl } from '../support/test-database';
import { syntheticDay } from '../fixtures/historical';

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('Isolated E2E_PASSWORD required.');

test.afterEach(async ({ page }) => {
  // Finish intercepted workspace reads before Playwright disposes their request context.
  await page.unrouteAll({ behavior: 'wait' });
});

test('a plan-only proposal shows its date before owner approval in both themes', async ({
  page,
  request,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const owner = (operation: string, data: unknown) =>
    page.request.post(`/api/plugins/agent-bridge/${operation}`, {
      headers: { Origin: origin },
      data,
    });
  const access = await owner('grant', {
    label: 'Synthetic plan date',
    version: 2,
    history: null,
    planning: { from: '2026-11-01', to: '2026-11-30' },
  });
  expect(access.ok()).toBe(true);
  const { token, grant } = await access.json();
  let proposalId: string | undefined;
  let appliedChangeId: string | undefined;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const context = await (await request.get('/api/agent/context', { headers })).json();
    const summary = `Plan date ${info.project.name} ${randomUUID()}`;
    const proposed = await request.post('/api/agent/propose', {
      headers,
      data: {
        summary,
        contextDigest: context.contextDigest,
        idempotencyKey: randomUUID(),
        commands: [
          {
            action: 'plan.create',
            values: { title: 'Synthetic dated plan', startDate: '2026-11-03' },
          },
        ],
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
    const dialog = page.getByRole('dialog');
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        document.documentElement.classList.toggle('dark', value === 'dark');
      }, theme);
      await expect(dialog.locator('.proposal-overview-dates')).toHaveText('3 Nov 2026');
      await expect(
        dialog.getByRole('button', { name: 'Apply reviewed changes', exact: true }),
      ).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.runtime/browser/plan-date-${info.project.name}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
    await dialog.getByRole('checkbox').check();
    const appliedResponse = page.waitForResponse((r) => r.url().endsWith('/agent-bridge/apply'));
    await dialog.getByRole('button', { name: 'Apply reviewed changes' }).click();
    const applied = await appliedResponse;
    expect(applied.ok(), await applied.text()).toBe(true);
    appliedChangeId = (await applied.json()).id;
    await expect(page.getByRole('region', { name: 'Proposal result' })).toContainText(
      'Saved 1 change: 1 plan.',
    );
  } finally {
    if (appliedChangeId)
      expect(
        (await owner('undo', { id: appliedChangeId, idempotencyKey: randomUUID() })).ok(),
      ).toBe(true);
    else if (proposalId) expect((await owner('reject', { id: proposalId })).ok()).toBe(true);
    expect((await owner('revoke', { id: grant.id })).ok()).toBe(true);
  }
});

test('pending proposals are listed and applied or rejected ones sit under Past proposals', async ({
  page,
  request,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training calendar', exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const owner = (operation: string, data: unknown) =>
    page.request.post(`/api/plugins/agent-bridge/${operation}`, {
      headers: { Origin: origin },
      data,
    });
  const access = await owner('grant', {
    label: 'Synthetic proposal list',
    version: 2,
    history: null,
    planning: { from: '2026-11-01', to: '2026-11-30' },
  });
  expect(access.ok()).toBe(true);
  const { token, grant } = await access.json();
  const headers = { Authorization: `Bearer ${token}` };
  const summarySuffix = `${info.project.name} ${randomUUID().slice(0, 6)}`;
  const propose = async (summary: string, startDate: string) => {
    const context = await (await request.get('/api/agent/context', { headers })).json();
    const proposed = await request.post('/api/agent/propose', {
      headers,
      data: {
        summary,
        contextDigest: context.contextDigest,
        idempotencyKey: randomUUID(),
        commands: [{ action: 'plan.create', values: { title: summary, startDate } }],
      },
    });
    expect(proposed.ok(), await proposed.text()).toBe(true);
    return proposed.json();
  };
  let pendingId: string | undefined;
  let appliedChangeId: string | undefined;
  try {
    const applied = await propose(`Applied ${summarySuffix}`, '2026-11-10');
    const applyResponse = await owner('apply', {
      id: applied.id,
      digest: applied.digest,
      idempotencyKey: randomUUID(),
    });
    expect(applyResponse.ok(), await applyResponse.text()).toBe(true);
    appliedChangeId = (await applyResponse.json()).id;
    const rejected = await propose(`Rejected ${summarySuffix}`, '2026-11-11');
    expect((await owner('reject', { id: rejected.id })).ok()).toBe(true);
    pendingId = (await propose(`Pending ${summarySuffix}`, '2026-11-12')).id;

    await page.goto('/agent');
    const pastSection = page.locator('details').filter({ hasText: 'Past proposals' });
    const rowFor = (summary: string) => page.locator('.proposal-row').filter({ hasText: summary });
    const pastRowFor = (summary: string) =>
      pastSection.locator('.proposal-row').filter({ hasText: summary });
    await expect(rowFor(`Pending ${summarySuffix}`)).toBeVisible();
    await expect(pastRowFor(`Pending ${summarySuffix}`)).toHaveCount(0);
    for (const summary of [`Applied ${summarySuffix}`, `Rejected ${summarySuffix}`]) {
      await expect(rowFor(summary)).toHaveCount(1);
      await expect(pastRowFor(summary)).toBeHidden();
    }
    await pastSection.locator('summary').click();
    await expect(pastRowFor(`Applied ${summarySuffix}`)).toBeVisible();
    await pastRowFor(`Rejected ${summarySuffix}`)
      .getByRole('button', { name: 'Review', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();

    await page.route('**/api/workspace?*', async (route) => {
      const response = await route.fetch();
      const envelope = await response.json();
      await route.fulfill({
        response,
        json: {
          ...envelope,
          proposals: envelope.proposals.filter(
            (proposal: { status: string }) => proposal.status !== 'pending',
          ),
        },
      });
    });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Your next adjustment starts with context' }),
    ).toBeVisible();
    await expect(rowFor(`Pending ${summarySuffix}`)).toHaveCount(0);
    await expect(pastSection.locator('summary')).toBeVisible();
    await pastSection.locator('summary').click();
    await expect(pastRowFor(`Rejected ${summarySuffix}`)).toBeVisible();
  } finally {
    if (pendingId) expect((await owner('reject', { id: pendingId })).ok()).toBe(true);
    if (appliedChangeId)
      expect(
        (await owner('undo', { id: appliedChangeId, idempotencyKey: randomUUID() })).ok(),
      ).toBe(true);
    expect((await owner('revoke', { id: grant.id })).ok()).toBe(true);
  }
});

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
  const sql = postgres(isolatedDatabaseUrl('E2E_DATABASE_URL'), { max: 1 });
  const run = {
    ...syntheticDay('2026-10-27', 1).activities[0]!,
    id: randomUUID(),
    externalId: randomUUID(),
    title: 'Run imported while planning',
  };
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const context = await (await request.get('/api/agent/context', { headers })).json();
    const workout = context.context.workouts.find((value: { id: string }) => value.id === id);
    await sql`insert into activity_records.records(kind,id,revision,data) values('activity',${run.id},1,${sql.json(run)})`;
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
      dialog.getByRole('heading', { name: 'Already changed on your calendar' }),
    ).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Changed context' })).toContainText(run.title);
    await expect(dialog.getByRole('region', { name: 'Changed context' })).toContainText(
      'Synthetic review context',
    );
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        document.documentElement.classList.toggle('dark', value === 'dark');
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
    await sql`delete from activity_records.records where kind='activity' and id=${run.id}`;
    await sql.end();
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
    await expect(week('Plans')).toContainText(planTitle);
    await expect(week('Plans')).toContainText('starts Tue 2 Mar');
    await expect(week('Week of 1 Mar 2027').locator('.proposal-diff-title')).toHaveText([
      'Synthetic intervals',
      'Synthetic removed run',
      'Synthetic rest',
    ]);
    await expect(week('Week of 8 Mar 2027').locator('.proposal-diff-title')).toHaveText([
      'Synthetic moved run',
      'Synthetic travel note',
      'Synthetic long run',
    ]);
    await expect(line('Synthetic intervals').locator('.proposal-diff-facts')).toContainText(
      'Tue 2 Mar · Running · 1h · 10.0 km',
    );
    await expect(line('Synthetic removed run').locator('.proposal-action')).toHaveText('Delete');
    await expect(week('Week of 1 Mar 2027').locator('.proposal-group-counts')).toContainText(
      '1 deletion',
    );
    await expect(line('Synthetic moved run').locator('.proposal-diff-facts')).toContainText(
      'moved from 2 Mar',
    );
    await expect(line('Synthetic travel note').locator('.proposal-type')).toHaveText('Note');
    await edits.getByRole('button', { name: 'Find changes' }).click();
    const search = edits.getByLabel('Search changes');
    for (const query of ['2027-03-02', '2 Mar', 'Tue 2 Mar']) {
      await search.fill(query);
      await expect(edits.locator('.proposal-diff-title')).toHaveText([
        planTitle,
        'Synthetic intervals',
        'Synthetic moved run',
      ]);
    }
    for (const [query, title] of [
      ['Wed 10 Mar', 'Synthetic moved run'],
      ['4 Mar', 'Synthetic removed run'],
      ['11 Mar', 'Synthetic travel note'],
    ]) {
      await search.fill(query!);
      await expect(edits.locator('.proposal-diff-title')).toHaveText([title!]);
    }
    await search.fill('Mar');
    await expect(edits.locator('details.proposal-diff')).toHaveCount(7);
    await edits.getByRole('button', { name: 'Clear filters' }).click();
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
