import type { CourseSection, RacePoint, TrackAnalysis } from '@athlete-panel/contracts';
import { assert } from '../../packages/host/src/errors';
import type { ParsedTrack, SourcePoint } from './parse';

export function groundDistance(
  a: Pick<SourcePoint, 'latitude' | 'longitude'>,
  b: Pick<SourcePoint, 'latitude' | 'longitude'>,
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
function sections(points: RacePoint[], distance: number, complete: boolean): CourseSection[] {
  const count = Math.max(1, Math.ceil(distance / 5000));
  const output = Array.from({ length: count }, (_, index) => ({
    index,
    fromMeters: index * 5000,
    toMeters: Math.min(distance, (index + 1) * 5000),
    ascentMeters: complete ? 0 : null,
    descentMeters: complete ? 0 : null,
  }));
  if (!complete) return output;
  points.forEach((p, i) => {
    const a = points[i - 1];
    if (!a || a.segment !== p.segment || p.distanceMeters <= a.distanceMeters) return;
    const delta = p.elevationMeters! - a.elevationMeters!;
    for (
      let s = Math.min(count - 1, Math.floor(a.distanceMeters / 5000));
      s < count && output[s]!.fromMeters < p.distanceMeters;
      s++
    ) {
      const section = output[s]!;
      const overlap = Math.max(
        0,
        Math.min(section.toMeters, p.distanceMeters) -
          Math.max(section.fromMeters, a.distanceMeters),
      );
      const share = overlap / (p.distanceMeters - a.distanceMeters);
      section.ascentMeters! += Math.max(0, delta) * share;
      section.descentMeters! += Math.max(0, -delta) * share;
    }
  });
  return output;
}
export function analyzeTrack(track: ParsedTrack): TrackAnalysis {
  let distance = 0,
    rawAscent = 0,
    hasGaps = false;
  const points: RacePoint[] = [];
  track.points.forEach((p, i) => {
    const a = track.points[i - 1];
    if (a) {
      const step = groundDistance(a, p);
      if (a.segment !== p.segment) {
        if (step > 1) hasGaps = true;
      } else {
        distance += step;
        if (step > 5000) hasGaps = true;
        if (p.elevation !== null && a.elevation !== null)
          rawAscent += Math.max(0, p.elevation - a.elevation);
      }
    }
    points.push({
      latitude: p.latitude,
      longitude: p.longitude,
      elevationMeters: p.elevation,
      distanceMeters: distance,
      slopePercent: null,
      segment: p.segment,
    });
  });
  assert(
    distance >= 100,
    'short_track',
    'The track is shorter than 100 m. Choose the complete course or effort.',
  );
  assert(
    distance <= 1000000,
    'long_track',
    'Tracks longer than 1,000 km are not supported. Check for GPS jumps.',
  );
  const coverage = track.points.filter((p) => p.elevation !== null).length / track.points.length;
  const sampled = smooth(resample(points));
  sampled.forEach((p, i) => {
    const a = sampled[Math.max(0, i - 1)],
      b = sampled[Math.min(sampled.length - 1, i + 1)];
    if (
      a &&
      b &&
      a.segment === b.segment &&
      a.elevationMeters !== null &&
      b.elevationMeters !== null &&
      p.elevationMeters !== null &&
      b.distanceMeters > a.distanceMeters
    )
      p.slopePercent =
        (100 * (b.elevationMeters - a.elevationMeters)) / (b.distanceMeters - a.distanceMeters);
  });
  const sectionValues = sections(sampled, distance, coverage === 1);
  const stride = Math.max(1, Math.ceil(sampled.length / 1700));
  const display = sampled.filter(
    (p, i) =>
      i % stride === 0 ||
      i === sampled.length - 1 ||
      sampled[i - 1]?.segment !== p.segment ||
      sampled[i + 1]?.segment !== p.segment,
  );
  const warnings: string[] = [];
  if (coverage < 1)
    warnings.push(
      coverage === 0
        ? 'This file has no elevation. The route is available, but climbing, slope and a personal estimate need elevation data.'
        : 'Some elevation points are missing. Climbing and the finish estimate are unavailable; missing height is not treated as flat terrain.',
    );
  if (hasGaps)
    warnings.push(
      'This track contains disconnected segments or a GPS jump over 5 km. The distance may be incomplete; use a continuous export before relying on an estimate.',
    );
  return {
    distanceMeters: distance,
    ascentMeters:
      coverage === 1 ? sectionValues.reduce((sum, s) => sum + s.ascentMeters!, 0) : null,
    descentMeters:
      coverage === 1 ? sectionValues.reduce((sum, s) => sum + s.descentMeters!, 0) : null,
    rawAscentMeters: coverage === 1 ? rawAscent : null,
    elevationCoverage: coverage,
    elapsedSeconds: track.elapsedSeconds,
    pointCount: track.points.length,
    hasGaps,
    warnings,
    points: display,
    sections: sectionValues,
  };
}
