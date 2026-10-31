import type { HistoryScope, HistoryQuery, HistoryRecord } from '@athlete-panel/contracts';
const permissions: Record<string, HistoryScope['categories'][number]> = {
  activities: 'activities',
  health: 'health',
  workouts: 'training',
  plans: 'training',
  notes: 'training',
  events: 'context',
  injuries: 'context',
};
export function historicalCategories(scope: HistoryScope) {
  return Object.keys(permissions).filter(
    (k) => scope.categories.includes(permissions[k]!) && (k !== 'notes' || scope.includeNotes),
  ) as NonNullable<HistoryQuery['category']>[];
}
export function sanitizeHistoryRecord(r: HistoryRecord, scope: HistoryScope) {
  const data = { ...r.data },
    within = (d: string | null | undefined) => Boolean(d && d >= scope.from && d <= scope.to);
  if (!scope.includeNotes) {
    for (const field of ['notes', 'body', 'reason', 'completionNotes'])
      delete data[field as keyof typeof data];
    if (r.category === 'plans') delete data.description;
    if (data.part) {
      const redact = (v: unknown): unknown =>
        Array.isArray(v)
          ? v.map(redact)
          : v && typeof v === 'object'
            ? Object.fromEntries(
                Object.entries(v)
                  .filter(([k]) => k !== 'notes' && k !== 'instructions')
                  .map(([k, x]) => [k, redact(x)]),
              )
            : v;
      data.part = redact(data.part) as Record<string, unknown>;
    }
  }
  if (r.category === 'workouts') {
    if (!within(data.scheduledDate)) {
      delete data.scheduledDate;
      delete data.durationSeconds;
      delete data.distanceMeters;
      delete data.elevationMeters;
    }
    const completionOutsideScope = Boolean(data.completionStatus && !within(data.performedDate));
    if (!within(data.performedDate))
      for (const field of [
        'performedDate',
        'completionStatus',
        'completionSource',
        'activityId',
        'actualDurationSeconds',
        'actualDistanceMeters',
        'rpe',
        'reason',
        'completionNotes',
      ])
        delete data[field as keyof typeof data];
    if (completionOutsideScope) data.completionStatus = 'unknown';
    if (data.completionSource === 'garmin' && !scope.categories.includes('activities'))
      for (const field of ['activityId', 'actualDurationSeconds', 'actualDistanceMeters'])
        delete data[field as keyof typeof data];
  }
  return { ...r, data };
}
