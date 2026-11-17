import { raceFileLimit } from '@athlete-panel/contracts';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';
import { assert } from '../../packages/host/src/errors';
import { analysis, upload, settings, updateReference, removeReference } from './service';

const ownerOperation =
  (handler: (body: unknown) => Promise<unknown>): ServerPlugin['operations'][string] =>
  async (body, context) => {
    assert(
      context.actor === 'owner',
      'owner_required',
      'Course analysis requires the owner session.',
      403,
    );
    return handler(body);
  };
export default {
  operations: {
    analysis: ownerOperation(analysis),
    settings: ownerOperation(settings),
    'reference-update': ownerOperation(updateReference),
    'reference-remove': ownerOperation(removeReference),
  },
  uploads: {
    track: {
      maxBytes: raceFileLimit,
      handle: async (file, metadata, context) => {
        assert(
          context.actor === 'owner',
          'owner_required',
          'Only the owner can upload race files.',
          403,
        );
        return upload(file, metadata);
      },
    },
  },
} satisfies ServerPlugin;
