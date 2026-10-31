/** Composition only: every query and date/projection rule belongs to its owning plugin. */
import type { HistoryScope, HistorySelection } from '../packages/contracts/src';
import type { Transaction } from '../packages/host/src/db';
import { pluginEnabled } from '../packages/host/src/plugins';
import {
  readRecordsHistory,
  recordsHistoryVersion,
  recordsHistoryAvailability,
} from '../plugins/activity-records/public/server';
import { readTrainingHistory, trainingHistoryVersion } from '../plugins/training/public/server';
import {
  readAthleteHistory,
  athleteHistoryVersion,
  historicalProfile,
} from '../plugins/athlete/public/server';
import { readHistoryCoverage, garminHistoryVersion } from '../plugins/garmin/public/server';
export { historicalProfile, recordsHistoryAvailability };
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
    const streams = [
      ...(scope.categories.includes('activities') ? ['activities'] : []),
      ...(scope.categories.includes('health')
        ? ['sleep', 'daily', 'hrv', 'steps', 'stress', 'bodyBattery']
        : []),
    ];
    return readHistoryCoverage(tx, q, streams);
  }
  return readTrainingHistory(tx, q);
}
