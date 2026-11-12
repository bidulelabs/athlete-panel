import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('shared UI components', () => {
  it.each(['button', 'toggle', 'switch', 'badge', 'tabs'])(
    '%s transitions listed properties, not transition-all',
    (componentName) => {
      const componentSource = readFileSync(
        `packages/ui/src/components/${componentName}.tsx`,
        'utf8',
      );
      expect(componentSource).not.toContain('transition-all');
      expect(componentSource).toMatch(
        /transition-\[color,background-color,border-color,box-shadow/,
      );
    },
  );
});
