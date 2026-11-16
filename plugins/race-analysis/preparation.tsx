'use client';

import { useState } from 'react';
import {
  Button,
  ErrorMessage,
  Field,
  Input,
  PageHeader,
  SubmitButton,
  Textarea,
  dateLabel,
  distance,
  duration,
  startOfWeek,
  useAction,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import type { RaceAnalysis, RacePlan } from '@athlete-panel/contracts';
import { mutate } from '../training/public/client';
import { targetRangeLabel, todayInTimeZone } from '../training/public/shared';
import { weeksUntilRace } from './preparation-weeks';
import { pacingRows, racePlanCommand, strategyNeedsReview } from './race-plan-form';

export function Preparation({
  race,
  course,
  data,
  request,
}: Pick<PluginPageProps, 'data' | 'request'> & Pick<RaceAnalysis, 'race' | 'course'>) {
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<{ racePlan: RacePlan | undefined } | null>(null);
  const savedPlan = data.racePlans.find((candidate) => candidate.eventId === race.id);
  const racePlan = draft ? draft.racePlan : savedPlan;
  const courseId = course?.id ?? null;
  const rows = pacingRows(racePlan?.pacing ?? [], course?.analysis.sections ?? []);
  const units = data.profile?.units ?? 'metric';
  const { envelope, weekStartsOn } = useWorkspace();
  const weeks = weeksUntilRace(
    data,
    startOfWeek(todayInTimeZone(data.profile?.timezone), weekStartsOn),
    race.date,
  );
  const agentBridgeEnabled = envelope.plugins.some(
    (plugin) => plugin.id === 'agent-bridge' && plugin.enabled,
  );
  return (
    <div className="race-analysis" aria-busy={action.busy}>
      <PageHeader
        eyebrow="Race / Preparation"
        title={race.title}
        description={dateLabel(race.date, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      />
      {savedPlan && strategyNeedsReview(savedPlan, courseId) && (
        <div className="race-recovery" role="status">
          <p>
            The course or your target changed after this strategy was written. Check that it still
            holds.
          </p>
          {draft ? (
            <p>Save your changes before marking the plan as reviewed.</p>
          ) : (
            <Button
              variant="outline"
              disabled={action.busy}
              onClick={() =>
                void action.run(() =>
                  mutate(request, [
                    {
                      action: 'racePlan.update',
                      id: savedPlan.id,
                      expectedRevision: savedPlan.revision,
                      values: { courseId },
                    },
                  ]),
                )
              }
            >
              Mark as reviewed
            </Button>
          )}
        </div>
      )}
      <form
        key={racePlan?.revision ?? 0}
        className="race-form"
        onChange={() => {
          setSaved(false);
          if (!draft) setDraft({ racePlan: savedPlan });
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const command = racePlanCommand(
            new FormData(event.currentTarget),
            rows,
            racePlan,
            race.id,
            courseId,
          );
          if (!command) setDraft(null);
          else
            void action.run(
              () => mutate(request, [command]),
              () => {
                setSaved(true);
                setDraft(null);
              },
            );
        }}
      >
        <Field label="Target" hint="What you want from this race. Only you set it.">
          <Input
            name="target"
            readOnly={action.busy}
            maxLength={120}
            defaultValue={racePlan?.target ?? ''}
            placeholder="Finish comfortably"
          />
        </Field>
        <Field label="Briefing">
          <Textarea
            name="briefing"
            readOnly={action.busy}
            rows={6}
            maxLength={4000}
            defaultValue={racePlan?.briefing ?? ''}
          />
        </Field>
        <fieldset className="race-pacing">
          <legend>Pacing by section</legend>
          {rows.length === 0 && (
            <p className="race-hint">
              Upload the course GPX in the Course tab to plan your effort section by section.
            </p>
          )}
          {rows.map((row) => (
            <Field
              key={row.fromMeters}
              label={`${distance(row.fromMeters, units)}–${distance(row.toMeters, units)}`}
            >
              <Input
                name="effort"
                readOnly={action.busy}
                maxLength={120}
                defaultValue={row.effort}
              />
            </Field>
          ))}
        </fieldset>
        <Field label="Assumptions" hint="One per line.">
          <Textarea
            name="assumptions"
            readOnly={action.busy}
            rows={3}
            defaultValue={racePlan?.assumptions.join('\n') ?? ''}
          />
        </Field>
        <Field label="Open questions" hint="One per line.">
          <Textarea
            name="openQuestions"
            readOnly={action.busy}
            rows={3}
            defaultValue={racePlan?.openQuestions.join('\n') ?? ''}
          />
        </Field>
        <ErrorMessage error={action.error} />
        <div className="race-save-bar">
          <span role="status">{saved ? 'Preparation saved.' : ''}</span>
          {draft && draft.racePlan?.revision !== savedPlan?.revision && (
            <>
              <span>
                The saved plan has changed. Your draft is retained; choose Use saved plan to start
                again from the latest values.
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={action.busy}
                onClick={() => {
                  setDraft(null);
                  action.setError(null);
                }}
              >
                Use saved plan
              </Button>
            </>
          )}
          <SubmitButton busy={action.busy}>Save preparation</SubmitButton>
        </div>
      </form>
      {agentBridgeEnabled && (
        <section className="race-agent" aria-labelledby="race-agent-title">
          <h2 id="race-agent-title">Prepare this race with an agent</h2>
          <p className="race-hint">
            Connect an agent to this race. It reads the course summary and proposes the race plan,
            phases and workouts. Nothing changes until you review and apply its proposal.
          </p>
          <a href="/agent">Open Agent workspace</a>
        </section>
      )}
      {weeks.length > 0 && (
        <section aria-labelledby="race-weeks-title">
          <h2 id="race-weeks-title">Weeks until race day</h2>
          <div
            className="race-weeks-scroll"
            role="region"
            aria-labelledby="race-weeks-title"
            tabIndex={0}
          >
            <table className="race-weeks">
              <thead>
                <tr>
                  <th scope="col">Week of</th>
                  <th scope="col">Phase</th>
                  <th scope="col">Target</th>
                  <th scope="col">Planned</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week.weekStart}>
                    <th scope="row">{dateLabel(week.weekStart)}</th>
                    <td>{week.phaseName ?? 'No phase'}</td>
                    <td>{targetRangeLabel(week.weeklyDurationTarget, duration)}</td>
                    <td>
                      {week.plannedSessions
                        ? `${week.plannedSessions} session${week.plannedSessions === 1 ? '' : 's'} · ${duration(week.plannedDurationSeconds)}`
                        : 'Nothing planned'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <a href="/calendar">Open calendar</a>
        </section>
      )}
    </div>
  );
}
