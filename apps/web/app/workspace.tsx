'use client';
import { activityProviderSchema } from '@athlete-panel/contracts';
import { WorkspaceApp, type WorkspacePage } from '../../../packages/ui/src';
import { pages, slots } from '../../../instance/registry.client';
const priority = [
  '/calendar',
  '/charts',
  '/plans',
  '/races',
  '/activities',
  '/health',
  '/garmin',
  '/apple-health',
  '/agent',
  '/settings',
];

const workspacePages: WorkspacePage[] = [...pages]
  .sort((a, b) => priority.indexOf(a.path) - priority.indexOf(b.path))
  .map((page) => {
    const source = activityProviderSchema.safeParse(page.pluginId).data;
    if (!source) return page;
    return {
      ...page,
      showInSidebar: (envelope) =>
        envelope?.activitySources?.selected.includes(source) ??
        (source === 'garmin' && envelope?.garmin.connected === true),
    };
  });

export default function Workspace({ initialPath }: { initialPath: string }) {
  return <WorkspaceApp pages={workspacePages} slots={slots} initialPath={initialPath} />;
}
