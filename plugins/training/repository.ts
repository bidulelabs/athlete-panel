import { RecordRepository } from '../../packages/host/src/records';
import {
  planSchema,
  workoutSchema,
  noteSchema,
  eventSchema,
  periodSchema,
  racePlanSchema,
  type Plan,
  type Workout,
  type Note,
  type TrainingEvent,
  type Period,
  type RacePlan,
} from '@athlete-panel/contracts';
export const trainingRepository = new RecordRepository<
  Plan | Workout | Note | TrainingEvent | Period | RacePlan
>('training', {
  plan: planSchema,
  workout: workoutSchema,
  note: noteSchema,
  event: eventSchema,
  period: periodSchema,
  racePlan: racePlanSchema,
});
