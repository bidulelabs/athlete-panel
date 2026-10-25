import { expect, it } from 'vitest';
import { onboardingActionSchema, preferencesSchema } from '../../packages/contracts/src/onboarding';
import { canRetryConnection, connectionMessage } from '../../plugins/garmin/connection-status';
import type { GarminConnection } from '../../packages/contracts/src/garmin-connection';

it('validates the narrow preference and operation contracts', () => {
  expect(preferencesSchema.parse({ timezone: 'UTC', units: 'metric', weekStartsOnPreference: 'auto' }).timezone).toBe('UTC');
  expect(preferencesSchema.safeParse({ timezone: 'Wrong/Zone', units: 'metric', weekStartsOnPreference: 'auto' }).success).toBe(false);
  expect(preferencesSchema.safeParse({ timezone: 'UTC', units: 'metric', weekStartsOnPreference: 'auto', ftpWatts: 200 }).success).toBe(false);
  expect(onboardingActionSchema.safeParse({ action: 'complete', expectedRevision: 0, idempotencyKey: 'invalid' }).success).toBe(false);
});
it('distinguishes saved, verified, failed, paused and completed imports', () => {
  const base: GarminConnection = { connected: true, paused: false, lastError: null, verified: false };
  expect(connectionMessage(base)).toContain('Checking');
  expect(connectionMessage({ ...base, currentJob: { id:'x',kind:'garmin-history',status:'queued',nextRunAt:null,retrying:false,progress:'' } }, false)).toContain('key is saved');
  expect(connectionMessage({ ...base, verified: true })).toContain('Ready to sync');
  expect(connectionMessage({ ...base, verified: true, currentJob: {id:'job',kind:'garmin-history',status:'running',progress:'',nextRunAt:null,retrying:false} })).toContain('importing');
  expect(connectionMessage({ ...base, verified: true, historyStatus: 'completed' })).toContain('scan finished');
  expect(connectionMessage({ ...base, verified: true, lastError:'Bad window' })).toContain('Some history');
  expect(connectionMessage({ ...base, lastErrorCode:'credentials_rejected', paused:true })).toContain("couldn't accept");
  expect(connectionMessage({ ...base, lastErrorCode:'account_mismatch' })).toContain('another Garmin account');
  const job = { id:'x',kind:'garmin-history',status:'queued',nextRunAt:'2026-10-25T10:00:00Z',retrying:true,progress:'' };
  expect(canRetryConnection({ ...base, currentJob:job })).toBe(false);
  expect(connectionMessage({ ...base, currentJob:job,lastErrorCode:'rate_limited' })).toContain('asked us to wait');
  expect(canRetryConnection({ ...base, currentJob:{ ...job,status:'failed',retrying:false } })).toBe(true);
  expect(canRetryConnection({ ...base, paused:true,currentJob:{ ...job,status:'failed' } })).toBe(false);
});
