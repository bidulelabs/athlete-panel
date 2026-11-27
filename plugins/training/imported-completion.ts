import {
  canLinkSport,
  type Activity,
  type EntityChange,
  type Workout,
} from '@athlete-panel/contracts';
import { fail } from './engine/errors';

/** Refresh a linked actual or return its planned session to planned. The caller audits removals. */
export function reconcileImportedCompletion(
  workout: Workout,
  activity: Activity | null,
): EntityChange | null {
  const completion = workout.completion;
  if (!completion?.activityId) return null;
  if (activity) {
    if (activity.id !== completion.activityId || !canLinkSport(workout, activity))
      fail('INVALID_LINK', 'The corrected activity needs a compatible planned workout.');
    if (
      completion.performedDate === activity.localDate &&
      completion.durationSeconds === activity.durationSeconds &&
      completion.distanceMeters === activity.distanceMeters
    )
      return null;
  }
  return {
    entity: 'workout',
    id: workout.id,
    before: workout,
    after: {
      ...workout,
      revision: workout.revision + 1,
      completion: activity
        ? {
            ...completion,
            performedDate: activity.localDate,
            durationSeconds: activity.durationSeconds,
            distanceMeters: activity.distanceMeters,
          }
        : null,
    },
  };
}
