'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorMessage,
  duration,
  useAction,
  useConfirm,
  type PluginPageProps,
} from '@athlete-panel/ui';
import {
  RACE_SCENARIO_LIMIT,
  type RaceAnalysis,
  type RaceScenario,
} from '@athlete-panel/contracts';
import { mutate } from '../training/public/client';
import { clockTime, effortAndWeatherText, finishTime } from './presentation';
import { ScenarioDialog } from './scenario-dialog';
import { duplicateScenarioCommand } from './scenario-form';
import { scenarioOutcome, scenarioOutdatedReasons } from './scenarios';

type Outcome = ReturnType<typeof scenarioOutcome>;

const finishText = ({ finish }: Outcome) =>
  finish.timeOfDay
    ? clockTime(finish.timeOfDay.seconds)
    : finish.fromStart
      ? `${finishTime(finish.fromStart.seconds)} after the start`
      : 'Unknown';

export function Scenarios({
  race,
  course,
  estimate,
  estimateReasons,
  data,
  request,
  onOpenCourse,
}: Pick<PluginPageProps, 'data' | 'request'> &
  Pick<RaceAnalysis, 'race' | 'course' | 'estimate' | 'estimateReasons'> & {
    onOpenCourse: () => void;
  }) {
  const action = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<string | null>(null);
  const racePlan = data.racePlans.find((candidate) => candidate.eventId === race.id);
  const scenarios = data.raceScenarios
    .filter((scenario) => scenario.eventId === race.id)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const units = data.profile?.units ?? 'metric';
  const courseId = course?.id ?? null;
  const atLimit = scenarios.length >= RACE_SCENARIO_LIMIT;
  const outcomeOf = (scenario: Parameters<typeof scenarioOutcome>[3]) =>
    scenarioOutcome(estimate, course?.analysis.sections ?? [], racePlan!, scenario, {
      products: data.profile?.nutrition?.products ?? [],
      carryCapacityMillilitres: data.profile?.nutrition?.carryCapacityMillilitres ?? null,
    });
  const scenarioBeingEdited = scenarios.find((scenario) => scenario.id === editing);
  const newScenarioButton = (
    <Button
      disabled={atLimit || action.busy}
      aria-describedby={atLimit ? 'race-scenario-limit' : undefined}
      onClick={() => setEditing('new')}
    >
      New scenario
    </Button>
  );
  async function deleteScenario(scenario: RaceScenario) {
    if (await confirm(`Delete the scenario ${scenario.name}? Undo it from History.`, 'Delete'))
      await action.run(() =>
        mutate(request, [
          { action: 'raceScenario.delete', id: scenario.id, expectedRevision: scenario.revision },
        ]),
      );
  }
  return (
    <div className="race-analysis race-scenarios" aria-busy={action.busy}>
      <section className="race-estimate" aria-labelledby="race-scenarios-title">
        <h2 id="race-scenarios-title">Compare race-day options</h2>
        <p className="race-hint">
          Each scenario changes your effort, stops or weather assumption. Your plan stays as it is.
        </p>
        {!racePlan ? (
          <EmptyState icon={<Flag size={25} />} title="Save a race plan first">
            Scenarios start from the race plan. Save one in Preparation or Race day, then come back.
          </EmptyState>
        ) : (
          <>
            {!estimate && (
              <div className="race-data-notice" role="status">
                <strong>Finish times need a course estimate</strong>
                {estimateReasons.map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
                <p>Until then, scenarios compare stops and cutoffs only.</p>
                <Button variant="outline" onClick={onOpenCourse}>
                  Open Course
                </Button>
              </div>
            )}
            {scenarios.length === 0 && (
              <EmptyState
                icon={<Flag size={25} />}
                title="Compare options before choosing"
                action={newScenarioButton}
              >
                Try a calmer or faster effort, longer stops, or a hot-day assumption. Your plan
                stays as it is until you apply one.
              </EmptyState>
            )}
            {scenarios.length > 0 && (
              <div className="race-scenario-toolbar">
                {newScenarioButton}
                {atLimit && (
                  <p id="race-scenario-limit" className="race-hint">
                    A race holds at most {RACE_SCENARIO_LIMIT} scenarios. Delete one to add another.
                  </p>
                )}
              </div>
            )}
            {scenarios.length > 0 && (
              <ul className="race-scenario-list" role="list">
                {scenarios.map((scenario) => {
                  const outcome = outcomeOf(scenario);
                  const outdatedReasons = scenarioOutdatedReasons(
                    racePlan,
                    courseId,
                    estimate,
                    scenario,
                    units,
                  );
                  return (
                    <li key={scenario.id} className="race-scenario">
                      <div>
                        <strong>{scenario.name}</strong>
                        {outdatedReasons.length > 0 && <Badge variant="outline">Outdated</Badge>}
                        <small>
                          {effortAndWeatherText(scenario) ?? 'No effort or weather change'} ·{' '}
                          {duration(outcome.stopSeconds)} of stops
                        </small>
                        {outdatedReasons.map((reason, position) => (
                          <small key={position} className="race-late">
                            {reason}
                          </small>
                        ))}
                      </div>
                      <span className="race-scenario-finish">
                        <small>Finish</small>
                        {finishText(outcome)}
                      </span>
                      <div className="race-scenario-actions">
                        <Button
                          variant="ghost"
                          aria-label={`Edit ${scenario.name}`}
                          disabled={action.busy}
                          onClick={() => setEditing(scenario.id)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`Duplicate ${scenario.name}`}
                          aria-describedby={atLimit ? 'race-scenario-limit' : undefined}
                          disabled={atLimit || action.busy}
                          onClick={() =>
                            void action.run(() =>
                              mutate(request, [duplicateScenarioCommand(scenario)]),
                            )
                          }
                        >
                          Duplicate
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`Delete ${scenario.name}`}
                          disabled={action.busy}
                          onClick={() => void deleteScenario(scenario)}
                        >
                          Delete
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        <ErrorMessage error={action.error} />
      </section>
      {racePlan && (editing === 'new' || scenarioBeingEdited) && (
        <ScenarioDialog
          scenario={scenarioBeingEdited}
          racePlan={racePlan}
          courseId={courseId}
          courseEstimateSeconds={estimate?.seconds ?? null}
          outdated={
            scenarioBeingEdited !== undefined &&
            scenarioOutdatedReasons(racePlan, courseId, estimate, scenarioBeingEdited, units)
              .length > 0
          }
          units={units}
          finishOf={(draft) => finishText(outcomeOf(draft))}
          onSave={(command) => mutate(request, [command])}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
