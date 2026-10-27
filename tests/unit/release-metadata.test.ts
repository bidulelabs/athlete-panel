import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceDigest, sourceFiles } from '../../scripts/lib/source-files';
import { readImageMetadata, releasedImageSchema } from '../../scripts/lib/release-data';

describe('recovery source identity', () => {
  it('requires metadata for this application at the documented image path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'athlete-panel-image-test-'));
    const metadata = {
      application: 'athlete-panel',
      hostedProtocol: 1,
      version: '0.1.0',
      sourceDigest: 'a'.repeat(64),
      plugins: [],
    };
    try {
      await expect(readImageMetadata(root)).rejects.toThrow();
      await writeFile(join(root, '.athlete-panel-release.json'), JSON.stringify(metadata));
      expect(await readImageMetadata(root)).toEqual(metadata);
      await writeFile(
        join(root, '.athlete-panel-release.json'),
        JSON.stringify({ ...metadata, application: 'unrelated-app' }),
      );
      await expect(readImageMetadata(root)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('tracks custom source while excluding credentials, exports and generated output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'athlete-panel-release-test-'));
    try {
      await mkdir(join(root, 'personal-plugins/custom'), { recursive: true });
      const custom = join(root, 'personal-plugins/custom/client.tsx');
      await writeFile(custom, 'synthetic-v1');
      const first = await sourceDigest(root);
      await writeFile(join(root, '.env'), 'synthetic-secret');
      await writeFile(join(root, 'personal-plugins/custom/context.json'), 'synthetic-export');
      await mkdir(join(root, 'apps/web/.next'), { recursive: true });
      await writeFile(join(root, 'apps/web/.next/cache'), 'synthetic-cache');
      expect(await sourceDigest(root)).toBe(first);
      await writeFile(custom, 'synthetic-v2');
      expect(await sourceDigest(root)).not.toBe(first);
      await symlink(custom, join(root, 'personal-plugins/custom/alias'));
      await expect(sourceDigest(root)).rejects.toThrow('symbolic links');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('preserves durable design context without archiving local design-tool state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'athlete-panel-design-source-test-'));
    try {
      await mkdir(join(root, '.impeccable'));
      await writeFile(join(root, 'PRODUCT.md'), 'Synthetic product context');
      await writeFile(join(root, 'DESIGN.md'), 'Synthetic design guidance');
      await writeFile(join(root, '.impeccable/design.json'), '{"schemaVersion":2}');
      const digest = await sourceDigest(root);
      await writeFile(
        join(root, '.impeccable/config.local.json'),
        'synthetic local-only configuration',
      );
      expect((await sourceFiles(root)).map((entry) => entry.path).sort()).toEqual([
        'source/.impeccable/design.json',
        'source/DESIGN.md',
        'source/PRODUCT.md',
      ]);
      expect(await sourceDigest(root)).toBe(digest);
      await writeFile(join(root, 'DESIGN.md'), 'Updated synthetic design guidance');
      expect(await sourceDigest(root)).not.toBe(digest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('requires separate immutable registry and local image identities', () => {
    const identity = {
      imageId: 'sha256:' + 'a'.repeat(64),
      registryRef: 'ghcr.io/example/athlete-panel@sha256:' + 'b'.repeat(64),
      sourceDigest: 'c'.repeat(64),
      version: '0.1.0',
      kind: 'registry',
    };
    expect(releasedImageSchema.parse(identity)).toEqual(identity);
    expect(() =>
      releasedImageSchema.parse({
        ...identity,
        registryRef: 'ghcr.io/example/athlete-panel:latest',
      }),
    ).toThrow();
    expect(() => releasedImageSchema.parse({ ...identity, imageId: 'v1' })).toThrow();
  });
});
