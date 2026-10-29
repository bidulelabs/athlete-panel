import { connection } from '../../packages/host/src/db';
import { checkSchema } from '../../packages/host/src/schema';
import { validateRetainedMigrations } from '../../packages/host/src/migrations';
import { loadWorkspace } from '../../instance/services';

/** Explicit full export-sized read. Domain rules remain in their existing owners. */
export async function verifyData() {
  await checkSchema();
  await connection().begin('isolation level repeatable read read only', async (tx) => {
    await validateRetainedMigrations(
      process.cwd(),
      await tx<{ name: string; checksum: string }[]>`select name,checksum from host.migrations`,
    );
    await loadWorkspace(tx, undefined, { records: 'all' });
    const [owner] = await tx`select count(*)::int as count from host.owner`;
    if (owner.count !== 1) throw new Error('Expected exactly one owner.');
  });
}
