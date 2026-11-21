import { numeric } from '@athlete-panel/ui';
import type { CommandInput, CourseSection, RacePlan } from '@athlete-panel/contracts';

type Pacing = RacePlan['pacing'];
type Station = RacePlan['stations'][number];
type RaceDayValues = Partial<
  Pick<RacePlan, 'startTime' | 'finishCutoff' | 'stations' | 'nutrition'>
>;

export function pacingRows(pacing: Pacing, sections: readonly CourseSection[]): Pacing {
  const unplannedSections = sections.filter(
    (section) =>
      !pacing.some(
        (planned) => planned.fromMeters < section.toMeters && section.fromMeters < planned.toMeters,
      ),
  );
  return [
    ...pacing,
    ...unplannedSections.map(({ fromMeters, toMeters }) => ({ fromMeters, toMeters, effort: '' })),
  ].sort((a, b) => a.fromMeters - b.fromMeters);
}

const nutritionIsWritten = (nutrition: RacePlan['nutrition']) =>
  Object.values(nutrition.targets).some((target) => target !== null) ||
  nutrition.schedule.length > 0 ||
  nutrition.cues.length > 0 ||
  [nutrition.daysBefore, nutrition.breakfast, nutrition.recovery].some((text) => text !== '');

export const strategyNeedsReview = (racePlan: RacePlan, courseId: string | null) =>
  (racePlan.briefing !== '' ||
    racePlan.pacing.length > 0 ||
    racePlan.assumptions.length > 0 ||
    racePlan.openQuestions.length > 0 ||
    racePlan.stations.length > 0 ||
    nutritionIsWritten(racePlan.nutrition)) &&
  (racePlan.writtenFor.courseId !== courseId ||
    (racePlan.writtenFor.target !== '' && racePlan.writtenFor.target !== racePlan.target));

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export function racePlanCommand(
  form: FormData,
  rows: Pacing,
  racePlan: RacePlan | undefined,
  raceId: string,
  courseId: string | null,
): CommandInput | null {
  const efforts = form.getAll('effort').map((effort) => String(effort).trim());
  const target = String(form.get('target')).trim();
  const strategy = {
    briefing: String(form.get('briefing')),
    pacing: rows
      .map((row, index) => ({ ...row, effort: efforts[index]! }))
      .filter((row) => row.effort),
    assumptions: lines(String(form.get('assumptions'))),
    openQuestions: lines(String(form.get('openQuestions'))),
  };
  if (!racePlan)
    return {
      action: 'racePlan.create',
      values: { eventId: raceId, target, ...strategy, courseId },
    };
  const changedStrategy = Object.fromEntries(
    Object.entries(strategy).filter(
      ([field, written]) =>
        JSON.stringify(written) !== JSON.stringify(racePlan[field as keyof typeof strategy]),
    ),
  );
  const strategyChanged = Object.keys(changedStrategy).length > 0;
  if (!strategyChanged && target === racePlan.target) return null;
  return {
    action: 'racePlan.update',
    id: racePlan.id,
    expectedRevision: racePlan.revision,
    values: {
      ...(target === racePlan.target ? {} : { target }),
      ...changedStrategy,
      ...(strategyChanged ? { courseId } : {}),
    },
  };
}

export function raceDayCommand(
  values: RaceDayValues,
  racePlan: RacePlan | undefined,
  raceId: string,
  courseId: string | null,
): CommandInput {
  return racePlan
    ? {
        action: 'racePlan.update',
        id: racePlan.id,
        expectedRevision: racePlan.revision,
        values,
      }
    : { action: 'racePlan.create', values: { eventId: raceId, ...values, courseId } };
}

const metersPerDistanceUnit = (units: string) => (units === 'imperial' ? 1609.344 : 1000);
export const distanceFieldText = (meters: number, units: string) =>
  String(Number((meters / metersPerDistanceUnit(units)).toFixed(3)));

function cutoffFromForm(form: FormData, field: string): RacePlan['finishCutoff'] {
  const time = String(form.get(`${field}Time`));
  return time ? { dayOffset: Number(form.get(`${field}Day`)), time } : null;
}

export const startAndCutoffFromForm = (form: FormData) => ({
  startTime: String(form.get('startTime')) || null,
  finishCutoff: cutoffFromForm(form, 'finishCutoff'),
});

export function stationFromForm(
  form: FormData,
  existingStation: Station | undefined,
  units: string,
): Station {
  const distanceText = String(form.get('distance'));
  return {
    id: existingStation?.id ?? crypto.randomUUID(),
    name: String(form.get('name')).trim(),
    distanceMeters:
      existingStation && distanceText === distanceFieldText(existingStation.distanceMeters, units)
        ? existingStation.distanceMeters
        : Math.round(Number(distanceText) * metersPerDistanceUnit(units)),
    cutoff: cutoffFromForm(form, 'cutoff'),
    stopSeconds: Math.round(Number(form.get('stopMinutes')) * 60),
    water: form.get('water') === 'on',
    food: String(form.get('food')).trim(),
    dropBag: existingStation?.dropBag ?? [],
    action: String(form.get('action')).trim(),
    source: String(form.get('source')).trim(),
    verified: form.get('verified') === 'on',
  };
}

export function stationsAfterSave(stations: readonly Station[], station: Station) {
  const others = stations.filter((saved) => saved.id !== station.id);
  if (others.some((saved) => saved.distanceMeters === station.distanceMeters))
    throw new Error('Another aid station is already at this distance.');
  return [...others, station].sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export const nutritionTargetsFromForm = (form: FormData): RacePlan['nutrition']['targets'] => ({
  carbohydrateGramsPerHour: numeric(form.get('carbohydrateGramsPerHour')),
  fluidMillilitresPerHour: numeric(form.get('fluidMillilitresPerHour')),
  sodiumMilligramsPerHour: numeric(form.get('sodiumMilligramsPerHour')),
});
