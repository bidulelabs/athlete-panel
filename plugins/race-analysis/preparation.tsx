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
  useAction,
  type PluginPageProps,
} from '@athlete-panel/ui';
import type { RaceAnalysis } from '@athlete-panel/contracts';
import { mutate } from '../training/public/client';
import { pacingRows, racePlanCommand, strategyNeedsReview } from './race-plan-form';

export function Preparation({
  race,
  course,
  data,
  request,
}: Pick<PluginPageProps, 'data' | 'request'> & Pick<RaceAnalysis, 'race' | 'course'>) {
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const racePlan = data.racePlans.find((candidate) => candidate.eventId === race.id);
  const courseId = course?.id ?? null;
  const rows = pacingRows(racePlan?.pacing ?? [], course?.analysis.sections ?? []);
  const units = data.profile?.units ?? 'metric';
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
      {racePlan && strategyNeedsReview(racePlan, courseId) && (
        <div className="race-recovery" role="status">
          <p>
            The course or your target changed after this strategy was written. Check that it still
            holds.
          </p>
          <Button
            variant="outline"
            disabled={action.busy}
            onClick={() =>
              void action.run(() =>
                mutate(request, [
                  {
                    action: 'racePlan.update',
                    id: racePlan.id,
                    expectedRevision: racePlan.revision,
                    values: { courseId },
                  },
                ]),
              )
            }
          >
            Mark as reviewed
          </Button>
        </div>
      )}
      <form
        key={racePlan?.revision ?? 0}
        className="race-form"
        onChange={() => setSaved(false)}
        onSubmit={(event) => {
          event.preventDefault();
          const command = racePlanCommand(
            new FormData(event.currentTarget),
            rows,
            racePlan,
            race.id,
            courseId,
          );
          if (command)
            void action.run(
              () => mutate(request, [command]),
              () => setSaved(true),
            );
        }}
      >
        <Field label="Target" hint="What you want from this race. Only you set it.">
          <Input
            name="target"
            maxLength={120}
            defaultValue={racePlan?.target ?? ''}
            placeholder="Finish comfortably"
          />
        </Field>
        <Field label="Briefing">
          <Textarea
            name="briefing"
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
              <Input name="effort" maxLength={120} defaultValue={row.effort} />
            </Field>
          ))}
        </fieldset>
        <Field label="Assumptions" hint="One per line.">
          <Textarea
            name="assumptions"
            rows={3}
            defaultValue={racePlan?.assumptions.join('\n') ?? ''}
          />
        </Field>
        <Field label="Open questions" hint="One per line.">
          <Textarea
            name="openQuestions"
            rows={3}
            defaultValue={racePlan?.openQuestions.join('\n') ?? ''}
          />
        </Field>
        <ErrorMessage error={action.error} />
        <div className="race-save-bar">
          <span role="status">{saved ? 'Preparation saved.' : ''}</span>
          <SubmitButton busy={action.busy}>Save preparation</SubmitButton>
        </div>
      </form>
    </div>
  );
}
