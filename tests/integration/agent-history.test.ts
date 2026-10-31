import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
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
import { addDays } from '../../plugins/training/dates';
const database = isolatedDatabaseUrl();
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = database;
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.proposals,host.grants,host.changes,host.idempotency,athlete.records,training.records,activity_records.records,garmin.coverage`;
  await connection()`delete from host.settings where key='maintenance'`;
});
afterAll(closeDatabase);
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
  expect(
    result.records!.find((r) => r.id === data.workouts[1]!.id)!.data.performedDate,
  ).toBeUndefined();
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
  expect(supporting.records!.some((r) => r.data.metric === 'legacyUnknownMetric')).toBe(true);
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
