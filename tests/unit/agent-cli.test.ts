import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  agentConfigPath,
  instanceOrigin,
  runAgentCli,
  savePrivateFile,
} from '../../scripts/lib/agent-client';

describe('agent CLI credential handling', () => {
  it('uses the standard credential location unless an explicit path is configured', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'athlete-panel-agent-'));
    try {
      expect(await agentConfigPath({}, directory)).toBe(
        join(directory, '.config/athlete-panel/agent.json'),
      );
      const custom = join(directory, 'custom.json');
      expect(await agentConfigPath({ ATHLETE_PANEL_AGENT_CONFIG: custom }, directory)).toBe(custom);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('accepts HTTPS and loopback HTTP without permitting credential-bearing or non-HTTP URLs', () => {
    expect(instanceOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(instanceOrigin('https://training.example/')).toBe('https://training.example');
    for (const url of [
      'http://training.example',
      'ftp://localhost',
      'file:///etc/passwd',
      'https://user:password@training.example',
      'https://training.example/path',
      'https://training.example/?token=secret',
      'https://training.example/#secret',
    ])
      expect(() => instanceOrigin(url)).toThrow();
  });
  it('writes and replaces credentials atomically with private permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'athlete-panel-agent-'));
    try {
      const file = join(directory, 'agent.json');
      await writeFile(file, 'old credential', { mode: 0o644 });
      await savePrivateFile(file, 'synthetic replacement');
      expect(await readFile(file, 'utf8')).toBe('synthetic replacement');
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      await expect(savePrivateFile(directory, 'cannot replace directory')).rejects.toThrow();
      expect(await readFile(file, 'utf8')).toBe('synthetic replacement');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('agent CLI server errors', () => {
  async function proposeWithServerError(error: unknown) {
    const directory = await mkdtemp(join(tmpdir(), 'athlete-panel-agent-'));
    const config = join(directory, 'agent.json');
    const proposal = join(directory, 'proposal.json');
    await savePrivateFile(
      config,
      JSON.stringify({ url: 'http://127.0.0.1:3000', token: 'A'.repeat(43) }),
    );
    await writeFile(proposal, '{}');
    vi.stubEnv('ATHLETE_PANEL_AGENT_CONFIG', config);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error }, { status: 400 })),
    );
    try {
      return await runAgentCli(['propose', '--file', proposal]).catch((thrown: Error) => thrown);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  }

  it('prints the path and message of each validation issue', async () => {
    const thrown = await proposeWithServerError({
      code: 'validation',
      message: 'Check the submitted values.',
      details: [
        { path: ['commands', 0, 'values', 'title'], message: 'Too small' },
        { path: ['summary'], message: 'Required' },
      ],
    });
    expect(thrown).toMatchObject({
      message:
        'Check the submitted values.\n  commands.0.values.title: Too small\n  summary: Required',
    });
  });

  it('prints only the message for other errors', async () => {
    const thrown = await proposeWithServerError({
      code: 'stale_context',
      message: 'The context changed.',
      details: { changed: ['plans'] },
    });
    expect(thrown).toMatchObject({ message: 'The context changed.' });
  });
});
