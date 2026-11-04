import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, afterEach, it, expect, vi } from 'vitest';
import { isolatedDatabaseUrl } from '../support/test-database';
import { connection, closeDatabase } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import {
  createGrant,
  contextForToken,
  submitProposal,
  applyProposal,
  reviewProposal,
  undoChange,
} from '../../plugins/agent-bridge/service';
import { readHistory } from '../../plugins/agent-bridge/history';
import { syntheticDay, historyId } from '../fixtures/historical';
import { addDays, todayInTimeZone } from '../../plugins/training/dates';
import { workoutSchema } from '@athlete-panel/contracts';
import * as sources from '../../instance/history-services';
const database = isolatedDatabaseUrl();
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = database;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.proposals,agent_bridge.planning_reads,host.grants,host.changes,host.idempotency,athlete.records,training.records,activity_records.records,garmin.coverage`;
  await connection()`delete from host.settings where key='maintenance'`;
});
afterAll(closeDatabase);
afterEach(() => vi.restoreAllMocks());
const access = (
  categories: string[] = ['activities', 'health', 'training', 'context'],
  includeNotes = false,
) =>
  createGrant({
    label: 'Synthetic history',
    version: 2,
    history: { from: '2021-10-31', to: '2026-10-31', categories, includeNotes, weekStartsOn: 1 },
    planning: null,
  });
async function seed() {
  const sql = connection();
  const data = syntheticDay('2024-01-01', 0);
  await sql`insert into training.records(kind,id,revision,data) values('plan',${historyId(900000)},1,${sql.json({ id: historyId(900000), revision: 1, title: 'Plan', startDate: '2024-01-01', description: 'PRIVATE_PLAN_NOTE' })})`;
  for (const [kind, records] of [
    ['activity', data.activities],
    ['health', data.health],
  ] as const)
    for (const record of records)
      await sql`insert into activity_records.records(kind,id,revision,data) values(${kind},${record.id},1,${sql.json(record)})`;
  for (const record of data.workouts)
    await sql`insert into training.records(kind,id,revision,data) values('workout',${record.id},1,${sql.json(record)})`;
  return data;
}
it('preserves category-specific event and calendar-note facts without unrelated workout fields', async () => {
  const sql = connection();
  await sql`insert into training.records(kind,id,revision,data) values
    ('event',${randomUUID()},1,'{"title":"Synthetic race","date":"2024-01-01","kind":"race","notes":"PRIVATE_EVENT"}'::jsonb),
    ('note',${randomUUID()},1,'{"title":"Travel week","schedule":{"kind":"independent","date":"2024-01-02"},"body":"PRIVATE_NOTE"}'::jsonb)`;
  const { token } = await access(['training', 'context'], true);
  const event = (await readHistory(token, 'records', { category: 'events' })).records![0]!;
  const note = (await readHistory(token, 'records', { category: 'notes' })).records![0]!;
  expect(event.data).toMatchObject({
    title: 'Synthetic race',
    kind: 'race',
    notes: 'PRIVATE_EVENT',
  });
  expect(note.data).toMatchObject({ title: 'Travel week', body: 'PRIVATE_NOTE' });
  for (const record of [event, note]) {
    expect(record.data).not.toHaveProperty('durationSeconds');
    expect(record.data).not.toHaveProperty('stepCount');
  }
  const restricted = await access(['context']);
  expect(
    JSON.stringify(await readHistory(restricted.token, 'records', { category: 'events' })),
  ).not.toContain('PRIVATE_EVENT');
});
it('historical-only access cannot get planning context or submit a proposal; legacy access has no history', async () => {
  const { token } = await access();
  await expect(contextForToken(token)).rejects.toMatchObject({ status: 403 });
  await expect(
    submitProposal(token, {
      commands: [{ action: 'plan.create', values: { title: 'Denied' } }],
      summary: 'Denied',
      contextDigest: 'a'.repeat(64),
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  const legacy = await createGrant({ label: 'Legacy', from: '2026-10-01', to: '2026-10-31' });
  await expect(readHistory(legacy.token, 'discover')).rejects.toMatchObject({ status: 403 });
  expect((await contextForToken(legacy.token)).scope).toMatchObject({
    from: '2026-10-01',
    to: '2026-10-31',
  });
});
it('keeps recent health in separately approved history under the default and future-only proposal dates', async () => {
  const sql = connection(),
    today = todayInTimeZone();
  for (let day = 0; day < 21; day++) {
    const data = syntheticDay(addDays(today, day - 20), day);
    for (const [kind, records] of [
      ['activity', data.activities],
      ['health', data.health],
    ] as const)
      for (const record of records)
        await sql`insert into activity_records.records(kind,id,revision,data) values(${kind},${record.id},1,${sql.json(record)})`;
  }
  const history = {
    from: addDays(today, -27),
    to: today,
    categories: ['activities', 'health'],
    weekStartsOn: 1,
  };
  const planning = { from: today, to: addDays(today, 13) };
  const combined = await createGrant({ label: 'Default combined', version: 2, history, planning });
  const planningOnly = await createGrant({
    label: 'No history',
    version: 2,
    history: null,
    planning,
  });
  for (const grant of [combined, planningOnly]) {
    const context = await contextForToken(grant.token);
    expect(context.scope).toMatchObject(planning);
    expect(new Set(context.context.health.map((record) => record.localDate))).toEqual(
      new Set([today]),
    );
    expect(context.context.healthWeeks).toEqual([]);
    expect(context.context.activities).toHaveLength(3);
  }
  const recent = await readHistory(combined.token, 'summary', {
    from: addDays(today, -20),
    to: addDays(today, -1),
    category: 'health',
    metric: 'steps',
    period: 'week',
  });
  expect(recent.summaries!.some((row) => row.contributingDays! > 0 && row.mean !== null)).toBe(
    true,
  );
  await expect(readHistory(planningOnly.token, 'discover')).rejects.toMatchObject({ status: 403 });
  const future = await createGrant({
    label: 'Future-only',
    version: 2,
    history: null,
    planning: { from: addDays(today, 1), to: addDays(today, 14) },
  });
  const futureContext = await contextForToken(future.token);
  expect(futureContext.context).toMatchObject({ health: [], healthWeeks: [], activities: [] });
  const legacy = await createGrant({
    label: 'Legacy dates',
    from: addDays(today, -28),
    to: addDays(today, 14),
  });
  const oldContext = await contextForToken(legacy.token);
  expect(new Set(oldContext.context.health.map((record) => record.localDate)).size).toBe(7);
  expect(oldContext.context.healthWeeks.length).toBeGreaterThan(0);
  expect(oldContext.context.activities).toHaveLength(63);
});
it('enforces categories, dates, filters and default private-note exclusions', async () => {
  await seed();
  const { token } = await access();
  const discover = await readHistory(token, 'discover');
  expect(discover.availability?.find((r) => r.category === 'activities')?.count).toBe(3);
  const workouts = await readHistory(token, 'records', { category: 'workouts' });
  expect(JSON.stringify(workouts)).not.toContain('PRIVATE_');
  const acts = await readHistory(token, 'records', { category: 'activities', sport: 'running' });
  expect(acts.records).toHaveLength(1);
  await expect(readHistory(token, 'summary', { from: '2021-10-30' })).rejects.toMatchObject({
    status: 403,
  });
  await expect(readHistory(token, 'records', { category: 'notes' })).rejects.toMatchObject({
    status: 403,
  });
  const limited = await access(['health']);
  const limitedOverview = await readHistory(limited.token, 'summary');
  expect(limitedOverview.warnings.join(' ')).toContain('comparison is unavailable');
  await expect(
    readHistory(limited.token, 'records', { category: 'activities' }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(readHistory(limited.token, 'context')).rejects.toMatchObject({ status: 403 });
  await expect(
    readHistory(token, 'records', { category: 'health', sport: 'running' }),
  ).rejects.toMatchObject({ status: 400 });
  const notes = await access(undefined, true);
  expect(
    JSON.stringify(await readHistory(notes.token, 'records', { category: 'workouts' })),
  ).toContain('PRIVATE_WORKOUT_NOTE');
});
it('pages deterministically, rejects cursor tampering/query changes and invalidates concurrent edits', async () => {
  const data = await seed();
  const { token } = await access();
  const first = await readHistory(token, 'records', { category: 'activities', limit: 1 });
  const next = { ...first.query, reviewToken: first.reviewToken, cursor: first.nextCursor! };
  await expect(readHistory(token, 'records', { ...next, cursor: '' })).rejects.toThrow();
  await expect(readHistory(token, 'records', { ...next, reviewToken: '' })).rejects.toThrow();
  const second = await readHistory(token, 'records', next);
  expect(second.records![0]!.id).not.toBe(first.records![0]!.id);
  expect(await readHistory(token, 'records', next)).toMatchObject({ records: second.records });
  await expect(readHistory(token, 'records', { ...next, sport: 'running' })).rejects.toMatchObject({
    code: 'invalid_cursor',
  });
  await expect(
    readHistory(token, 'records', { ...next, cursor: 'tampered' }),
  ).rejects.toMatchObject({ code: 'invalid_cursor' });
  const sql = connection();
  await sql`update activity_records.records set data=data||'{"durationSeconds":999}'::jsonb where id=${data.activities[0]!.id}`;
  await expect(readHistory(token, 'records', next)).rejects.toMatchObject({
    code: 'history_changed',
  });
});
it('discovers every permitted scheduled/performed date without widening a narrowed selection', async () => {
  const sql = connection();
  // Deliberately order the earliest-keyed record's completion after the last record.
  for (const [scheduled, performed] of [
    ['2024-01-10', '2024-12-20'],
    ['2024-11-15', '2024-02-05'],
    ['2023-12-31', '2024-06-15'],
    ['2024-07-15', '2025-01-01'],
  ]) {
    const workout = workoutSchema.parse({
      id: randomUUID(),
      revision: 1,
      title: 'Synthetic dated completion',
      sport: 'running',
      schedule: { kind: 'independent', date: scheduled },
      completion: {
        status: 'completed',
        source: 'manual',
        activityId: null,
        performedDate: performed,
      },
    });
    await sql`insert into training.records(kind,id,revision,data) values('workout',${workout.id},1,${sql.json(workout)})`;
  }
  const { token } = await createGrant({
    label: 'Dated discovery',
    version: 2,
    planning: null,
    history: { from: '2024-01-01', to: '2024-12-31', categories: ['training'], weekStartsOn: 1 },
  });
  const records = vi.spyOn(sources, 'historicalRecords');
  const discovery = await readHistory(token, 'discover');
  expect(records).not.toHaveBeenCalled();
  expect(discovery.availability).toContainEqual({
    category: 'workouts',
    count: 4,
    from: '2024-01-10',
    to: '2024-12-20',
  });
  expect(discovery.availability).toContainEqual({
    category: 'plans',
    count: 0,
    from: null,
    to: null,
  });
  for (const [from, to, count, first, last] of [
    ['2024-12-01', '2024-12-31', 1, '2024-12-20', '2024-12-20'],
    ['2024-06-01', '2024-07-31', 2, '2024-06-15', '2024-07-15'],
    ['2024-03-01', '2024-03-31', 0, null, null],
  ] as const) {
    const query = { from, to, reviewToken: discovery.reviewToken };
    const narrowed = await readHistory(token, 'discover', query);
    expect(narrowed.availability).toContainEqual({
      category: 'workouts',
      count,
      from: first,
      to: last,
    });
    const details = await readHistory(token, 'records', { ...query, category: 'workouts' });
    expect(details.records).toHaveLength(count);
  }
});
it('discovers full coverage and injury intervals clipped to both query and grant boundaries', async () => {
  const sql = connection();
  await sql`insert into garmin.coverage(stream,start_date,end_date,status,scan_state,scanned_at)
    values('activities','2023-12-01','2025-01-31','complete','scanned',now()),
      ('activities','2024-06-01','2024-06-30','complete','scanned',now()),
      ('sleep','2023-01-01','2025-12-31','complete','scanned',now())`;
  for (const endDate of ['2024-12-20', null]) {
    const injury = {
      id: randomUUID(),
      revision: 1,
      bodyPart: 'Synthetic knee',
      startDate: '2023-12-01',
      endDate,
      notes: 'PRIVATE_INJURY_NOTE',
    };
    await sql`insert into athlete.records(kind,id,revision,data) values('injury',${injury.id},1,${sql.json(injury)})`;
  }
  const { token } = await createGrant({
    label: 'Interval discovery',
    version: 2,
    planning: null,
    history: {
      from: '2024-01-01',
      to: '2024-12-31',
      categories: ['activities', 'context'],
      weekStartsOn: 1,
    },
  });
  for (const range of [
    { from: '2024-01-01', to: '2024-12-31' },
    { from: '2024-06-01', to: '2024-06-30' },
  ]) {
    const discovery = await readHistory(token, 'discover', range);
    expect(discovery.availability).toContainEqual({ category: 'coverage', count: 2, ...range });
    expect(discovery.availability).toContainEqual({ category: 'injuries', count: 2, ...range });
    expect(discovery.availability?.some((row) => row.category === 'health')).toBe(false);
    expect(JSON.stringify(discovery)).not.toContain('PRIVATE_');
  }
  await sql`delete from athlete.records where data->>'endDate' is null`;
  const closedOnly = await readHistory(token, 'discover');
  expect(closedOnly.availability).toContainEqual({
    category: 'injuries',
    count: 1,
    from: '2024-01-01',
    to: '2024-12-20',
  });
});
it('rechecks revoked, expired and cross-grant review access on each page', async () => {
  await seed();
  const a = await access(),
    b = await access();
  const first = await readHistory(a.token, 'records', { category: 'activities', limit: 1 });
  const next = { ...first.query, reviewToken: first.reviewToken, cursor: first.nextCursor! };
  await expect(readHistory(b.token, 'records', next)).rejects.toMatchObject({ status: 403 });
  await connection()`update host.grants set revoked=true where id=${a.grant.id}`;
  await expect(readHistory(a.token, 'records', next)).rejects.toMatchObject({ status: 401 });
  await connection()`update host.grants set expires_at=now()-interval '1 second' where id=${b.grant.id}`;
  await expect(readHistory(b.token, 'summary')).rejects.toMatchObject({ status: 401 });
});
it('summarizes recorded facts without linked duplication and returns page/coverage bounds', async () => {
  await seed();
  const { token } = await access();
  const result = await readHistory(token, 'summary', {
    from: '2024-01-01',
    to: '2024-01-31',
    limit: 200,
  });
  expect(
    result.summaries!.filter((r) => r.category === 'actual').reduce((n, r) => n + r.count, 0),
  ).toBe(4);
  expect(
    result.summaries!.find((r) => r.category === 'health' && r.metric === 'hrvMilliseconds'),
  ).toMatchObject({ mean: null, contributingDays: 0, unknownDays: 1 });
  expect(result.summaries!.find((r) => r.category === 'coverage')).toMatchObject({
    scannedDays: 0,
    unscannedDays: 31,
  });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1024 * 1024);
});
it('reviews, applies and undoes one annual proposal above 200 commands atomically', async () => {
  const { token, grant } = await createGrant({
    label: 'Annual',
    version: 2,
    history: { from: '2021-10-31', to: '2026-10-31', categories: ['activities'], weekStartsOn: 1 },
    planning: { from: '2026-10-31', to: '2027-10-31' },
  });
  const context = await contextForToken(token);
  const commands = Array.from({ length: 366 }, (_, day) => ({
    action: 'workout.create',
    values: {
      title: `Annual day ${day}`,
      sport: 'running',
      schedule: { kind: 'independent', date: addDays('2026-10-31', day) },
      durationSeconds: 1800,
    },
  }));
  const input = {
    commands,
    summary: 'One annual program',
    contextDigest: context.contextDigest,
    idempotencyKey: randomUUID(),
  };
  const submitted = await submitProposal(token, input);
  expect(await connection()`select id from training.records`).toHaveLength(0);
  expect(await submitProposal(token, input)).toEqual(submitted);
  const review = await reviewProposal({ id: submitted.id, digest: submitted.digest });
  expect(review.applicability).toBe('ready');
  const applied = await applyProposal({
    id: submitted.id,
    digest: submitted.digest,
    idempotencyKey: randomUUID(),
    reviewedContextDigest: review.currentContextDigest!,
  });
  expect(await connection()`select id from training.records where deleted=false`).toHaveLength(366);
  await undoChange({ id: applied.id, idempotencyKey: randomUUID() });
  expect(await connection()`select id from training.records where deleted=false`).toHaveLength(0);
  expect(grant).toMatchObject({ version: 2 });
}, 30000);
it('five-year reading never widens annual proposal source or result dates', async () => {
  const { token } = await createGrant({
    label: 'Both',
    version: 2,
    history: { from: '2021-10-31', to: '2026-10-31', categories: ['training'], weekStartsOn: 1 },
    planning: { from: '2026-10-31', to: '2027-10-31' },
  });
  const context = await contextForToken(token);
  await expect(
    submitProposal(token, {
      commands: [
        {
          action: 'workout.create',
          values: {
            title: 'Outside',
            sport: 'running',
            schedule: { kind: 'independent', date: '2024-01-01' },
          },
        },
      ],
      summary: 'Denied',
      contextDigest: context.contextDigest,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 403 });
});

it('invalidates insertion, deletion, plan moves and coverage corrections without duplicates', async () => {
  const data = await seed(),
    { token } = await access();
  for (const mutation of [
    async () => {
      const a = { ...data.activities[0]!, id: randomUUID(), externalId: 'new-synthetic' };
      await connection()`insert into activity_records.records(kind,id,revision,data) values('activity',${a.id},1,${connection().json(a)})`;
    },
    async () => {
      await connection()`update activity_records.records set deleted=true where id=${data.activities[1]!.id}`;
    },
    async () => {
      await connection()`update training.records set data=data||'{"startDate":"2024-02-01"}'::jsonb where kind='plan'`;
    },
    async () => {
      await connection()`insert into garmin.coverage(stream,start_date,end_date,status) values('activities','2024-01-01','2024-01-31','failed')`;
    },
  ]) {
    const before = await readHistory(token, 'summary', {
      from: '2024-01-01',
      to: '2024-01-31',
      limit: 1,
    });
    await mutation();
    await expect(
      readHistory(token, 'summary', {
        ...before.query,
        reviewToken: before.reviewToken,
        cursor: before.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: 'history_changed' });
  }
});
it('pages prescriptions, excludes nested notes, and keeps out-of-grant completion facts private', async () => {
  const data = await seed(),
    workout = data.workouts[2]!;
  const steps = Array.from({ length: 3 }, () => ({
    kind: 'work',
    durationSeconds: 60,
    distanceMeters: null,
    target: null,
    notes: 'PRIVATE_STEP',
  }));
  // Use an existing normalized interval shape from its runtime contract.
  const { workoutStepSchema } = await import('../../packages/contracts/src');
  const normalized = steps.map((step) => workoutStepSchema.parse(step));
  await connection()`update training.records set data=data||${connection().json({ steps: normalized })}::jsonb where id=${workout.id}`;
  const { token } = await access();
  const first = await readHistory(token, 'records', {
    category: 'workouts',
    recordId: workout.id,
    section: 'steps',
    limit: 1,
  });
  expect(first.records).toHaveLength(1);
  expect(JSON.stringify(first)).not.toContain('PRIVATE_STEP');
  const second = await readHistory(token, 'records', {
    ...first.query,
    reviewToken: first.reviewToken,
    cursor: first.nextCursor!,
  });
  expect(second.records![0]!.id).not.toBe(first.records![0]!.id);
  const narrowed = await createGrant({
    label: 'Narrow',
    version: 2,
    history: { from: '2024-01-01', to: '2024-01-01', categories: ['training'], weekStartsOn: 1 },
    planning: null,
  });
  await connection()`update training.records set data=jsonb_set(data,'{completion,performedDate}','"2025-01-01"') where id=${data.workouts[1]!.id}`;
  const result = await readHistory(narrowed.token, 'records', { category: 'workouts' });
  const historicalWorkout = result.records!.find((r) => r.id === data.workouts[1]!.id)!;
  expect(historicalWorkout.category).toBe('workouts');
  if (historicalWorkout.category !== 'workouts') throw new Error('Expected a workout');
  expect(historicalWorkout.data.performedDate).toBeUndefined();
});
it('reports unsupported older measurement fields and excludes provider payloads', async () => {
  const data = await seed();
  await connection()`update activity_records.records set data=data||'{"durationSeconds":"old-invalid","raw":{"secret":"NEVER_EXPORT"},"gps":[1,2]}'::jsonb where id=${data.activities[0]!.id}`;
  const { token } = await access();
  const detail = await readHistory(token, 'records', { category: 'activities', sport: 'running' });
  expect(detail.records![0]!.data.unsupportedFields).toContain('durationSeconds');
  expect(JSON.stringify(detail)).not.toContain('NEVER_EXPORT');
  expect(JSON.stringify(detail)).not.toContain('gps');
  await connection()`update activity_records.records set data=data||'{"metric":"legacyUnknownMetric","value":123}'::jsonb where id=${data.health[0]!.id}`;
  const summary = await readHistory(token, 'summary', {
    category: 'health',
    from: '2024-01-01',
    to: '2024-01-31',
  });
  const unsupported = summary.summaries!.find((r) => r.metric === 'legacyUnknownMetric')!;
  expect(unsupported).toMatchObject({ unsupportedRecords: 1, mean: null });
  const supporting = await readHistory(token, 'records', {
    ...unsupported.detailReferences![0],
    reviewToken: summary.reviewToken,
  });
  expect(
    supporting.records!.some(
      (r) => r.category === 'health' && r.data.metric === 'legacyUnknownMetric',
    ),
  ).toBe(true);
});
it('agent HTTP accepts up to 4 MiB while the generic/manual reader keeps 256 KiB', async () => {
  const { POST } = await import('../../apps/web/app/api/agent/[operation]/route');
  const { readJson } = await import('../../packages/host/src/http');
  const { token } = await createGrant({
    label: 'Body bound',
    version: 2,
    history: null,
    planning: { from: '2026-10-31', to: '2027-10-31' },
  });
  const large = JSON.stringify({ padding: 'x'.repeat(300 * 1024) });
  await expect(
    readJson(new Request('http://localhost/api', { method: 'POST', body: large })),
  ).rejects.toMatchObject({ status: 413 });
  const allowed = await POST(
    new Request('http://localhost/api/agent/propose', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: large,
    }),
    { params: Promise.resolve({ operation: 'propose' }) },
  );
  expect(allowed.status).toBe(400);
  const refused = await POST(
    new Request('http://localhost/api/agent/propose', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024) }),
    }),
    { params: Promise.resolve({ operation: 'propose' }) },
  );
  expect(refused.status).toBe(413);
});
it('reads profile/events/overlapping injuries and includes calendar notes only with explicit permission', async () => {
  await seed();
  const sql = connection();
  const { profileSchema } = await import('../../packages/contracts/src');
  await sql`insert into athlete.records(kind,id,revision,data) values('profile','owner',1,${sql.json(profileSchema.parse({ id: 'owner', revision: 1, goals: 'Current synthetic goal' }))})`;
  const injury = {
    id: randomUUID(),
    revision: 1,
    bodyPart: 'Knee',
    description: 'Shared constraint',
    notes: 'PRIVATE_INJURY_NOTE',
    startDate: '2020-01-01',
    endDate: null,
    severity: 'mild',
  };
  await sql`insert into athlete.records(kind,id,revision,data) values('injury',${injury.id},1,${sql.json(injury)})`;
  const event = {
    id: randomUUID(),
    revision: 1,
    title: 'Synthetic race',
    date: '2024-06-01',
    kind: 'race',
    notes: 'PRIVATE_EVENT_NOTE',
  };
  await sql`insert into training.records(kind,id,revision,data) values('event',${event.id},1,${sql.json(event)})`;
  const note = {
    id: randomUUID(),
    revision: 1,
    title: 'Travel',
    body: 'PRIVATE_CALENDAR_NOTE',
    schedule: { kind: 'independent', date: '2024-06-01' },
  };
  await sql`insert into training.records(kind,id,revision,data) values('note',${note.id},1,${sql.json(note)})`;
  const { token } = await access();
  expect((await readHistory(token, 'context')).profile).toMatchObject({
    goals: 'Current synthetic goal',
  });
  const injuries = await readHistory(token, 'records', {
    category: 'injuries',
    from: '2024-01-01',
    to: '2024-12-31',
  });
  expect(injuries.records![0]!.data).toMatchObject({
    description: 'Shared constraint',
    startDate: null,
    from: '2024-01-01',
    to: '2024-12-31',
  });
  expect(JSON.stringify(injuries)).not.toContain('PRIVATE_');
  expect(JSON.stringify(injuries)).not.toContain('2020-01-01');
  expect(JSON.stringify(await readHistory(token, 'records', { category: 'events' }))).not.toContain(
    'PRIVATE_',
  );
  const permitted = await access(undefined, true);
  expect(
    JSON.stringify(await readHistory(permitted.token, 'records', { category: 'notes' })),
  ).toContain('PRIVATE_CALENDAR_NOTE');
});
it('enforces the byte ceiling without losing large prescription parts between pages', async () => {
  const data = await seed(),
    id = data.workouts[2]!.id,
    sql = connection();
  const steps = Array.from({ length: 4 }, () => ({
    kind: 'repeat',
    times: 2,
    steps: Array.from({ length: 50 }, () => ({
      kind: 'work',
      durationSeconds: 30,
      distanceMeters: null,
      target: null,
      notes: 'é'.repeat(4000),
    })),
  }));
  await sql`update training.records set data=data||${sql.json({ steps })}::jsonb where id=${id}`;
  const { token } = await access(undefined, true);
  let page = await readHistory(token, 'records', {
      category: 'workouts',
      recordId: id,
      section: 'steps',
      limit: 200,
    }),
    count = 0;
  const ids = new Set<string>();
  expect(page.nextCursor).not.toBeNull();
  for (;;) {
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1024 * 1024);
    for (const record of page.records!) {
      expect(ids.has(record.id)).toBe(false);
      ids.add(record.id);
      count++;
    }
    if (!page.nextCursor) break;
    page = await readHistory(token, 'records', {
      ...page.query,
      reviewToken: page.reviewToken,
      cursor: page.nextCursor,
    });
  }
  expect(count).toBe(4);
  await sql`update activity_records.records set data=data||${sql.json({ provenance: { sourceAccountId: 'é'.repeat(600000), source: 'synthetic-invalid-legacy' } })}::jsonb where id=${data.health[0]!.id}`;
  await expect(
    readHistory(token, 'summary', {
      category: 'health',
      metric: 'sleepDurationSeconds',
      from: '2024-01-01',
      to: '2024-01-31',
    }),
  ).rejects.toMatchObject({ status: 413, code: 'summary_too_large' });
});

it('embeds the exact review in summary evidence, including cache reuse, and rejects stale drill-down', async () => {
  const data = await seed();
  const { token } = await access();
  const query = { category: 'activities', from: '2024-01-01', to: '2024-01-31' };
  const first = await readHistory(token, 'summary', query);
  const second = await readHistory(token, 'summary', query);
  expect(second.reviewToken).not.toBe(first.reviewToken);
  for (const response of [first, second]) {
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(1024 * 1024);
    for (const summary of response.summaries!) {
      expect(summary.reference.reviewToken).toBe(response.reviewToken);
      expect((await readHistory(token, 'summary', summary.reference)).reviewToken).toBe(
        response.reviewToken,
      );
      for (const ref of summary.detailReferences ?? []) {
        expect(ref.reviewToken).toBe(response.reviewToken);
        expect((await readHistory(token, 'records', ref)).reviewToken).toBe(response.reviewToken);
      }
    }
  }
  await connection()`update activity_records.records set revision=revision+1 where id=${data.activities[0]!.id}`;
  for (const summary of second.summaries!) {
    await expect(readHistory(token, 'summary', summary.reference)).rejects.toMatchObject({
      code: 'history_changed',
      status: 409,
    });
    for (const ref of summary.detailReferences ?? [])
      await expect(readHistory(token, 'records', ref)).rejects.toMatchObject({
        code: 'history_changed',
        status: 409,
      });
  }
});

it.each(['steps', 'exercises'] as const)(
  'distinguishes missing, empty and unsupported historical %s collections',
  async (section) => {
    const sql = connection();
    const id = randomUUID();
    const count = section === 'steps' ? 'stepCount' : 'exerciseCount';
    const { token } = await access(['training']);
    const query = { category: 'workouts', recordId: id };
    await sql`insert into training.records(kind,id,revision,data) values('workout',${id},1,${sql.json({ title: 'Synthetic legacy', schedule: { kind: 'independent', date: '2024-01-01' }, notes: 'PRIVATE_LEGACY' })})`;
    const missing = (await readHistory(token, 'records', query)).records![0]!;
    expect(missing.data).not.toHaveProperty(count);
    expect((await readHistory(token, 'records', { ...query, section })).records).toEqual([]);
    for (const collection of [null, 'old text', 12, { legacyItems: [{ durationSeconds: 60 }] }]) {
      await sql`update training.records set data=data||${sql.json({ [section]: collection, durationSeconds: 'invalid legacy duration' })} where id=${id}`;
      const core = await readHistory(token, 'records', query);
      expect(core.records![0]!.data).not.toHaveProperty(count);
      expect(core.records![0]!.data.unsupportedFields).toEqual(
        expect.arrayContaining([section, 'durationSeconds']),
      );
      const parts = await readHistory(token, 'records', {
        ...query,
        section,
        limit: 1,
        reviewToken: core.reviewToken,
      });
      expect(parts.records).toEqual([
        {
          category: 'workouts',
          id: `${id}:0`,
          date: '2024-01-01',
          data: { unsupportedFields: [section] },
        },
      ]);
      expect(parts.nextCursor).toBeNull();
      expect(JSON.stringify(parts)).not.toContain('PRIVATE_LEGACY');
      expect(
        (await readHistory(token, 'records', { ...query, section, from: '2024-02-01' })).records,
      ).toEqual([]);
    }
    await sql`update training.records set data=data||${sql.json({ [section]: [] })} where id=${id}`;
    expect((await readHistory(token, 'records', query)).records![0]!.data).toHaveProperty(count, 0);
    expect((await readHistory(token, 'records', { ...query, section })).records).toEqual([]);
  },
);

it.each(['records', 'summary'] as const)(
  'rejects unsupported coverage identity filters in %s',
  async (operation) => {
    const { token } = await access(['activities']);
    await expect(readHistory(token, operation, { recordId: randomUUID() })).rejects.toMatchObject({
      code: 'validation',
      status: 400,
      message: expect.stringContaining('Choose a record category'),
    });
    await expect(
      readHistory(token, operation, { category: 'coverage', recordId: randomUUID() }),
    ).rejects.toMatchObject({
      code: 'validation',
      status: 400,
      message: expect.stringContaining('Remove recordId'),
    });
  },
);

it('returns history_changed if a collection changes shape between its core and section reads', async () => {
  const data = await seed();
  const id = data.workouts[0]!.id;
  const { token } = await access(['training']);
  const original = sources.historicalRecords;
  let changed = false;
  vi.spyOn(sources, 'historicalRecords').mockImplementationOnce((tx, query, scope) =>
    original(
      new Proxy(tx, {
        apply(target, receiver, args) {
          const result = Reflect.apply(target, receiver, args);
          if (Array.isArray(args[0]) && args[0].join('').includes('select id,date,'))
            return result.then(async (rows: unknown) => {
              changed = true;
              await connection()`update training.records set revision=revision+1,data=data||'{"steps":{"legacyItems":[]}}'::jsonb where id=${id}`;
              return rows;
            });
          return result;
        },
      }),
      query,
      scope,
    ),
  );
  await expect(
    readHistory(token, 'records', { category: 'workouts', recordId: id, section: 'steps' }),
  ).rejects.toMatchObject({ code: 'history_changed', status: 409 });
  expect(changed).toBe(true);
});
