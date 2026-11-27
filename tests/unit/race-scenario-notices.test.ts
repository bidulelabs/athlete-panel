import { describe, expect, it } from 'vitest';
import { scenarioNotices, type ScenarioOutcome } from '../../plugins/race-analysis/scenarios';

const leg = (
  fromMeters: number,
  toMeters: number,
  waterNeededMillilitres: number | null,
  {
    stationName,
    nextRefillMeters = toMeters,
  }: { stationName?: string; nextRefillMeters?: number } = {},
) => ({
  fromMeters,
  toMeters,
  station: stationName === undefined ? undefined : { name: stationName },
  waterNeededMillilitres,
  waterNextRefillMeters: waterNeededMillilitres === null ? null : nextRefillMeters,
  waterOverCapacity: waterNeededMillilitres !== null && waterNeededMillilitres > 1000,
});
const outcomeWith = (values: {
  finishMargin?: number | null;
  stationMargins?: Record<string, number | null>;
  legs?: ReturnType<typeof leg>[];
}) =>
  ({
    finish: { cutoffMarginSeconds: values.finishMargin ?? 600 },
    cutoffs: Object.entries(values.stationMargins ?? {}).map(([name, cutoffMarginSeconds]) => ({
      stationId: name,
      name,
      cutoffMarginSeconds,
    })),
    carry: { carryCapacityMillilitres: 1000, legs: values.legs ?? [leg(0, 42000, 800)] },
  }) as unknown as ScenarioOutcome;
const noticesOf = (outcome: ScenarioOutcome, outdatedReasons: string[] = []) =>
  scenarioNotices({ name: 'Hot and careful' }, outcome, outdatedReasons);

describe('scenario notices', () => {
  it('says nothing about a scenario that keeps every cutoff, fits its bottles and is up to date', () => {
    expect(
      noticesOf(outcomeWith({ stationMargins: { 'Grand Col': 0 }, finishMargin: 60 })),
    ).toEqual([]);
  });

  it('counts each missed cutoff, stations first and the finish last', () => {
    const [notice] = noticesOf(
      outcomeWith({ stationMargins: { 'Grand Col': -1440, 'Les Pins': 300 }, finishMargin: -2400 }),
    );
    expect(notice).toEqual({
      kind: 'missed-cutoffs',
      title: '“Hot and careful” misses 2 cutoffs at its latest arrival',
      body: 'Grand Col by 24 min and the finish by 40 min. Shorter stops or a calmer start may not be enough: check the course estimate.',
    });
  });

  it('names one missed cutoff in the singular, capitalising the finish', () => {
    const [notice] = noticesOf(outcomeWith({ finishMargin: -2400 }));
    expect(notice!.title).toContain('misses 1 cutoff at');
    expect(notice!.body).toMatch(/^The finish by 40 min\. /);
  });

  it('rounds a margin under a minute up to one minute', () => {
    const [notice] = noticesOf(outcomeWith({ finishMargin: -20 }));
    expect(notice!.body).toMatch(/^The finish by 1 min\. /);
  });

  it('ignores a cutoff whose margin is unknown', () => {
    expect(
      noticesOf(outcomeWith({ stationMargins: { 'Grand Col': null }, finishMargin: null })),
    ).toEqual([]);
  });

  it('names the finish when the water lasts from the last refill to the finish', () => {
    const [notice] = noticesOf(
      outcomeWith({
        legs: [
          leg(0, 20000, 700),
          leg(20000, 42000, 1200, { stationName: 'Les Pins', nextRefillMeters: 42000 }),
        ],
      }),
    );
    expect(notice).toEqual({
      kind: 'carry-over-capacity',
      title: 'Hot and careful: water until the finish needs 1.2 L, bottles hold 1 L',
      body: 'Slower legs need more to drink. Add capacity in Settings or plan a refill.',
    });
  });

  it('names the station with the next water, not a dry station on the way', () => {
    const [notice] = noticesOf(
      outcomeWith({
        legs: [
          leg(0, 10000, 1200, { nextRefillMeters: 28000 }),
          leg(10000, 28000, null, { stationName: 'Dry Pass' }),
          leg(28000, 42000, 700, { stationName: 'Grand Col', nextRefillMeters: 42000 }),
        ],
      }),
    );
    expect(notice!.title).toBe(
      'Hot and careful: water until Grand Col needs 1.2 L, bottles hold 1 L',
    );
  });

  it('stays quiet when the heaviest leg is exactly what the bottles hold', () => {
    expect(noticesOf(outcomeWith({ legs: [leg(0, 42000, 1000)] }))).toEqual([]);
  });

  it('stays quiet without a carry plan', () => {
    expect(noticesOf({ ...outcomeWith({}), carry: null })).toEqual([]);
  });

  it('explains an outdated scenario with the reasons the column used to show', () => {
    const [notice] = noticesOf(outcomeWith({}), ['The course changed.', 'Grand Col was moved.']);
    expect(notice).toEqual({
      kind: 'outdated',
      title: '“Hot and careful” was saved before the plan changed',
      body: 'The course changed. Grand Col was moved. Review it, then save it again.',
    });
  });

  it('lists the outdated, missed cutoff and carry notices in that order', () => {
    expect(
      noticesOf(outcomeWith({ finishMargin: -60, legs: [leg(0, 42000, 1200)] }), [
        'The course changed.',
      ]).map(({ kind }) => kind),
    ).toEqual(['outdated', 'missed-cutoffs', 'carry-over-capacity']);
  });
});
