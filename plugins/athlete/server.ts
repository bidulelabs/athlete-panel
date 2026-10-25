import type { ServerPlugin } from '../../packages/plugin-sdk/src';
import { updateOnboarding } from '../../instance/onboarding';
import { assert } from '../../packages/host/src/errors';
export default { operations: { async onboarding(body, context) {
  assert(context.actor === 'owner', 'forbidden', 'Owner approval is required.', 403);
  return updateOnboarding(body);
} } } satisfies ServerPlugin;
