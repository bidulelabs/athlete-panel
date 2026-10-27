import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  emptyWorkspace,
  workspaceEnvelopeSchema,
  onboardingStatusSchema,
  createPluginRequester,
  operationContracts,
  type MutationResponse,
  responseError,
} from '@athlete-panel/contracts';
import { initialOnboarding } from '../../packages/host/src/onboarding';
import { requiredRow, optionalRow } from '../../packages/host/src/rows';
import { AppError } from '../../packages/host/src/errors';
import { contractJson } from '../../packages/host/src/http';
const id = '00000000-0000-4000-8000-000000000001';
const envelope = () => ({
  state: emptyWorkspace(),
  plugins: [],
  proposals: [],
  grants: [],
  changes: [],
  jobs: [],
  garmin: {
    connected: false,
    paused: false,
    earliestDate: null,
    lastSync: null,
    lastError: null,
    status: 'Disabled',
    coverage: [],
  },
});
describe('public response boundaries', () => {
  it('preserves existing empty/null payloads and optional fields', () => {
    expect(workspaceEnvelopeSchema.parse(envelope())).toEqual(envelope());
    const status = {
      onboarding: initialOnboarding(),
      worker: null,
      garmin: { connected: false, paused: false, lastError: null },
    };
    expect(onboardingStatusSchema.parse(status)).toEqual(status);
  });
  it('rejects malformed collections, dates, stored entity payloads and operational fields', () => {
    expect(() => workspaceEnvelopeSchema.parse({ ...envelope(), proposals: [{}] })).toThrow();
    expect(() =>
      workspaceEnvelopeSchema.parse({
        ...envelope(),
        garmin: { ...envelope().garmin, checkedAt: 'yesterday' },
      }),
    ).toThrow();
    expect(() =>
      workspaceEnvelopeSchema.parse({
        ...envelope(),
        state: { ...emptyWorkspace(), plans: [{ id }] },
      }),
    ).toThrow();
    expect(() =>
      workspaceEnvelopeSchema.parse({
        ...envelope(),
        operational: [{ key: 'worker', value: { lastSeen: 123 } }],
      }),
    ).toThrow();
  });
  it('accepts typed numeric Garmin coverage and preserves compatible optional audit fields', () => {
    const value = {
      ...envelope(),
      changes: [
        {
          id,
          createdAt: '2026-10-27T00:00:00.000Z',
          summary: 'Synthetic',
          undoneAt: null,
          undoable: false,
          changes: [],
        },
      ],
      garmin: {
        ...envelope().garmin,
        coverage: [
          {
            stream: 'sleep',
            from: '2026-10-26',
            to: '2026-10-27',
            status: 'partial',
            records: 1,
            missingDays: 1,
            unknownMetrics: 2,
            error: null,
          },
        ],
      },
    };
    expect(workspaceEnvelopeSchema.parse(value)).toEqual(value);
  });
  it('validates known requests/results and leaves extension responses unknown', async () => {
    const request = createPluginRequester(async () => ({ id, changes: [] }));
    const result = request('training', 'undo', { id, idempotencyKey: id });
    expectTypeOf(result).toEqualTypeOf<Promise<MutationResponse>>();
    await expect(result).resolves.toEqual({ id, changes: [] });
    const extension = request('personal-feature', 'read', {});
    expectTypeOf(extension).toEqualTypeOf<Promise<unknown>>();
    await expect(
      createPluginRequester(async () => ({ bad: true }))('training', 'undo', {
        id,
        idempotencyKey: id,
      }),
    ).rejects.toThrow();
    expect(() =>
      operationContracts.training.undo.input.parse({ id: 'invalid', idempotencyKey: id }),
    ).toThrow();
    expect(
      operationContracts.garmin.configure.input.parse({
        key: 'synthetic-key',
        earliestDate: '2026-01-01',
      }).earliestDate,
    ).toBe('2026-01-01');
  });
  it('returns server contract failures as internal errors without leaking stored values', () => {
    expect(() => contractJson(workspaceEnvelopeSchema, { secret: 'synthetic' })).toThrowError(
      expect.objectContaining({ code: 'invalid_response', status: 500 }),
    );
    expect(
      responseError(
        { error: { message: 'Invalid', details: [{ message: 'Choose a date' }] } },
        'Fallback',
      ),
    ).toBe('Invalid Choose a date');
    expect(responseError(null, 'Fallback')).toBe('Fallback');
  });
});
describe('row cardinality', () => {
  it('distinguishes absence, required rows and invalid duplicate results', () => {
    expect(optionalRow([])).toBeUndefined();
    expect(requiredRow([{ id }])).toEqual({ id });
    const error = new AppError('not_found', 'Missing', 404);
    expect(() => requiredRow([], error)).toThrow(error);
    expect(() => optionalRow([{ id }, { id }])).toThrowError(
      expect.objectContaining({ code: 'unexpected_rows', status: 500 }),
    );
  });
});
