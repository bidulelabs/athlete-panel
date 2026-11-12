import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { planningStyles } from '../../plugins/agent-bridge/planning-styles';

describe('planning styles', () => {
  it('the coaching skill names each style the connect dialog suggests', async () => {
    const skill = await readFile('.agents/skills/athlete-panel-training-coaching/SKILL.md', 'utf8');
    for (const style of planningStyles) expect(skill).toContain(`**${style}:**`);
    expect(skill).toContain('ask once with these two choices');
  });
});
