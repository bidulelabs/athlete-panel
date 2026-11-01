import { mutate, undoChange } from './service';
import { changeDetails } from './history-read';
import type { ServerPlugin } from '../../packages/plugin-sdk/src';
export default {
  operations: { mutate, undo: undoChange, 'history-details': changeDetails },
} satisfies ServerPlugin;
