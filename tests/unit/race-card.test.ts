import { describe, expect, it } from 'vitest';
import {
  racePlanSchema,
  type CourseEstimate,
  type CourseSection,
  type NutritionProduct,
  type RaceAnalysis,
  type RacePlan,
} from '@athlete-panel/contracts';
import { carryPlan } from '../../plugins/race-analysis/carry';
import { raceCardContent, raceCardHasContent } from '../../plugins/race-analysis/race-card';
import { raceCardFile, raceCardFileName } from '../../plugins/race-analysis/race-card-file';
import { adjustedEstimate, stationArrivals } from '../../plugins/race-analysis/race-day';

const planId = '00000000-0000-4000-8000-0000000000a1';
const raceId = '00000000-0000-4000-8000-0000000000a2';
const courseId = '00000000-0000-4000-8000-0000000000a3';
const gelId = '00000000-0000-4000-8000-0000000000a4';
const sections: CourseSection[] = [0, 1].map((index) => ({
  index,
  fromMeters: index * 10000,
  toMeters: (index + 1) * 10000,
  ascentMeters: 400,
  descentMeters: 0,
}));
const estimate = {
  seconds: 7200,
  lowSeconds: 6000,
  highSeconds: 8400,
  sectionSeconds: [3600, 3600],
} as CourseEstimate;
const course = { id: courseId, filename: 'synthetic-course.gpx' } as RaceAnalysis['course'];
const gel: NutritionProduct = {
  id: gelId,
  name: 'Synthetic gel',
  kind: 'gel',
  carbohydrateGrams: 25,
  fluidMillilitres: null,
  sodiumMilligrams: null,
  caffeineMilligrams: null,
  source: 'label',
  tolerance: 'comfortable',
};
const station = (
  name: string,
  distanceMeters: number,
  values: Partial<RacePlan['stations'][number]> = {},
) => ({
  id: crypto.randomUUID(),
  name,
  distanceMeters,
  cutoff: null,
  stopSeconds: 300,
  water: true,
  food: '',
  dropBag: [],
  action: '',
  source: '',
  verified: true,
  ...values,
});
const racePlan = (values: Record<string, unknown> = {}) =>
  racePlanSchema.parse({
    id: planId,
    revision: 4,
    eventId: raceId,
    target: 'Finish comfortably',
    briefing: '',
    pacing: [],
    assumptions: [],
    openQuestions: [],
    writtenFor: { courseId, target: 'Finish comfortably' },
    ...values,
  });

const nutritionWith = (values: Record<string, unknown> = {}) => ({
  targets: {
    carbohydrateGramsPerHour: null,
    fluidMillilitresPerHour: 500,
    sodiumMilligramsPerHour: null,
  },
  schedule: [{ productId: gelId, servings: 1, everyMinutes: 30 }],
  cues: [],
  daysBefore: '',
  breakfast: '',
  recovery: '',
  ...values,
});

function cardFor(
  plan: RacePlan,
  {
    withEstimate = true,
    products = [gel],
    capacity = 1000 as number | null,
    units = 'metric',
  } = {},
) {
  const raceDay = stationArrivals(withEstimate ? estimate : null, sections, plan);
  return raceCardContent({
    racePlan: plan,
    course,
    raceDay,
    carry: carryPlan(raceDay, plan.nutrition, products, capacity),
    products,
    units,
  });
}
const file = (card: ReturnType<typeof cardFor>, needsReview = false) =>
  raceCardFile({
    card,
    title: 'Synthetic Trail',
    dateText: 'Sunday 29 August 2027',
    downloadedOn: '23 November 2026 at 18:30',
    needsReview,
  });

describe('race card content', () => {
  it('lists start, stations and finish with times, cutoffs, the next leg and what to leave with', () => {
    const card = cardFor(
      racePlan({
        startTime: '07:00',
        stations: [
          station('Les Pins', 8000, {
            action: 'Refill bottles',
            cutoff: { dayOffset: 0, time: '12:00' },
            verified: false,
          }),
        ],
        nutrition: nutritionWith({
          targets: {
            carbohydrateGramsPerHour: 50,
            fluidMillilitresPerHour: 500,
            sodiumMilligramsPerHour: null,
          },
          cues: [{ when: 'Last climb', text: 'Keep a gel' }],
          breakfast: ' Rice and honey ',
        }),
      }),
    );
    expect(card.stops.map((stop) => stop.marker)).toEqual(['S', '1', 'F']);
    expect(card.stops[0]).toMatchObject({
      title: 'Start · 07:00',
      action: '',
      leaveWith: expect.stringMatching(/^Leave with .*× Synthetic gel/),
      details: expect.stringMatching(/^next 8\.0 km · \d+ m up · about \d+m moving$/),
    });
    expect(card.stops[1]).toMatchObject({
      title: 'Les Pins · 8.0 km',
      action: 'Refill bottles',
      leaveWith: expect.stringMatching(/^Leave with /),
      cutoff: expect.stringMatching(/^Cutoff 12:00 · .+ margin$/),
      cutoffMissed: false,
    });
    expect(card.stops[1]!.time).toMatch(/^\d\d:\d\d–\d\d:\d\d$/);
    expect(card.stops[1]!.details).toMatch(/^stop 5m · next 12\.0 km · .+ · not confirmed$/);
    expect(card.stops[2]).toMatchObject({ title: 'Finish · 20.0 km', time: null });
    expect(card.expectedFinish).toMatch(/^\d\d:\d\d$/);
    expect(card.finishRange).toMatch(/^\d\d:\d\d–\d\d:\d\d$/);
    expect(card.timesFromStart).toBe(false);
    expect(card.food).toBe(
      '50 g carbohydrate per hour, 500 ml fluid per hour: 1 × Synthetic gel, every 30 min',
    );
    expect(card.cues).toEqual([{ when: 'Last climb', text: 'Keep a gel' }]);
    expect(card.breakfast).toBe('Rice and honey');
    expect(card.writtenFor).toBe('Written for synthetic-course.gpx · target Finish comfortably');
    expect(card.revision).toBe(4);
    expect(card.warning).toBeNull();
  });

  it('names a product that is no longer in the profile', () => {
    const card = cardFor(racePlan({ nutrition: nutritionWith() }), { products: [] });
    expect(card.food).toBe('500 ml fluid per hour: 1 × Removed product, every 30 min');
  });

  it('leaves the empty texts and an unset food plan out', () => {
    const card = cardFor(
      racePlan({
        briefing: '  ',
        nutrition: nutritionWith({
          targets: {
            carbohydrateGramsPerHour: null,
            fluidMillilitresPerHour: null,
            sodiumMilligramsPerHour: null,
          },
          schedule: [],
          recovery: ' ',
        }),
      }),
    );
    expect([card.briefing, card.breakfast, card.recovery, card.food]).toEqual(['', '', '', '']);
  });

  it('says what is unknown and does not invent a time or a quantity without an estimate', () => {
    const card = cardFor(racePlan({ stations: [station('Les Pins', 8000)] }), {
      withEstimate: false,
    });
    expect(card.expectedFinish).toBeNull();
    expect(card.finishRange).toBeNull();
    expect(card.warning).toBe(
      'No finish estimate yet: arrival times and carry amounts are not shown.',
    );
    expect(card.stops.every((stop) => stop.time === null && stop.leaveWith === '')).toBe(true);
  });

  it('gives one warning, the most important one, when carry amounts are not complete', () => {
    const withFood = (values: Record<string, unknown>) =>
      racePlan({ startTime: '07:00', nutrition: nutritionWith(values) });
    const noFluid = {
      targets: {
        carbohydrateGramsPerHour: 50,
        fluidMillilitresPerHour: null,
        sodiumMilligramsPerHour: null,
      },
    };
    expect(
      cardFor(racePlan({ stations: [station('Les Pins', 8000, { stopSeconds: 86400 })] })).warning,
    ).toBe('Carry amounts are not shown: the planned stops are longer than the estimate.');
    expect(cardFor(withFood(noFluid)).warning).toBe(
      'Water to carry is unknown: no fluid target and no fluid in the food plan.',
    );
    expect(cardFor(withFood({}), { capacity: null }).warning).toBe(
      'Carry capacity is unknown: water is not checked against it.',
    );
    expect(cardFor(withFood({ schedule: [] })).warning).toBe(
      'No food plan yet: products to carry are not shown.',
    );
  });

  it('shows the capacity overflow on the leave-with line', () => {
    const card = cardFor(
      racePlan({
        nutrition: nutritionWith({
          targets: {
            carbohydrateGramsPerHour: null,
            fluidMillilitresPerHour: 3000,
            sodiumMilligramsPerHour: null,
          },
        }),
      }),
    );
    expect(card.stops[0]).toMatchObject({
      leaveWith: expect.stringMatching(/, over capacity$/),
      overCapacity: true,
    });
    const roomy = cardFor(racePlan({ nutrition: nutritionWith() }));
    expect(roomy.stops[0]!.overCapacity).toBe(false);
    expect(roomy.stops[0]!.leaveWith).not.toContain('over capacity');
  });

  it('counts times from the start without a start time and gives no time to a station beyond the course', () => {
    const card = cardFor(
      racePlan({ stations: [station('Les Pins', 8000), station('Far Away', 90000)] }),
    );
    expect(card.timesFromStart).toBe(true);
    expect(card.expectedFinish).toMatch(/^\dh \d\dm$/);
    expect(card.stops[1]!.time).toMatch(/^\dh \d\dm–\dh \d\dm$/);
    expect(card.stops[2]).toMatchObject({
      title: 'Far Away · 90.0 km',
      time: null,
      leaveWith: '',
    });
    expect(card.stops[2]!.details).toContain('beyond the course');
  });

  it('writes distances in miles for imperial units', () => {
    const card = cardFor(racePlan({ stations: [station('Les Pins', 8000)] }), {
      units: 'imperial',
    });
    expect(card.stops[1]!.title).toBe('Les Pins · 5.0 mi');
    expect(card.stops[0]!.details).toMatch(/^next 5\.0 mi · [\d,]+ ft up/);
  });

  it('names an earlier course, no course and an empty target', () => {
    expect(cardFor(racePlan({ writtenFor: { courseId: raceId, target: '' } })).writtenFor).toBe(
      'Written for an earlier course',
    );
    expect(cardFor(racePlan({ writtenFor: { courseId: null, target: '' } })).writtenFor).toBe(
      'Written for no course',
    );
  });

  it('puts the cutoff on its own line and flags a missed one', () => {
    const card = cardFor(
      racePlan({
        startTime: '07:00',
        finishCutoff: { dayOffset: 0, time: '08:00' },
        stations: [station('Les Pins', 8000, { cutoff: { dayOffset: 0, time: '07:10' } })],
      }),
    );
    expect(card.stops[1]).toMatchObject({
      cutoff: expect.stringMatching(/^Cutoff 07:10 · .+ after the cutoff$/),
      cutoffMissed: true,
    });
    expect(card.stops[1]!.details).not.toContain('Cutoff');
    expect(card.stops.at(-1)).toMatchObject({
      cutoff: expect.stringMatching(/^Cutoff 08:00 · .+ after the cutoff$/),
      cutoffMissed: true,
    });
  });

  it('has nothing to show for a plan with a target only', () => {
    expect(raceCardHasContent(racePlan())).toBe(false);
    expect(raceCardHasContent(racePlan({ briefing: 'Easy start' }))).toBe(false);
    expect(raceCardHasContent(racePlan({ stations: [station('Les Pins', 8000)] }))).toBe(true);
    expect(raceCardHasContent(racePlan({ nutrition: nutritionWith({ schedule: [] }) }))).toBe(true);
  });
});

describe('offline race card file', () => {
  const hostile = '<script>alert(1)</script> https://x "quoted" & <img src=x onerror=y>';
  const plan = racePlan({
    briefing: hostile,
    stations: [station(hostile, 8000, { action: hostile })],
    nutrition: nutritionWith({
      targets: {
        carbohydrateGramsPerHour: null,
        fluidMillilitresPerHour: null,
        sodiumMilligramsPerHour: null,
      },
      schedule: [],
      cues: [{ when: hostile, text: hostile }],
      breakfast: hostile,
      recovery: hostile,
    }),
  });
  const html = file(cardFor(plan), false);

  it('escapes every typed text and has no script, src or href', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<[^>]*\b(?:src|href)\s*=/i);
    expect(html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt; https://x &quot;quoted&quot; &amp;',
    );
  });

  it('escapes the race title in the page title and the heading', () => {
    const titled = raceCardFile({
      card: cardFor(plan),
      title: '<b>Trail</b>',
      dateText: '',
      downloadedOn: 'today',
      needsReview: false,
    });
    expect(titled).not.toContain('<b>');
    expect(titled).toContain('<title>Race card · &lt;b&gt;Trail&lt;/b&gt;</title>');
  });

  it('carries the plan revision, the download date and the review banner only when needed', () => {
    expect(html).toContain('plan revision 4');
    expect(html).toContain('downloaded on 23 November 2026 at 18:30 from plan revision 4');
    expect(html).not.toContain('needed review');
    expect(file(cardFor(plan), true)).toContain(
      'This plan needed review when this copy was downloaded',
    );
  });

  it('wraps long words, keeps the time on the title line and renders no empty time', () => {
    expect(html).toContain('overflow-wrap:anywhere');
    expect(html).toContain('grid-template-areas:"marker title time" "marker body body"');
    expect(html).toContain('@media (max-width:760px)');
    expect(html).not.toMatch(/(?:^|\n|\})li\{/);
    expect(html).toContain('.stops li{display:grid;');
    expect(html).toContain('<ol class="stops">');
    expect(html.match(/class="time"/g)).toHaveLength(1);
  });

  it('puts the action and what to leave with on two lines and underlines a missed cutoff', () => {
    const missed = file(
      cardFor(
        racePlan({
          startTime: '07:00',
          stations: [
            station('Les Pins', 8000, {
              action: 'Refill bottles',
              cutoff: { dayOffset: 0, time: '07:10' },
            }),
          ],
          nutrition: nutritionWith(),
        }),
      ),
    );
    expect(missed).toContain(
      '<p class="action">Refill bottles</p><p class="leave-with">Leave with',
    );
    expect(missed).toContain('<p class="details late">Cutoff 07:10');
  });

  it('says once that times count from the start', () => {
    const noStart = file(cardFor(racePlan({ stations: [station('Les Pins', 8000)] })));
    expect(noStart.match(/Times are counted from the start\./g)).toHaveLength(1);
    expect(noStart).not.toContain('after the start');
  });

  it('leaves out an empty block', () => {
    const bare = file(cardFor(racePlan()));
    expect(bare).not.toContain('Keep in mind');
    expect(bare).not.toContain('Breakfast');
    expect(bare).not.toContain('During the race');
    expect(bare).not.toContain('Recovery');
    expect(bare).not.toContain('<h2>Food</h2>');
  });

  it('names the file from the title without accents or leading dashes', () => {
    expect(raceCardFileName('Échappée Belle')).toBe('echappee-belle-race-card.html');
    expect(raceCardFileName('  !!Alpine Trail 42!! ')).toBe('alpine-trail-42-race-card.html');
    expect(raceCardFileName('山岳レース')).toBe('race-race-card.html');
    expect(raceCardFileName('')).toBe('race-race-card.html');
  });
});

describe('race card effort and weather', () => {
  const planWith = (values: Record<string, unknown>) =>
    racePlan({ startTime: '07:00', stations: [station('Les Pins', 8000)], ...values });
  const cardWithEffortAndWeather = (plan: RacePlan) => {
    const raceDay = stationArrivals(
      adjustedEstimate(estimate, sections, plan.stations, {
        effortPercent: plan.effortPercent,
        weatherPercent: plan.weatherPercent,
        stations: plan.stations,
      }),
      sections,
      plan,
    );
    return raceCardContent({
      racePlan: plan,
      course,
      raceDay,
      carry: null,
      products: [gel],
      units: 'metric',
    });
  };

  it('shows the assumption line and the note on the card and in the downloaded file', () => {
    const card = cardWithEffortAndWeather(
      planWith({ effortPercent: 8, weatherPercent: 6, weatherNote: 'Hot afternoon' }),
    );
    expect(card.effortAndWeather).toBe('Effort +8 % · weather +6 % (your assumption)');
    const html = file(card);
    expect(html).toContain('Effort +8 % · weather +6 % (your assumption)');
    expect(html).toContain('Hot afternoon');
  });

  it('shows a negative effort with its sign and a zero weather as 0 %', () => {
    expect(cardWithEffortAndWeather(planWith({ effortPercent: -5 })).effortAndWeather).toBe(
      'Effort -5 % · weather 0 % (your assumption)',
    );
  });

  it('shows no assumption line when both are 0, even with a note', () => {
    const html = file(cardWithEffortAndWeather(planWith({ weatherNote: 'Hot afternoon' })));
    expect(html).not.toContain('your assumption');
    expect(html).not.toContain('Hot afternoon');
  });

  it('moves the expected finish with the effort and leaves a plan at 0 untouched', () => {
    const untouched = cardWithEffortAndWeather(planWith({}));
    expect(untouched.expectedFinish).toBe(cardFor(planWith({})).expectedFinish);
    expect(cardWithEffortAndWeather(planWith({ effortPercent: 10 })).expectedFinish).not.toBe(
      untouched.expectedFinish,
    );
  });
});
