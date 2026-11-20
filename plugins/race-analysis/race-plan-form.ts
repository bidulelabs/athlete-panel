import type { CommandInput, CourseSection, RacePlan } from '@athlete-panel/contracts';

type Pacing = RacePlan['pacing'];

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

export const strategyNeedsReview = (racePlan: RacePlan, courseId: string | null) =>
  (racePlan.briefing !== '' ||
    racePlan.pacing.length > 0 ||
    racePlan.assumptions.length > 0 ||
    racePlan.openQuestions.length > 0) &&
  (racePlan.writtenFor.courseId !== courseId || racePlan.writtenFor.target !== racePlan.target);

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
