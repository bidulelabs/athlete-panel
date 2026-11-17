import { eventSchema } from '@athlete-panel/contracts';
import type { Transaction } from '../../packages/host/src/db';
import { trainingRepository } from './repository';

/** Public read projection; consumers never query Training's tables or duplicate its race records. */
export async function findRaceEvent(id: string, tx?: Transaction) {
  const records = await trainingRepository.select('event', { ids: [id] }, tx);
  const event = records[0] ? eventSchema.parse(records[0]) : null;
  return event?.kind === 'race'
    ? { id: event.id, title: event.title, date: event.date, revision: event.revision }
    : null;
}
