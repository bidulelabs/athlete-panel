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
function redactPrescription(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPrescription);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'notes' && key !== 'instructions')
      .map(([key, child]) => [key, redactPrescription(child)]),
  );
}
export function sanitizeHistoryRecord(r: HistoryRecord, scope: HistoryScope): HistoryRecord {
  if (r.category !== 'workouts') {
    if (scope.includeNotes) return r;
    switch (r.category) {
      case 'plans':
        return { ...r, data: { ...r.data, description: undefined } };
      case 'notes':
        return { ...r, data: { ...r.data, body: undefined } };
      case 'events':
        return { ...r, data: { ...r.data, notes: undefined } };
      case 'injuries':
        return { ...r, data: { ...r.data, notes: undefined } };
      default:
        return r;
    }
  }
  const data = { ...r.data };
  const within = (date: string | null | undefined) =>
    Boolean(date && date >= scope.from && date <= scope.to);
  if (!scope.includeNotes) {
    delete data.notes;
    delete data.reason;
    delete data.completionNotes;
    if (data.part) data.part = redactPrescription(data.part) as Record<string, unknown>;
  }
  if (!within(data.scheduledDate)) {
    delete data.scheduledDate;
    delete data.durationSeconds;
    delete data.distanceMeters;
    delete data.elevationMeters;
  }
  const completionOutsideScope = Boolean(data.completionStatus && !within(data.performedDate));
  if (!within(data.performedDate)) {
    delete data.performedDate;
    delete data.completionStatus;
    delete data.completionSource;
    delete data.activityId;
    delete data.actualDurationSeconds;
    delete data.actualDistanceMeters;
    delete data.rpe;
    delete data.reason;
    delete data.completionNotes;
  }
  if (completionOutsideScope) data.completionStatus = 'unknown';
  if (data.completionSource === 'garmin' && !scope.categories.includes('activities')) {
    delete data.activityId;
    delete data.actualDurationSeconds;
    delete data.actualDistanceMeters;
  }
  return { ...r, data };
}
