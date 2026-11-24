import { RecordRepository } from '../../packages/host/src/records';
import {
  planSchema,
  workoutSchema,
  noteSchema,
  eventSchema,
  periodSchema,
  racePlanSchema,
  rehearsalSchema,
  type Plan,
  type Workout,
  type Note,
  type TrainingEvent,
  type Period,
  type RacePlan,
  type Rehearsal,
} from '@athlete-panel/contracts';
export const trainingRepository = new RecordRepository<
  Plan | Workout | Note | TrainingEvent | Period | RacePlan | Rehearsal
>('training', {
  plan: planSchema,
  workout: workoutSchema,
  note: noteSchema,
  event: eventSchema,
  period: periodSchema,
  racePlan: racePlanSchema,
  rehearsal: rehearsalSchema,
});
