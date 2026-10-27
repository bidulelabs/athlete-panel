'use client';
import { WorkspaceApp } from '../../../packages/ui/src';
import { pages, slots } from '../../../instance/registry.client';
const priority = [
  '/calendar',
  '/plans',
  '/activities',
  '/health',
  '/cycling-sleep',
  '/garmin',
  '/agent',
  '/settings',
];
export default function Workspace({ initialPath }: { initialPath: string }) {
  return (
    <WorkspaceApp
      pages={[...pages].sort((a, b) => priority.indexOf(a.path) - priority.indexOf(b.path))}
      slots={slots}
      initialPath={initialPath}
    />
  );
}
