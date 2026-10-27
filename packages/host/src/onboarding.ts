import { onboardingSchema, type Onboarding } from '../../contracts/src/onboarding';
import { connection, type Transaction } from './db';

export function initialOnboarding(status: Onboarding['status'] = 'pending'): Onboarding {
  return {
    version: 1,
    status,
    step: 1,
    revision: 1,
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
}
export async function readOnboarding(
  tx = connection() as unknown as Transaction,
): Promise<Onboarding> {
  const [row] = await tx<
    { value: unknown }[]
  >`select value from host.settings where key='onboarding'`;
  // An absent marker never identifies an existing owner as new.
  return row
    ? onboardingSchema.parse(row.value)
    : { ...initialOnboarding('existing-owner'), updatedAt: '1970-01-01T00:00:00.000Z' };
}
export async function writeOnboarding(tx: Transaction, value: Onboarding) {
  const validated = onboardingSchema.parse(value);
  await tx`insert into host.settings(key,value) values('onboarding',${tx.json(validated)}) on conflict(key) do update set value=excluded.value`;
  return validated;
}
