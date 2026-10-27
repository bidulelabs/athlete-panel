import { RecordRepository } from '../../packages/host/src/records';
import {
  planSchema,
  workoutSchema,
  noteSchema,
  eventSchema,
  type Plan,
  type Workout,
  type Note,
  type TrainingEvent,
} from '@athlete-panel/contracts';
export const trainingRepository = new RecordRepository<Plan | Workout | Note | TrainingEvent>(
  'training',
  { plan: planSchema, workout: workoutSchema, note: noteSchema, event: eventSchema },
);
