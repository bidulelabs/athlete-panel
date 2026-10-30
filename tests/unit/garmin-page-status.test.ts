import { describe, expect, it } from 'vitest';
import type { WorkspaceEnvelope } from '@athlete-panel/contracts';
import {
  activitySummary,
  connectionDetail,
  coverageSummary,
  recoverySummary,
  refreshRange,
  refreshState,
  syncTime,
} from '../../plugins/garmin/page-status';

const healthy: WorkspaceEnvelope['garmin'] = {
  connected: true,
  verified: true,
  paused: false,
  lastError: null,
  lastErrorCode: null,
  earliestDate: '2000-01-01',
  lastSync: '2026-10-29T13:52:00.000Z',
  status: 'Connected',
  coverage: [],
  currentJob: {
    id: 'synthetic',
    kind: 'garmin-history',
    status: 'completed',
    progress: 'Import complete',
    nextRunAt: null,
    retrying: false,
  },
  coverageSummary: { windows: 7, failed: 0, complete: 7, empty: 0, unavailable: 0, rejected: 0 },
  recovery: {
    catchup: null,
    reconciliation: null,
    nextReconcileAt: null,
    unscannedWindows: 0,
    retryStreams: [],
  },
};

describe('Garmin page summaries', () => {
  it('keeps a healthy completed import quiet without hiding verification or coverage problems', () => {
    expect(connectionDetail(healthy, true)).toBeNull();
    expect(connectionDetail(healthy, false)).toBeNull();
    expect(connectionDetail({ ...healthy, verified: false }, true)).toContain('Waiting for Garmin');
    for (const metric of ['failed', 'unavailable', 'rejected']) {
      const value = { ...healthy, coverageSummary: { ...healthy.coverageSummary!, [metric]: 1 } };
      expect(connectionDetail(value, true)).toContain('needs attention');
    }
    expect(connectionDetail({ ...healthy, lastErrorCode: 'account_mismatch' }, true)).toContain(
      'another Garmin account',
    );
  });
  it('keeps pause, failure and retry timing distinct from a healthy connection', () => {
    expect(connectionDetail({ ...healthy, paused: true }, true)).toContain('Resume');
    expect(
      connectionDetail(
        { ...healthy, currentJob: { ...healthy.currentJob!, status: 'failed' } },
        true,
      ),
    ).toContain('failed');
    const retry = {
      ...healthy,
      lastErrorCode: 'rate_limited',
      currentJob: {
        ...healthy.currentJob!,
        status: 'queued',
        retrying: true,
        nextRunAt: '2026-10-30T10:00:00.000Z',
      },
    };
    expect(connectionDetail(retry, true)).toContain('Garmin asked us to wait');
    expect(activitySummary(retry)).toContain('Retry scheduled');
    expect(
      connectionDetail({ ...retry, currentJob: { ...retry.currentJob, retrying: false } }, false),
    ).toContain('background worker');
  });
  it('does not sum overlapping coverage counts or infer completeness from empty history', () => {
    expect(
      coverageSummary({ ...healthy, coverageSummary: { ...healthy.coverageSummary!, failed: 2 } }),
    ).toBe('2 failed periods need attention');
    expect(
      coverageSummary({
        ...healthy,
        coverageSummary: { ...healthy.coverageSummary!, failed: 2, rejected: 2 },
      }),
    ).toBe('2 failed periods · 2 windows with rejected records');
    expect(coverageSummary({ ...healthy, coverageSummary: undefined })).toBe(
      'History has not been checked yet',
    );
    expect(coverageSummary(healthy)).toBe('No history errors reported');
  });
  it('distinguishes absent, waiting, queued and failed recovery evidence', () => {
    expect(recoverySummary(healthy)).toBe('No recovery import running');
    expect(recoverySummary({ ...healthy, recovery: undefined })).toBe(
      'Recovery status unavailable',
    );
    expect(
      recoverySummary({ ...healthy, recovery: { ...healthy.recovery!, unscannedWindows: 2101 } }),
    ).toBe('Waiting to check older dates');
    expect(
      recoverySummary({ ...healthy, recovery: { ...healthy.recovery!, retryStreams: ['steps'] } }),
    ).toContain('explicit retry');
    expect(
      recoverySummary({
        ...healthy,
        recovery: {
          ...healthy.recovery!,
          catchup: {
            status: 'queued',
            stream: 'steps',
            from: '2026-09-01',
            to: '2026-09-28',
            nextRunAt: null,
          },
        },
      }),
    ).toBe('Recovery import queued');
  });
  it('uses known successful-sync dates rather than inventing job completion timestamps', () => {
    const now = new Date(2026, 9, 29, 15, 0);
    expect(syncTime(new Date(2026, 9, 29, 14, 52).toISOString(), now)).toBe('today at 14:52');
    expect(syncTime(new Date(2025, 9, 29, 14, 52).toISOString(), now)).toBe(
      'on 29 October 2025 at 14:52',
    );
    expect(activitySummary(healthy)).toMatch(/^Last successful sync /);
    expect(activitySummary({ ...healthy, lastSync: null })).toBe('Import completed');
    expect(
      activitySummary({
        ...healthy,
        lastSync: null,
        currentJob: { ...healthy.currentJob!, status: 'cancelled' },
      }),
    ).toBe('Last import cancelled');
    expect(activitySummary({ ...healthy, lastSync: null, currentJob: null })).toBe(
      'No imports have run yet',
    );
    const range = refreshRange('2025-12-31', '2026-01-02');
    expect(range).toContain('31 December 2025');
    expect(range).toContain('2 January 2026');
  });
  it('does not call queued or reused running work completed', () => {
    expect(refreshState('queued')).toBe('queued');
    expect(refreshState('running')).toBe('in progress');
    expect(refreshState('completed')).toBe('completed');
    expect(refreshState('unrecognized')).toBe('accepted');
  });
});
