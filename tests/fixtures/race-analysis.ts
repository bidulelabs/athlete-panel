import type { TrainingEvent } from '@athlete-panel/contracts';

export const courseRaceId = '11300000-0000-4000-8000-000000000001';
export function courseRace(): TrainingEvent {
  return {
    id: courseRaceId,
    revision: 1,
    kind: 'race',
    title: 'Alpine Trail 42',
    date: '2027-08-29',
    notes: 'Synthetic trail race for course-analysis verification.',
  };
}
export function syntheticGpx(
  options: {
    km?: number;
    ascent?: number;
    seconds?: number;
    count?: number;
    elevation?: 'full' | 'partial' | 'none';
    namespace?: boolean;
    salt?: string;
  } = {},
) {
  const {
    km = 42,
    ascent = 2324,
    seconds,
    count = 841,
    elevation = 'full',
    namespace = false,
    salt = '',
  } = options;
  const radius = (km * 1000) / (2 * Math.PI * 111195);
  const prefix = namespace ? 'g:' : '';
  const points = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1),
      angle = 2 * Math.PI * t;
    const lat = 45 + radius * Math.cos(angle),
      lon = 6 + (radius * Math.sin(angle)) / Math.cos((45 * Math.PI) / 180);
    const ele = 900 + (ascent / 4) * (1 - Math.cos(4 * Math.PI * t));
    const height =
      elevation === 'none' || (elevation === 'partial' && i === Math.floor(count / 2))
        ? ''
        : `<${prefix}ele>${ele.toFixed(2)}</${prefix}ele>`;
    const time = seconds
      ? `<${prefix}time>${new Date(Date.UTC(2027, 5, 1, 7) + seconds * 1000 * t).toISOString()}</${prefix}time>`
      : '';
    return `<${prefix}trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">${height}${time}</${prefix}trkpt>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><${prefix}gpx version="1.1" creator="synthetic" ${namespace ? 'xmlns:g' : 'xmlns'}="http://www.topografix.com/GPX/1/1"><${prefix}metadata><${prefix}name>Synthetic ${salt}</${prefix}name></${prefix}metadata><${prefix}trk><${prefix}trkseg>${points}</${prefix}trkseg></${prefix}trk></${prefix}gpx>`;
}
export const courseReferences = [
  { title: 'Crêtes du Lac', km: 36, ascent: 1850, seconds: 5 * 3600 + 12 * 60 },
  { title: 'Boucle des Sapins', km: 28, ascent: 1320, seconds: 3 * 3600 + 46 * 60 },
  { title: 'Trail des Roches', km: 44, ascent: 2410, seconds: 6 * 3600 + 58 * 60 },
  { title: 'Traversée du Plateau', km: 32, ascent: 1420, seconds: 4 * 3600 + 24 * 60 },
];
