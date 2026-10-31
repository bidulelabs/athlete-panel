import {
  proposalExpiresAt,
  grantScopeSchema,
  workspaceEnvelopeSchema,
  type WorkspaceEnvelope,
} from '../packages/contracts/src';
import { connection, transaction } from '../packages/host/src/db';
import { contractValue } from '../packages/host/src/http';
import { pluginStatus, pluginEnabled } from '../packages/host/src/plugins';
import { readOnboarding } from '../packages/host/src/onboarding';
import { status } from '../plugins/garmin/public/server';
import { loadWorkspace } from './services';

type ProposalRow = {
  id: string;
  status: string;
  digest: string;
  createdAt: Date;
  affectedCount: number;
  dateBounds: unknown;
  summary: string;
};
type GrantRow = {
  id: string;
  label: string;
  expiresAt: Date;
  revoked: boolean;
  scope: unknown;
};
type AuditRow = {
  id: string;
  createdAt: Date;
  summary: string;
  undoneAt: Date | null;
  changes: unknown;
};
type JobRow = {
  id: string;
  status: string;
  kind: string;
  progress: unknown;
  error: string | null;
  nextRunAt: Date;
  attempts: number;
};
function progressLabel(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  if ('label' in value && typeof value.label === 'string') return value.label;
  return 'phase' in value && typeof value.phase === 'string' ? value.phase : '';
}
export async function readWorkspaceResponse(range: {
  from: string;
  to: string;
}): Promise<WorkspaceEnvelope> {
  const sql = connection();
  const [state, plugins, garmin, proposals, grants, changes, jobs, operational] = await Promise.all(
    [
      transaction((tx) => loadWorkspace(tx, range), { allowMaintenance: true }),
      pluginStatus(),
      pluginEnabled('garmin')
        ? status()
        : Promise.resolve({
            connected: false,
            paused: false,
            earliestDate: null,
            lastSync: null,
            lastError: null,
            status: 'Disabled',
            coverage: [],
          }),
      sql<
        ProposalRow[]
      >`select id,status,digest,created_at as "createdAt",jsonb_array_length(changes) as "affectedCount",summary,
      (select jsonb_build_object('from',min(coalesce(c->>'afterEffectiveDate',c->>'beforeEffectiveDate')),'to',max(coalesce(c->>'afterEffectiveDate',c->>'beforeEffectiveDate'))) from jsonb_array_elements(changes) c) as "dateBounds" from host.proposals order by created_at desc limit 50`,
      sql<
        GrantRow[]
      >`select id,label,expires_at as "expiresAt",revoked,scope from host.grants order by created_at desc limit 50`,
      sql<
        AuditRow[]
      >`select id,created_at as "createdAt",summary,undone_at as "undoneAt",changes from host.changes order by created_at desc limit 50`,
      sql<
        JobRow[]
      >`select id,status,kind,progress,error,next_run_at as "nextRunAt",attempts from host.jobs order by created_at desc limit 50`,
      sql<
        { key: string; value: unknown }[]
      >`select key,value from host.settings where key in ('worker','lastBackup','backupAttempt','backupSchedule','composition')`,
    ],
  );
  const schema = await sql<
    { pluginId: string; name: string; appliedAt: Date }[]
  >`select plugin_id as "pluginId",name,applied_at as "appliedAt" from host.migrations order by applied_at,name`;
  return contractValue(workspaceEnvelopeSchema, {
    state,
    plugins,
    garmin,
    onboarding: await readOnboarding(),
    proposals: proposals.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      expiresAt: proposalExpiresAt(row.createdAt),
      warnings: [],
    })),
    grants: grants.map(({ scope, ...row }) => ({
      ...row,
      ...grantScopeSchema.parse(scope),
      expiresAt: row.expiresAt.toISOString(),
    })),
    changes: changes.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      undoneAt: row.undoneAt?.toISOString() ?? null,
    })),
    jobs: jobs.map((row) => ({
      ...row,
      nextRunAt: row.nextRunAt.toISOString(),
      progress: progressLabel(row.progress),
    })),
    operational: [
      ...operational,
      {
        key: 'schema',
        value: schema.map((row) => ({ ...row, appliedAt: row.appliedAt.toISOString() })),
      },
    ],
  });
}
