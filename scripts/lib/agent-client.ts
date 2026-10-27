import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  agentConnectionStartedSchema,
  agentConnectionStatusSchema,
} from '../../packages/contracts/src';

const configSchema = z.object({
  url: z.string(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  grantId: z.uuid().optional(),
  expiresAt: z.string().optional(),
});
type AgentConfig = z.infer<typeof configSchema>;

export function instanceOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Use a valid Athlete Panel URL, such as http://127.0.0.1:3000.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Use the instance origin without credentials, a path, query, or fragment.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new Error('Remote agent access requires HTTPS. HTTP is allowed only on loopback.');
  }
  return url.origin;
}

export async function savePrivateFile(file: string, contents: string) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(file), `.athlete-panel-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readConfig(file: string): Promise<AgentConfig | null> {
  try {
    if ((await stat(file)).mode & 0o077)
      throw new Error(
        'Agent configuration must be private. Restrict its permissions to your account before continuing (chmod 600).',
      );
    const config = configSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    return { ...config, url: instanceOrigin(config.url) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      throw new Error(
        'The saved agent configuration is invalid. Remove it and run pnpm agent connect again.',
      );
    throw error;
  }
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request(
  origin: string,
  path: string,
  options: { token?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${origin}/api/agent/${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
  } catch {
    if (options.signal?.aborted) throw new Error('Connection cancelled.');
    throw new RequestError(
      `Cannot reach Athlete Panel at ${origin}. Check that it is running, then retry.`,
      0,
    );
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (body?.error?.code === 'invalid_grant')
      throw new RequestError(
        'Agent access expired or was disconnected. Run pnpm agent connect to approve fresh access.',
        response.status,
        'invalid_grant',
      );
    throw new RequestError(
      body?.error?.message ?? `Athlete Panel returned HTTP ${response.status}.`,
      response.status,
      body?.error?.code,
    );
  }
  return body;
}

async function openBrowser(url: string) {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'rundll32.exe'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise<void>((resolve) => {
    const child = spawn(command, args, { shell: false, detached: true, stdio: 'ignore' });
    child.once('error', () => {
      console.log('Could not open a browser automatically. Open the approval link above.');
      resolve();
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function connect(origin: string, configPath: string, label: string, noOpen: boolean) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  let token: string | undefined,
    saved = false;
  try {
    console.log(`Connecting to ${origin}…`);
    const started = agentConnectionStartedSchema.parse(
      await request(origin, 'connect', { body: { label }, signal: controller.signal }),
    );
    token = started.token;
    const approvalUrl = `${origin}/agent?connect=${encodeURIComponent(started.id)}`;
    console.log(
      `\nApproval code: ${started.code}\nOpen: ${approvalUrl}\n\nApprove this matching code in your browser. No token copying is needed.\nWaiting for approval (up to 10 minutes). Press Ctrl+C to cancel.`,
    );
    if (!noOpen) await openBrowser(approvalUrl);
    const deadline = Date.now() + 10 * 60 * 1000;
    let interval = started.pollIntervalSeconds * 1000,
      failures = 0;
    while (Date.now() < deadline) {
      await delay(interval, undefined, { signal: controller.signal });
      let result: unknown;
      try {
        result = await request(origin, 'connect', { token, signal: controller.signal });
        failures = 0;
      } catch (error) {
        if (
          error instanceof RequestError &&
          (error.status === 0 || error.status >= 500) &&
          ++failures <= 3
        ) {
          console.log('Athlete Panel is temporarily unavailable; retrying the connection…');
          continue;
        }
        throw error;
      }
      if ((result as { status?: string })?.status === 'slow_down') {
        interval += 2000;
        continue;
      }
      const status = agentConnectionStatusSchema.parse(result);
      if (status.status === 'pending') continue;
      if (status.status === 'denied')
        throw new Error('Connection declined in the browser. No agent access was saved.');
      if (status.status === 'cancelled')
        throw new Error(
          'This connection was cancelled or disconnected. Run pnpm agent connect again.',
        );
      if (status.status === 'expired')
        throw new Error('This connection request expired. Run pnpm agent connect again.');
      if (!status.grant)
        throw new Error('The approved connection did not include a grant. Please reconnect.');
      controller.signal.throwIfAborted();
      await savePrivateFile(
        configPath,
        JSON.stringify({
          url: origin,
          token,
          grantId: status.grant.id,
          expiresAt: status.grant.expiresAt,
        }) + '\n',
      );
      saved = true;
      console.log(
        `\nConnected. Your credential was saved privately.\nAccess: ${status.grant.from} through ${status.grant.to}; ${status.grant.includeNotes ? 'private notes included' : 'private notes excluded'}.\nExpires: ${new Date(status.grant.expiresAt).toLocaleString()}.\n\nAsk your agent to read the training-planning skill linked in AGENTS.md and propose your training changes. Review and apply proposals in Athlete Panel.`,
      );
      return;
    }
    throw new Error('Approval timed out. Run pnpm agent connect again.');
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Connection cancelled.');
    if (error instanceof z.ZodError)
      throw new Error(
        'Athlete Panel returned an incompatible connection response. Update the app and checkout together.',
      );
    throw error;
  } finally {
    if (token && !saved)
      await request(origin, 'connect-cancel', { token, body: {} }).catch(() => {});
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

export async function agentConfigPath(
  environment: Record<string, string | undefined> = process.env,
  home = homedir(),
) {
  const override = environment.ATHLETE_PANEL_AGENT_CONFIG;
  if (override) return resolve(override);
  return join(home, '.config/athlete-panel/agent.json');
}

export async function runAgentCli(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      label: { type: 'string' },
      'no-open': { type: 'boolean' },
      'token-stdin': { type: 'boolean' },
      out: { type: 'string' },
      file: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  const action = positionals[0];
  if (values.help || !action) {
    console.log(
      'pnpm agent connect [--url <instance>] [--label <name>] [--no-open]\npnpm agent context --out <file>\npnpm agent propose --file <file>\nAdvanced: pnpm agent configure --url <instance> --token-stdin',
    );
    return;
  }
  if (positionals.length !== 1 || !['connect', 'configure', 'context', 'propose'].includes(action))
    throw new Error(
      'Use pnpm agent connect, context, propose, or configure. See pnpm agent --help.',
    );
  const configPath = await agentConfigPath();
  if (action === 'configure') {
    if (!values['token-stdin'] || !values.url)
      throw new Error(
        'Use configure --url <instance> --token-stdin, or pnpm agent connect for browser approval.',
      );
    if (process.stdin.isTTY)
      throw new Error(
        'This advanced command expects a token piped through stdin. Use pnpm agent connect to approve in your browser instead.',
      );
    const url = instanceOrigin(values.url);
    let token = '';
    for await (const chunk of process.stdin) {
      token += chunk;
      if (token.length > 1024) throw new Error('Invalid grant token input.');
    }
    const config = configSchema.safeParse({ url, token: token.trim() });
    if (!config.success)
      throw new Error('Supply the grant token through stdin, or use pnpm agent connect.');
    await savePrivateFile(configPath, JSON.stringify(config.data) + '\n');
    console.log('Protected agent configuration saved.');
    return;
  }
  const config = await readConfig(configPath);
  if (action === 'connect') {
    const origin = instanceOrigin(
      values.url ?? config?.url ?? process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000',
    );
    await connect(
      origin,
      configPath,
      values.label ?? 'Local training agent',
      values['no-open'] ?? false,
    );
    return;
  }
  if (!config) throw new Error('No agent connection is configured. Run pnpm agent connect first.');
  if (config.expiresAt && Date.parse(config.expiresAt) <= Date.now())
    throw new Error('Agent access expired. Run pnpm agent connect to approve fresh access.');
  if (action === 'propose' && !values.file)
    throw new Error('Use pnpm agent propose --file <proposal.json>.');
  const payload =
    action === 'propose' ? JSON.parse(await readFile(resolve(values.file!), 'utf8')) : undefined;
  const result = await request(config.url, action, { token: config.token, body: payload });
  const output = JSON.stringify(result, null, 2) + '\n';
  if (values.out) await savePrivateFile(resolve(values.out), output);
  else console.log(output);
}
