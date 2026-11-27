import type { RacePoint } from '@athlete-panel/contracts';

export function groundDistance(
  a: Pick<RacePoint, 'latitude' | 'longitude'>,
  b: Pick<RacePoint, 'latitude' | 'longitude'>,
) {
  const rad = Math.PI / 180;
  const q =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, q)), Math.sqrt(Math.max(0, 1 - q)));
}
function interpolate(a: RacePoint, b: RacePoint, distance: number): RacePoint {
  const fraction = (distance - a.distanceMeters) / (b.distanceMeters - a.distanceMeters);
  const delta = ((b.longitude - a.longitude + 540) % 360) - 180;
  return {
    distanceMeters: distance,
    latitude: a.latitude + (b.latitude - a.latitude) * fraction,
    longitude: ((a.longitude + delta * fraction + 540) % 360) - 180,
    elevationMeters:
      a.elevationMeters === null || b.elevationMeters === null
        ? null
        : a.elevationMeters + (b.elevationMeters - a.elevationMeters) * fraction,
    slopePercent: null,
    segment: a.segment,
  };
}
function resample(points: RacePoint[]) {
  const output: RacePoint[] = [];
  let target = 0;
  points.forEach((p, i) => {
    const previous = points[i - 1];
    if (!previous || previous.segment !== p.segment) {
      output.push({ ...p });
      target = p.distanceMeters + 25;
      return;
    }
    while (target < p.distanceMeters) {
      output.push(interpolate(previous, p, target));
      target += 25;
    }
    if (i === points.length - 1 || points[i + 1]?.segment !== p.segment) output.push({ ...p });
  });
  return output;
}
function smooth(points: RacePoint[]): RacePoint[] {
  return points.map((p, i) => {
    if (p.elevationMeters === null) return p;
    const window = points
      .slice(Math.max(0, i - 2), i + 3)
      .filter((q) => q.segment === p.segment && q.elevationMeters !== null);
    const values = window.map((q) => q.elevationMeters!).sort((a, b) => a - b);
    // Distance-resampled median removes isolated GPS spikes without accumulating stationary jitter.
    const elevationMeters =
      i === 0 ||
      i === points.length - 1 ||
      points[i - 1]?.segment !== p.segment ||
      points[i + 1]?.segment !== p.segment
        ? p.elevationMeters
        : values[Math.floor(values.length / 2)]!;
    return { ...p, elevationMeters };
  });
}
export function smoothTrackElevation(points: RacePoint[]): RacePoint[] {
  return smooth(resample(points));
}
