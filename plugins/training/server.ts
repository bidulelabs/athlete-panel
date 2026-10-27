import { mutate, undoChange } from './service';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';
export default { operations: { mutate, undo: undoChange } } satisfies ServerPlugin;
