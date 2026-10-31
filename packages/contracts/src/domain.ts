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
      .describe('Step duration in seconds. Set exactly one of durationSeconds and distanceMeters.')
      .default(null),
    distanceMeters: nullableNumber
      .describe('Step distance in meters. Set exactly one of durationSeconds and distanceMeters.')
      .default(null),
    target: targetSchema.nullable().default(null),
    notes: privateNotes(notes).default(''),
  })
  .strict()
  .superRefine((step, ctx) => {
    const time = step.durationSeconds !== null && step.durationSeconds > 0;
    const distance = step.distanceMeters !== null && step.distanceMeters > 0;
    if (
      time === distance ||
      (step.durationSeconds !== null && !time) ||
      (step.distanceMeters !== null && !distance)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Each interval needs exactly one positive duration or distance.',
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
  })
  .superRefine((completion, ctx) => {
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
    averageHeartRateBpm: nullableNumber,
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
  })
  .strict()
  .partial();
const eventPatchSchema = nonemptyPatch(
  z
    .object({ title: text, date: dateSchema, kind: z.enum(['race', 'goal', 'other']), notes })
    .strict(),
);
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
  z
    .object({ action: z.literal('injury.create'), values: injuryValuesSchema.extend(createId) })
    .strict(),
  z.object({ action: z.literal('injury.update'), ...existing, values: injuryPatchSchema }).strict(),
  z.object({ action: z.literal('injury.delete'), ...existing }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandInput = z.input<typeof commandSchema>;
export const commandsSchema = z.array(commandSchema).min(1).max(200);
export type EntityKind =
  'profile' | 'plan' | 'workout' | 'note' | 'event' | 'injury' | 'activity' | 'health';
export type Entity =
  Profile | Plan | Workout | Note | TrainingEvent | Injury | Activity | HealthRecord;
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
  .object(agentScopeFields)
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
        ]
      : ['Proposal submission is not permitted.']),
    'Applying training changes requires your review and explicit approval in Athlete Panel.',
  ];
}
