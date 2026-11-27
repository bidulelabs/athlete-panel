import { raceFileLimit, racePointLimit, type RacePoint } from '@athlete-panel/contracts';
import { z } from 'zod';
import { groundDistance, smoothTrackElevation } from '../activity-records/public/shared';
import { appleTimestamp } from './protocol';

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  alt: z.unknown().optional(),
  t: appleTimestamp,
});
const routeSchema = z.array(pointSchema).min(2).max(racePointLimit);
const altitude = z.number().min(-12000).max(100000);
type TrackPoint = RacePoint & { timestamp: string };

function trackPoints(input: z.infer<typeof routeSchema>): TrackPoint[] {
  const ordered = input
    .map((point) => ({
      latitude: point.lat,
      longitude: point.lon,
      elevationMeters: altitude.safeParse(point.alt).data ?? null,
      timestamp: new Date(point.t).toISOString(),
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  let distanceMeters = 0;
  let segment = 0;
  return ordered.map((point, index) => {
    const previous = ordered[index - 1];
    if (previous) {
      const step = groundDistance(previous, point);
      if (step > 5000) segment++;
      else distanceMeters += step;
    }
    return { ...point, distanceMeters, segment, slopePercent: null };
  });
}

function estimateClimbing(points: TrackPoint[]): number | null {
  const last = points.at(-1);
  if (
    !last ||
    last.segment ||
    last.distanceMeters < 100 ||
    last.distanceMeters > 1000000 ||
    points.some((point) => point.elevationMeters === null)
  )
    return null;
  const smooth = smoothTrackElevation(points);
  return smooth.reduce((gain, point, index) => {
    const previous = smooth[index - 1];
    return previous && point.distanceMeters > previous.distanceMeters
      ? gain + Math.max(0, point.elevationMeters! - previous.elevationMeters!)
      : gain;
  }, 0);
}

function toGpx(points: TrackPoint[]) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Athlete Panel" xmlns="http://www.topografix.com/GPX/1/1"><trk>',
  ];
  let segment = -1;
  for (const point of points) {
    if (segment !== point.segment) {
      if (segment !== -1) lines.push('</trkseg>');
      lines.push('<trkseg>');
      segment = point.segment;
    }
    const elevation =
      point.elevationMeters === null ? '' : `<ele>${point.elevationMeters.toFixed(3)}</ele>`;
    lines.push(
      `<trkpt lat="${point.latitude.toFixed(8)}" lon="${point.longitude.toFixed(8)}">${elevation}<time>${point.timestamp}</time></trkpt>`,
    );
  }
  lines.push('</trkseg></trk></gpx>');
  return lines.join('');
}

export function appleRoute(input: unknown) {
  const parsed = routeSchema.safeParse(input);
  if (!parsed.success) return null;
  const points = trackPoints(parsed.data);
  if (points.at(-1)!.segment >= 100) return null;
  const gpx = toGpx(points);
  if (Buffer.byteLength(gpx) > raceFileLimit) return null;
  return { gpx, estimatedElevationMeters: estimateClimbing(points) };
}
