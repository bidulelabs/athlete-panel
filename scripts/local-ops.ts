/** Explicit local maintenance only. Never invoked by setup/local or applied automatically. */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  acquireLocalLock,
  administrativeEnvironment,
  LocalError,
  readLocalConfig,
  runtimeEnvironment,
} from './lib/local-config';
import { requireFreePort, runCommand } from './lib/local-process';
import { localDatabase } from './lib/local-database';
import { createBackup } from './backup';
import { verifyBackup } from './restore';
import { closeDatabase } from '../packages/host/src/db';

const root = fileURLToPath(new URL('..', import.meta.url));
const usage =
  'pnpm local:ops maintenance on|off | backup --key-file PATH --destination DIR | migrate --backup ARCHIVE --key-file PATH';
let unlock: (() => Promise<void>) | undefined;
try {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help') {
    console.log(usage);
  } else {
    if (!['maintenance', 'backup', 'migrate'].includes(command)) throw new LocalError(usage);
    const options: Record<string, string> = {};
    if (command === 'maintenance') {
      if (args.length !== 1 || !['on', 'off'].includes(args[0])) throw new LocalError(usage);
    } else {
      for (let i = 0; i < args.length; i += 2) {
        if (
          !['--key-file', command === 'backup' ? '--destination' : '--backup'].includes(args[i]) ||
          !args[i + 1] ||
          options[args[i]]
        )
          throw new LocalError(usage);
        options[args[i]] = args[i + 1];
      }
      if (Object.keys(options).length !== 2) throw new LocalError(usage);
    }
    unlock = await acquireLocalLock(root);
    const config = await readLocalConfig(root);
    if (!config)
      throw new LocalError('Restore the existing private .env before using local maintenance.');
    await requireFreePort(config.webPort, 'local maintenance: stop pnpm run local first');
    const env = runtimeEnvironment(config),
      run = async (script: string, extra: string[] = [], admin = false) =>
        runCommand(process.execPath, ['--import', 'tsx', script, ...extra], {
          root,
          env: admin ? administrativeEnvironment(config) : env,
          timeout: 300000,
          message:
            'Local operation failed. Maintenance and data were retained. See docs/development.md#updating-a-local-checkout.',
        });
    if (command === 'maintenance')
      console.log(await run('scripts/operations.ts', ['maintenance', args[0]]));
    else if (command === 'backup') {
      const result = await createBackup({
        root,
        databaseUrl: config.values.DATABASE_URL,
        encryptionKey: config.values.ENCRYPTION_KEY,
        keyFile: resolve(options['--key-file']),
        destination: resolve(options['--destination']),
      });
      const verified = await verifyBackup(
        result.file,
        resolve(options['--key-file']),
        config.values.ENCRYPTION_KEY,
      );
      await verified.cleanup();
      console.log(`Verified encrypted backup: ${result.file}`);
    } else {
      // Authenticating the selected archive is mandatory before any migration.
      const verified = await verifyBackup(
        resolve(options['--backup']),
        resolve(options['--key-file']),
        config.values.ENCRYPTION_KEY,
      );
      try {
        const sql = localDatabase(config.values.DATABASE_URL);
        try {
          const [maintenance] = await sql`select value from host.settings where key='maintenance'`;
          if (maintenance?.value !== true)
            throw new LocalError(
              'Enable maintenance in the installed checkout and create its backup before upgrading.',
            );
          const current =
            await sql`select plugin_id,name,checksum from host.migrations order by plugin_id,name`;
          const normalize = (rows: unknown[]) =>
            JSON.stringify(
              [...rows].sort((a: any, b: any) =>
                `${a.plugin_id}/${a.name}`.localeCompare(`${b.plugin_id}/${b.name}`),
              ),
            );
          if (normalize(current) !== normalize(verified.metadata.migrations))
            throw new LocalError(
              'The backup does not match the installed migrations. Keep maintenance enabled and review the recovery point.',
            );
        } finally {
          await sql.end();
        }
        console.log(await run('scripts/migrate.ts', [], true));
        console.log(await run('scripts/operations.ts', ['verify-schema']));
        console.log(
          'Candidate schema verified. Maintenance remains enabled. Check the workspace before explicitly reopening writes.',
        );
      } finally {
        await verified.cleanup();
      }
    }
  }
} catch (error) {
  console.error(
    error instanceof LocalError
      ? error.message
      : 'Local maintenance failed. Check the separate keys, matching PostgreSQL client tools and selected backup. No configuration was replaced.',
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
  await unlock?.();
}
