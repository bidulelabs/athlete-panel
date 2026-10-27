/** Shared allowlist for release fingerprints and matched-source archives. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
const sourceRoots = [
  'apps',
  'packages',
  'plugins',
  'personal-plugins',
  'instance',
  'scripts',
  'tests',
  '.agents',
  '.claude',
  '.github',
  'docs',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.strict.json',
  'eslint.config.mjs',
  '.prettierrc.json',
  '.prettierignore',
  '.git-blame-ignore-revs',
  'vitest.config.ts',
  'playwright.config.ts',
  'Dockerfile',
  'compose.yml',
  'compose.local.yml',
  'compose.test.yml',
  'Caddyfile',
  '.dockerignore',
  '.gitignore',
  '.env.example',
  'AGENTS.md',
  'README.md',
  'PRODUCT.md',
  'DESIGN.md',
  '.impeccable/design.json',
  'LICENSE',
  'SECURITY.md',
  'CONTRIBUTING.md',
];
const excluded = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  '.cache',
  '.runtime',
  '.playwright-mcp',
  'coverage',
  'test-results',
  'playwright-report',
  '.DS_Store',
  '.env',
  '.secrets',
  'private-exports',
  'context.json',
  'proposal.json',
  '__pycache__',
]);
export async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function sourceFiles(root: string): Promise<Array<{ path: string; file: string }>> {
  const files: Array<{ path: string; file: string }> = [];
  const walk = async (relative: string) => {
    if (
      excluded.has(basename(relative)) ||
      /\.(fgr|partial|dump|pem|key|pyc|tsbuildinfo)$/.test(relative) ||
      (basename(relative).startsWith('.env.') && basename(relative) !== '.env.example')
    )
      return;
    const absolute = join(root, relative);
    const { lstat } = await import('node:fs/promises');
    const info = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) return;
    if (info.isSymbolicLink()) throw new Error(`Source backup refuses symbolic links: ${relative}`);
    if (info.isDirectory())
      for (const name of (await readdir(absolute)).sort()) await walk(`${relative}/${name}`);
    else if (info.isFile()) files.push({ path: `source/${relative}`, file: absolute });
  };
  for (const rootPath of sourceRoots) await walk(rootPath);
  return files;
}

export async function sourceDigest(root: string): Promise<string> {
  const hash = createHash('sha256');
  for (const entry of (await sourceFiles(root)).sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    hash.update(entry.path + '\0' + (await sha256(entry.file)) + '\n');
  }
  return hash.digest('hex');
}
