import { operationContracts } from '@athlete-panel/contracts';
import { readTransaction } from '../../packages/host/src/db';
import { assert } from '../../packages/host/src/errors';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';

export default {
  operations: {
    'download-gpx': async (body, context) => {
      assert(context.actor === 'owner', 'forbidden', 'Only the owner can download a route.', 403);
      const { id } = operationContracts['activity-records']['download-gpx'].input.parse(body);
      return readTransaction(async (tx) => {
        const [row] = await tx<{ gpx: string; date: string }[]>`
          select gpx,data->>'localDate' as date from activity_records.routes
          join activity_records.records on kind='activity' and id=activity_id and not deleted
          where activity_id=${id}`;
        assert(row, 'route_unavailable', 'This activity has no GPS route to download.', 404);
        return { filename: `apple-health-${row.date}.gpx`, gpx: row.gpx };
      });
    },
  },
} satisfies ServerPlugin;
