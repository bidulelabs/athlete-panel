import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { connection, closeDatabase } from '../../packages/host/src/db';
import { migrate } from '../../packages/host/src/migrations';
import { bootstrapOwner } from '../../packages/host/src/auth';
import { readOnboarding } from '../../packages/host/src/onboarding';
import { updateOnboarding } from '../../instance/onboarding';
import { loadWorkspace } from '../../instance/services';
import { mutate } from '../../plugins/training/service';
import { configure, getConfiguration, status, sync } from '../../plugins/garmin/service';
import athlete from '../../plugins/athlete/server';

const url = process.env.TEST_DATABASE_URL;
if (!url || !['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname) || !new URL(url).pathname.endsWith('_test')) throw new Error('Onboarding tests require explicit isolated local TEST_DATABASE_URL ending in _test.');
const preferences = { timezone: 'America/New_York', units: 'imperial', weekStartsOnPreference: 'sunday' };
const action = async (name: string, extra = {}) => updateOnboarding({ action: name, expectedRevision: (await readOnboarding()).revision, idempotencyKey: randomUUID(), ...extra });
beforeAll(async () => { await closeDatabase(); process.env.DATABASE_URL = url; process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); await migrate(); });
beforeEach(async () => {
  const sql = connection();
  await sql`truncate host.owner, host.sessions, host.grants, host.proposals, host.login_attempts, host.changes, host.idempotency, host.jobs, athlete.records, training.records, activity_records.records, garmin.coverage`;
  await sql`delete from host.settings where key in ('onboarding','garmin','garminToken','maintenance')`;
});
afterAll(closeDatabase);

it('bootstraps pending once, saves preferences atomically, completes and survives recovery', async () => {
  await bootstrapOwner('synthetic-onboarding-password');
  expect(await readOnboarding()).toMatchObject({ status: 'pending', step: 1 });
  await action('preferences', { values: preferences, expectedProfileRevision: null });
  expect((await loadWorkspace()).profile).toMatchObject({ ...preferences, displayName: 'Athlete', ftpWatts: null });
  expect(await readOnboarding()).toMatchObject({ status: 'active', step: 2 });
  await action('continue'); const completed = await action('complete');
  await closeDatabase(); expect(await readOnboarding()).toEqual(completed);
  await bootstrapOwner('synthetic-recovery-password', true);
  expect(await readOnboarding()).toEqual(completed);
  await expect(action('resume')).rejects.toMatchObject({ code: 'onboarding_complete' });
  expect(await connection()`select * from host.jobs`).toHaveLength(0);
});

it('classifies upgraded or missing-marker owners without inspecting their profile', async () => {
  await bootstrapOwner('synthetic-existing-password');
  await connection()`delete from host.settings where key='onboarding'`;
  expect(await readOnboarding()).toMatchObject({ status: 'existing-owner' });
  await connection().unsafe(await readFile('plugins/athlete/migrations/003-onboarding.sql','utf8'));
  expect(await readOnboarding()).toMatchObject({ status: 'existing-owner' });
  await action('resume'); expect(await readOnboarding()).toMatchObject({ status: 'active', step: 1 });
});

it('preserves detailed profile fields and rejects stale profiles without advancing', async () => {
  await bootstrapOwner('synthetic-onboarding-password');
  await mutate({ idempotencyKey: randomUUID(), commands: [{ action: 'profile.set', expectedRevision: null, values: { displayName: 'Synthetic owner', goals: 'Keep training easy', ftpWatts: 205, heartRateZones: { cycling: [120,140], running: [125,145] } } }] });
  const before = await readOnboarding();
  await expect(action('preferences', { values: preferences, expectedProfileRevision: null })).rejects.toMatchObject({ code: 'STALE_REVISION' });
  expect(await readOnboarding()).toEqual(before);
  await action('preferences', { values: preferences, expectedProfileRevision: 1 });
  expect((await loadWorkspace()).profile).toMatchObject({ ...preferences, displayName: 'Synthetic owner', goals: 'Keep training easy', ftpWatts: 205, heartRateZones: { cycling: [120,140], running: [125,145] } });
});

it('persists dismissal and Back, and rejects stale tabs and malformed commands', async () => {
  await bootstrapOwner('synthetic-onboarding-password');
  await action('preferences', { values: preferences, expectedProfileRevision: null });
  const old = await readOnboarding();
  await action('defer'); expect(await readOnboarding()).toMatchObject({ status: 'deferred', step: 2 });
  await expect(updateOnboarding({ action: 'continue', expectedRevision: old.revision, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'onboarding_conflict' });
  await expect(action('complete')).rejects.toMatchObject({ code: 'onboarding_inactive' });
  await action('resume'); await action('back');
  expect(await readOnboarding()).toMatchObject({ step: 1 });
  const state = await readOnboarding();
  await expect(action('preferences', { values: { ...preferences, timezone: 'Invalid/Zone' }, expectedProfileRevision: 1 })).rejects.toThrow();
  expect(await readOnboarding()).toEqual(state);
});

it('applies simultaneous retries once and protects request identity and agent boundaries', async () => {
  await bootstrapOwner('synthetic-onboarding-password');
  const input = { action: 'preferences', expectedRevision: 1, expectedProfileRevision: null, values: preferences, idempotencyKey: randomUUID() };
  const results = await Promise.all([updateOnboarding(input), updateOnboarding(input)]);
  expect(results[0]).toEqual(results[1]);
  expect(await connection()`select * from host.changes`).toHaveLength(1);
  await expect(updateOnboarding({ ...input, values: { ...preferences, units: 'metric' } })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  await expect(athlete.operations.onboarding(input, { actor: 'agent' })).rejects.toMatchObject({ code: 'forbidden' });
});

it('rolls back the preference audit and progress when persistence fails', async () => {
  await bootstrapOwner('synthetic-onboarding-password');
  await connection().unsafe(`create function public.reject_onboarding_test() returns trigger language plpgsql as $$ begin if new.key='onboarding' then raise exception 'synthetic progress failure'; end if; return new; end $$`);
  await connection().unsafe('create trigger reject_onboarding_test before update on host.settings for each row execute function public.reject_onboarding_test()');
  try {
    await expect(action('preferences', { values: preferences, expectedProfileRevision: null })).rejects.toThrow('synthetic progress failure');
    expect((await loadWorkspace()).profile).toBeNull();
    expect(await connection()`select * from host.changes`).toHaveLength(0);
    expect(await readOnboarding()).toMatchObject({ step: 1, revision: 1 });
  } finally {
    await connection().unsafe('drop trigger reject_onboarding_test on host.settings');
    await connection().unsafe('drop function public.reject_onboarding_test()');
  }
});

it('stores a key once across concurrent retries without leaking it or claiming verification', async () => {
  const key = 'synthetic-private-onboarding-key'; const idempotencyKey = randomUUID();
  await Promise.all([configure({ key, idempotencyKey }), configure({ key, idempotencyKey })]);
  const generation = (await getConfiguration())!.generation;
  await configure({ key, idempotencyKey });
  expect((await getConfiguration())!.generation).toBe(generation);
  expect(await status(false)).toMatchObject({ connected: true, verified: false, currentJob: { status: 'queued', kind: 'garmin-history' } });
  expect(await connection()`select * from host.jobs`).toHaveLength(1);
  expect(JSON.stringify(await connection()`select * from host.idempotency`)).not.toContain(key);
  expect(JSON.stringify(await status())).not.toContain(key);
  await expect(configure({ key: 'synthetic-different-key', idempotencyKey })).rejects.toMatchObject({ code: 'idempotency_conflict' });
});

it('keeps the history job visible beyond generic job limits and preserves retry backoff', async () => {
  await configure({ key: 'synthetic-onboarding-key' });
  await connection()`update host.jobs set error='Synthetic throttling',next_run_at=now()+interval '1 hour' where plugin_id='garmin'`;
  const before = (await status(false)).currentJob;
  for (let i=0; i<51; i++) await connection()`insert into host.jobs(id,plugin_id,kind,status,payload) values(${randomUUID()},'other','unrelated','completed','{}')`;
  await sync({ mode: 'full' });
  expect((await status(false)).currentJob).toEqual(before);
});
