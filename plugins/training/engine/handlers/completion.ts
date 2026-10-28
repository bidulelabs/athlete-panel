import {
  type Command,
  completionValuesSchema,
  canLinkSport,
  isRest,
} from '@athlete-panel/contracts';
import { effectiveDate } from '../../dates';
import type { CommandContext } from '../context';
import { fail } from '../errors';

export function handleCompletion(
  context: CommandContext,
  command: Extract<
    Command,
    { action: 'workout.complete' | 'workout.clearCompletion' | 'workout.link' | 'workout.unlink' }
  >,
): void {
  const { state, get } = context;
  switch (command.action) {
    case 'workout.complete': {
      const workout = get(state.workouts, command.id, command.expectedRevision);
      if (isRest(workout)) fail('INVALID_COMPLETION', 'Rest days cannot have recorded completion.');
      const values = completionValuesSchema.parse({
        durationSeconds: workout.completion?.durationSeconds ?? null,
        distanceMeters: workout.completion?.distanceMeters ?? null,
        rpe: workout.completion?.rpe ?? null,
        reason: workout.completion?.reason ?? '',
        ...(workout.completion?.notes !== undefined ? { notes: workout.completion.notes } : {}),
        ...command.values,
      });
      if (workout.completion?.source === 'garmin') {
        const activity = state.activities.find(
          (candidate) => candidate.id === workout.completion?.activityId,
        );
        if (!activity) fail('NOT_FOUND', 'The linked activity does not exist.');
        if (values.status === 'skipped')
          fail(
            'HISTORY_CONFLICT',
            'Unlink the actual activity before marking the workout skipped.',
          );
        if (
          values.performedDate !== activity.localDate ||
          (values.durationSeconds !== null &&
            values.durationSeconds !== activity.durationSeconds) ||
          (values.distanceMeters !== null && values.distanceMeters !== activity.distanceMeters)
        ) {
          fail(
            'HISTORY_CONFLICT',
            'Garmin supplies the actual date, duration and distance. Unlink before entering different manual actuals.',
          );
        }
        workout.completion = {
          ...workout.completion,
          status: values.status,
          reason: values.reason,
          ...(values.notes !== undefined ? { notes: values.notes } : {}),
          rpe: values.rpe,
          performedDate: activity.localDate,
          durationSeconds: activity.durationSeconds,
          distanceMeters: activity.distanceMeters,
        };
        break;
      }
      if (!effectiveDate(workout, state.plans))
        fail('INVALID_SCHEDULE', 'Schedule this plan before recording completion.');
      const skipped = values.status === 'skipped';
      workout.completion = {
        ...values,
        source: 'manual',
        activityId: null,
        durationSeconds: skipped ? null : values.durationSeconds,
        distanceMeters: skipped ? null : values.distanceMeters,
        rpe: skipped ? null : values.rpe,
      };
      break;
    }
    case 'workout.clearCompletion': {
      const workout = get(state.workouts, command.id, command.expectedRevision);
      if (isRest(workout)) fail('INVALID_COMPLETION', 'Rest days cannot have recorded completion.');
      if (workout.completion?.source === 'garmin')
        fail('HISTORY_CONFLICT', 'Use unlink to remove an imported completion.');
      workout.completion = null;
      break;
    }
    case 'workout.link': {
      const workout = get(state.workouts, command.id, command.expectedRevision);
      if (isRest(workout)) fail('INVALID_COMPLETION', 'Rest days cannot have recorded completion.');
      const activity = state.activities.find((candidate) => candidate.id === command.activityId);
      if (!activity) fail('NOT_FOUND', 'Imported activity does not exist.');
      if (!effectiveDate(workout, state.plans))
        fail('INVALID_SCHEDULE', 'Schedule this plan before linking an activity.');
      if (!canLinkSport(workout, activity))
        fail(
          'INVALID_LINK',
          'Link an activity with the same Garmin sport group and the prescribed subgroup.',
        );
      if (
        state.workouts.some(
          (candidate) =>
            candidate.id !== workout.id && candidate.completion?.activityId === activity.id,
        )
      )
        fail('ALREADY_LINKED', 'This activity is already linked to another workout.');
      if (workout.completion?.source === 'garmin' && workout.completion.activityId !== activity.id)
        fail('ALREADY_LINKED', 'Unlink the current activity before linking another.');
      if (workout.completion?.status === 'skipped')
        fail('HISTORY_CONFLICT', 'Clear skipped completion before linking an actual activity.');
      workout.completion = {
        status: workout.completion?.status ?? 'completed',
        source: 'garmin',
        performedDate: activity.localDate,
        durationSeconds: activity.durationSeconds,
        distanceMeters: activity.distanceMeters,
        activityId: activity.id,
        rpe: workout.completion?.rpe ?? null,
        reason: workout.completion?.reason ?? '',
        ...(workout.completion?.notes !== undefined ? { notes: workout.completion.notes } : {}),
      };
      break;
    }
    case 'workout.unlink': {
      const workout = get(state.workouts, command.id, command.expectedRevision);
      if (isRest(workout)) fail('INVALID_COMPLETION', 'Rest days cannot have recorded completion.');
      if (workout.completion?.source !== 'garmin')
        fail('INVALID_LINK', 'This workout has no linked activity.');
      // Old manual actuals are intentionally not an active fallback. Imported
      // activity remains in history and continues to count exactly once.
      workout.completion = null;
      break;
    }
  }
}
