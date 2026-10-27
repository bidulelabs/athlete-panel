import { bootstrapOwner } from '../packages/host/src/auth';
import { closeDatabase } from '../packages/host/src/db';
import { useAdministrativeDatabase } from '../packages/host/src/database-access';
useAdministrativeDatabase();
const action = process.argv[2];
if (!['bootstrap', 'recover'].includes(action) || !process.argv.includes('--password-stdin'))
  throw new Error(
    'Use pnpm run owner bootstrap|recover --password-stdin and supply the password on stdin.',
  );
let password = '';
for await (const chunk of process.stdin) password += chunk;
try {
  await bootstrapOwner(password.trimEnd(), action === 'recover');
  console.log(`Owner ${action} completed; existing sessions and grants revoked.`);
} finally {
  password = '';
  await closeDatabase();
}
