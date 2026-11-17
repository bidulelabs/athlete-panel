import { describe, expect, it } from 'vitest';
import {
  Encoder,
  Profile,
  type FileIdMesg,
  type RecordMesg,
  type SessionMesg,
} from '@garmin/fitsdk';
import { raceFileLimit, raceAnalysisSchema, type ReferenceEffort } from '@athlete-panel/contracts';
import { parseTrack } from '../../plugins/race-analysis/parse';
import { analyzeTrack, groundDistance } from '../../plugins/race-analysis/geometry';
import { estimateCourse } from '../../plugins/race-analysis/estimate';
import { routeCoordinates } from '../../plugins/race-analysis/presentation';
import { courseReferences, courseRace, syntheticGpx } from '../fixtures/race-analysis';

const file = (text: string, name = 'course.gpx') => ({ name, bytes: Buffer.from(text) });
const analyze = (text: string) => analyzeTrack(parseTrack(file(text), 'course'));
function references(): ReferenceEffort[] {
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
    predictedSeconds: null,
    comparison: 'unavailable',
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
    expect(first.comparison).toBe('held-out');
    expect(changed.predictedSeconds).toBe(first.predictedSeconds);
    expect(
      estimateCourse(track, 3, {}, original.slice(0, 3)).references.every(
        (r) => r.predictedSeconds === null,
      ),
    ).toBe(true);
  });
});
