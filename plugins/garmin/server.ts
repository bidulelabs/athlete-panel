import {
  configure,
  sync,
  pause,
  disconnect,
  coveragePage,
  runGarminJob,
  scheduleRecent,
} from './service';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';
export default {
  operations: { configure, sync, pause, disconnect, coverage: coveragePage },
  jobs: {
    'garmin-recent': runGarminJob,
    'garmin-history': runGarminJob,
    'garmin-catchup': runGarminJob,
    'garmin-reconcile': runGarminJob,
    'garmin-match-activities': runGarminJob,
  },
  schedule: scheduleRecent,
} satisfies ServerPlugin;
