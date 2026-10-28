import { z } from 'zod';
import { validSportSelection, isRest } from './sports';

export const CONTRACT_VERSION = 2 as const;
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
const base = { id: idSchema, revision: revisionSchema };

export const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('independent'), date: dateSchema }).strict(),
  z
    .object({ kind: z.literal('plan'), planId: idSchema, day: z.number().int().min(1).max(3660) })
    .strict(),
]);
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
export const profileValuesSchema = z
  .object({
    displayName: text.default('Athlete'),
    units: z.enum(['metric', 'imperial']).default('metric'),
    timezone: timezoneSchema.default('Europe/Paris'),
    language: z.literal('en').default('en'),
    // Omission means Automatic without rewriting older stored/audited profiles.
    weekStartsOnPreference: weekStartsOnPreferenceSchema.optional(),
    goals: notes.default(''),
    weeklyAvailability: z
      .object({
        monday: availableSeconds.default(0),
        tuesday: availableSeconds.default(0),
        wednesday: availableSeconds.default(0),
        thursday: availableSeconds.default(0),
        friday: availableSeconds.default(0),
        saturday: availableSeconds.default(0),
        sunday: availableSeconds.default(0),
      })
      .strict()
      .default({
        monday: 0,
        tuesday: 0,
        wednesday: 0,
        thursday: 0,
        friday: 0,
        saturday: 0,
        sunday: 0,
      }),
    heartRateZones: z
      .object({ cycling: zoneBounds.default([]), running: zoneBounds.default([]) })
      .strict()
      .default({ cycling: [], running: [] }),
    ftpWatts: z.number().int().min(1).max(3000).nullable().default(null),
  })
  .strict();
export const profileSchema = profileValuesSchema.extend({
  id: z.literal('owner'),
  revision: revisionSchema,
});
export type Profile = z.infer<typeof profileSchema>;

export const targetSchema = z
  .object({
    kind: z.enum(['heartRateBpm', 'powerWatts', 'paceSecondsPerKilometer', 'rpe']),
    min: z.number().finite().positive(),
    max: z.number().finite().positive(),
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
    durationSeconds: nullableNumber.default(null),
    distanceMeters: nullableNumber.default(null),
    target: targetSchema.nullable().default(null),
    notes: notes.default(''),
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
      times: z.number().int().min(2).max(100),
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

export const planValuesSchema = z
  .object({
    title: text,
    description: narrativeSchema.default(''),
    startDate: dateSchema.nullable().default(null),
  })
  .strict();
export const planSchema = planValuesSchema.extend(base);
export type Plan = z.infer<typeof planSchema>;
export const strengthExerciseSchema = z
  .object({
    name: text,
    sets: z.number().int().positive().nullable().optional(),
    repetitions: z.string().max(255).optional(),
    weightKg: nullableNumber.optional(),
    loadDescription: z.string().max(1000).optional(),
    restSeconds: nullableNumber.optional(),
    instructions: notes.optional(),
  })
  .strict();
export type StrengthExercise = z.infer<typeof strengthExerciseSchema>;
const workoutFields = {
  title: text,
  kind: z.enum(['workout', 'rest']).optional(),
  sport: sportSchema.nullable(),
  sportSubgroup: sportSchema.nullable().optional(),
  schedule: scheduleSchema,
  durationSeconds: nullableNumber.default(null),
  distanceMeters: nullableNumber.default(null),
  plannedElevationGainMeters: nullableNumber.optional(),
  steps: z.array(workoutStepSchema).max(100).default([]),
  exercises: z.array(strengthExerciseSchema).max(100).optional(),
  order: z.number().int().min(1).max(10000).default(1),
  notes: narrativeSchema.default(''),
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
  .object({ title: text, body: narrativeSchema, schedule: scheduleSchema })
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

const existing = { id: idSchema, expectedRevision: revisionSchema };
const createId = { id: idSchema.optional() };
const nonemptyPatch = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, 'An update must contain at least one field.');
// Patch schemas intentionally contain no defaults: omission must never erase existing values.
const planPatchSchema = nonemptyPatch(
  z
    .object({ title: text, description: narrativeSchema, startDate: dateSchema.nullable() })
    .strict(),
);
const workoutPatchSchema = nonemptyPatch(
  z
    .object({
      title: text,
      kind: z.enum(['workout', 'rest']),
      sport: sportSchema.nullable(),
      sportSubgroup: sportSchema.nullable(),
      plannedElevationGainMeters: nullableNumber,
      exercises: z.array(strengthExerciseSchema).max(100),
      schedule: scheduleSchema,
      durationSeconds: nullableNumber,
      distanceMeters: nullableNumber,
      steps: z.array(workoutStepSchema).max(100),
      order: z.number().int().min(1).max(10000),
      notes: narrativeSchema,
    })
    .strict(),
);
const notePatchSchema = nonemptyPatch(noteValuesSchema);
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
export const commandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('profile.set'),
      expectedRevision: revisionSchema.nullable(),
      values: profileValuesSchema,
    })
    .strict(),
  z
    .object({ action: z.literal('plan.create'), values: planValuesSchema.extend(createId) })
    .strict(),
  z.object({ action: z.literal('plan.update'), ...existing, values: planPatchSchema }).strict(),
  z.object({ action: z.literal('plan.delete'), ...existing }).strict(),
  z
    .object({
      action: z.literal('plan.duplicate'),
      ...existing,
      values: z.object({ ...createId, title: text, startDate: dateSchema.nullable() }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal('workout.create'),
      values: workoutValuesSchema.safeExtend(createId),
    })
    .strict(),
  z
    .object({ action: z.literal('workout.update'), ...existing, values: workoutPatchSchema })
    .strict(),
  z.object({ action: z.literal('workout.delete'), ...existing }).strict(),
  z
    .object({
      action: z.literal('workout.duplicate'),
      ...existing,
      values: z.object({ ...createId, schedule: scheduleSchema, title: text.optional() }).strict(),
    })
    .strict(),
  z
    .object({ action: z.literal('workout.complete'), ...existing, values: completionInputSchema })
    .strict(),
  z.object({ action: z.literal('workout.clearCompletion'), ...existing }).strict(),
  z.object({ action: z.literal('workout.link'), ...existing, activityId: idSchema }).strict(),
  z.object({ action: z.literal('workout.unlink'), ...existing }).strict(),
  z
    .object({
      action: z.literal('workout.reorder'),
      date: dateSchema,
      workouts: z.array(z.object(existing).strict()).min(1).max(1000),
    })
    .strict(),
  z
    .object({ action: z.literal('note.create'), values: noteValuesSchema.extend(createId) })
    .strict(),
  z.object({ action: z.literal('note.update'), ...existing, values: notePatchSchema }).strict(),
  z.object({ action: z.literal('note.delete'), ...existing }).strict(),
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
const boundedAgentDates = (scope: { from: string; to: string }) =>
  scope.from <= scope.to && (Date.parse(scope.to) - Date.parse(scope.from)) / 86400000 <= 120;
const agentDatesMessage = 'Context range must be ordered and at most 121 days.';
export const agentScopeSchema = z
  .object(agentScopeFields)
  .refine(boundedAgentDates, agentDatesMessage);
export const agentGrantValuesSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    ...agentScopeFields,
    expiresInHours: z.number().positive().max(24).default(1),
  })
  .strict()
  .refine(boundedAgentDates, agentDatesMessage);
export const agentConnectionStartSchema = z
  .object({ label: z.string().trim().min(1).max(100) })
  .strict();
export const agentConnectionIdSchema = z.object({ id: idSchema }).strict();
export const agentConnectionApprovalSchema = agentGrantValuesSchema.safeExtend({
  id: idSchema,
  code: z.string().regex(/^[A-F0-9]{4}-[A-F0-9]{4}$/),
});
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
    .object({ id: idSchema, label: z.string(), ...agentScopeFields, expiresAt: timestampSchema })
    .nullable(),
});
export type AgentConnectionStatus = z.infer<typeof agentConnectionStatusSchema>;
