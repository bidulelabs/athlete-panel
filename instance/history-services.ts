/** Composition only: every query and date/projection rule belongs to its owning plugin. */
import type { HistoryScope, HistorySelection } from '../packages/contracts/src';
import type { Transaction } from '../packages/host/src/db';
import { pluginEnabled } from '../packages/host/src/plugins';
import {
  readRecordsHistory,
  recordsHistoryVersion,
  recordsHistoryAvailability,
} from '../plugins/activity-records/public/server';
import {
  readTrainingHistory,
  trainingHistoryVersion,
  trainingHistoryAvailability,
} from '../plugins/training/public/server';
import {
  readAthleteHistory,
  athleteHistoryVersion,
  historicalProfile,
  athleteHistoryAvailability,
} from '../plugins/athlete/public/server';
import {
  readHistoryCoverage,
  garminHistoryVersion,
  garminHistoryAvailability,
} from '../plugins/garmin/public/server';
export { historicalProfile };
function coverageStreams(scope: HistoryScope) {
  return [
    ...(scope.categories.includes('activities') ? ['activities'] : []),
    ...(scope.categories.includes('health')
      ? ['sleep', 'daily', 'hrv', 'steps', 'stress', 'bodyBattery']
      : []),
  ];
}
export async function historicalAvailability(
  tx: Transaction,
  q: Pick<HistorySelection, 'category' | 'from' | 'to'>,
  scope: HistoryScope,
) {
  if (q.category === 'activities' || q.category === 'health')
    return recordsHistoryAvailability(tx, q);
  if (q.category === 'injuries') return athleteHistoryAvailability(tx, q);
  if (q.category === 'coverage')
    return pluginEnabled('garmin')
      ? garminHistoryAvailability(tx, q, coverageStreams(scope))
      : { category: 'coverage' as const, count: 0, from: null, to: null };
  return trainingHistoryAvailability(tx, q);
}
export async function historyVersions(tx: Transaction, scope: HistoryScope) {
  const versions: Record<string, string> = {};
  if (scope.categories.some((c) => c === 'activities' || c === 'health')) {
    versions.records = await recordsHistoryVersion(tx);
    versions.coverage = pluginEnabled('garmin') ? await garminHistoryVersion(tx) : 'disabled';
  }
  if (scope.categories.some((c) => c === 'training' || c === 'context'))
    versions.training = await trainingHistoryVersion(tx);
  if (scope.categories.includes('context')) versions.athlete = await athleteHistoryVersion(tx);
  return versions;
}
export async function historicalRecords(tx: Transaction, q: HistorySelection, scope: HistoryScope) {
  if (q.category === 'activities' || q.category === 'health') return readRecordsHistory(tx, q);
  if (q.category === 'injuries') return readAthleteHistory(tx, q);
  if (q.category === 'coverage') {
    if (!pluginEnabled('garmin')) return [];
    return readHistoryCoverage(tx, q, coverageStreams(scope));
  }
  return readTrainingHistory(tx, q);
}
