import { RecordRepository } from '../../packages/host/src/records';
import { profileSchema, injurySchema, type Profile, type Injury } from '@athlete-panel/contracts';
export const athleteRepository = new RecordRepository<Profile | Injury>('athlete', {
  profile: profileSchema,
  injury: injurySchema,
});
