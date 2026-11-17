import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { Encoder, Profile, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';
import type { TrackAnalysis } from '@athlete-panel/contracts';
import { parseTrack } from '../../plugins/race-analysis/parse';
import { analyzeTrack } from '../../plugins/race-analysis/geometry';
import { estimateCourse, type ReferenceFacts } from '../../plugins/race-analysis/estimate';

const gpx = (text: string) => ({ name: 'synthetic.gpx', bytes: Buffer.from(text) });
const points = (content = '') =>
  `<gpx><trk><trkseg><trkpt lat="45" lon="6">${content}</trkpt><trkpt lat="45.01" lon="6"><ele>0</ele></trkpt></trkseg></trk></gpx>`;

it('bounds malicious XML and long scalar work in a killable process', () => {
  // A regression must fail rather than block the Vitest worker's event loop for minutes.
  const result = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { parseTrack } from './plugins/race-analysis/parse.ts';
    const file = text => ({ name: 'synthetic.gpx', bytes: Buffer.from(text) });
    for (const text of ['<gpx>' + '<!--'.repeat(40000), '<gpx>' + '<![CDATA['.repeat(40000)]) {
      assert.throws(() => parseTrack(file(text), 'course'), e => e.code === 'invalid_gpx');
    }
    const wrap = value => '<gpx><trk><trkseg><trkpt lat="45" lon="6">' + value + '</trkpt><trkpt lat="45.01" lon="6"/></trkseg></trk></gpx>';
    assert.throws(() => parseTrack(file(wrap('<ele>' + '9'.repeat(40000) + 'x</ele>')), 'course'), e => e.code === 'invalid_elevation');
    const time = parseTrack(file(wrap('<time>' + 'T'.repeat(40000) + '</time>')), 'course');
    assert.equal(time.points[0].time, null);
    console.log('bounded');
  `,
    ],
    { encoding: 'utf8', timeout: 5000 },
  );
  expect(result.trim()).toBe('bounded');
});

it('counts XML elements without mistaking quoted text, comments or CDATA for nesting', () => {
  const text = points('<ele>100</ele>').replace(
    '<gpx>',
    '<gpx label=" > / > "><!-- <fake> --><![CDATA[<fake>]]>',
  );
  expect(parseTrack(gpx(text), 'course').points).toHaveLength(2);
  expect(() =>
    parseTrack(gpx('<gpx>' + '<x>'.repeat(65) + '</x>'.repeat(65) + '</gpx>'), 'course'),
  ).toThrow(expect.objectContaining({ code: 'xml_depth' }));
});

it.each(['-501', '9001', 'not-a-height'])('rejects invalid elevation %s', (value) => {
  expect(() => parseTrack(gpx(points(`<ele>${value}</ele>`)), 'course')).toThrow(
    expect.objectContaining({ code: 'invalid_elevation' }),
  );
});

it('rejects too many GPX points and tracks shorter than 100 metres', () => {
  const text =
    '<gpx><trk><trkseg>' + '<trkpt lat="45" lon="6"/>'.repeat(100001) + '</trkseg></trk></gpx>';
  expect(() => parseTrack(gpx(text), 'course')).toThrow(
    expect.objectContaining({ code: 'too_many_points' }),
  );
  expect(() =>
    analyzeTrack(parseTrack(gpx(points().replace('45.01', '45.00001')), 'course')),
  ).toThrow(expect.objectContaining({ code: 'short_track' }));
});

it('distinguishes multisport, missing GPS and FIT record-limit errors', () => {
  const multi = new Encoder();
  const firstSession: SessionMesg = { totalElapsedTime: 600 };
  const secondSession: SessionMesg = { totalElapsedTime: 700 };
  multi.onMesg(Profile.MesgNum.SESSION, firstSession);
  multi.onMesg(Profile.MesgNum.SESSION, secondSession);
  expect(() => parseTrack({ name: 'multi.fit', bytes: multi.close() }, 'reference')).toThrow(
    expect.objectContaining({ code: 'multiple_efforts' }),
  );
  const indoor = new Encoder();
  const record: RecordMesg = { altitude: 100 };
  indoor.onMesg(Profile.MesgNum.RECORD, record);
  expect(() => parseTrack({ name: 'indoor.fit', bytes: indoor.close() }, 'reference')).toThrow(
    expect.objectContaining({ code: 'fit_without_route' }),
  );
  const huge = new Encoder();
  for (let i = 0; i < 300001; i++) huge.onMesg(Profile.MesgNum.RECORD, record);
  expect(() => parseTrack({ name: 'huge.fit', bytes: huge.close() }, 'reference')).toThrow(
    expect.objectContaining({ code: 'too_many_records' }),
  );
});

function references(): ReferenceFacts[] {
  return [18, 20, 22, 24].map((km, i) => ({
    id: String(i),
    assetId: String(i),
    title: `Synthetic ${i}`,
    filename: `${i}.gpx`,
    distanceMeters: km * 1000,
    ascentMeters: km * (10 + i * 10),
    durationSeconds: km * 360 + km * (10 + i * 10) * 0.6,
    durationSource: 'owner',
    terrain: 1,
    hasGaps: false,
  }));
}
function track(km = 20, ascent = 400): TrackAnalysis {
  const measured = analyzeTrack(parseTrack(gpx(points('<ele>0</ele>')), 'course'));
  return {
    ...measured,
    distanceMeters: km * 1000,
    ascentMeters: ascent,
    sections: [
      { ...measured.sections[0]!, fromMeters: 0, toMeters: km * 1000, ascentMeters: ascent },
    ],
  };
}
const margin = (estimate: NonNullable<ReturnType<typeof estimateCourse>['estimate']>) =>
  estimate.highSeconds / estimate.seconds - 1;

it('excludes a minutes/hours typo without distorting the remaining references', () => {
  const good = references();
  const typo = { ...good[0]!, id: 'typo', distanceMeters: 36000, durationSeconds: 5.2 * 60 };
  const baseline = estimateCourse(track(), 1, {}, good).estimate!;
  const result = estimateCourse(track(), 1, {}, [...good, typo]);
  expect(result.estimate).toEqual(baseline);
  expect(result.references.at(-1)?.predictedSeconds).toBeNull();
});

it('caps short effort influence on the fit', () => {
  const good = references();
  const short = {
    ...good[0]!,
    id: 'short',
    distanceMeters: 100,
    ascentMeters: 0,
    durationSeconds: 12,
  };
  const baseline = estimateCourse(track(), 1, {}, good).estimate!;
  const result = estimateCourse(track(), 1, {}, [...good, short]).estimate!;
  expect(Math.abs(result.seconds / baseline.seconds - 1)).toBeLessThan(0.01);
});

it('widens sparse and limited-climbing evidence and explains the climbing fallback', () => {
  const good = references();
  expect(margin(estimateCourse(track(), 1, {}, good).estimate!)).toBeCloseTo(0.15);
  const sparse = estimateCourse(track(), 1, {}, good.slice(0, 3)).estimate!;
  expect(margin(sparse)).toBeCloseTo(0.25);
  expect(sparse.explanations.join()).toContain('Add a fourth');
  const same = good.map((ref) => ({
    ...ref,
    ascentMeters: ref.distanceMeters * 0.02,
    durationSeconds: ref.distanceMeters * 0.372,
  }));
  const limited = estimateCourse(track(), 1, {}, same).estimate!;
  expect(limited.climbSecondsPer100m).toBe(60);
  expect(margin(limited)).toBeCloseTo(0.2);
  expect(limited.explanations.join()).toContain('cannot isolate climbing cost');
});

it.each([
  [track(40, 800), 1, 'distance'],
  [track(20, 1400), 1, 'climbing per kilometre'],
  [track(28.5, 1140), 5, 'elapsed time'],
] as const)(
  'widens and names extrapolation beyond reference evidence (%s)',
  (course, terrain, reason) => {
    const estimate = estimateCourse(course, terrain, {}, references()).estimate!;
    expect(margin(estimate)).toBeGreaterThanOrEqual(0.249);
    expect(
      estimate.explanations.some(
        (message) => message.includes('outside the reference range') && message.includes(reason),
      ),
    ).toBe(true);
  },
);

it('withholds predictions beyond 20 days and calculates harder terrain per effective section', () => {
  const beyond = estimateCourse(
    track(1000, 100000),
    5,
    {},
    references().map((ref) => ({ ...ref, durationSeconds: 600000 })),
  );
  expect(beyond.estimate).toBeNull();
  expect(beyond.estimateReasons.join()).toContain('beyond the supported prediction range');
  const normal = estimateCourse(track(), 1, {}, references()).estimate!;
  const harder = estimateCourse(track(), 2, {}, references()).estimate!;
  expect(normal.harderTerrainSeconds).toBeCloseTo(harder.seconds - normal.seconds);
  expect(estimateCourse(track(), 5, {}, references()).estimate?.harderTerrainSeconds).toBeNull();
  expect(
    estimateCourse(track(), 5, { '0': 3 }, references()).estimate?.harderTerrainSeconds,
  ).toBeGreaterThan(0);
  expect(
    estimateCourse(track(), 3, { '0': 5 }, references()).estimate?.harderTerrainSeconds,
  ).toBeNull();
});
