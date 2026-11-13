import { RecordRepository } from '../../packages/host/src/records';
import {
  planSchema,
  workoutSchema,
  noteSchema,
  eventSchema,
  periodSchema,
  type Plan,
  type Workout,
  type Note,
  type TrainingEvent,
  type Period,
} from '@athlete-panel/contracts';
export const trainingRepository = new RecordRepository<
  Plan | Workout | Note | TrainingEvent | Period
>('training', {
  plan: planSchema,
  workout: workoutSchema,
  note: noteSchema,
  event: eventSchema,
  period: periodSchema,
});
