import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkBoundaries } from '../../scripts/lib/import-boundaries';

const roots: string[] = [];
function fixture(
  extra: Record<string, string> = {},
  dependencies: Record<string, string> = { provider: '^1.0.0' },
) {
  const root = mkdtempSync(join(tmpdir(), 'athlete-boundaries-'));
  roots.push(root);
  const manifest = (id: string, extra: object) =>
    JSON.stringify({
      id,
      name: id,
      description: '',
      version: '1.0.0',
      hostApi: '^1.0.0',
      ...extra,
    });
  const files = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        moduleResolution: 'Bundler',
        module: 'ESNext',
        baseUrl: '.',
        paths: { '@provider/*': ['plugins/provider/*'] },
      },
      include: ['**/*.ts', '**/*.tsx'],
    }),
    'instance/composition.json': JSON.stringify({
      apiVersion: 1,
      plugins: ['consumer', 'provider'].map((id) => ({
        path: `plugins/${id}`,
        version: '1.0.0',
        enabled: true,
      })),
    }),
    'plugins/consumer/manifest.json': manifest('consumer', { client: 'view.tsx', dependencies }),
    'plugins/provider/manifest.json': manifest('provider', {
      public: { shared: 'public/shared.ts', server: 'public/server.ts' },
    }),
    'plugins/consumer/view.tsx': "export { value } from '@provider/public/shared';",
    'plugins/provider/public/shared.ts': 'export const value = 1; export type Value = number;',
    'plugins/provider/public/server.ts': "export { secret } from '../private';",
    'plugins/provider/private.ts': "export const secret = 'synthetic';",
    ...extra,
  };
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('resolved source boundaries', () => {
  it('accepts a declared public alias and erased public type imports', () => {
    const root = fixture({
      'plugins/consumer/view.tsx':
        "import type { Value } from '@provider/public/shared'; export type Result = Value;",
    });
    expect(checkBoundaries(root)).toEqual([]);
  });
  it.each([
    "export * from '@provider/public/server';",
    "export const load = () => import('@provider/public/server');",
    "export const load = () => require('@provider/public/server');",
    "import fs from 'node:fs'; export { fs };",
    "import fs from 'fs'; export { fs };",
    'declare const target: string; export const load = () => import(target);',
    "export * from './missing';",
  ])('rejects a transitive browser edge: %s', (source) => {
    const root = fixture({
      'plugins/consumer/view.tsx': "export * from './barrel';",
      'plugins/consumer/barrel.ts': source,
    });
    expect(
      checkBoundaries(root).some(
        (error) => error.startsWith('Browser dependency:') && error.includes('barrel.ts'),
      ),
    ).toBe(true);
  });
  it('discovers use-client roots that are not named client.tsx', () => {
    const root = fixture({
      'apps/web/widget.tsx': "'use client'; export * from '../../plugins/provider/public/server';",
    });
    expect(checkBoundaries(root).join('\n')).toContain('apps/web/widget.tsx');
  });
  it('rejects private imports even when erased and rejects undeclared public edges', () => {
    expect(
      checkBoundaries(
        fixture({
          'plugins/consumer/view.tsx': "import type { secret } from '@provider/private';",
        }),
      ).join('\n'),
    ).toContain('private plugin import');
    expect(checkBoundaries(fixture({}, {})).join('\n')).toContain(
      'undeclared/incompatible dependency',
    );
  });
  it('rejects transitive host feature imports', () => {
    const root = fixture({
      'packages/host/index.ts': "export * from '../../bridge';",
      'bridge.ts': "export * from './plugins/provider/public/shared';",
    });
    expect(checkBoundaries(root).join('\n')).toContain('Host imports feature code:');
  });
  it('rejects dependency cycles and incompatible versions before source evaluation', () => {
    const manifest = {
      id: 'provider',
      name: 'provider',
      description: '',
      version: '1.0.0',
      hostApi: '^1.0.0',
      dependencies: { consumer: '^1.0.0' },
    };
    expect(() =>
      checkBoundaries(fixture({ 'plugins/provider/manifest.json': JSON.stringify(manifest) })),
    ).toThrow(/cycle/);
    expect(() => checkBoundaries(fixture({}, { provider: '^2.0.0' }))).toThrow(
      /Unsatisfied dependency/,
    );
  });
  it('allows an absent optional provider without a source import', () => {
    const root = fixture({
      'instance/composition.json': JSON.stringify({
        plugins: [{ path: 'plugins/consumer', version: '1.0.0', enabled: true }],
      }),
      'plugins/consumer/manifest.json': JSON.stringify({
        id: 'consumer',
        name: 'consumer',
        description: '',
        version: '1.0.0',
        hostApi: '^1.0.0',
        client: 'view.tsx',
        optionalDependencies: { garmin: '^1.0.0' },
      }),
      'plugins/consumer/view.tsx': 'export default function View() { return null; }',
    });
    expect(checkBoundaries(root)).toEqual([]);
  });
  it('rejects feature imports hidden through shared packages, including host type imports', () => {
    const root = fixture({
      'packages/ui/index.ts': "export * from '../../plugins/provider/private';",
      'packages/host/types.ts':
        "import type { Value } from '../../plugins/provider/public/shared'; export type HostValue = Value;",
    });
    expect(checkBoundaries(root).join('\n')).toContain('Shared package imports feature code:');
    expect(checkBoundaries(root).join('\n')).toContain('Host imports feature code:');
  });
  it('rejects a plugin hiding a private import behind an application barrel', () => {
    const root = fixture({
      'plugins/consumer/view.tsx': "export * from '../../bridge';",
      'bridge.ts': "export * from './plugins/provider/private';",
    });
    expect(checkBoundaries(root).join('\n')).toContain('plugin bypasses public infrastructure');
  });
});
