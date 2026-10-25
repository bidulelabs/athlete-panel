import { createInterface } from 'node:readline/promises';
import { LocalError } from './local-config';

export function validateLoginPassword(password: string) {
  if (password.length < 12 || password.length > 256) throw new LocalError('Use a login password between 12 and 256 characters.');
  if (password.trimEnd() !== password || /[\x00-\x1f\x7f]/.test(password)) throw new LocalError('Do not use control characters or trailing whitespace in your login password.');
}

async function visibleInput(prompt: string, signal: AbortSignal): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new LocalError('Run setup in an interactive terminal to choose your password. For automation, use --password-stdin with a protected password-manager stream.');
  if (signal.aborted) throw new LocalError('Setup cancelled. Run it again to finish.');
  const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 0 });
  const cancelled = new AbortController();
  const interrupt = () => { process.stdout.write('\n'); cancelled.abort(); };
  const closed = () => cancelled.abort();
  terminal.once('SIGINT', interrupt); terminal.once('close', closed);
  try {
    return await terminal.question(prompt, { signal: AbortSignal.any([signal, cancelled.signal]) });
  } catch { throw new LocalError('Setup cancelled. Run it again to finish.'); }
  finally {
    terminal.removeListener('SIGINT', interrupt); terminal.removeListener('close', closed);
    terminal.close();
  }
}

export async function choosePassword(fromStdin: boolean, signal: AbortSignal): Promise<string> {
  if (fromStdin) {
    if (process.stdin.isTTY) throw new LocalError('--password-stdin expects a pipe or protected file. Omit it for the interactive password prompt.');
    const input = await new Promise<string>((resolve, reject) => {
      let value = '';
      const cleanup = () => {
        process.stdin.removeListener('data', onData); process.stdin.removeListener('end', onEnd);
        process.stdin.removeListener('error', onError); signal.removeEventListener('abort', onAbort); process.stdin.pause();
      };
      const onError = () => { value = ''; cleanup(); reject(new LocalError('Cannot read password input.')); };
      const onAbort = () => { value = ''; cleanup(); reject(new LocalError('Setup cancelled.')); };
      const onData = (chunk: string) => { value += chunk; if (Buffer.byteLength(value) > 4096) { value = ''; cleanup(); reject(new LocalError('Password input is too long.')); } };
      const onEnd = () => { const result = value; value = ''; cleanup(); resolve(result); };
      process.stdin.setEncoding('utf8'); process.stdin.on('data', onData); process.stdin.once('end', onEnd); process.stdin.once('error', onError);
      signal.addEventListener('abort', onAbort, { once: true }); process.stdin.resume();
      if (signal.aborted) onAbort();
    });
    const password = input.replace(/\r?\n$/, '');
    validateLoginPassword(password); return password;
  }
  while (!signal.aborted) {
    let password = await visibleInput('Choose your login password (12–256 characters; input visible): ', signal);
    try { validateLoginPassword(password); }
    catch (error) { password = ''; console.log((error as LocalError).message); continue; }
    const confirmation = await visibleInput('Confirm your login password (input visible): ', signal);
    if (password === confirmation) return password;
    password = ''; console.log('Passwords did not match. Please try again.');
  }
  throw new LocalError('Setup cancelled.');
}
