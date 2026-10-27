import { expect, it, vi } from 'vitest';
import { dispatchJob, schedulerRunner } from '../../packages/host/src/worker-loop';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';
import type { Job } from '../../packages/host/src/jobs';

it('isolates schedulers, limits failed attempts and recovers degraded state', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const broken = vi
      .fn()
      .mockRejectedValueOnce(new Error('private upstream value'))
      .mockResolvedValue(undefined);
    const other = vi.fn().mockResolvedValue(undefined);
    const run = schedulerRunner();
    const plugins: Record<string, ServerPlugin> = {
      broken: { operations: {}, schedule: broken },
      other: { operations: {}, schedule: other },
    };
    expect(await run(plugins, 0)).toEqual(['broken']);
    const handler = vi.fn();
    await dispatchJob(
      { plugin_id: 'other', kind: 'work' } as Job,
      { other: { ...plugins.other!, jobs: { work: handler } } },
      vi.fn(),
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(other).toHaveBeenCalledOnce();
    expect(await run(plugins, 29999)).toEqual(['broken']);
    expect(broken).toHaveBeenCalledOnce();
    expect(await run(plugins, 30000)).toEqual([]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private upstream');
  } finally {
    log.mockRestore();
  }
});

it('settles absent handlers and unexpected failures through the fenced fallback', async () => {
  const fail = vi.fn();
  const job = { plugin_id: 'plugin', kind: 'constructor' } as Job;
  await dispatchJob(job, { plugin: { operations: {}, jobs: {} } }, fail);
  expect(fail).toHaveBeenLastCalledWith(job, 'missing_handler', true);
  const throwing = {
    operations: {},
    jobs: {
      work: async () => {
        throw new Error('secret');
      },
    },
  };
  const work = { ...job, kind: 'work' };
  await dispatchJob(work, { plugin: throwing }, fail);
  expect(fail).toHaveBeenLastCalledWith(work, 'handler_failed');
});
