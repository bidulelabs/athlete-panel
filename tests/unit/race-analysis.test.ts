import { describe, expect, it } from 'vitest';
import {
  Encoder,
  Profile,
  type FileIdMesg,
  type RecordMesg,
  type SessionMesg,
} from '@garmin/fitsdk';
import { raceFileLimit, raceAnalysisSchema } from '@athlete-panel/contracts';
import { parseTrack } from '../../plugins/race-analysis/parse';
import { analyzeTrack, groundDistance } from '../../plugins/race-analysis/geometry';
import { estimateCourse, type ReferenceFacts } from '../../plugins/race-analysis/estimate';
import { elevationLabel, routeCoordinates } from '../../plugins/race-analysis/presentation';
import { courseReferences, courseRace, syntheticGpx } from '../fixtures/race-analysis';

const file = (text: string, name = 'course.gpx') => ({ name, bytes: Buffer.from(text) });
const analyze = (text: string) => analyzeTrack(parseTrack(file(text), 'course'));
function references(): ReferenceFacts[] {
  return courseReferences.map((ref, i) => ({
    id: `11300000-0000-4000-8000-${String(i + 10).padStart(12, '0')}`,
    assetId: `11300000-0000-4000-8000-${String(i + 20).padStart(12, '0')}`,
    title: ref.title,
    filename: `${i}.gpx`,
    distanceMeters: ref.km * 1000,
    ascentMeters: ref.ascent,
    durationSeconds: ref.seconds,
    durationSource: 'file',
    terrain: 3,
    hasGaps: false,
  }));
}
describe('file validation and factual measurements', () => {
  it('reads namespaced GPX and preserves measured distance, climb and elapsed time', () => {
    const track = analyze(syntheticGpx({ namespace: true, seconds: 23000 }));
    expect(track.distanceMeters).toBeGreaterThan(41900);
    expect(track.distanceMeters).toBeLessThan(42100);
    expect(track.ascentMeters).toBeGreaterThan(2300);
    expect(track.ascentMeters).toBeLessThanOrEqual(track.rawAscentMeters!);
    expect(track.elapsedSeconds).toBe(23000);
    expect(track.points.length).toBeLessThanOrEqual(2000);
    expect(track.sections.reduce((sum, s) => sum + s.ascentMeters!, 0)).toBeCloseTo(
      track.ascentMeters!,
    );
    expect(track.sections.at(-1)!.toMeters).toBe(track.distanceMeters);
  });
  it('does not turn missing elevation or time into zero', () => {
    for (const elevation of ['none', 'partial'] as const) {
      const track = analyze(syntheticGpx({ elevation }));
      expect(track.ascentMeters).toBeNull();
      expect(track.rawAscentMeters).toBeNull();
      expect(track.elapsedSeconds).toBeNull();
      expect(track.warnings.join()).toMatch(/elevation/);
      expect(estimateCourse(track, 3, {}, references()).estimate).toBeNull();
    }
    const flat = analyze(syntheticGpx({ ascent: 0 }));
    expect(flat.ascentMeters).toBe(0);
  });
  it('rejects malformed XML, entities, ambiguous tracks, invalid positions and oversize files', () => {
    for (const text of [
      '<gpx><trk></gpx>',
      '<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx/>',
      '<gpx><trk/><trk/></gpx>',
      '<gpx><trk><trkseg><trkpt lat="91" lon="0"/><trkpt lat="92" lon="0"/></trkseg></trk></gpx>',
      '<gpx>' + '<x>'.repeat(65) + '</x>'.repeat(65) + '</gpx>',
    ])
      expect(() => parseTrack(file(text), 'course')).toThrow();
    expect(() =>
      parseTrack({ name: 'x.gpx', bytes: new Uint8Array(raceFileLimit + 1) }, 'course'),
    ).toThrow(/10 MiB/);
    expect(() => parseTrack(file(syntheticGpx(), 'x.fit'), 'course')).toThrow(/gpx/);
    expect(() => parseTrack(file('<gpx><trk><trkseg/></trk></gpx>'), 'course')).toThrow(/two GPS/);
  });
  it('does not bridge disconnected segments or accept a non-monotonic elapsed time', () => {
    const xml =
      '<gpx><trk><trkseg><trkpt lat="45" lon="6"><ele>100</ele><time>2027-01-01T10:00:00Z</time></trkpt><trkpt lat="45.01" lon="6"><ele>100</ele><time>2027-01-01T09:00:00Z</time></trkpt></trkseg><trkseg><trkpt lat="46" lon="6"><ele>200</ele></trkpt><trkpt lat="46.01" lon="6"><ele>200</ele></trkpt></trkseg></trk></gpx>';
    const track = analyze(xml);
    expect(track.distanceMeters).toBeCloseTo(2223.9, 0);
    expect(track.hasGaps).toBe(true);
    expect(track.ascentMeters).toBe(0);
    expect(track.elapsedSeconds).toBeNull();
  });
  it('smooths isolated elevation spikes and keeps distance independent of display point count', () => {
    const base = syntheticGpx({ count: 20001 });
    const noisy = base.replace('<ele>2062.00</ele>', '<ele>4000</ele>');
    const track = analyze(noisy);
    expect(track.pointCount).toBe(20001);
    expect(track.points.length).toBeLessThanOrEqual(2000);
    expect(track.ascentMeters).toBeLessThan(2400);
    expect(track.distanceMeters).toBeCloseTo(analyze(base).distanceMeters, 5);
  });
  it('shows elevation in metres or feet with thousands separators, and Unknown when missing', () => {
    expect(elevationLabel(1234.4, 'metric')).toBe('1,234 m');
    expect(elevationLabel(1000, 'imperial')).toBe('3,281 ft');
    expect(elevationLabel(null, 'metric')).toBe('Unknown');
  });
  it('handles an antimeridian crossing without drawing a world-spanning route', () => {
    expect(
      groundDistance({ latitude: 0, longitude: 179.99 }, { latitude: 0, longitude: -179.99 }),
    ).toBeLessThan(2300);
    const route = routeCoordinates([
      {
        latitude: 0,
        longitude: 179.99,
        elevationMeters: 0,
        distanceMeters: 0,
        slopePercent: 0,
        segment: 0,
      },
      {
        latitude: 0.01,
        longitude: -179.99,
        elevationMeters: 0,
        distanceMeters: 2300,
        slopePercent: 0,
        segment: 0,
      },
    ]);
    expect(Math.abs(route[1]!.y - route[0]!.y)).toBeGreaterThan(100);
  });
  const twoPoints = (horizontalMeters: number, climbMeters: number) =>
    `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${[
      [45, 1000, '2027-06-01T07:00:00Z'],
      [45 + horizontalMeters / 111195.08, 1000 + climbMeters, '2027-06-01T07:01:40Z'],
      [45 + 1, 1000 + climbMeters, '2027-06-01T08:01:40Z'],
    ]
      .map(
        ([lat, ele, time]) =>
          `<trkpt lat="${lat}" lon="6"><ele>${ele}</ele><time>${time}</time></trkpt>`,
      )
      .join('')}</trkseg></trk></gpx>`;
  it.each([
    ['31 m on the flat', 31, 0, 100],
    ['29 m on the flat', 29, 0, 0],
    ['10 m of GPS drift at an aid station', 10, 0, 0],
    ['5.3 m of climbing in place', 0, 5.28, 100],
    ['4.7 m of climbing in place', 0, 4.72, 0],
    ['4.7 m of descent in place', 0, -4.72, 0],
    ['5.3 m of descent in place', 0, -5.28, 100],
    ['a 60% climb at 400 m an hour', 18.52, 11.11, 100],
    ['a 25% climb at 2 km/h', 54, 13.5, 100],
  ])(
    'counts 100 s covering %s as moving from 0.3 m/s or 180 m an hour',
    (_label, horizontal, climb, counted) => {
      expect(analyze(twoPoints(horizontal, climb)).movingSeconds).toBeCloseTo(3600 + counted, 6);
    },
  );
  const seededNoise = (seed: number) => (amplitude: number) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1) * amplitude;
  };
  const oneHertzGpx = (
    stretches: { seconds: number; northPerSecond: number; upPerSecond: number }[],
    noisy: boolean,
  ) => {
    const noise = seededNoise(42);
    const metersPerDegree = 111195.08;
    let north = 0,
      up = 1000,
      second = 0;
    const point = () =>
      `<trkpt lat="${45 + (north + (noisy ? noise(3) : 0)) / metersPerDegree}" lon="${6 + (noisy ? noise(3) : 0) / (metersPerDegree * Math.cos(Math.PI / 4))}"><ele>${up + (noisy ? noise(0.3) : 0)}</ele><time>${new Date(Date.UTC(2027, 5, 1, 7) + second * 1000).toISOString()}</time></trkpt>`;
    const points = [point()];
    for (const { seconds, northPerSecond, upPerSecond } of stretches)
      for (let i = 0; i < seconds; i++) {
        north += northPerSecond;
        up += upPerSecond;
        second++;
        points.push(point());
      }
    return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points.join('')}</trkseg></trk></gpx>`;
  };
  it('counts a 10 min stop recorded every second with GPS and barometer noise as a pause', () => {
    const walk = { seconds: 300, northPerSecond: 1, upPerSecond: 0 };
    const stop = { seconds: 600, northPerSecond: 0, upPerSecond: 0 };
    expect(analyze(oneHertzGpx([walk, stop, walk], true)).movingSeconds).toBe(600);
  });
  it.each([
    [
      'a 60% climb at 400 m an hour with GPS and barometer noise',
      { northPerSecond: 400 / 3600 / 0.6, upPerSecond: 400 / 3600 },
      true,
    ],
    ['a flat walk at 1.1 km/h', { northPerSecond: 1.1 / 3.6, upPerSecond: 0 }, false],
  ])('counts %s recorded every second as moving', (_label, pace, noisy) => {
    expect(analyze(oneHertzGpx([{ seconds: 600, ...pace }], noisy)).movingSeconds).toBe(600);
  });
  it('leaves a pause out of the moving time and keeps it in the elapsed time', () => {
    const track = analyze(syntheticGpx({ km: 8, ascent: 400, seconds: 3000, pauseSeconds: 1800 }));
    expect(track.elapsedSeconds).toBe(4800);
    expect(track.movingSeconds).toBeCloseTo(3000, 6);
  });
  it('decodes a CRC-checked synthetic FIT reference, including elapsed rather than timer time', () => {
    const encoder = new Encoder();
    const identity: FileIdMesg = {
      type: 'activity',
      manufacturer: 'development',
      product: 1,
      timeCreated: new Date('2027-06-01T07:00:00Z'),
    };
    encoder.onMesg(Profile.MesgNum.FILE_ID, identity);
    for (let i = 0; i < 30; i++) {
      const record: RecordMesg = {
        positionLat: Math.round(((45 + i * 0.001) * 2 ** 31) / 180),
        positionLong: Math.round((6 * 2 ** 31) / 180),
        altitude: 900 + i * 10,
        timestamp: new Date(Date.UTC(2027, 5, 1, 7) + i * 60000),
      };
      encoder.onMesg(Profile.MesgNum.RECORD, record);
    }
    const session: SessionMesg = { totalElapsedTime: 2000, totalTimerTime: 1800 };
    encoder.onMesg(Profile.MesgNum.SESSION, session);
    const bytes = encoder.close();
    const parsed = parseTrack({ name: 'effort.fit', bytes }, 'reference');
    expect(parsed.elapsedSeconds).toBe(2000);
    expect(analyzeTrack(parsed).movingSeconds).toBe(1740);
    expect(analyzeTrack(parsed).distanceMeters).toBeGreaterThan(3000);
    const broken = Uint8Array.from(bytes);
    broken[30] = broken[30]! ^ 255;
    expect(() => parseTrack({ name: 'broken.fit', bytes: broken }, 'reference')).toThrow();
  });
});
describe('personal estimate and honest uncertainty', () => {
  const track = analyze(syntheticGpx());
  it('requires three usable references and never fits unknown times', () => {
    const two = references().slice(0, 2);
    const unknown = { ...references()[2]!, durationSeconds: null };
    const result = estimateCourse(track, 3, {}, [...two, unknown]);
    expect(result.estimate).toBeNull();
    expect(result.estimateReasons.join()).toContain('1 more usable past effort');
  });
  it('adds sections exactly to elapsed time and previews terrain monotonically', () => {
    const lower = estimateCourse(track, 2, {}, references()).estimate!;
    const upper = estimateCourse(track, 3, { '0': 5 }, references()).estimate!;
    expect(upper.seconds).toBeGreaterThan(lower.seconds);
    expect(upper.sectionSeconds.reduce((sum, value) => sum + value, 0)).toBeCloseTo(upper.seconds);
    expect(upper.lowSeconds).toBeLessThan(upper.seconds);
    expect(upper.highSeconds).toBeGreaterThan(upper.seconds);
    expect(upper.explanations.join()).toContain('not a calibrated confidence interval');
    expect(
      raceAnalysisSchema.safeParse({
        race: courseRace(),
        revision: 1,
        course: null,
        terrain: 3,
        sectionTerrain: {},
        ...estimateCourse(track, 3, {}, references()),
      }).success,
    ).toBe(true);
  });
  it('holds each effort out of its own comparison', () => {
    const original = references();
    const first = estimateCourse(track, 3, {}, original).references[0]!;
    original[0]!.durationSeconds! *= 2;
    const changed = estimateCourse(track, 3, {}, original).references[0]!;
    expect(first.predictedSeconds).not.toBeNull();
    expect(changed.predictedSeconds).toBe(first.predictedSeconds);
    expect(
      estimateCourse(track, 3, {}, original.slice(0, 3)).references.every(
        (r) => r.predictedSeconds === null,
      ),
    ).toBe(true);
  });
});
