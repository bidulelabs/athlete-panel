import { z } from 'zod';
import { validSportSelection, isRest } from './sports';

export const sportSchema = z.string().min(1).max(100);
export type Sport = z.infer<typeof sportSchema>;
export const idSchema = z.uuid();
export const revisionSchema = z.number().int().positive();
export const nonnegativeSchema = z.number().finite().nonnegative();
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Use a real calendar date in YYYY-MM-DD format.');
export const timestampSchema = z.iso.datetime({ offset: true });
export const timezoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Use an IANA timezone.');
const text = z.string().trim().min(1).max(255);
const notes = z.string().max(4000);
export const narrativeSchema = z.string().max(20000);
const nullableNumber = nonnegativeSchema.nullable();
const privateNotes = <T extends z.ZodString>(schema: T) =>
  schema.describe('Private text. Agents read and write it only when their grant includes notes.');
const base = { id: idSchema, revision: revisionSchema };

export const scheduleSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('independent'), date: dateSchema }).strict(),
    z
      .object({
        kind: z.literal('plan'),
        planId: idSchema.describe('Id of the plan that places this record.'),
        day: z
          .number()
          .int()
          .min(1)
          .max(3660)
          .describe('Day within the plan, 1-based: day 1 is the plan startDate.'),
      })
      .strict(),
  ])
  .describe('Either an independent date or a day within a plan, never both.');
export type Schedule = z.infer<typeof scheduleSchema>;

const zoneBounds = z
  .array(z.number().int().min(1).max(300))
  .max(6)
  .refine(
    (values) =>
      values.every((value, index) => {
        const previous = values[index - 1];
        return index === 0 || (previous !== undefined && value > previous);
      }),
    'Heart-rate zone upper bounds must be strictly ascending.',
  );
const availableSeconds = z.number().int().min(0).max(86400);
export const weekStartsOnPreferenceSchema = z.enum(['auto', 'sunday', 'monday']);
export type WeekStartsOnPreference = z.infer<typeof weekStartsOnPreferenceSchema>;
const units = z.enum(['metric', 'imperial']);
const weeklyAvailability = z
  .object({
    monday: availableSeconds,
    tuesday: availableSeconds,
    wednesday: availableSeconds,
    thursday: availableSeconds,
    friday: availableSeconds,
    saturday: availableSeconds,
    sunday: availableSeconds,
  })
  .strict();
const heartRateZones = z.object({ cycling: zoneBounds, running: zoneBounds }).strict();
const ftpWatts = z.number().int().min(1).max(3000).nullable();
const restingHeartRateBpm = z.number().int().min(25).max(120).nullable();
const maxHeartRateBpm = z.number().int().min(100).max(240).nullable();
export const nutritionAmountMaximums = {
  carbohydrateGrams: 500,
  fluidMillilitres: 5000,
  sodiumMilligrams: 10000,
  caffeineMilligrams: 1000,
} as const;
const amountPerServing = (max: number) => z.number().finite().min(0).max(max).nullable();
const toleranceLevels = ['comfortable', 'mild', 'poor'] as const;
export const nutritionProductSchema = z
  .object({
    id: idSchema,
    name: text,
    kind: z.enum(['gel', 'drink', 'food', 'other']),
    carbohydrateGrams: amountPerServing(nutritionAmountMaximums.carbohydrateGrams),
    fluidMillilitres: amountPerServing(nutritionAmountMaximums.fluidMillilitres),
    sodiumMilligrams: amountPerServing(nutritionAmountMaximums.sodiumMilligrams),
    caffeineMilligrams: amountPerServing(nutritionAmountMaximums.caffeineMilligrams),
    source: z.enum(['label', 'estimate']),
    tolerance: z.enum([...toleranceLevels, 'untested']),
  })
  .strict();
export type NutritionProduct = z.infer<typeof nutritionProductSchema>;
export const nutritionProfileSchema = z
  .object({
    products: z
      .array(nutritionProductSchema)
      .max(50)
      .refine(
        (products) => new Set(products.map((product) => product.id)).size === products.length,
        'Each product needs its own id.',
      ),
    carryCapacityMillilitres: z.number().int().min(0).max(20000).nullable(),
    preferences: z.string().max(2000),
  })
  .strict();
export type NutritionProfile = z.infer<typeof nutritionProfileSchema>;
export const profileValuesSchema = z
  .object({
    displayName: text.default('Athlete'),
    units: units.default('metric'),
    timezone: timezoneSchema.default('Europe/Paris'),
    language: z.literal('en').default('en'),
    // Omission means Automatic without rewriting older stored/audited profiles.
    weekStartsOnPreference: weekStartsOnPreferenceSchema.optional(),
    goals: notes.default(''),
    weeklyAvailability: weeklyAvailability.default({
      monday: 0,
      tuesday: 0,
      wednesday: 0,
      thursday: 0,
      friday: 0,
      saturday: 0,
      sunday: 0,
    }),
    heartRateZones: heartRateZones.default({ cycling: [], running: [] }),
    ftpWatts: ftpWatts.default(null),
    restingHeartRateBpm: restingHeartRateBpm.optional(),
    maxHeartRateBpm: maxHeartRateBpm.optional(),
    nutrition: nutritionProfileSchema.optional(),
  })
  .strict();
export const profileSchema = profileValuesSchema.extend({
  id: z.literal('owner'),
  revision: revisionSchema,
});
export type Profile = z.infer<typeof profileSchema>;

export const targetSchema = z
  .object({
    kind: z
      .enum(['heartRateBpm', 'powerWatts', 'paceSecondsPerKilometer', 'rpe'])
      .describe(
        'Unit of min and max: beats per minute, watts, seconds per kilometer, or RPE from 1 to 10.',
      ),
    min: z.number().finite().positive().describe('Lower bound, in the unit of kind.'),
    max: z.number().finite().positive().describe('Upper bound, in the unit of kind.'),
  })
  .strict()
  .superRefine((target, ctx) => {
    if (target.min > target.max)
      ctx.addIssue({ code: 'custom', path: ['max'], message: 'Maximum must be at least minimum.' });
    if (target.kind === 'rpe' && (target.min < 1 || target.max > 10))
      ctx.addIssue({ code: 'custom', path: ['max'], message: 'RPE must be between 1 and 10.' });
    if (target.kind === 'heartRateBpm' && target.max > 300)
      ctx.addIssue({
        code: 'custom',
        path: ['max'],
        message: 'Heart rate must not exceed 300 bpm.',
      });
  });
export const intervalStepSchema = z
  .object({
    kind: z.enum(['warmup', 'work', 'recovery', 'cooldown']),
    durationSeconds: nullableNumber
      .describe(
        'Step duration in seconds. Set exactly one of durationSeconds, distanceMeters and endsOnLapButton.',
      )
      .default(null),
    distanceMeters: nullableNumber
      .describe(
        'Step distance in meters. Set exactly one of durationSeconds, distanceMeters and endsOnLapButton.',
      )
      .default(null),
    endsOnLapButton: z
      .boolean()
      .describe(
        'True when the step has no set length and ends when the athlete presses the lap button. Set exactly one of durationSeconds, distanceMeters and endsOnLapButton.',
      )
      .optional(),
    target: targetSchema.nullable().default(null),
    notes: privateNotes(notes).default(''),
  })
  .strict()
  .superRefine((step, ctx) => {
    const endConditionCount = [
      step.durationSeconds !== null,
      step.distanceMeters !== null,
      step.endsOnLapButton,
    ].filter(Boolean).length;
    if (
      endConditionCount !== 1 ||
      (step.durationSeconds !== null && step.durationSeconds <= 0) ||
      (step.distanceMeters !== null && step.distanceMeters <= 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Each interval needs exactly one positive duration, distance or lap button end.',
      });
    }
  });
export const workoutStepSchema = z.union([
  intervalStepSchema,
  z
    .object({
      kind: z.literal('repeat'),
      times: z.number().int().min(2).max(100).describe('Number of times the steps run.'),
      steps: z.array(intervalStepSchema).min(1).max(50),
    })
    .strict(),
]);
export type WorkoutStep = z.infer<typeof workoutStepSchema>;

export const completionValuesSchema = z
  .object({
    status: z.enum(['completed', 'partial', 'skipped']),
    performedDate: dateSchema,
    durationSeconds: nullableNumber.default(null),
    distanceMeters: nullableNumber.default(null),
    rpe: z.number().finite().min(1).max(10).nullable().default(null),
    reason: narrativeSchema.default(''),
    notes: narrativeSchema.optional(),
  })
  .strict()
  .superRefine((completion, ctx) => {
    if (completion.status === 'partial' && !completion.reason.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Give a reason for partial completion.',
      });
  });
export const completionInputSchema = z
  .object({
    status: z.enum(['completed', 'partial', 'skipped']),
    performedDate: dateSchema,
    durationSeconds: nullableNumber.optional(),
    distanceMeters: nullableNumber.optional(),
    rpe: z.number().finite().min(1).max(10).nullable().optional(),
    reason: narrativeSchema.optional(),
    notes: narrativeSchema.optional(),
  })
  .strict();

export const completionSchema = completionValuesSchema
  .safeExtend({
    source: z.enum(['manual', 'garmin']),
    activityId: idSchema.nullable(),
    /** Set by the training service, never accepted in owner completion input. */
    linkMethod: z.enum(['manual', 'automatic']).optional(),
  })
  .superRefine((completion, ctx) => {
    if (completion.linkMethod && completion.source !== 'garmin')
      ctx.addIssue({
        code: 'custom',
        path: ['linkMethod'],
        message: 'Only Garmin links have a linking method.',
      });
    if ((completion.source === 'garmin') !== (completion.activityId !== null))
      ctx.addIssue({
        code: 'custom',
        path: ['activityId'],
        message: 'Only Garmin completion must reference an activity.',
      });
    if (
      completion.status === 'skipped' &&
      (completion.source === 'garmin' ||
        completion.durationSeconds !== null ||
        completion.distanceMeters !== null ||
        completion.rpe !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Skipped completion cannot contain recorded actuals.',
      });
  });
export type Completion = z.infer<typeof completionSchema>;

const planFieldsWithoutDefaults = {
  title: text,
  description: privateNotes(narrativeSchema),
  startDate: dateSchema
    .nullable()
    .describe(
      'Date of plan day 1. Null leaves the plan unscheduled; agent proposals need a date inside the grant.',
    ),
};
export const planValuesSchema = z
  .object({
    ...planFieldsWithoutDefaults,
    description: planFieldsWithoutDefaults.description.default(''),
    startDate: planFieldsWithoutDefaults.startDate.default(null),
  })
  .strict();
export const planSchema = planValuesSchema.extend(base);
export type Plan = z.infer<typeof planSchema>;
export const strengthExerciseSchema = z
  .object({
    name: text,
    sets: z.number().int().positive().nullable().optional().describe('Number of sets.'),
    repetitions: z
      .string()
      .max(255)
      .optional()
      .describe('Repetitions per set as free text, for example 8-10.'),
    weightKg: nullableNumber.optional().describe('Load in kilograms.'),
    loadDescription: z
      .string()
      .max(1000)
      .optional()
      .describe('Load as free text when it is not a weight.'),
    restSeconds: nullableNumber.optional().describe('Rest between sets in seconds.'),
    instructions: privateNotes(notes).optional(),
  })
  .strict();
export type StrengthExercise = z.infer<typeof strengthExerciseSchema>;
const workoutFieldsWithoutDefaults = {
  title: text,
  kind: z
    .enum(['workout', 'rest'])
    .describe('workout, or rest for a rest day with no sport, volume, steps or exercises.'),
  sport: sportSchema
    .nullable()
    .describe('Garmin sport group typeKey, for example running. Null for a rest day.'),
  sportSubgroup: sportSchema
    .nullable()
    .describe('Garmin typeKey inside the sport group, for example trail_running.'),
  plannedElevationGainMeters: nullableNumber.describe('Planned elevation gain in meters.'),
  exercises: z.array(strengthExerciseSchema).max(100),
  schedule: scheduleSchema,
  durationSeconds: nullableNumber.describe('Planned duration in seconds.'),
  distanceMeters: nullableNumber.describe('Planned distance in meters.'),
  steps: z.array(workoutStepSchema).max(100).describe('Interval steps, in order.'),
  order: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .describe('Position among the workouts of the same day, 1-based.'),
  notes: privateNotes(narrativeSchema),
};
const workoutFields = {
  title: workoutFieldsWithoutDefaults.title,
  kind: workoutFieldsWithoutDefaults.kind.optional(),
  sport: workoutFieldsWithoutDefaults.sport,
  sportSubgroup: workoutFieldsWithoutDefaults.sportSubgroup.optional(),
  schedule: workoutFieldsWithoutDefaults.schedule,
  durationSeconds: workoutFieldsWithoutDefaults.durationSeconds.default(null),
  distanceMeters: workoutFieldsWithoutDefaults.distanceMeters.default(null),
  plannedElevationGainMeters: workoutFieldsWithoutDefaults.plannedElevationGainMeters.optional(),
  steps: workoutFieldsWithoutDefaults.steps.default([]),
  exercises: workoutFieldsWithoutDefaults.exercises.optional(),
  order: workoutFieldsWithoutDefaults.order.default(1),
  notes: workoutFieldsWithoutDefaults.notes.default(''),
};
const unrefinedWorkoutValues = z.object(workoutFields).strict();
function validateWorkout(value: z.infer<typeof unrefinedWorkoutValues>, ctx: z.RefinementCtx) {
  if (isRest(value)) {
    if (
      value.sport !== null ||
      value.sportSubgroup != null ||
      value.durationSeconds !== null ||
      value.distanceMeters !== null ||
      value.plannedElevationGainMeters != null ||
      value.steps.length ||
      value.exercises?.length
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Rest days have no sport, exercise prescription or volume.',
      });
    }
  } else if (!validSportSelection(value)) {
    ctx.addIssue({
      code: 'custom',
      path: ['sport'],
      message: 'Choose a Garmin group and a subgroup belonging to it.',
    });
  }
}
export const workoutValuesSchema = unrefinedWorkoutValues.superRefine(validateWorkout);
export const workoutSchema = workoutValuesSchema
  .safeExtend({
    ...base,
    completion: completionSchema.nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (isRest(value) && value.completion !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['completion'],
        message: 'Rest days cannot have completion.',
      });
  });
export type Workout = z.infer<typeof workoutSchema>;
export const noteValuesSchema = z
  .object({ title: text, body: privateNotes(narrativeSchema), schedule: scheduleSchema })
  .strict();
export const noteSchema = noteValuesSchema.extend(base);
export type Note = z.infer<typeof noteSchema>;
export const eventValuesSchema = z
  .object({
    title: text,
    date: dateSchema,
    kind: z.enum(['race', 'goal', 'other']).default('goal'),
    notes: notes.default(''),
  })
  .strict();
export const eventSchema = eventValuesSchema.extend(base);
export type TrainingEvent = z.infer<typeof eventSchema>;
const racePlanLine = z.string().trim().min(1).max(300);
const racePlanTarget = z
  .string()
  .trim()
  .max(120)
  .describe('What the athlete wants from this race. Only the owner sets it.');
const racePlanAgentFields = {
  briefing: notes.describe('Race briefing in plain text.'),
  pacing: z
    .array(
      z
        .object({
          fromMeters: nonnegativeSchema.describe('Section start, in meters from the start line.'),
          toMeters: nonnegativeSchema.describe('Section end, in meters from the start line.'),
          effort: z
            .string()
            .trim()
            .min(1)
            .max(120)
            .describe('Effort or run and walk guidance for this section.'),
        })
        .strict(),
    )
    .max(200)
    .refine(
      (sections) =>
        sections.every(
          (section, index) =>
            section.toMeters > section.fromMeters &&
            (index === 0 || section.fromMeters >= sections[index - 1]!.toMeters),
        ),
      'Pacing sections run from start to finish without overlap.',
    )
    .describe('Pacing by course section, in course order.'),
  assumptions: z.array(racePlanLine).max(20).describe('What the strategy takes for granted.'),
  openQuestions: z
    .array(racePlanLine)
    .max(20)
    .describe('What the athlete still has to answer for the strategy to hold.'),
};
const racePlanCourseId = idSchema
  .nullable()
  .describe('Id of the course the strategy was written for. Null when the race has no course.');
const raceClockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time in HH:MM format.')
  .describe('Wall-clock time in the profile timezone, HH:MM.');
const raceCutoff = z
  .object({
    dayOffset: z.number().int().min(0).max(6).describe('Days after the race date.'),
    time: raceClockTime,
  })
  .strict()
  .nullable();
export const raceNutritionMaximums = {
  carbohydrateGramsPerHour: 500,
  fluidMillilitresPerHour: 5000,
  sodiumMilligramsPerHour: 10000,
  servings: 100,
  everyMinutes: 1440,
  cueWhen: 80,
  cueText: 300,
  scheduleRows: 30,
  cues: 20,
} as const;
const hourlyTarget = (max: number, unit: string) =>
  z.number().finite().min(0).max(max).nullable().describe(`Target in ${unit}. Null when unknown.`);
const racePlanStationFields = {
  id: idSchema,
  name: z
    .string()
    .trim()
    .min(1, 'Name each aid station.')
    .max(80, 'Keep an aid station name to 80 characters.'),
  distanceMeters: nonnegativeSchema.describe('Distance from the start line, in meters.'),
  cutoff: raceCutoff,
  stopSeconds: z
    .number()
    .int()
    .min(0)
    .max(86400)
    .describe('Planned stop at this station, in seconds.'),
  water: z.boolean(),
  food: z.string().trim().max(200),
  dropBag: z
    .array(
      z
        .object({
          productId: idSchema,
          servings: z
            .number()
            .int()
            .min(1)
            .max(100)
            .describe('Whole servings of the product left in the drop bag.'),
        })
        .strict(),
    )
    .max(20)
    .refine(
      (items) => new Set(items.map((item) => item.productId)).size === items.length,
      'List each product once in a drop bag.',
    ),
  action: z.string().trim().max(300),
  source: z.string().trim().max(120),
  verified: z.boolean(),
};
const racePlanStationSchema = z.object(racePlanStationFields).strict();
const racePlanStationCommandSchema = racePlanStationSchema.partial({
  source: true,
  verified: true,
});
const racePlanStationAgentSchema = racePlanStationSchema
  .omit({ source: true, verified: true })
  .extend({
    id: idSchema
      .optional()
      .describe('Id of an existing aid station, as read. Leave out for a new one.'),
  });
const stationsInCourseOrder = <Station extends z.ZodType<{ id?: string; distanceMeters: number }>>(
  station: Station,
) =>
  z
    .array(station)
    .max(60)
    .refine(
      (stations) =>
        stations.every(
          (item, index) => index === 0 || item.distanceMeters > stations[index - 1]!.distanceMeters,
        ),
      'Aid stations run in course order, each farther than the one before.',
    )
    .refine((stations) => {
      const ids = stations.flatMap((item) => (item.id ? [item.id] : []));
      return new Set(ids).size === ids.length;
    }, 'Each aid station needs its own id.')
    .describe('Aid stations in course order.');
const racePlanDayFields = {
  startTime: raceClockTime.nullable(),
  finishCutoff: raceCutoff,
  stations: stationsInCourseOrder(racePlanStationSchema),
  nutrition: z
    .object({
      targets: z
        .object({
          carbohydrateGramsPerHour: hourlyTarget(
            raceNutritionMaximums.carbohydrateGramsPerHour,
            'grams of carbohydrate per hour',
          ),
          fluidMillilitresPerHour: hourlyTarget(
            raceNutritionMaximums.fluidMillilitresPerHour,
            'millilitres of fluid per hour',
          ),
          sodiumMilligramsPerHour: hourlyTarget(
            raceNutritionMaximums.sodiumMilligramsPerHour,
            'milligrams of sodium per hour',
          ),
        })
        .strict(),
      schedule: z
        .array(
          z
            .object({
              productId: idSchema,
              servings: z
                .number()
                .finite()
                .positive()
                .max(raceNutritionMaximums.servings)
                .describe('Servings of the product at each intake.'),
              everyMinutes: z
                .number()
                .int()
                .min(1)
                .max(raceNutritionMaximums.everyMinutes)
                .describe('Minutes between two intakes of the product.'),
            })
            .strict(),
        )
        .max(raceNutritionMaximums.scheduleRows),
      cues: z
        .array(
          z
            .object({
              when: z.string().trim().min(1).max(raceNutritionMaximums.cueWhen),
              text: z.string().trim().min(1).max(raceNutritionMaximums.cueText),
            })
            .strict(),
        )
        .max(raceNutritionMaximums.cues),
      daysBefore: notes,
      breakfast: notes,
      recovery: notes,
    })
    .strict()
    .describe('What to eat and drink before, during and after the race.'),
};
const withoutHalfCharacters = (value: string) => !/\p{Cs}/u.test(value);
const racePlanAssumptionFields = {
  effortPercent: z.number().min(-30).max(50).multipleOf(0.5),
  weatherPercent: z.number().min(-20).max(50).multipleOf(0.5),
  weatherNote: z.string().trim().max(300).refine(withoutHalfCharacters),
};
const racePlanAgentDayFields = {
  startTime: racePlanDayFields.startTime.optional(),
  finishCutoff: racePlanDayFields.finishCutoff.optional(),
  stations: stationsInCourseOrder(racePlanStationAgentSchema).optional(),
  nutrition: racePlanDayFields.nutrition.optional(),
};
export const emptyRaceNutrition: z.infer<typeof racePlanDayFields.nutrition> = {
  targets: {
    carbohydrateGramsPerHour: null,
    fluidMillilitresPerHour: null,
    sodiumMilligramsPerHour: null,
  },
  schedule: [],
  cues: [],
  daysBefore: '',
  breakfast: '',
  recovery: '',
};
export const racePlanSchema = z
  .object({
    eventId: idSchema.describe('Id of the race this plan prepares.'),
    target: racePlanTarget,
    ...racePlanAgentFields,
    startTime: racePlanDayFields.startTime.default(null),
    finishCutoff: racePlanDayFields.finishCutoff.default(null),
    stations: racePlanDayFields.stations.default([]),
    nutrition: racePlanDayFields.nutrition.default(() => structuredClone(emptyRaceNutrition)),
    effortPercent: racePlanAssumptionFields.effortPercent.default(0),
    weatherPercent: racePlanAssumptionFields.weatherPercent.default(0),
    weatherNote: racePlanAssumptionFields.weatherNote.default(''),
    writtenFor: z.object({ courseId: racePlanCourseId, target: racePlanTarget }).strict(),
  })
  .strict()
  .extend(base);
export type RacePlan = z.infer<typeof racePlanSchema>;
const rehearsalFields = {
  items: z
    .array(
      z
        .object({
          productName: text,
          carbohydrateGrams: amountPerServing(500),
          fluidMillilitres: amountPerServing(5000),
          plannedServings: z.number().finite().min(0).max(144000).nullable(),
          takenServings: z.number().finite().min(0).max(100).multipleOf(0.5),
        })
        .strict(),
    )
    .max(50),
  extraFluidMillilitres: z.number().int().min(0).max(20000),
  stomach: z.enum(toleranceLevels),
  conditions: z.string().trim().max(120),
  lesson: notes,
};
export const rehearsalSchema = z
  .object({
    eventId: idSchema.describe('Id of the race this rehearsal prepares.'),
    workoutId: idSchema.describe('Id of the completed session the rehearsal was run on.'),
    ...rehearsalFields,
  })
  .strict()
  .extend(base);
export type Rehearsal = z.infer<typeof rehearsalSchema>;
export const RACE_SCENARIO_LIMIT = 4;
const raceScenarioStationLimit = 60;
const raceScenarioFields = {
  name: z.string().trim().min(1).max(80).refine(withoutHalfCharacters),
  ...racePlanAssumptionFields,
  stops: z
    .array(
      z
        .object({
          stationId: idSchema,
          stopSeconds: racePlanStationFields.stopSeconds,
        })
        .strict(),
    )
    .max(raceScenarioStationLimit)
    .refine((stops) => new Set(stops.map((stop) => stop.stationId)).size === stops.length, {
      message: 'Each aid station appears once.',
    }),
  basedOn: z
    .object({
      courseId: racePlanCourseId,
      stations: z
        .array(
          z
            .object({
              id: idSchema,
              distanceMeters: nonnegativeSchema,
              stopSeconds: racePlanStationFields.stopSeconds.optional(),
              cutoff: racePlanStationFields.cutoff.optional(),
            })
            .strict(),
        )
        .max(raceScenarioStationLimit),
      courseEstimate: z
        .object({
          seconds: z.number().finite().positive(),
          lowSeconds: z.number().finite().positive(),
          highSeconds: z.number().finite().positive(),
        })
        .strict()
        .nullable()
        .optional(),
      effortPercent: racePlanAssumptionFields.effortPercent.optional(),
      weatherPercent: racePlanAssumptionFields.weatherPercent.optional(),
    })
    .strict(),
};
export const raceScenarioSchema = z
  .object({
    eventId: idSchema.describe('Id of the race whose plan this scenario compares.'),
    ...raceScenarioFields,
  })
  .strict()
  .extend(base);
export type RaceScenario = z.infer<typeof raceScenarioSchema>;
const weeklyRange = z
  .object({
    min: nonnegativeSchema.describe('Lowest weekly value, in the unit named by the target field.'),
    max: nonnegativeSchema.describe('Highest weekly value, in the unit named by the target field.'),
  })
  .strict()
  .refine((range) => range.min <= range.max, {
    path: ['max'],
    message: 'Maximum must be at least minimum.',
  });
const weeklyTarget = z
  .object({
    firstWeek: weeklyRange,
    lastWeek: weeklyRange.describe(
      'Weeks between the first and the last are interpolated linearly.',
    ),
  })
  .strict();
const editedWeek = z
  .object({
    weeklyDurationSeconds: weeklyRange.optional(),
    weeklyDistanceMeters: weeklyRange.optional(),
    weeklyElevationGainMeters: weeklyRange.optional(),
  })
  .strict()
  .refine(
    (week) =>
      week.weeklyDurationSeconds || week.weeklyDistanceMeters || week.weeklyElevationGainMeters,
    { message: 'An edited week sets at least one target.' },
  );
const editedWeeks = z
  .record(dateSchema, editedWeek)
  .describe(
    'Weeks whose targets are set by hand, keyed by the Monday of the week, so a change of week start keeps them. A target left out stays calculated from the first and last weeks.',
  );
export const editedWeekStartsInside = (monday: string, startDate: string, endDate: string) =>
  startDate <= monday &&
  new Date(Date.parse(monday) - 86400000).toISOString().slice(0, 10) <= endDate;
export const periodRoles = ['base', 'build', 'peak', 'taper', 'recovery'] as const;
const periodFieldsWithoutDefaults = {
  name: text,
  role: z.enum(periodRoles),
  startDate: dateSchema.describe(
    'First day of the period. A week belongs to the period holding its first day.',
  ),
  endDate: dateSchema.describe('Last day of the period.'),
  focus: z
    .string()
    .trim()
    .max(120)
    .describe('What the phase trains, such as "VO2max" or "Taper for the spring marathon".'),
  weeklyDurationSeconds: weeklyTarget
    .nullable()
    .describe('Weekly training time in seconds, every sport included.'),
  weeklyDistanceMeters: weeklyTarget.nullable().describe('Weekly distance in meters.'),
  weeklyElevationGainMeters: weeklyTarget.nullable().describe('Weekly elevation gain in meters.'),
  editedWeeks,
};
export const periodValuesSchema = z
  .object({
    ...periodFieldsWithoutDefaults,
    focus: periodFieldsWithoutDefaults.focus.default(''),
    weeklyDurationSeconds: periodFieldsWithoutDefaults.weeklyDurationSeconds.default(null),
    weeklyDistanceMeters: periodFieldsWithoutDefaults.weeklyDistanceMeters.default(null),
    weeklyElevationGainMeters: periodFieldsWithoutDefaults.weeklyElevationGainMeters.default(null),
    editedWeeks: editedWeeks.default({}),
  })
  .strict();
export const periodSchema = periodValuesSchema
  .extend(base)
  .refine((value) => value.endDate >= value.startDate, {
    path: ['endDate'],
    message: 'End date cannot be before start date.',
  })
  .refine(
    (value) =>
      Object.keys(value.editedWeeks).every(
        (monday) => new Date(`${monday}T12:00:00Z`).getUTCDay() === 1,
      ),
    { path: ['editedWeeks'], message: 'Edited weeks are keyed by the Monday of the week.' },
  )
  .refine(
    (value) =>
      Object.keys(value.editedWeeks).every((monday) =>
        editedWeekStartsInside(monday, value.startDate, value.endDate),
      ),
    { path: ['editedWeeks'], message: 'Edited weeks must start inside their phase.' },
  );
export type Period = z.infer<typeof periodSchema>;
export type EditedWeek = z.infer<typeof editedWeek>;
export type WeeklyTarget = z.infer<typeof weeklyTarget>;
export const injuryValuesSchema = z
  .object({
    bodyPart: text,
    description: notes.default(''),
    startDate: dateSchema,
    endDate: dateSchema.nullable().default(null),
    severity: z.enum(['mild', 'moderate', 'severe']).default('mild'),
    notes: notes.default(''),
  })
  .strict();
export const injurySchema = injuryValuesSchema
  .extend(base)
  .refine((value) => value.endDate === null || value.endDate >= value.startDate, {
    path: ['endDate'],
    message: 'End date cannot be before start date.',
  });
export type Injury = z.infer<typeof injurySchema>;

export const importProvenanceSchema = z
  .object({
    sourceAccountId: z.string().min(1).max(512),
    source: z.string().min(1).max(255),
    restingHeartRateMayBeMinimum: z.boolean().optional(),
  })
  .strict();
export const activitySchema = z
  .object({
    ...base,
    provider: z.literal('garmin'),
    externalId: z.string().min(1).max(512),
    title: z.string().max(512),
    sport: sportSchema,
    sportSubgroup: sportSchema.nullable().optional(),
    sportResolution: z.enum(['resolved', 'unresolved']).optional(),
    garminActivityType: z
      .object({
        typeKey: z.string().min(1).max(100),
        typeId: z.string().regex(/^\d+$/).nullable(),
        parentTypeId: z.string().regex(/^\d+$/).nullable(),
      })
      .strict()
      .optional(),
    trainingStressScore: nullableNumber.optional(),
    intensityFactor: nullableNumber.optional(),
    normalizedPowerWatts: nullableNumber.optional(),
    startedAt: timestampSchema,
    localDate: dateSchema,
    dateSource: z.enum(['provider', 'inferred']),
    durationSeconds: nullableNumber,
    distanceMeters: nullableNumber,
    elevationMeters: nullableNumber,
    elevationLossMeters: nullableNumber.optional(),
    averageHeartRateBpm: nullableNumber,
    maxHeartRateBpm: nullableNumber.optional(),
    heartRateZoneSeconds: z.array(nullableNumber).length(5).nullable().optional(),
    provenance: importProvenanceSchema.optional(),
  })
  .strict();
export type Activity = z.infer<typeof activitySchema>;
export const healthMetricSchema = z.enum([
  'sleepDurationSeconds',
  'sleepDeepSeconds',
  'sleepLightSeconds',
  'sleepRemSeconds',
  'sleepAwakeSeconds',
  'sleepScore',
  'restingHeartRateBpm',
  'hrvMilliseconds',
  'bodyBattery',
  'steps',
  'stress',
]);
export const healthRecordSchema = z
  .object({
    ...base,
    provider: z.literal('garmin'),
    externalId: z.string().min(1).max(512),
    metric: healthMetricSchema,
    localDate: dateSchema,
    measuredAt: timestampSchema.nullable(),
    value: nullableNumber,
    provenance: importProvenanceSchema.optional(),
  })
  .strict();
export type HealthRecord = z.infer<typeof healthRecordSchema>;
export const workspaceStateSchema = z
  .object({
    profile: profileSchema.nullable(),
    plans: z.array(planSchema),
    workouts: z.array(workoutSchema),
    notes: z.array(noteSchema),
    events: z.array(eventSchema),
    periods: z.array(periodSchema).default([]),
    racePlans: z.array(racePlanSchema).default([]),
    rehearsals: z.array(rehearsalSchema).default([]),
    raceScenarios: z.array(raceScenarioSchema).default([]),
    injuries: z.array(injurySchema),
    activities: z.array(activitySchema),
    health: z.array(healthRecordSchema),
  })
  .strict();
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;
export const emptyWorkspace = (): WorkspaceState => ({
  profile: null,
  plans: [],
  workouts: [],
  notes: [],
  events: [],
  periods: [],
  racePlans: [],
  rehearsals: [],
  raceScenarios: [],
  injuries: [],
  activities: [],
  health: [],
});

const existing = {
  id: idSchema.describe('Id of the existing record.'),
  expectedRevision: revisionSchema.describe(
    'Revision of the record when it was read. The command is refused if the record changed since.',
  ),
};
const createId = {
  id: idSchema
    .optional()
    .describe(
      'Optional UUID for the new record. A later command of the same batch can use it as schedule.planId.',
    ),
};
const nonemptyPatch = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, 'An update must contain at least one field.');
// Patch schemas intentionally contain no defaults: omission must never erase existing values.
const planPatchSchema = nonemptyPatch(z.object(planFieldsWithoutDefaults).strict());
const workoutPatchSchema = nonemptyPatch(z.object(workoutFieldsWithoutDefaults).strict());
const notePatchSchema = nonemptyPatch(noteValuesSchema);
const profilePatchSchema = z
  .object({
    displayName: text,
    units,
    timezone: timezoneSchema,
    language: z.literal('en'),
    weekStartsOnPreference: weekStartsOnPreferenceSchema,
    goals: notes,
    weeklyAvailability,
    heartRateZones,
    ftpWatts,
    restingHeartRateBpm,
    maxHeartRateBpm,
    nutrition: nutritionProfileSchema,
  })
  .strict()
  .partial();
const eventPatchSchema = nonemptyPatch(
  z
    .object({ title: text, date: dateSchema, kind: z.enum(['race', 'goal', 'other']), notes })
    .strict(),
);
const periodPatchSchema = nonemptyPatch(z.object(periodFieldsWithoutDefaults).strict());
const injuryPatchSchema = nonemptyPatch(
  z
    .object({
      bodyPart: text,
      description: notes,
      startDate: dateSchema,
      endDate: dateSchema.nullable(),
      severity: z.enum(['mild', 'moderate', 'severe']),
      notes,
    })
    .strict(),
);
const planCreateCommand = z
  .object({ action: z.literal('plan.create'), values: planValuesSchema.extend(createId) })
  .strict();
const planUpdateCommand = z
  .object({ action: z.literal('plan.update'), ...existing, values: planPatchSchema })
  .strict();
const planDeleteCommand = z.object({ action: z.literal('plan.delete'), ...existing }).strict();
const planDuplicateCommand = z
  .object({
    action: z.literal('plan.duplicate'),
    ...existing,
    values: z
      .object({ ...createId, title: text, startDate: planFieldsWithoutDefaults.startDate })
      .strict(),
  })
  .strict();
const workoutCreateCommand = z
  .object({
    action: z.literal('workout.create'),
    values: workoutValuesSchema.safeExtend(createId),
  })
  .strict();
const workoutUpdateCommand = z
  .object({ action: z.literal('workout.update'), ...existing, values: workoutPatchSchema })
  .strict();
const workoutDeleteCommand = z
  .object({ action: z.literal('workout.delete'), ...existing })
  .strict();
const workoutDuplicateCommand = z
  .object({
    action: z.literal('workout.duplicate'),
    ...existing,
    values: z.object({ ...createId, schedule: scheduleSchema, title: text.optional() }).strict(),
  })
  .strict();
const workoutReorderCommand = z
  .object({
    action: z.literal('workout.reorder'),
    date: dateSchema.describe('Day whose workouts are reordered.'),
    workouts: z
      .array(z.object(existing).strict())
      .min(1)
      .max(1000)
      .describe('Every workout of that day, exactly once, in the new order.'),
  })
  .strict();
const noteCreateCommand = z
  .object({ action: z.literal('note.create'), values: noteValuesSchema.extend(createId) })
  .strict();
const noteUpdateCommand = z
  .object({ action: z.literal('note.update'), ...existing, values: notePatchSchema })
  .strict();
const noteDeleteCommand = z.object({ action: z.literal('note.delete'), ...existing }).strict();
const agentEventCreateCommand = z
  .object({
    action: z.literal('event.create'),
    values: eventValuesSchema.extend({ ...createId, kind: z.enum(['race', 'goal']) }),
  })
  .strict();
const periodCreateCommand = z
  .object({ action: z.literal('period.create'), values: periodValuesSchema.extend(createId) })
  .strict();
const periodUpdateCommand = z
  .object({ action: z.literal('period.update'), ...existing, values: periodPatchSchema })
  .strict();
const periodDeleteCommand = z.object({ action: z.literal('period.delete'), ...existing }).strict();
const agentRacePlanCreateCommand = z
  .object({
    action: z.literal('racePlan.create'),
    values: z
      .object({
        ...createId,
        eventId: racePlanSchema.shape.eventId,
        ...racePlanAgentFields,
        ...racePlanAgentDayFields,
        courseId: racePlanCourseId,
      })
      .strict(),
  })
  .strict();
const agentRacePlanUpdateCommand = z
  .object({
    action: z.literal('racePlan.update'),
    ...existing,
    values: z
      .object(racePlanAgentFields)
      .strict()
      .partial()
      .extend({ ...racePlanAgentDayFields, courseId: racePlanCourseId }),
  })
  .strict();
export const agentCommandSchema = z.discriminatedUnion('action', [
  planCreateCommand,
  planUpdateCommand,
  planDeleteCommand,
  planDuplicateCommand,
  workoutCreateCommand,
  workoutUpdateCommand,
  workoutDeleteCommand,
  workoutDuplicateCommand,
  workoutReorderCommand,
  noteCreateCommand,
  noteUpdateCommand,
  noteDeleteCommand,
  agentEventCreateCommand,
  periodCreateCommand,
  periodUpdateCommand,
  periodDeleteCommand,
  agentRacePlanCreateCommand,
  agentRacePlanUpdateCommand,
]);
export const AGENT_COMMAND_LIMIT = 1500;
export const AGENT_PROPOSAL_BYTES = 4 * 1024 * 1024;
export const agentCommandsSchema = z
  .array(agentCommandSchema)
  .min(1)
  .max(
    AGENT_COMMAND_LIMIT,
    'A proposal supports at most 1,500 commands. Reduce its size without silently shortening the requested program.',
  );
export const commandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('profile.set'),
      expectedRevision: revisionSchema.nullable(),
      values: profilePatchSchema,
    })
    .strict(),
  planCreateCommand,
  planUpdateCommand,
  planDeleteCommand,
  planDuplicateCommand,
  workoutCreateCommand,
  workoutUpdateCommand,
  workoutDeleteCommand,
  workoutDuplicateCommand,
  z
    .object({ action: z.literal('workout.complete'), ...existing, values: completionInputSchema })
    .strict(),
  z.object({ action: z.literal('workout.clearCompletion'), ...existing }).strict(),
  z.object({ action: z.literal('workout.link'), ...existing, activityId: idSchema }).strict(),
  z.object({ action: z.literal('workout.unlink'), ...existing }).strict(),
  workoutReorderCommand,
  noteCreateCommand,
  noteUpdateCommand,
  noteDeleteCommand,
  z
    .object({ action: z.literal('event.create'), values: eventValuesSchema.extend(createId) })
    .strict(),
  z.object({ action: z.literal('event.update'), ...existing, values: eventPatchSchema }).strict(),
  z.object({ action: z.literal('event.delete'), ...existing }).strict(),
  periodCreateCommand,
  periodUpdateCommand,
  periodDeleteCommand,
  z
    .object({
      action: z.literal('racePlan.create'),
      values: z
        .object({
          ...createId,
          eventId: racePlanSchema.shape.eventId,
          target: racePlanTarget.optional(),
          briefing: racePlanAgentFields.briefing.default(''),
          pacing: racePlanAgentFields.pacing.default([]),
          assumptions: racePlanAgentFields.assumptions.default([]),
          openQuestions: racePlanAgentFields.openQuestions.default([]),
          startTime: racePlanDayFields.startTime.optional(),
          finishCutoff: racePlanDayFields.finishCutoff.optional(),
          stations: stationsInCourseOrder(racePlanStationCommandSchema).optional(),
          nutrition: racePlanDayFields.nutrition.optional(),
          effortPercent: racePlanAssumptionFields.effortPercent.optional(),
          weatherPercent: racePlanAssumptionFields.weatherPercent.optional(),
          weatherNote: racePlanAssumptionFields.weatherNote.optional(),
          courseId: racePlanCourseId.default(null),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal('racePlan.update'),
      ...existing,
      values: nonemptyPatch(
        z
          .object({
            target: racePlanTarget,
            ...racePlanAgentFields,
            ...racePlanDayFields,
            ...racePlanAssumptionFields,
            stations: stationsInCourseOrder(racePlanStationCommandSchema),
            courseId: racePlanCourseId,
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      action: z.literal('rehearsal.create'),
      values: z
        .object({
          ...createId,
          eventId: rehearsalSchema.shape.eventId,
          workoutId: rehearsalSchema.shape.workoutId,
          ...rehearsalFields,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal('rehearsal.update'),
      ...existing,
      values: nonemptyPatch(z.object(rehearsalFields).strict()),
    })
    .strict(),
  z.object({ action: z.literal('rehearsal.delete'), ...existing }).strict(),
  z
    .object({
      action: z.literal('raceScenario.create'),
      values: z
        .object({
          ...createId,
          eventId: raceScenarioSchema.shape.eventId,
          ...raceScenarioFields,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal('raceScenario.update'),
      ...existing,
      values: nonemptyPatch(z.object(raceScenarioFields).strict()),
    })
    .strict(),
  z.object({ action: z.literal('raceScenario.delete'), ...existing }).strict(),
  z
    .object({ action: z.literal('injury.create'), values: injuryValuesSchema.extend(createId) })
    .strict(),
  z.object({ action: z.literal('injury.update'), ...existing, values: injuryPatchSchema }).strict(),
  z.object({ action: z.literal('injury.delete'), ...existing }).strict(),
]);
export type AgentCommand = z.infer<typeof agentCommandSchema>;
export type Command = z.infer<typeof commandSchema>;
export type CommandInput = z.input<typeof commandSchema>;
export const commandsSchema = z.array(commandSchema).min(1).max(200);
export type EntityKind =
  | 'profile'
  | 'plan'
  | 'workout'
  | 'note'
  | 'event'
  | 'period'
  | 'racePlan'
  | 'rehearsal'
  | 'raceScenario'
  | 'injury'
  | 'activity'
  | 'health';
export type Entity =
  | Profile
  | Plan
  | Workout
  | Note
  | TrainingEvent
  | Period
  | RacePlan
  | Rehearsal
  | RaceScenario
  | Injury
  | Activity
  | HealthRecord;
export type EntityChange = {
  entity: EntityKind;
  id: string;
  before: Entity | null;
  after: Entity | null;
  /** Derived dates make whole-plan schedule effects reviewable without denormalizing stored entities. */
  beforeEffectiveDate?: string | null;
  afterEffectiveDate?: string | null;
};
export type MutationResult = { state: WorkspaceState; changes: EntityChange[] };

const agentScopeFields = {
  from: dateSchema,
  to: dateSchema,
  includeNotes: z.boolean().default(false),
};
/** Inclusive floating dates; an unavailable leap-day anniversary clamps to February 28. */
export function addCalendarYears(date: string, years: number): string {
  dateSchema.parse(date);
  const year = Number(date.slice(0, 4)) + years;
  const monthDay = date.slice(5);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return `${String(year).padStart(4, '0')}-${monthDay === '02-29' && !leap ? '02-28' : monthDay}`;
}
const boundedAgentDates = (scope: { from: string; to: string }) =>
  scope.from <= scope.to && (Date.parse(scope.to) - Date.parse(scope.from)) / 86400000 <= 120;
export const agentScopeSchema = z.object(agentScopeFields).refine(boundedAgentDates, {
  path: ['to'],
  message:
    'Legacy context ranges allow at most 121 inclusive days. Approve a new connection for annual planning.',
});
function calendarRange(scope: { from: string; to: string }, years: number, ctx: z.RefinementCtx) {
  if (!dateSchema.safeParse(scope.from).success || !dateSchema.safeParse(scope.to).success) return;
  const latest = addCalendarYears(scope.from, years);
  if (scope.to < scope.from || scope.to > latest)
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `Choose an end date from ${scope.from} through ${latest}, inclusive (at most ${years} calendar ${years === 1 ? 'year' : 'years'}).`,
    });
}
export const planningScopeSchema = z
  .object({
    ...agentScopeFields,
    // Absence must remain absent in saved scopes; old grants never gain permission.
    allowEventCreation: z.boolean().optional(),
    allowPhaseChanges: z.boolean().optional(),
    raceId: idSchema.optional(),
    includeRehearsals: z.boolean().optional(),
  })
  .strict()
  .superRefine((scope, ctx) => calendarRange(scope, 1, ctx));
export const historyCategorySchema = z.enum(['activities', 'health', 'training', 'context']);
export const historyScopeSchema = z
  .object({
    ...agentScopeFields,
    categories: z
      .array(historyCategorySchema)
      .min(1)
      .max(4)
      .refine((v) => new Set(v).size === v.length, 'Choose each category once.'),
    weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  })
  .strict()
  .superRefine((scope, ctx) => calendarRange(scope, 5, ctx));
const accessFields = {
  version: z.literal(2),
  history: historyScopeSchema.nullable(),
  planning: planningScopeSchema.nullable(),
};
const hasCapability = (v: { history: unknown; planning: unknown }) =>
  Boolean(v.history || v.planning);
export const agentAccessSchema = z
  .object(accessFields)
  .strict()
  .refine(hasCapability, 'Choose historical review, training proposals, or both.');
export const grantScopeSchema = z.union([agentAccessSchema, agentScopeSchema.strict()]);
export type GrantScope = z.infer<typeof grantScopeSchema>;
export type PlanningScope = z.infer<typeof planningScopeSchema>;
export type HistoryScope = z.infer<typeof historyScopeSchema>;
export function planningScope(scope: GrantScope): PlanningScope | null {
  return 'version' in scope ? scope.planning : scope;
}
export function historicalScope(scope: GrantScope): HistoryScope | null {
  return 'version' in scope ? scope.history : null;
}
const grantMetadata = {
  label: z.string().trim().min(1).max(100),
  expiresInHours: z.number().positive().max(24).default(1),
};
const legacyGrant = z
  .object({ ...grantMetadata, ...agentScopeFields })
  .strict()
  .refine(boundedAgentDates, 'Legacy context ranges allow at most 121 inclusive days.');
const modernGrant = z
  .object({ ...grantMetadata, ...accessFields })
  .strict()
  .refine(hasCapability, 'Choose at least one capability.');
export const agentGrantValuesSchema = z.union([modernGrant, legacyGrant]);
/** Strip only approval metadata; never interpret a modern grant as a legacy shared scope. */
export function scopeFromGrant(input: z.infer<typeof agentGrantValuesSchema>): GrantScope {
  return 'version' in input
    ? agentAccessSchema.parse({
        version: input.version,
        history: input.history,
        planning: input.planning,
      })
    : agentScopeSchema.parse(input);
}
export const agentConnectionStartSchema = z
  .object({ label: z.string().trim().min(1).max(100) })
  .strict();
export const agentConnectionIdSchema = z.object({ id: idSchema }).strict();
const approvalFields = { id: idSchema, code: z.string().regex(/^[A-F0-9]{4}-[A-F0-9]{4}$/) };
export const agentConnectionApprovalSchema = z.union([
  modernGrant.safeExtend(approvalFields),
  legacyGrant.safeExtend(approvalFields),
]);
export const agentConnectionStartedSchema = z.object({
  id: idSchema,
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().regex(/^[A-F0-9]{4}-[A-F0-9]{4}$/),
  expiresAt: timestampSchema,
  pollIntervalSeconds: z.literal(2),
});
export const agentConnectionStatusSchema = z.object({
  id: idSchema,
  label: z.string(),
  expiresAt: timestampSchema,
  status: z.enum(['pending', 'approved', 'denied', 'cancelled', 'expired']),
  grant: z
    .union([
      z.object({ ...accessFields, id: idSchema, label: z.string(), expiresAt: timestampSchema }),
      z.object({
        ...agentScopeFields,
        id: idSchema,
        label: z.string(),
        expiresAt: timestampSchema,
      }),
    ])
    .nullable(),
});
export type AgentConnectionStatus = z.infer<typeof agentConnectionStatusSchema>;

export function describeAgentAccess(scope: GrantScope): string[] {
  const planning = planningScope(scope),
    history = historicalScope(scope);
  return [
    ...(history
      ? [
          `Historical review: ${history.from} through ${history.to}; ${history.categories.join(', ')}; ${history.includeNotes ? 'private notes included' : 'private notes excluded'}; weeks start ${history.weekStartsOn === 0 ? 'Sunday' : 'Monday'}.`,
        ]
      : []),
    ...(planning
      ? [
          `Training proposals: ${planning.from} through ${planning.to}; profile, training, events, injuries, activities and health; ${planning.includeNotes ? 'private notes included' : 'private notes excluded'}.`,
          `Create races and goals: ${planning.allowEventCreation === true ? 'permitted within the proposal dates' : 'not permitted'}.`,
          `Change plan phases: ${planning.allowPhaseChanges === true ? 'permitted for phases within the proposal dates' : 'not permitted'}.`,
          `Race preparation: ${planning.raceId ? `course summary and race plan of the selected race, ${planning.includeRehearsals === true ? 'its fueling rehearsals, ' : ''}your nutrition profile (products, carry capacity, preferences) shared, race plan proposals permitted` : 'not permitted'}.`,
        ]
      : ['Proposal submission is not permitted.']),
    'Applying training changes requires your review and explicit approval in Athlete Panel.',
  ];
}
