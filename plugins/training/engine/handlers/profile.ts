import { profileSchema, type Command } from '@athlete-panel/contracts';
import type { CommandContext } from '../context';
import { fail } from '../errors';

export function handleProfile(
  context: CommandContext,
  command: Extract<Command, { action: 'profile.set' }>,
): void {
  const { state } = context;
  switch (command.action) {
    case 'profile.set': {
      const currentRevision = state.profile?.revision ?? null;
      if (command.expectedRevision !== currentRevision)
        fail('STALE_REVISION', 'Profile changed. Reload before saving.');
      state.profile = profileSchema.parse({
        ...command.values,
        id: 'owner',
        revision: currentRevision ?? 1,
      });
      break;
    }
  }
}
