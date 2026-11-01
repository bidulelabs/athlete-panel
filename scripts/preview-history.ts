/** Disposable synthetic preview. Never reads .env or modifies an existing database. */
import postgres from 'postgres';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedDatabaseUrl } from '../tests/support/test-database';
import { seedHistoricalDataset, historicalRange } from '../tests/fixtures/historical';
import { seedAnnualReview, annualRange } from '../tests/fixtures/annual-review';
import { closeDatabase, connection, transaction } from '../packages/host/src/db';
import { bootstrapOwner } from '../packages/host/src/auth';
import { initialOnboarding, writeOnboarding } from '../packages/host/src/onboarding';
import { migrate } from '../packages/host/src/migrations';
import { createGrant, contextForToken, submitProposal } from '../plugins/agent-bridge/service';
import { mutate } from '../plugins/training/service';
import { LocalError, systemEnvironment } from './lib/local-config';
import { requireFreePort, supervise } from './lib/local-process';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2] ?? 3017);
if (process.argv.length > 3 || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new LocalError('Usage: pnpm preview:history [port 1024–65535]');
const base = isolatedDatabaseUrl();
const admin = postgres(base, { max: 1, onnotice: () => {} });
const name = `history_preview_${process.pid}_${randomBytes(4).toString('hex')}_test`;
const url = new URL(base);
url.pathname = `/${name}`;
const directory = join(root, '.runtime/history-preview', name);
const env = {
  ...systemEnvironment(),
  DATABASE_URL: url.href,
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  APP_ORIGIN: `http://127.0.0.1:${port}`,
  COOKIE_SECURE: 'false',
  TRUST_PROXY_CLIENT_IP: 'false',
  ATHLETE_PANEL_DEMO: 'true',
  ATHLETE_PANEL_E2E: 'true',
  DEMO_PASSWORD: 'AthletePanel-demo-only-2026',
  HOSTNAME: '127.0.0.1',
  PORT: String(port),
  NODE_ENV: 'production' as const,
  NEXT_TELEMETRY_DISABLED: '1',
};
const controller = new AbortController();
const cancel = () => controller.abort();
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
let created = false;
let stage = 'preparing the built preview';
try {
  await requireFreePort(port, 'the synthetic preview');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Keep a private copy so a subsequent test/build cannot replace the running web artifact.
  const release = join(directory, 'release');
  await cp(join(root, 'apps/web/.next/standalone'), release, {
    recursive: true,
    verbatimSymlinks: true,
  });
  await cp(join(root, 'apps/web/.next/static'), join(release, 'apps/web/.next/static'), {
    recursive: true,
  });
  await writeFile(join(directory, 'env.json'), JSON.stringify(env), { mode: 0o600 });
  await writeFile(join(directory, 'pid'), String(process.pid), { mode: 0o600 });
  // Clear ambient credentials/settings before any application database or service call.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  await admin`create database ${admin(name)}`;
  created = true;
  stage = 'applying migrations';
  await migrate();
  stage = 'creating the synthetic owner';
  await bootstrapOwner(env.DEMO_PASSWORD);
  await transaction((tx) => writeOnboarding(tx, initialOnboarding('existing-owner')));
  stage = 'seeding historical records';
  const dataset = await connection().begin((tx) => seedHistoricalDataset(tx, 30000));
  await mutate({
    idempotencyKey: randomUUID(),
    commands: [
      {
        action: 'profile.set',
        expectedRevision: 1,
        values: {
          displayName: 'Alex Morgan (synthetic)',
          timezone: 'Europe/Paris',
          units: 'metric',
          goals: 'Synthetic five-year review',
          weekStartsOnPreference: 'monday',
        },
      },
    ],
  });
  stage = 'preparing the annual proposal';
  const annual = await connection().begin((tx) => seedAnnualReview(tx));
  const grant = await createGrant({
    label: 'Synthetic annual review',
    version: 2,
    history: {
      ...historicalRange,
      categories: ['activities', 'health', 'training', 'context'],
      weekStartsOn: 1,
    },
    planning: annualRange,
  });
  const context = await contextForToken(grant.token);
  await submitProposal(grant.token, {
    summary: 'Synthetic annual review: 500 additions, 500 edits and 500 deletions',
    commands: annual.commands,
    contextDigest: context.contextDigest,
    idempotencyKey: randomUUID(),
  });
  stage = 'running the web and worker';
  console.log(
    `Synthetic preview: ${env.APP_ORIGIN}/agent\n` +
      `${dataset.total} history records plus 1,000 annual workouts and their plan. The 1,500-command proposal awaits owner review.\n` +
      'Use the documented demo password. Ctrl+C stops web/worker and drops only this newly created synthetic database.',
  );
  await supervise(
    [
      {
        name: 'Synthetic web',
        command: process.execPath,
        args: [join(release, 'apps/web/server.js')],
        cwd: root,
        env,
      },
      {
        name: 'Synthetic worker',
        command: process.execPath,
        args: ['--import', 'tsx', 'apps/worker/index.ts'],
        cwd: root,
        env,
      },
    ],
    controller.signal,
  );
} catch (error) {
  if (created)
    await writeFile(
      join(directory, 'failure.log'),
      error instanceof Error ? (error.stack ?? error.message) : 'Unknown failure',
      { mode: 0o600 },
    );
  console.error(
    error instanceof LocalError
      ? error.message
      : `Synthetic preview failed while ${stage}. Inspect the private failure.log under .runtime/history-preview/.`,
  );
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  await closeDatabase();
  if (created) await admin`drop database ${admin(name)} with (force)`;
  await admin.end();
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
}
