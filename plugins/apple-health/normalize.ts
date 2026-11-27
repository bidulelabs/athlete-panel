import {
  appleRecordingSourceSchema,
  dateSchema,
  sportSchema,
  sportTypeLabel,
  timezoneSchema,
  type Activity,
} from '@athlete-panel/contracts';
import { z } from 'zod';
import { appleTimestamp, workoutUuid } from './protocol';
import { appleRoute } from './route-data';

const workoutSchema = z.object({
  uuid: workoutUuid,
  attivita: sportSchema,
  inizio: appleTimestamp,
  fine: appleTimestamp,
  durata_s: z.unknown().optional(),
  distanza_m: z.unknown().optional(),
  fonte: z.unknown().optional(),
  statistiche: z.unknown().optional(),
  metadati: z.unknown().optional(),
  percorso: z.unknown().optional(),
});
const numbers = z.number().nonnegative();
const metadataSchema = z.record(z.string(), z.unknown());
const heartSchema = z.object({
  HKQuantityTypeIdentifierHeartRate: z
    .object({
      unita: z.literal('count/min'),
      media: z.unknown().optional(),
      massimo: z.unknown().optional(),
    })
    .optional(),
});
const sports: Record<string, [string, string?]> = {
  walking: ['walking'],
  hiking: ['hiking'],
  swimming: ['swimming'],
  traditional_strength_training: ['fitness_equipment', 'strength_training'],
  functional_strength_training: ['fitness_equipment', 'strength_training'],
  yoga: ['fitness_equipment', 'yoga'],
  mixed_cardio: ['fitness_equipment', 'indoor_cardio'],
  multisport: ['multi_sport'],
};

function sportSelection(type: string, indoor: boolean) {
  const match = (() => {
    if (type === 'running') return ['running', indoor ? 'indoor_running' : null] as const;
    if (type === 'cycling') return ['cycling', indoor ? 'indoor_cycling' : null] as const;
    return Object.hasOwn(sports, type) ? sports[type] : undefined;
  })();
  return {
    sport: match?.[0] ?? type,
    sportSubgroup: match?.[1] ?? null,
    sportResolution: match ? ('resolved' as const) : ('unresolved' as const),
  };
}

function elevationMeters(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const result = /^([0-9]+(?:\.[0-9]+)?)\s*(m|km|cm|ft)$/.exec(value.trim());
  if (!result) return null;
  const conversion = { m: 1, km: 1000, cm: 0.01, ft: 0.3048 };
  return (
    numbers.safeParse(Number(result[1]) * conversion[result[2] as keyof typeof conversion]).data ??
    null
  );
}

export type AppleWorkout = Omit<Activity, 'id' | 'revision'> & {
  appleHealth: NonNullable<Activity['appleHealth']>;
};

export function normalizeWorkout(input: unknown, athleteZone: string) {
  const parsed = workoutSchema.safeParse(input);
  if (!parsed.success || Date.parse(parsed.data.fine) < Date.parse(parsed.data.inizio)) return null;
  const workout = parsed.data;
  const startedAt = new Date(workout.inizio).toISOString();
  const metadata = metadataSchema.safeParse(workout.metadati).data ?? {};
  const zone = timezoneSchema.safeParse(metadata.HKTimeZone).data;
  const localDate = dateSchema.safeParse(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone ?? athleteZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(startedAt)),
  ).data;
  if (!localDate) return null;
  const sport = sportSelection(workout.attivita, metadata.HKIndoorWorkout === '1');
  const route = appleRoute(workout.percorso);
  const heart = heartSchema.safeParse(workout.statistiche).data?.HKQuantityTypeIdentifierHeartRate;
  const recordingSource =
    appleRecordingSourceSchema.safeParse(workout.fonte).data ?? 'Unknown source';
  const facts: AppleWorkout = {
    provider: 'apple-health',
    externalId: `apple-health:${workout.uuid}`,
    title: sportTypeLabel(sport.sportSubgroup ?? sport.sport),
    ...sport,
    startedAt,
    localDate,
    dateSource: zone ? 'provider' : 'inferred',
    durationSeconds: numbers.safeParse(workout.durata_s).data ?? null,
    distanceMeters: numbers.safeParse(workout.distanza_m).data ?? null,
    elevationMeters: elevationMeters(metadata.HKElevationAscended),
    elevationLossMeters: elevationMeters(metadata.HKElevationDescended),
    averageHeartRateBpm: numbers.safeParse(heart?.media).data ?? null,
    maxHeartRateBpm: numbers.safeParse(heart?.massimo).data ?? null,
    provenance: { sourceAccountId: 'apple-health', source: 'workouts' },
    appleHealth: {
      recordingSource,
      workoutType: workout.attivita,
      routeAvailable: route !== null,
      estimatedElevationMeters: route?.estimatedElevationMeters ?? null,
    },
  };
  return {
    uuid: workout.uuid,
    facts,
    route,
    invalidRoute: workout.percorso != null && route === null,
  };
}
