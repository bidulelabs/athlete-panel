import { createHash } from 'node:crypto';
export function duplicateChildId(parentId: string, sourceId: string): string {
  // Stable child identities keep proposal previews and application consistent.
  const hex = createHash('sha256')
    .update(`athlete-panel:duplicate:${parentId}:${sourceId}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
