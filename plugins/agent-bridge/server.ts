import {
  createGrant,
  revokeGrant,
  applyProposal,
  rejectProposal,
  reviewProposal,
  undoChange,
} from './service';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';
import { inspectConnection, approveConnection, denyConnection } from './connections';
export default {
  operations: {
    grant: createGrant,
    revoke: revokeGrant,
    apply: applyProposal,
    review: reviewProposal,
    reject: rejectProposal,
    undo: undoChange,
    connection: inspectConnection,
    'approve-connection': approveConnection,
    'deny-connection': denyConnection,
  },
} satisfies ServerPlugin;
