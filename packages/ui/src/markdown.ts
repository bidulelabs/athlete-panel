import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const parser = unified().use(remarkParse).use(remarkGfm);
type TextNode = {
  type: string;
  value?: string;
  alt?: string | null;
  children?: TextNode[];
};
const separated = new Set(['root', 'blockquote', 'list', 'listItem', 'table', 'tableRow']);
// Bound the recursive Markdown-to-HTML and React walks, independently of text length.
const maxDepth = 64;

function parseMarkdown(source: string): TextNode | undefined {
  try {
    const tree = parser.parse(source);
    const pending = [{ node: tree as TextNode, depth: 0 }];
    while (pending.length) {
      const current = pending.pop()!;
      if (current.depth > maxDepth) return undefined;
      for (const node of current.node.children ?? [])
        pending.push({ node, depth: current.depth + 1 });
    }
    return tree;
  } catch {
    // GFM can itself recurse while parsing, before we can inspect the resulting tree.
    return undefined;
  }
}

/** Preflight also protects server rendering, where React error boundaries do not run. */
export function canRenderMarkdown(source: string): boolean {
  return parseMarkdown(source) !== undefined;
}

function nodeText(node: TextNode): string {
  if (node.type === 'definition' || node.type === 'footnoteReference') return '';
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? '';
  if (node.type === 'break' || node.type === 'thematicBreak') return ' ';
  if (node.value !== undefined) return node.value;
  return node.children?.map(nodeText).join(separated.has(node.type) ? ' ' : '') ?? '';
}

/** Plain, noninteractive text for bounded cards; never rewrite the saved source. */
export function markdownToPlainText(source: string): string {
  let text = source;
  try {
    const tree = parseMarkdown(source);
    if (tree) text = nodeText(tree);
  } catch {
    // A failed excerpt must not prevent the containing card and its actions from rendering.
  }
  return text.replace(/\s+/gu, ' ').trim();
}

/** Browsers ignore control characters in schemes, so reject them before navigation. */
export function markdownUrl(url: string): string | undefined {
  const value = url.trim();
  if (/\p{Cc}/u.test(value)) return undefined;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1];
  return scheme && !['http', 'https', 'mailto'].includes(scheme.toLowerCase()) ? undefined : value;
}
