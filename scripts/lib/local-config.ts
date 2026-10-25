import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/** Only these messages, never raw driver/child errors, are displayed by the local CLI. */
export class LocalError extends Error {}

export type LocalConfig = {
  values: Record<string, string>;
  project: string;
  databasePort: number;
  webPort: number;
};

function port(value: string, name: string) {
  const result = Number(value);
  if (!/^\d+$/.test(value) || result < 1024 || result > 65535) throw new LocalError(`Invalid ${name} in .env. Use a port between 1024 and 65535.`);
  return result;
}

export function validateLocalConfig(values: Record<string, string>): LocalConfig {
  const database = 'athlete_panel';
  const role = 'athlete_panel_app';
  const project = values.ATHLETE_PANEL_LOCAL_PROJECT ?? 'athlete-panel-local';
  if (!/^athlete-panel-local(?:-[a-z0-9]+)*$/.test(project)) throw new LocalError('ATHLETE_PANEL_LOCAL_PROJECT must be athlete-panel-local or begin with athlete-panel-local-.');
  const databasePort = port(values.ATHLETE_PANEL_LOCAL_DB_PORT ?? '55440', 'ATHLETE_PANEL_LOCAL_DB_PORT');
  const webPort = port(values.ATHLETE_PANEL_LOCAL_WEB_PORT ?? '3000', 'ATHLETE_PANEL_LOCAL_WEB_PORT');
  const invalid = () => new LocalError('Existing .env is incomplete or does not match the local setup. No credentials were replaced. See docs/development.md#local-setup-troubleshooting.');
  if (databasePort === webPort || !/^[a-f0-9]{32,128}$/.test(values.APP_DATABASE_PASSWORD ?? '') || !/^[a-f0-9]{32,128}$/.test(values.POSTGRES_PASSWORD ?? '') || values.POSTGRES_PASSWORD === values.APP_DATABASE_PASSWORD) throw invalid();
  for (const [key, user, password] of [
    ['DATABASE_URL', role, values.APP_DATABASE_PASSWORD],
    ['ADMIN_DATABASE_URL', database, values.POSTGRES_PASSWORD],
  ]) {
    try {
      const url = new URL(values[key]);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || Number(url.port) !== databasePort || url.pathname !== `/${database}` || url.search || url.hash || decodeURIComponent(url.username) !== user || decodeURIComponent(url.password) !== password) throw invalid();
    } catch { throw invalid(); }
  }
  if (values.POSTGRES_DB && values.POSTGRES_DB !== database || values.POSTGRES_USER && values.POSTGRES_USER !== database || values.APP_DATABASE_ROLE && values.APP_DATABASE_ROLE !== role) throw invalid();
  values = { ...values, POSTGRES_DB: database, POSTGRES_USER: database, APP_DATABASE_ROLE: role, ATHLETE_PANEL_LOCAL_PROJECT: project };
  const key = values.ENCRYPTION_KEY ?? '';
  if (Buffer.from(key, 'base64').length !== 32 || Buffer.from(key, 'base64').toString('base64') !== key) throw invalid();
  if (values.APP_ORIGIN !== `http://127.0.0.1:${webPort}` || values.COOKIE_SECURE !== 'false' || ![undefined, 'false'].includes(values.TRUST_PROXY_CLIENT_IP)) throw invalid();
  if (values.ATHLETE_PANEL_INSTANCE_PATH && values.ATHLETE_PANEL_INSTANCE_PATH !== 'instance/composition.json') throw invalid();
  return { values, project, databasePort, webPort };
}

export function instanceSecrets() {
  return { POSTGRES_PASSWORD:randomBytes(32).toString('hex'), APP_DATABASE_PASSWORD:randomBytes(32).toString('hex'), ENCRYPTION_KEY:randomBytes(32).toString('base64') };
}

export function newLocalConfig(options: { project?: string; databasePort?: number; webPort?: number } = {}): LocalConfig {
  const secrets = instanceSecrets(), admin = secrets.POSTGRES_PASSWORD, app = secrets.APP_DATABASE_PASSWORD;
  const databasePort = options.databasePort ?? 55440, webPort = options.webPort ?? 3000;
  return validateLocalConfig({
    POSTGRES_PASSWORD: admin, APP_DATABASE_PASSWORD: app,
    ADMIN_DATABASE_URL: `postgres://athlete_panel:${admin}@127.0.0.1:${databasePort}/athlete_panel`,
    DATABASE_URL: `postgres://athlete_panel_app:${app}@127.0.0.1:${databasePort}/athlete_panel`,
    ENCRYPTION_KEY: secrets.ENCRYPTION_KEY,
    APP_ORIGIN: `http://127.0.0.1:${webPort}`, COOKIE_SECURE: 'false', TRUST_PROXY_CLIENT_IP: 'false',
    ATHLETE_PANEL_INSTANCE_PATH: 'instance/composition.json', POSTGRES_DB: 'athlete_panel',
    ATHLETE_PANEL_LOCAL_PROJECT: options.project ?? 'athlete-panel-local',
    ATHLETE_PANEL_LOCAL_DB_PORT: String(databasePort), ATHLETE_PANEL_LOCAL_WEB_PORT: String(webPort),
  });
}

export async function readLocalConfig(root: string): Promise<LocalConfig | null> {
  let file;
  try { file = await open(join(root, '.env'), constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new LocalError('Cannot safely read .env. Use a regular file owned by your account, not a symlink.');
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 65536 || (process.getuid && info.uid !== process.getuid())) throw new LocalError('.env must be a small, regular file owned by your account, without hard links.');
    if (info.mode & 0o077) throw new LocalError('.env must be private. Run chmod 600 .env, then retry.');
    // Parse data; never source the file as executable shell code or expand variables.
    const parsed = parseEnv(await file.readFile('utf8'));
    return validateLocalConfig(Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => entry[1] !== undefined)));
  } finally { await file.close(); }
}

export async function createLocalConfig(root: string, config: LocalConfig) {
  const temporary = join(root, `.env.setup-${randomUUID()}`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile('# Generated by pnpm run setup. Keep a separate private recovery copy.\n' + Object.entries(config.values).map(([key, value]) => `${key}=${value}\n`).join(''));
      await file.sync();
    } finally { await file.close(); }
    // Publish complete bytes atomically without ever replacing an existing .env.
    await link(temporary, join(root, '.env'));
  } catch { throw new LocalError('Could not create .env safely. An existing file was not overwritten; check permissions and retry.'); }
  finally { await rm(temporary, { force: true }); }
}

/** Start children from an allowlist, not inherited database/admin/test configuration. */
export function systemEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keys = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM', 'PNPM_HOME', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR', 'SSH_AUTH_SOCK', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY'];
  return { ...Object.fromEntries(keys.flatMap(key => source[key] === undefined ? [] : [[key, source[key]]])), NODE_ENV: 'development' };
}

export function runtimeEnvironment(config: LocalConfig): NodeJS.ProcessEnv {
  const { values } = config;
  return { ...systemEnvironment(), DATABASE_URL: values.DATABASE_URL, ENCRYPTION_KEY: values.ENCRYPTION_KEY,
    APP_ORIGIN: values.APP_ORIGIN, COOKIE_SECURE: 'false', TRUST_PROXY_CLIENT_IP: 'false',
    ATHLETE_PANEL_INSTANCE_PATH: 'instance/composition.json', NEXT_TELEMETRY_DISABLED: '1' };
}

export function administrativeEnvironment(config: LocalConfig): NodeJS.ProcessEnv {
  return { ...runtimeEnvironment(config), ADMIN_DATABASE_URL: config.values.ADMIN_DATABASE_URL, APP_DATABASE_PASSWORD: config.values.APP_DATABASE_PASSWORD, APP_DATABASE_ROLE: config.values.APP_DATABASE_ROLE };
}

export async function acquireLocalLock(root: string): Promise<() => Promise<void>> {
  const directory = join(root, '.runtime');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw new LocalError('.runtime must be a regular directory.');
  const path = join(directory, 'local-command.lock');
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(String(process.pid)); } finally { await file.close(); }
    return () => rm(path, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new LocalError('Cannot create the local command lock. Check checkout permissions.');
    const pid = Number(await readFile(path, 'utf8').catch(() => ''));
    let alive = true;
    if (Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
    }
    if (alive) throw new LocalError('Another setup/local command is running in this checkout. Stop it before retrying.');
    // No automatic unlink race: a crashed command needs a deliberate stale-lock removal.
    throw new LocalError('A previous command stopped unexpectedly. Its process is gone; remove .runtime/local-command.lock, then retry.');
  }
}
