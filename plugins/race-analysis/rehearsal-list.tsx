'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, dateLabel, duration, localDate, type PluginPageProps } from '@athlete-panel/ui';
import type { RaceAnalysis } from '@athlete-panel/contracts';
import { ToleranceBadge } from '../athlete/public/client';
import { mutate } from '../training/public/client';
import { RehearsalDialog } from './rehearsal-dialog';
import {
  isCompletedOrPartial,
  plannedItems,
  rehearsalEmptyStateHint,
  rehearsalSummaryText,
  rehearsalWindowStart,
  rehearsalsOfRace,
  type RehearsalValues,
  sessionsWithoutRehearsal,
} from './rehearsal';

export function RehearsalsCard({
  race,
  data,
  request,
}: Pick<PluginPageProps, 'data' | 'request'> & Pick<RaceAnalysis, 'race'>) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const loggedRehearsals = rehearsalsOfRace(data.rehearsals, data.workouts, race.id);
  const sessions = sessionsWithoutRehearsal(
    data.workouts,
    data.rehearsals,
    race.id,
    rehearsalWindowStart(localDate(new Date(), data.profile?.timezone)),
  );
  const schedule =
    data.racePlans.find((racePlan) => racePlan.eventId === race.id)?.nutrition.schedule ?? [];
  const products = data.profile?.nutrition?.products ?? [];
  const hasPlannedProducts = plannedItems(schedule, products, null).length > 0;
  const rehearsalBeingEdited = data.rehearsals.find((rehearsal) => rehearsal.id === editingId);
  const emptyStateHint = rehearsalEmptyStateHint(
    hasPlannedProducts,
    sessions.length,
    loggedRehearsals.length,
  );
  const save = (workoutId: string, values: Partial<RehearsalValues>) =>
    mutate(request, [
      rehearsalBeingEdited
        ? {
            action: 'rehearsal.update',
            id: rehearsalBeingEdited.id,
            expectedRevision: rehearsalBeingEdited.revision,
            values,
          }
        : {
            action: 'rehearsal.create',
            values: { eventId: race.id, workoutId, ...(values as RehearsalValues) },
          },
    ]);
  return (
    <section className="race-estimate" aria-labelledby="race-rehearsals-title">
      <div className="race-section-heading">
        <div>
          <h2 id="race-rehearsals-title">Fueling rehearsals</h2>
          <p className="race-hint">
            Logged on completed long sessions. A missing log does not mean poor tolerance.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!hasPlannedProducts || sessions.length === 0}
          onClick={() => setEditingId('new')}
        >
          <Plus size={15} />
          Log a fueling rehearsal
        </Button>
      </div>
      {emptyStateHint && <p className="race-hint">{emptyStateHint}</p>}
      {loggedRehearsals.length > 0 && (
        <table className="race-stations race-rehearsals">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Session</th>
              <th scope="col">Stomach</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loggedRehearsals.map(({ rehearsal, workout }) => (
              <tr key={rehearsal.id}>
                <th scope="row">
                  {workout.completion ? dateLabel(workout.completion.performedDate) : 'No date'}
                </th>
                <td data-label="Session">
                  <strong>
                    {[
                      workout.title,
                      workout.completion?.durationSeconds != null &&
                        duration(workout.completion.durationSeconds),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </strong>
                  <small>{rehearsalSummaryText(rehearsal, workout)}</small>
                  {rehearsal.lesson && (
                    <small className="race-rehearsal-lesson" title={rehearsal.lesson}>
                      {rehearsal.lesson}
                    </small>
                  )}
                  {!isCompletedOrPartial(workout) && (
                    <small>Session no longer marked completed</small>
                  )}
                </td>
                <td data-label="Stomach">
                  <ToleranceBadge tolerance={rehearsal.stomach} />
                </td>
                <td className="race-station-actions">
                  <Button
                    variant="outline"
                    aria-label={`Edit fueling rehearsal of ${workout.title}`}
                    onClick={() => setEditingId(rehearsal.id)}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(editingId === 'new' || rehearsalBeingEdited) && (
        <RehearsalDialog
          raceTitle={race.title}
          rehearsal={rehearsalBeingEdited}
          sessions={
            rehearsalBeingEdited
              ? data.workouts.filter((workout) => workout.id === rehearsalBeingEdited.workoutId)
              : sessions
          }
          schedule={schedule}
          products={products}
          units={data.profile?.units}
          onSave={save}
          onDelete={() =>
            mutate(request, [
              {
                action: 'rehearsal.delete',
                id: rehearsalBeingEdited!.id,
                expectedRevision: rehearsalBeingEdited!.revision,
              },
            ])
          }
          onClose={() => setEditingId(null)}
        />
      )}
    </section>
  );
}
