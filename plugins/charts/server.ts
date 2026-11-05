import {
  chartsSummaryInputSchema,
  emptyWorkspace,
  type Activity,
  type Plan,
  type TrainingEvent,
  type Workout,
} from '@athlete-panel/contracts';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';
import { connection } from '../../packages/host/src/db';
import { repositories } from '../../instance/services';
import { addDays } from '../training/public/shared';
import { chartsSummary } from './summary';

async function summary(body: unknown) {
  const input = chartsSummaryInputSchema.parse(body);
  const range = { from: input.weekStart, to: addDays(input.weekStart, input.weeks * 7 - 1) };
  const state = await connection().begin(
    'isolation level repeatable read read only',
    async (tx) => ({
      ...emptyWorkspace(),
      plans: (await repositories.plan.list('plan', tx)) as Plan[],
      workouts: (await repositories.workout.list('workout', tx)) as Workout[],
      events: (await repositories.event.list('event', tx)) as TrainingEvent[],
      activities: (await repositories.activity.select('activity', { range }, tx)) as Activity[],
    }),
  );
  return chartsSummary(state, input);
}

export default { operations: { summary } } satisfies ServerPlugin;
