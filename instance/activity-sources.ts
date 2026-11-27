import {
  activityProviderSchema,
  activitySourceChoicesSchema,
  type ActivityProvider,
  type ActivitySources,
} from '@athlete-panel/contracts';
import { connection, transaction, type Transaction } from '../packages/host/src/db';
import { assert } from '../packages/host/src/errors';
import { pluginEnabled } from '../packages/host/src/plugins';

async function savedSourceChoices(sql: Transaction | ReturnType<typeof connection> = connection()) {
  const [row] = await sql<{ value: unknown }[]>`
    select value from host.settings where key='activitySources'`;
  return row ? activitySourceChoicesSchema.parse(row.value) : [];
}

export async function chooseActivitySource(source: ActivityProvider) {
  assert(pluginEnabled(source), 'plugin_disabled', 'This activity source is disabled.', 404);
  return transaction(async (tx) => {
    const selected = await savedSourceChoices(tx);
    if (!selected.includes(source)) {
      await tx`insert into host.settings(key,value) values ('activitySources',${tx.json([...selected, source])})
        on conflict(key) do update set value=excluded.value`;
    }
    return { source };
  });
}

async function readAppleHealth() {
  if (!pluginEnabled('apple-health')) return null;
  const { readAppleHealthConnection } = await import('../plugins/apple-health/public/server');
  return readAppleHealthConnection();
}

export async function readActivitySources(garminConnected: boolean): Promise<ActivitySources> {
  const [saved, appleHealth] = await Promise.all([savedSourceChoices(), readAppleHealth()]);
  const selected = new Set(saved);
  if (garminConnected) selected.add('garmin');
  if (appleHealth?.connected) selected.add('apple-health');
  return {
    selected: activityProviderSchema.options.filter(
      (source) => selected.has(source) && pluginEnabled(source),
    ),
    appleHealth,
  };
}
