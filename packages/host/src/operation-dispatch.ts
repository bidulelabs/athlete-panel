import type { ServerPlugin } from '../../plugin-sdk/src';
import { assert } from './errors';

/** Only explicitly registered, callable operations belong to the public API. */
export function operationHandler(
  plugins: Record<string, ServerPlugin>,
  id: string,
  operation: string,
) {
  const plugin = Object.hasOwn(plugins, id) ? plugins[id] : undefined;
  const operations = plugin?.operations;
  const handler =
    operations && Object.hasOwn(operations, operation) ? operations[operation] : undefined;
  assert(typeof handler === 'function', 'not_found', 'Operation does not exist.', 404);
  return handler;
}
