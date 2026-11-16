import type { Transaction } from '../packages/host/src/db';
import { pluginEnabled } from '../packages/host/src/plugins';
import { readRaceCourseSummary } from '../plugins/race-analysis/public/server';

export const readRaceCourseIfEnabled = async (raceId: string, tx: Transaction) =>
  pluginEnabled('race-analysis') ? readRaceCourseSummary(raceId, tx) : null;
