import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const roots = [
  'SECURITY.md',
  'CONTRIBUTING.md',
  'docs/changelog.md',
  'docs/release-readiness.md',
  'README.md',
  'AGENTS.md',
  'PRODUCT.md',
  'DESIGN.md',
  'docs/architecture.md',
  'docs/development.md',
  'docs/features',
  'docs/decisions',
  'docs/plans',
  '.agents/skills',
  '.claude/skills',
];
const files: string[] = [];
async function walk(path: string) {
  const info = await stat(path);
  if (info.isDirectory()) for (const child of await readdir(path)) await walk(`${path}/${child}`);
  else if (path.endsWith('.md')) files.push(path);
}
for (const root of roots) await walk(root);

// Links and heading-like shell comments inside fenced examples aren't page navigation.
function outsideCodeFences(markdown: string) {
  let fence = '';
  const lines: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker?.[1].startsWith(fence) && !marker[2].trim()) fence = '';
    } else if (marker) {
      fence = marker[1];
    } else {
      lines.push(line);
    }
  }
  return lines.join('\n');
}

const errors: string[] = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  if (/\{\{[A-Z_]+\}\}/.test(text)) errors.push(`${file}: unresolved template placeholder`);
  const markdown = outsideCodeFences(text);
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const [link, anchor] = match[1].split('#');
    if (/^[a-z]+:/i.test(link)) continue;
    const target = link ? resolve(dirname(file), link) : resolve(file);
    if (!(await stat(target).catch(() => null))) errors.push(`${file}: missing link ${link}`);
    else if (anchor && target.endsWith('.md')) {
      const body = link ? outsideCodeFences(await readFile(target, 'utf8')) : markdown;
      const headings = [...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((h) =>
        h[1]
          .toLowerCase()
          .replace(/[^\p{L}\p{N}_ -]/gu, '')
          .trim()
          .replace(/ /g, '-'),
      );
      if (!headings.includes(decodeURIComponent(anchor)))
        errors.push(`${file}: missing anchor ${link}#${anchor}`);
    }
  }
  if (
    file.startsWith('docs/features/') &&
    ![
      'Purpose and scope',
      'Intended behavior',
      'Acceptance scenarios',
      'Observed implementation',
    ].every((h) => text.includes(h))
  )
    errors.push(`${file}: required feature sections missing`);
  if (
    file.startsWith('docs/decisions/') &&
    !/Status: (proposed|accepted|rejected|superseded|unconfirmed)\b/.test(text)
  )
    errors.push(`${file}: ADR status missing`);
}
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Documentation content and local links checked (${files.length} files).`);
