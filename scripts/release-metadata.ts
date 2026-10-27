/** Build-time metadata. No credentials, database connection or publication. */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { imageMetadataSchema } from './lib/release-data';
import { sourceDigest } from './lib/source-files';

export async function releaseMetadata(root: string) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const composition = JSON.parse(await readFile(join(root, 'instance/composition.json'), 'utf8'));
  const plugins = [];
  for (const plugin of composition.plugins) {
    if (!/^(plugins|personal-plugins)\/[a-z][a-z0-9-]*$/.test(plugin.path))
      throw new Error('Invalid release plugin path.');
    const manifest = JSON.parse(await readFile(join(root, plugin.path, 'manifest.json'), 'utf8'));
    if (manifest.version !== plugin.version)
      throw new Error('Release composition is not pinned to its source.');
    plugins.push({
      id: manifest.id,
      version: manifest.version,
      path: plugin.path,
      enabled: plugin.enabled,
    });
  }
  return imageMetadataSchema.parse({
    application: 'athlete-panel',
    hostedProtocol: 1,
    version: pkg.version,
    sourceDigest: await sourceDigest(root),
    plugins,
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await writeFile(
    '.athlete-panel-release.json',
    JSON.stringify(await releaseMetadata(process.cwd()), null, 2) + '\n',
  );
}
