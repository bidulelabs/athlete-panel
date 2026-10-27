import { fileURLToPath } from 'node:url';
import {
  acquireLocalLock,
  administrativeEnvironment,
  createLocalConfig,
  LocalError,
  newLocalConfig,
  readLocalConfig,
  systemEnvironment,
} from './lib/local-config';
import {
  existingLocalStorage,
  prerequisites,
  requireFreePort,
  runCommand,
  startDatabase,
} from './lib/local-process';
import {
  installationState,
  installedSchema,
  localDatabase,
  verifyRuntime,
} from './lib/local-database';
import { choosePassword } from './lib/local-password';

const root = fileURLToPath(new URL('..', import.meta.url));
const controller = new AbortController();
const cancel = () => controller.abort();
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
let unlock: (() => Promise<void>) | undefined;

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'pnpm run setup [--password-stdin]\nCreate or resume a local installation. The login password is visible while typing and confirming.\n--password-stdin reads one password from a protected pipe/file for automation without echoing it.\nExisting credentials, owner accounts and data are preserved.',
    );
  } else {
    if (args.some((arg) => arg !== '--password-stdin') || args.length > 1)
      throw new LocalError('Usage: pnpm run setup [--password-stdin]');
    await prerequisites(root, controller.signal);
    unlock = await acquireLocalLock(root);
    console.log('✓ Requirements checked');
    let config = await readLocalConfig(root);
    if (!config) {
      if (await existingLocalStorage(root, controller.signal))
        throw new LocalError(
          'Local database storage already exists, but .env is missing. Restore its private configuration before continuing. Setup will not replace credentials or delete data.',
        );
      config = newLocalConfig();
      await requireFreePort(config.databasePort, 'PostgreSQL');
      await requireFreePort(config.webPort, 'the web application');
      await createLocalConfig(root, config);
      console.log('✓ Private configuration created');
    } else console.log('✓ Existing private configuration preserved');

    await runCommand(process.execPath, ['--import', 'tsx', 'scripts/registry.ts'], {
      root,
      signal: controller.signal,
      message:
        'Plugin configuration could not be generated. Check composition and installed dependencies.',
      env: systemEnvironment(),
    });
    console.log('Starting PostgreSQL (the first run may download its Docker image)…');
    await startDatabase(root, config, controller.signal);
    console.log('✓ Database started');
    const sql = localDatabase(config.values.ADMIN_DATABASE_URL);
    try {
      const [lock] = await sql`select pg_try_advisory_lock(736147003) as acquired`;
      if (!lock.acquired)
        throw new LocalError(
          'Another setup command is initializing this database. Wait for it to finish.',
        );
      const state = await installationState(sql);
      if (state !== 'empty') await installedSchema(sql, root);
      if (state === 'ready')
        console.log('✓ Existing account preserved; no migrations or password changes performed');
      else {
        await runCommand(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
          root,
          signal: controller.signal,
          env: administrativeEnvironment(config),
          message:
            'Database initialization failed. Your configuration was retained; retry setup. If the problem persists, check migration compatibility in the development guide.',
        });
        console.log('✓ Database initialized');
        let password = await choosePassword(args.includes('--password-stdin'), controller.signal);
        try {
          await runCommand(
            process.execPath,
            ['--import', 'tsx', 'scripts/owner.ts', 'bootstrap', '--password-stdin'],
            {
              root,
              signal: controller.signal,
              env: administrativeEnvironment(config),
              input: password,
              message:
                'Could not create the owner account. Retry setup; existing accounts are never overwritten.',
            },
          );
        } finally {
          password = '';
        }
        console.log('✓ Your account is ready');
      }
    } catch (error) {
      if (error instanceof LocalError) throw error;
      throw new LocalError(
        'Cannot initialize the configured database. Check that .env belongs to this database. No credentials were regenerated; see docs/development.md#local-setup-troubleshooting.',
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
    await verifyRuntime(root, config);
    console.log('\nStart Athlete Panel with: pnpm run local');
    console.log(
      'Keep a separate private recovery copy of .env. It contains the encryption key needed to recover Garmin credentials. Backups are configured separately.',
    );
  }
} catch (error) {
  console.error(
    error instanceof LocalError
      ? error.message
      : 'Setup could not finish. Check checkout permissions and the local setup troubleshooting guide. No automatic reset was performed.',
  );
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  await unlock?.();
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
}
