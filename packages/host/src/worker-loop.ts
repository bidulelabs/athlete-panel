import type { ServerPlugin } from '../../plugin-sdk/src';
import { AppError } from './errors';
import type { Job } from './jobs';

/** Per-plugin scheduler state survives iterations, including failures. */
export function schedulerRunner(interval = 30_000) {
  const attempted = new Map<string, number>();
  const failed = new Set<string>();
  return async (plugins: Record<string, ServerPlugin>, now = Date.now()) => {
    for (const [id, plugin] of Object.entries(plugins)) {
      if (!plugin.schedule || now - (attempted.get(id) ?? -Infinity) < interval) continue;
      attempted.set(id, now);
      try {
        await plugin.schedule();
        failed.delete(id);
      } catch (error) {
        if (error instanceof AppError && error.code === 'maintenance') throw error;
        failed.add(id);
        console.error(JSON.stringify({ level: 'error', event: 'scheduler_failed', plugin: id }));
      }
    }
    return [...failed].sort();
  };
}

export async function dispatchJob(
  job: Job,
  plugins: Record<string, ServerPlugin>,
  fail: (job: Job, code: string, permanent?: boolean) => Promise<void>,
) {
  const operations = Object.hasOwn(plugins, job.plugin_id)
    ? plugins[job.plugin_id]?.jobs
    : undefined;
  const handler =
    operations && Object.hasOwn(operations, job.kind) ? operations[job.kind] : undefined;
  if (typeof handler !== 'function') return fail(job, 'missing_handler', true);
  try {
    await handler(job);
  } catch (error) {
    if (error instanceof AppError && error.code === 'maintenance') throw error;
    await fail(job, 'handler_failed');
  }
}
