'use client';

import { useState } from 'react';
import { canLinkSport, sportSelectionLabel, type Activity } from '@athlete-panel/contracts';
import {
  Button,
  Modal,
  Field,
  NativeSelect,
  ErrorMessage,
  EmptyState,
  dateLabel,
  duration,
  distance,
  useAction,
  useWorkspace,
} from '@athlete-panel/ui';
import { isLinkableWorkout, matchingDate } from './activity-matching';
import { mutate } from './editors';

export function LinkWorkoutDialog({
  activity,
  onClose,
}: {
  activity: Activity;
  onClose: () => void;
}) {
  const { data, request } = useWorkspace();
  const action = useAction();
  // Keep the reviewed revisions for the lifetime of this draft, including failed refreshes.
  const [candidates] = useState(() =>
    data.workouts
      .filter(
        (workout) => isLinkableWorkout(workout, data.plans) && canLinkSport(workout, activity),
      )
      .map((workout) => ({ workout, date: matchingDate(workout, data.plans)! }))
      .sort(
        (a, b) =>
          Number(b.date === activity.localDate) - Number(a.date === activity.localDate) ||
          a.date.localeCompare(b.date) ||
          a.workout.title.localeCompare(b.workout.title),
      ),
  );
  const [selected, setSelected] = useState('');
  const candidate = candidates.find(({ workout }) => workout.id === selected);
  return (
    <Modal
      open
      onClose={onClose}
      title="Link workout"
      description={`Choose the workout for ${activity.title || 'this Garmin activity'}.`}
    >
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (candidate)
            void action.run(
              () =>
                mutate(request, [
                  {
                    action: 'workout.link',
                    id: candidate.workout.id,
                    expectedRevision: candidate.workout.revision,
                    activityId: activity.id,
                  },
                ]),
              onClose,
            );
        }}
      >
        <p>
          Recorded {dateLabel(activity.localDate)} · {duration(activity.durationSeconds)} ·{' '}
          {distance(activity.distanceMeters, data.profile?.units)}
        </p>
        {candidates.length ? (
          <>
            <Field label="Workout">
              <NativeSelect
                required
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">Choose a workout</option>
                {candidates.map(({ workout, date }) => (
                  <option key={workout.id} value={workout.id}>
                    {date === activity.localDate ? 'Same day · ' : ''}
                    {dateLabel(date)} · {workout.title} · {sportSelectionLabel(workout)} · Planned{' '}
                    {duration(workout.durationSeconds)}
                    {workout.distanceMeters !== null
                      ? ` · ${distance(workout.distanceMeters, data.profile?.units)}`
                      : ''}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {candidate?.workout.completion && (
              <p className="form-footnote">
                Garmin measurements replace the manually logged{' '}
                {duration(candidate.workout.completion.durationSeconds)} ·{' '}
                {distance(candidate.workout.completion.distanceMeters, data.profile?.units)}.
                Status, notes and effort are kept.
              </p>
            )}
            <p className="form-footnote">
              The activity is counted once in recorded totals. Linking does not change the planned
              date.
            </p>
          </>
        ) : (
          <EmptyState title="No compatible unlinked workouts">
            Schedule a workout with a matching sport group and subgroup before linking.
          </EmptyState>
        )}
        <ErrorMessage error={action.error} />
        <div className="dialog-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={action.busy || !candidate}>
            {action.busy ? 'Linking…' : 'Link workout'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
