/** Generate a fresh hosted configuration only; never starts services or changes an existing instance. */
import { constants } from 'node:fs';
import { lstat, mkdir, open, link, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { instanceSecrets, LocalError, acquireLocalLock } from './lib/local-config';
import { loadBackupKey } from './backup';

export function hostedValues(domain: string, destination: string, release: string) {
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))
    throw new LocalError('Use a DNS hostname without https://, port or path.');
  if (!isAbsolute(destination) || /[\r\n\0$"\\]/.test(destination))
    throw new LocalError('Use an absolute backup directory without shell substitutions.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(release))
    throw new LocalError(
      'Use a release tag containing letters, digits, dots, underscores or hyphens.',
    );
  return {
    ...instanceSecrets(),
    POSTGRES_DB: 'athlete_panel',
    POSTGRES_USER: 'athlete_panel',
    APP_DATABASE_ROLE: 'athlete_panel_app',
    ATHLETE_PANEL_DOMAIN: domain,
    ATHLETE_PANEL_RELEASE: release,
    BACKUP_DESTINATION: destination,
    BACKUP_KEY_FILE: './.secrets/backup-key',
    BACKUP_HOUR_UTC: '3',
  };
}
export async function configureHosted(
  root: string,
  domain: string,
  destination: string,
  release: string,
) {
  const values = hostedValues(domain, destination, release);
  if (
    await lstat(join(root, '.env')).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    })
  )
    throw new LocalError(
      'An .env already exists. It was preserved. Use the upgrade guide for an existing installation.',
    );
  if (!(await lstat(destination)).isDirectory())
    throw new LocalError(
      'Create and mount the backup destination first. This command cannot verify that it is off-host.',
    );
  const secrets = join(root, '.secrets');
  await mkdir(secrets, { recursive: true, mode: 0o700 });
  const info = await lstat(secrets);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.mode & 0o077 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new LocalError('.secrets must be an owner-only directory, not a symlink.');
  const key = join(secrets, 'backup-key');
  try {
    const file = await open(
      key,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(randomBytes(32).toString('base64') + '\n');
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await lstat(key);
    if (
      !existing.isFile() ||
      existing.nlink !== 1 ||
      existing.isSymbolicLink() ||
      (process.getuid && existing.uid !== process.getuid())
    )
      throw new LocalError('Existing backup key is not a safe regular file.');
    await loadBackupKey(key);
  }
  const temporary = join(root, `.env.setup-${randomUUID()}`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(
        '# Generated hosted configuration. Keep keys separately recoverable.\n' +
          Object.entries(values)
            .map(([name, value]) => `${name}=${JSON.stringify(value)}\n`)
            .join(''),
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await link(temporary, join(root, '.env'));
  } finally {
    await rm(temporary, { force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let unlock: (() => Promise<void>) | undefined;
  try {
    const args = process.argv.slice(2),
      usage =
        'pnpm configure:hosted --domain training.example.com --backup-destination /mounted/off-host/athlete-panel --release v0.1.0';
    if (args.length === 1 && args[0] === '--help') console.log(usage);
    else {
      const options: Record<string, string> = {};
      for (let i = 0; i < args.length; i += 2) {
        if (
          !['--domain', '--backup-destination', '--release'].includes(args[i]) ||
          !args[i + 1] ||
          options[args[i]]
        )
          throw new LocalError(usage);
        options[args[i]] = args[i + 1];
      }
      if (Object.keys(options).length !== 3) throw new LocalError(usage);
      const root = fileURLToPath(new URL('..', import.meta.url));
      unlock = await acquireLocalLock(root);
      await configureHosted(
        root,
        options['--domain'],
        options['--backup-destination'],
        options['--release'],
      );
      console.log(
        'Private hosted configuration created. No services were started. Keep .env and .secrets/backup-key separately recoverable. Continue with docs/development.md#private-server-installation.',
      );
    }
  } catch (error) {
    console.error(
      error instanceof LocalError
        ? error.message
        : 'Configuration could not be created safely. Check directory permissions; existing secrets were preserved.',
    );
    process.exitCode = 1;
  } finally {
    await unlock?.();
  }
}
