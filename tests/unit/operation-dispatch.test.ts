import { expect, it, vi } from 'vitest';
import { operationHandler } from '../../packages/host/src/operation-dispatch';
import { dispatchJob } from '../../packages/host/src/worker-loop';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';
import type { Job } from '../../packages/host/src/jobs';

it('rejects inherited plugins, inherited operations and non-callable registered values', () => {
  const handler = vi.fn();
  const operations = Object.assign(Object.create({ inherited: handler }), {
    allowed: handler,
    broken: true,
  });
  const plugins = Object.assign(Object.create({ inherited: { operations } }), {
    plugin: { operations },
  });
  for (const id of ['constructor', 'toString', '__proto__', 'inherited', 'missing'])
    expect(() => operationHandler(plugins, id, 'allowed')).toThrow(
      expect.objectContaining({ code: 'not_found', status: 404 }),
    );
  for (const operation of [
    'constructor',
    'toString',
    '__proto__',
    'inherited',
    'missing',
    'broken',
  ])
    expect(() => operationHandler(plugins, 'plugin', operation)).toThrow(
      expect.objectContaining({ code: 'not_found', status: 404 }),
    );
  expect(operationHandler(plugins, 'plugin', 'allowed')).toBe(handler);
  expect(handler).not.toHaveBeenCalled();
});

it('keeps missing worker handlers permanently failed without invoking prototype functions', async () => {
  const fail = vi.fn();
  const plugin = { operations: {}, jobs: { broken: true } } as unknown as ServerPlugin;
  for (const kind of ['constructor', 'toString', '__proto__', 'missing', 'broken']) {
    const job = { plugin_id: 'plugin', kind } as Job;
    await dispatchJob(job, { plugin }, fail);
    expect(fail).toHaveBeenLastCalledWith(job, 'missing_handler', true);
  }
});
