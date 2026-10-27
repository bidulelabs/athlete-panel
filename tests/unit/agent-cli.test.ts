import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentConfigPath, instanceOrigin, savePrivateFile } from '../../scripts/lib/agent-client';

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
