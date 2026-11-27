import { activitySourceChoiceSchema } from '@athlete-panel/contracts';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';
import { updateOnboarding } from '../../instance/onboarding';
import { chooseActivitySource } from '../../instance/activity-sources';
import { assert } from '../../packages/host/src/errors';
export default {
  operations: {
    async onboarding(body, context) {
      assert(context.actor === 'owner', 'forbidden', 'Owner approval is required.', 403);
      return updateOnboarding(body);
    },
    async 'choose-activity-source'(body, context) {
      assert(context.actor === 'owner', 'forbidden', 'Owner approval is required.', 403);
      return chooseActivitySource(activitySourceChoiceSchema.parse(body).source);
    },
  },
} satisfies ServerPlugin;
