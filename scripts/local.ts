import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLocalLock, LocalError, readLocalConfig, runtimeEnvironment, systemEnvironment } from './lib/local-config';
import { verifyRuntime } from './lib/local-database';
import { prerequisites, requireFreePort, runCommand, startDatabase, supervise } from './lib/local-process';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const controller = new AbortController();
const cancel = () => { if (!controller.signal.aborted) console.log('\nStopping web and worker; database data will be retained…'); controller.abort(); };
process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
let unlock: (() => Promise<void>) | undefined;
try {
  if (process.argv.length !== 2) throw new LocalError('Usage: pnpm run local');
  await prerequisites(root, controller.signal);
  unlock = await acquireLocalLock(root);
  const config = await readLocalConfig(root);
  if (!config) throw new LocalError('Local configuration is missing. Run pnpm run setup first.');
  await requireFreePort(config.webPort, 'the web application');
  await startDatabase(root, config, controller.signal);
  await runCommand(process.execPath, ['--import', 'tsx', 'scripts/registry.ts'], { root, signal: controller.signal, env: systemEnvironment(), message: 'Plugin configuration could not be generated. Check composition and installed dependencies.' });
  await verifyRuntime(root, config);
  const env = runtimeEnvironment(config);
  console.log(`Starting Athlete Panel at ${config.values.APP_ORIGIN}\nWeb and worker share this terminal. Press Ctrl+C to stop them; PostgreSQL stays running.`);
  await supervise([
    { name: 'Web application', command: process.execPath, args: [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(config.webPort)], cwd: join(root, 'apps/web'), env },
    { name: 'Background worker', command: process.execPath, args: ['--import', 'tsx', 'apps/worker/index.ts'], cwd: root, env },
  ], controller.signal);
} catch (error) {
  console.error(error instanceof LocalError ? error.message : 'Local startup failed. Check installed dependencies and docs/development.md#local-setup-troubleshooting.');
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  await unlock?.();
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
}
