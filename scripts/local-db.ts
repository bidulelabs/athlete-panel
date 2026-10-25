/** Resolve the saved installation identity before operating its persistent container. */
import { fileURLToPath } from 'node:url';
import { acquireLocalLock, LocalError, readLocalConfig, systemEnvironment } from './lib/local-config';
import { runCommand, startDatabase } from './lib/local-process';

const root = fileURLToPath(new URL('..', import.meta.url));
let unlock: (() => Promise<void>) | undefined;
try {
  const action = process.argv[2];
  if (!['start', 'stop'].includes(action) || process.argv.length !== 3) throw new LocalError('Use pnpm db:start or pnpm db:stop.');
  unlock = await acquireLocalLock(root);
  const config = await readLocalConfig(root);
  if (!config) throw new LocalError('Run pnpm run setup first, or restore the existing private .env.');
  if (action === 'start') await startDatabase(root, config, new AbortController().signal);
  else await runCommand('docker', ['compose', '--env-file', '.env', '-p', config.project, '-f', 'compose.local.yml', 'stop', 'db'], {
    root, env: { ...systemEnvironment(), ...config.values }, message: 'Database could not stop. Check Docker; saved data was retained.',
  });
  console.log(`Database ${action === 'start' ? 'started' : 'stopped'}; persistent data retained.`);
} catch (error) {
  console.error(error instanceof LocalError ? error.message : 'Database command failed. Configuration and data were retained.');
  process.exitCode = 1;
} finally { await unlock?.(); }
