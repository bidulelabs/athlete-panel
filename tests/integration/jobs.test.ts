import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { connection, transaction, closeDatabase } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { claimJob, enqueue, failClaimedJob } from '../../packages/host/src/jobs';

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith('_test')
)
  throw new Error('Explicit loopback *_test database required');
beforeAll(async () => {
  await closeDatabase();
  process.env.DATABASE_URL = url;
  await migrate();
});
beforeEach(async () => {
  await connection()`truncate host.jobs`;
  await connection()`delete from host.settings where key='maintenance'`;
});
afterAll(closeDatabase);
const insert = async (status: string, kind = 'fixture', priority = 0, created = '2020-01-01') => {
  const id = randomUUID(),
    sql = connection();
  await sql`insert into host.jobs(id,plugin_id,kind,status,payload,progress,attempts,priority,created_at) values(${id},'garmin',${kind},${status},'{"checkpoint":42}','{"saved":true}',2,${priority},${created})`;
  return id;
};
it('retains disabled collisions and restores only the oldest checkpoint after the live slot clears', async () => {
  const older = await insert('disabled'),
    newer = await insert('disabled', 'fixture', 0, '2020-01-02'),
    live = await insert('queued');
  expect((await claimJob('first'))?.id).toBe(live);
  expect(await connection()`select id from host.jobs where status='disabled'`).toHaveLength(2);
  await connection()`update host.jobs set status='completed',lease_owner=null,lease_until=null where id=${live}`;
  const restored = await claimJob('second');
  expect(restored).toMatchObject({
    id: older,
    payload: { checkpoint: 42 },
    progress: { saved: true },
    attempts: 2,
  });
  expect((await connection()`select status from host.jobs where id=${newer}`)[0].status).toBe(
    'disabled',
  );
});
it('reuses retained work, respects retry deadlines and keeps explicit pauses', async () => {
  const disabled = await insert('disabled');
  await connection()`update host.jobs set next_run_at=now()+interval '1 hour' where id=${disabled}`;
  expect(await transaction((tx) => enqueue(tx, 'garmin', 'fixture', { different: true }, 30))).toBe(
    disabled,
  );
  const paused = await insert('paused', 'paused');
  expect(await claimJob('worker')).toBeNull();
  expect(
    (
      await connection()`select payload,attempts,priority,status from host.jobs where id=${disabled}`
    )[0],
  ).toMatchObject({ payload: { checkpoint: 42 }, attempts: 2, priority: 30, status: 'queued' });
  expect((await connection()`select status from host.jobs where id=${paused}`)[0].status).toBe(
    'paused',
  );
});
it('bounds lease expiry retries and keeps a failed checkpoint until explicit retry', async () => {
  const id = await insert('queued');
  for (let attempts = 3; attempts <= 8; attempts++) {
    await connection()`update host.jobs set next_run_at=now() where id=${id}`;
    expect((await claimJob('worker'))?.id).toBe(id);
    await connection()`update host.jobs set lease_until=now()-interval '1 second' where id=${id}`;
    expect(await claimJob('next')).toBeNull();
    expect(
      (await connection()`select status,attempts,error,payload from host.jobs where id=${id}`)[0],
    ).toMatchObject({
      status: attempts === 8 ? 'failed' : 'queued',
      attempts,
      error: 'lease_expired',
      payload: { checkpoint: 42 },
    });
  }
  expect(await claimJob('later')).toBeNull();
});
it('claims by priority and fences concurrent claims and old failures', async () => {
  await insert('queued', 'low', 0);
  const high = await insert('queued', 'high', 30);
  const claimed = await Promise.all([claimJob('one'), claimJob('two')]);
  expect(claimed.filter(Boolean)).toHaveLength(1);
  const job = claimed.find(Boolean)!;
  expect(job.id).toBe(high);
  await connection()`update host.jobs set lease_owner='replacement' where id=${high}`;
  await failClaimedJob(job);
  expect((await connection()`select status,attempts from host.jobs where id=${high}`)[0]).toEqual({
    status: 'running',
    attempts: 2,
  });
  await failClaimedJob({ ...job, lease_owner: 'replacement' });
  expect(
    (await connection()`select status,attempts,error from host.jobs where id=${high}`)[0],
  ).toEqual({ status: 'queued', attempts: 3, error: 'handler_failed' });
});
