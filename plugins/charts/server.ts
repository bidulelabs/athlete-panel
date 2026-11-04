import { chartsSummaryInputSchema } from '@athlete-panel/contracts';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';
import { transaction } from '../../packages/host/src/db';
import { loadWorkspace } from '../../instance/services';
import { addDays } from '../training/public/shared';
import { chartsSummary } from './summary';

async function summary(body: unknown) {
  const input = chartsSummaryInputSchema.parse(body);
  const range = { from: input.weekStart, to: addDays(input.weekStart, input.weeks * 7 - 1) };
  const state = await transaction((tx) => loadWorkspace(tx, range), { allowMaintenance: true });
  return chartsSummary(state, input);
}

export default { operations: { summary } } satisfies ServerPlugin;
