import { RecordRepository } from '../../packages/host/src/records';
import {
  activitySchema,
  healthRecordSchema,
  type Activity,
  type HealthRecord,
} from '@athlete-panel/contracts';
export const recordsRepository = new RecordRepository<Activity | HealthRecord>('activity_records', {
  activity: activitySchema,
  health: healthRecordSchema,
});
