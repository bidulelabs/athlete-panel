import { targetRangeLabel, type MetricTotal, type TargetRange } from '../training/public/shared';

const formatHours = (seconds: number) => String(Number((seconds / 3600).toFixed(1)));
const hasHours = (metric: MetricTotal) => metric.missingCount > 0 || (metric.value ?? 0) > 0;
export const hoursLabel = (metric: MetricTotal) =>
  metric.knownCount === 0 || metric.value === null ? '—' : `${formatHours(metric.value)} h`;

export const targetAndPlannedParts = (planned: MetricTotal, target: TargetRange | null) =>
  [
    target && `Target ${targetRangeLabel(target, formatHours)} h`,
    hasHours(planned) && `Planned ${hoursLabel(planned)}`,
  ].filter((part): part is string => Boolean(part));

export function weekHoursLabel(
  planned: MetricTotal,
  recorded: MetricTotal,
  target: TargetRange | null,
) {
  const parts = targetAndPlannedParts(planned, target);
  if (hasHours(recorded)) parts.push(`Recorded ${hoursLabel(recorded)}`);
  return parts.join(' · ') || 'No plan';
}
