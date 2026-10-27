import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { LocalError, systemEnvironment, type LocalConfig } from './local-config';

export function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    root: string;
    message: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    timeout?: number;
    input?: string;
  },
): Promise<string> {
  if (options.signal?.aborted)
    throw new LocalError('Cancelled. Saved configuration and database data were retained.');
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.root,
      env: options.env ?? systemEnvironment(),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      overflow = false,
      stopped = false;
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      signalGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => signalGroup(child, 'SIGKILL'), 3000);
    };
    const timer = setTimeout(stop, options.timeout ?? 120_000);
    options.signal?.addEventListener('abort', stop, { once: true });
    child.stdout!.on('data', (chunk) => {
      if (stdout.length + chunk.length < 262144) stdout += chunk;
      else {
        overflow = true;
        stop();
      }
    });
    // Never echo raw Docker, SQL, subprocess arguments or environment values.
    child.stderr!.resume();
    child.stdin!.on('error', () => {});
    child.stdin!.end(options.input);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', stop);
    };
    child.once('error', () => {
      cleanup();
      reject(new LocalError(options.message));
    });
    child.once('close', (code) => {
      cleanup();
      if (options.signal?.aborted)
        reject(new LocalError('Cancelled. Saved configuration and database data were retained.'));
      else if (code !== 0 || stopped || overflow) reject(new LocalError(options.message));
      else resolve(stdout.trim());
    });
  });
}

export async function requireFreePort(port: number, purpose: string) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(
        new LocalError(
          `Port ${port} is unavailable for ${purpose}. Stop the process using it, then retry.`,
        ),
      ),
    );
    server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
  });
}

export async function prerequisites(root: string, signal: AbortSignal) {
  if (process.platform === 'win32')
    throw new LocalError(
      'Use WSL2 with Node.js and Docker integration for these local commands on Windows.',
    );
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13))
    throw new LocalError('Install Node.js 22.13 or newer before setup.');
  const pnpm = await runCommand('pnpm', ['--version'], {
    root,
    signal,
    message: 'pnpm is unavailable. Install pnpm 11.28.8, then retry.',
  });
  if (pnpm !== '11.28.8')
    throw new LocalError('Use pnpm 11.28.8: npm install --global pnpm@11.28.8');
  await runCommand('docker', ['compose', 'version'], {
    root,
    signal,
    timeout: 15000,
    message: 'Docker Compose v2 is required. Install or update Docker Desktop/Engine.',
  });
  await runCommand('docker', ['info', '--format', '{{.ServerVersion}}'], {
    root,
    signal,
    timeout: 15000,
    message: 'Docker is not running or cannot be reached. Start Docker Desktop/Engine, then retry.',
  });
}

export async function existingLocalStorage(root: string, signal: AbortSignal) {
  const options = {
    root,
    signal,
    message: 'Cannot inspect local Docker storage. Check Docker before continuing.',
  };
  const volume = await runCommand(
    'docker',
    ['volume', 'ls', '--filter', 'name=^athlete-panel-local_database$', '--format', '{{.Name}}'],
    options,
  );
  const labelled = await runCommand(
    'docker',
    ['volume', 'ls', '--filter', 'label=com.athlete-panel.local=true', '--format', '{{.Name}}'],
    options,
  );
  const containers = await runCommand(
    'docker',
    [
      'ps',
      '-a',
      '--filter',
      'label=com.docker.compose.project=athlete-panel-local',
      '--format',
      '{{.ID}}',
    ],
    options,
  );
  return Boolean(volume || labelled || containers);
}

export async function startDatabase(root: string, config: LocalConfig, signal: AbortSignal) {
  // Ignore ambient COMPOSE_* and database variables; .env is the sole source.
  const args = ['compose', '--env-file', '.env', '-p', config.project, '-f', 'compose.local.yml'];
  const env = { ...systemEnvironment(), ...config.values };
  const options = {
    root,
    signal,
    env,
    message: 'Could not inspect the local database container. Check Docker and compose.local.yml.',
  };
  const running = await runCommand(
    'docker',
    [...args, 'ps', '--status', 'running', '-q', 'db'],
    options,
  );
  if (!running) await requireFreePort(config.databasePort, 'PostgreSQL');
  await runCommand('docker', [...args, 'up', '-d', '--wait', '--wait-timeout', '60', 'db'], {
    root,
    signal,
    env,
    timeout: 180_000,
    message: `PostgreSQL could not start. Check Docker, network access for the image download, and port ${config.databasePort}. Saved data was retained.`,
  });
}

export type Service = {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

/** Stop process groups so Next/tsx descendants cannot survive a failed sibling or Ctrl+C. */
export async function supervise(
  services: Service[],
  signal: AbortSignal,
  graceMs = 40000,
): Promise<void> {
  if (signal.aborted) return;
  const children: ChildProcess[] = [];
  const exited: Promise<void>[] = [];
  let resolveStop!: (reason: string | null) => void;
  const stopped = new Promise<string | null>((resolve) => {
    resolveStop = resolve;
  });
  const onAbort = () => resolveStop(null);
  signal.addEventListener('abort', onAbort, { once: true });
  let failure: string | null = null;
  try {
    for (const service of services) {
      const child = spawn(service.command, service.args, {
        cwd: service.cwd,
        env: service.env,
        detached: true,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      children.push(child);
      exited.push(
        new Promise((resolve) => {
          child.once('error', () => {
            resolveStop(`${service.name} could not start. Check installed dependencies and retry.`);
            resolve();
          });
          child.once('exit', () => {
            resolveStop(
              `${service.name} stopped unexpectedly. Both application processes have been stopped; review the output above.`,
            );
            resolve();
          });
        }),
      );
    }
    failure = await stopped;
  } finally {
    signal.removeEventListener('abort', onAbort);
    children.forEach((child) => signalGroup(child, 'SIGTERM'));
    const timer = new AbortController();
    await Promise.race([
      Promise.all(exited),
      sleep(graceMs, undefined, { signal: timer.signal }).catch(() => {}),
    ]);
    timer.abort();
    // Also kill any orphaned descendants in a group whose original parent exited.
    children.forEach((child) => signalGroup(child, 'SIGKILL'));
    await Promise.all(exited);
  }
  if (failure && !signal.aborted) throw new LocalError(failure);
}
