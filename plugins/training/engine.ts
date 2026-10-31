import {
  agentCommandSchema,
  commandsSchema,
  type Command,
  type CommandInput,
  type MutationResult,
  type WorkspaceState,
} from '@athlete-panel/contracts';
import { createCommandContext } from './engine/context';
import { fail } from './engine/errors';
import { finalize } from './engine/finalize';
import { handleCompletion } from './engine/handlers/completion';
import { handleEvent } from './engine/handlers/event';
import { handleInjury } from './engine/handlers/injury';
import { handleNote } from './engine/handlers/note';
import { handlePlan } from './engine/handlers/plan';
import { handleProfile } from './engine/handlers/profile';
import { handleWorkout } from './engine/handlers/workout';
import { validateWorkspace } from './engine/state';
export { effectiveDate } from './dates';
export { DomainError } from './engine/errors';
export { validateWorkspace } from './engine/state';
const agentActions = new Set<string>(
  agentCommandSchema.options.map((option) => option.shape.action.value),
);
/** Commands use initial-snapshot revisions; newly created entities can be addressed at revision 1.
 * Finalization increments each changed entity once. Callers own transactions, audit and idempotency.
 */
export function applyCommands(
  input: WorkspaceState,
  inputs: readonly CommandInput[] | readonly Command[],
  options: { actor: 'owner' | 'agent'; idFactory?: () => string },
): MutationResult {
  const initial = validateWorkspace(input);
  const commands = commandsSchema.parse(inputs);
  const state: WorkspaceState = structuredClone(initial);
  const context = createCommandContext(initial, state, options);
  for (const command of commands) {
    if (options.actor === 'agent' && !agentActions.has(command.action))
      fail('FORBIDDEN', 'This command is not available to the training agent.');
    switch (command.action) {
      case 'profile.set':
        handleProfile(context, command);
        break;
      case 'plan.create':
      case 'plan.update':
      case 'plan.delete':
      case 'plan.duplicate':
        handlePlan(context, command);
        break;
      case 'workout.create':
      case 'workout.update':
      case 'workout.delete':
      case 'workout.duplicate':
      case 'workout.reorder':
        handleWorkout(context, command);
        break;
      case 'workout.complete':
      case 'workout.clearCompletion':
      case 'workout.link':
      case 'workout.unlink':
        handleCompletion(context, command);
        break;
      case 'note.create':
      case 'note.update':
      case 'note.delete':
        handleNote(context, command);
        break;
      case 'event.create':
      case 'event.update':
      case 'event.delete':
        handleEvent(context, command);
        break;
      case 'injury.create':
      case 'injury.update':
      case 'injury.delete':
        handleInjury(context, command);
        break;

      default: {
        const unreachable: never = command;
        fail('INVALID_COMMAND', String(unreachable));
      }
    }
  }
  return finalize(initial, state);
}
