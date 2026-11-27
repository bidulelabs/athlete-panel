import { operationContracts } from '@athlete-panel/contracts';
import { loadWorkspace } from '../../instance/services';
import { transaction } from '../../packages/host/src/db';
import { assert } from '../../packages/host/src/errors';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';
import { appleActivitiesForSource } from '../activity-records/public/server';
import { linkedWorkouts, persistRetractions } from './import';
import { connectionStatus, disconnect, issueToken, status } from './repository';

export default {
  operations: {
    status: () => status(),
    'issue-token': () => issueToken(),
    disconnect: () => disconnect(),
    'set-source': async (body) => {
      const { name, excluded } = operationContracts['apple-health']['set-source'].input.parse(body);
      return transaction(async (tx) => {
        const [source] = await tx<{ excluded: boolean }[]>`
          select excluded from apple_health.sources where name=${name}`;
        assert(source, 'not_found', 'This recording source has not uploaded any workouts.', 404);
        if (source.excluded === excluded) return connectionStatus(tx);
        if (excluded) {
          const existing = await appleActivitiesForSource(tx, name);
          const state = await loadWorkspace(tx, undefined, { records: 'linked' });
          await persistRetractions(tx, existing, 'excluded', linkedWorkouts(state.workouts));
        }
        await tx`update apple_health.sources set excluded=${excluded} where name=${name}`;
        return connectionStatus(tx);
      });
    },
  },
} satisfies ServerPlugin;
