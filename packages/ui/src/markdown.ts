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

function nodeText(node: TextNode): string {
  if (node.type === 'definition' || node.type === 'footnoteReference') return '';
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? '';
  if (node.type === 'break' || node.type === 'thematicBreak') return ' ';
  if (node.value !== undefined) return node.value;
  return node.children?.map(nodeText).join(separated.has(node.type) ? ' ' : '') ?? '';
}

/** Plain, noninteractive text for bounded cards; never rewrite the saved source. */
export function markdownToPlainText(source: string): string {
  return nodeText(parser.parse(source)).replace(/\s+/gu, ' ').trim();
}

/** Browsers ignore control characters in schemes, so reject them before navigation. */
export function markdownUrl(url: string): string | undefined {
  const value = url.trim();
  if (/\p{Cc}/u.test(value)) return undefined;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1];
  return scheme && !['http', 'https', 'mailto'].includes(scheme.toLowerCase()) ? undefined : value;
}
