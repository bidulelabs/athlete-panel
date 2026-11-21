import type { RacePoint } from '@athlete-panel/contracts';
import { elevation } from '@athlete-panel/ui';

export const terrainNames = ['Smooth', 'Stony', 'Mountain', 'Rocky', 'Scrambling'];
export const slopeBands = [
  { key: 'down-steep', name: 'Steep downhill', range: 'below −10%' },
  { key: 'down', name: 'Downhill', range: '−10 to −3%' },
  { key: 'flat', name: 'Flat', range: '−3 to 3%' },
  { key: 'up', name: 'Uphill', range: '3 to 10%' },
  { key: 'up-steep', name: 'Steep uphill', range: 'above 10%' },
];
export function slopeColor(slope: number | null) {
  const key =
    slope === null
      ? 'unknown'
      : slope < -10
        ? 'down-steep'
        : slope < -3
          ? 'down'
          : slope <= 3
            ? 'flat'
            : slope <= 10
              ? 'up'
              : 'up-steep';
  return `var(--race-${key})`;
}
export function finishTime(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return 'Not available';
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
export const elevationLabel = (meters: number | null, units: string) =>
  meters === null ? 'Unknown' : elevation(meters, units);
export function routeCoordinates(points: RacePoint[]) {
  const meanLatitude = points.reduce((n, p) => n + p.latitude, 0) / points.length;
  let longitude = points[0]?.longitude ?? 0;
  const projected = points.map((p, i) => {
    if (i) longitude += ((p.longitude - points[i - 1]!.longitude + 540) % 360) - 180;
    return { x: longitude * Math.cos((meanLatitude * Math.PI) / 180), y: -p.latitude };
  });
  const minX = Math.min(...projected.map((p) => p.x)),
    maxX = Math.max(...projected.map((p) => p.x));
  const minY = Math.min(...projected.map((p) => p.y)),
    maxY = Math.max(...projected.map((p) => p.y));
  const scale = 260 / Math.max(maxX - minX, maxY - minY, 0.000001);
  return projected.map((p) => ({
    x: 160 + (p.x - (minX + maxX) / 2) * scale,
    y: 160 + (p.y - (minY + maxY) / 2) * scale,
  }));
}
export function clockTime(secondsAfterRaceDayMidnight: number) {
  const minutes = Math.round(secondsAfterRaceDayMidnight / 60);
  const days = Math.floor(minutes / 1440);
  const time = `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return days ? `${time} +${days} day${days === 1 ? '' : 's'}` : time;
}
