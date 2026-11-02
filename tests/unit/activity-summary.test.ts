import { describe, expect, it } from 'vitest';
import { activityMetricSummary } from '../../plugins/activity-records/summary';
import { validateRecords } from '../../plugins/garmin/record-validation';

describe('activity summary coverage', () => {
  it('keeps Garmin activities with missing measurements and marks their sum as partial', () => {
    const rows = [{ activityId: 7501, duration: 5400, distance: 42000 }, { activityId: 7502 }].map(
      (record) => ({
        ownerId: 555,
        activityName: 'Synthetic ride',
        activityType: { typeKey: 'cycling', typeId: 2 },
        startTimeGMT: '2026-11-02 09:00:00',
        startTimeLocal: '2026-11-02 10:00:00',
        ...record,
      }),
    );
    const result = validateRecords(
      rows,
      { stream: 'activities', from: '2026-11-02', to: '2026-11-02', pageOffset: 0 },
      'Europe/Paris',
    );
    expect(result.rejectedRecords).toBe(0);
    expect(result.activities).toHaveLength(2);
    expect(activityMetricSummary(result.activities, 'durationSeconds')).toEqual({
      value: 5400,
      knownCount: 1,
      missingCount: 1,
    });
    expect(activityMetricSummary(result.activities, 'distanceMeters')).toEqual({
      value: 42000,
      knownCount: 1,
      missingCount: 1,
    });
  });

  it('counts known zero and calculates each metric independently', () => {
    const records = [
      { durationSeconds: 5400, distanceMeters: null },
      { durationSeconds: 0, distanceMeters: null },
      { durationSeconds: null, distanceMeters: 0 },
    ];
    expect(activityMetricSummary(records, 'durationSeconds')).toEqual({
      value: 5400,
      knownCount: 2,
      missingCount: 1,
    });
    expect(activityMetricSummary(records, 'distanceMeters')).toEqual({
      value: 0,
      knownCount: 1,
      missingCount: 2,
    });
  });

  it('distinguishes empty, all unknown and fully measured selections', () => {
    expect(activityMetricSummary([], 'durationSeconds')).toEqual({
      value: null,
      knownCount: 0,
      missingCount: 0,
    });
    expect(
      activityMetricSummary([{ durationSeconds: null, distanceMeters: null }], 'durationSeconds'),
    ).toEqual({ value: null, knownCount: 0, missingCount: 1 });
    expect(
      activityMetricSummary(
        [
          { durationSeconds: 5400, distanceMeters: 42000 },
          { durationSeconds: 0, distanceMeters: 0 },
        ],
        'durationSeconds',
      ),
    ).toEqual({ value: 5400, knownCount: 2, missingCount: 0 });
  });
});
