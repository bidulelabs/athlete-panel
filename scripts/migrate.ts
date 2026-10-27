import { migrate } from '../packages/host/src/migrations';
import { closeDatabase, connection } from '../packages/host/src/db';
import {
  provisionApplicationRole,
  useAdministrativeDatabase,
} from '../packages/host/src/database-access';
useAdministrativeDatabase();
let phase = 'migration';
try {
  await migrate();
  phase = 'permissions';
  if (process.env.APP_DATABASE_PASSWORD)
    await provisionApplicationRole(connection(), process.env.APP_DATABASE_PASSWORD);
  console.log('Migrations verified and applied; configured application permissions refreshed.');
} catch {
  console.error(
    phase === 'migration'
      ? 'Migration validation or SQL failed; its transaction was rolled back. Keep maintenance enabled and check the candidate migrations before retrying.'
      : 'Migrations committed, but runtime permission provisioning failed. Keep maintenance enabled; correct administrative access/password configuration and rerun this same release. Do not assume the previous schema remains installed.',
  );
  process.exitCode = phase === 'migration' ? 1 : 2;
} finally {
  await closeDatabase();
}
