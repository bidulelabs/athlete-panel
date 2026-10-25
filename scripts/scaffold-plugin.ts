import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { manifestSchema } from '../packages/plugin-sdk/src';

export async function scaffoldPlugin(root: string, id: string, name: string): Promise<string> {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(id)) throw new Error('Use a plugin ID of 2–64 lowercase letters, digits or hyphens, starting with a letter.');
  if (!name.trim() || name.length > 100) throw new Error('Use a plugin name of 1–100 characters.');
  const project = await realpath(root);
  const parent = resolve(project, 'personal-plugins');
  await mkdir(parent, { recursive: true });
  if (await realpath(parent) !== parent) throw new Error('The personal-plugins directory must not be a symbolic link.');
  const target = resolve(parent, id);
  const manifest = manifestSchema.parse({ id, name: name.trim(), description: `${name.trim()} personal workspace plugin`, version: '0.1.0', hostApi: '^1.0.0', dependencies: { 'activity-records': '^1.0.0' }, client: 'client.tsx', routes: [{ path: `/${id}`, title: name.trim() }] });
  // mkdir without recursive and exclusive file writes refuse existing plugins, including symlinks.
  await mkdir(target);
  await writeFile(resolve(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  const title = JSON.stringify(name.trim()).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
  const source = `"use client";\n\nimport { PageHeader, Section, type PluginPageProps } from '@athlete-panel/ui';\n\nexport default function PersonalPlugin({ data }: PluginPageProps) {\n  const cycling = data.activities.filter(activity => activity.sport === 'cycling');\n  const known = cycling.filter(activity => activity.durationSeconds !== null);\n  const seconds = known.reduce((total, activity) => total + activity.durationSeconds!, 0);\n  return <><PageHeader title={${title}} description="A personal view of the currently loaded training window." /><Section title="Recorded cycling"><p>{Math.round(seconds / 60)} recorded minutes across {cycling.length} activities.</p>{known.length < cycling.length && <p>{cycling.length - known.length} activities have unknown duration.</p>}{cycling.length === 0 && <p>No cycling activities are available in this window.</p>}</Section></>;\n}\n`;
  await writeFile(resolve(target, 'client.tsx'), source, { flag: 'wx' });
  // Parse the output once before reporting a successfully created source plugin.
  manifestSchema.parse(JSON.parse(await readFile(resolve(target, 'manifest.json'), 'utf8')));
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (!args[0] || args.length > 2) throw new Error('Usage: pnpm exec tsx scripts/scaffold-plugin.ts <plugin-id> [display-name]');
  const directory = await scaffoldPlugin(process.cwd(), args[0], args[1] ?? args[0].split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' '));
  console.log(`Created ${directory}. Review the source, add its pinned entry to instance/composition.json, then follow the documented verification and activation procedure.`);
}
