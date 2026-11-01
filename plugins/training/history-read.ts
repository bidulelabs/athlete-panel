import { operationContracts, auditSummarySchema } from '@athlete-panel/contracts';
import { connection } from '../../packages/host/src/db';
import { assert } from '../../packages/host/src/errors';
import { auditTitle } from './history-title';

/** Project metadata in SQL: never transfer the stored before/after arrays into a workspace read. */
export async function recentChanges() {
  const rows = await connection()`
    with recent as (select id,created_at,summary,undone_at,changes from host.changes
      order by created_at desc,id desc limit 50)
    select id,created_at as "createdAt",summary,undone_at as "undoneAt",
      detail.count as "affectedCount",detail.subject
    from recent cross join lateral (
      with visible as (
        select c,ordinality,
          coalesce(nullif(c->'before','null'::jsonb),'{}'::jsonb) - array['id','revision'] as before,
          coalesce(nullif(c->'after','null'::jsonb),'{}'::jsonb) - array['id','revision'] as after
        from jsonb_array_elements(changes) with ordinality as items(c,ordinality)
        where c->'before'='null'::jsonb or c->'after'='null'::jsonb
          or (coalesce(nullif(c->'before','null'::jsonb),'{}'::jsonb) - array['id','revision'])
            is distinct from (coalesce(nullif(c->'after','null'::jsonb),'{}'::jsonb) - array['id','revision'])
          or c->'beforeEffectiveDate' is distinct from c->'afterEffectiveDate'
      )
      select (select count(*)::int from visible) as count,
        (select coalesce(c#>>'{after,title}',c#>>'{before,title}',
          c#>>'{after,displayName}',c#>>'{before,displayName}',initcap(c->>'entity'))
        from visible where c->>'entity'=split_part(summary,'.',1)
          and case split_part(summary,'.',2)
            when 'create' then c->'before'='null'::jsonb
            when 'duplicate' then c->'before'='null'::jsonb
            when 'delete' then c->'after'='null'::jsonb else true end
        order by (before - 'order' is distinct from after - 'order') desc,ordinality limit 1) as subject
    ) detail order by created_at desc,id desc`;
  return rows.map((row) =>
    auditSummarySchema.parse({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      summary: row.summary,
      title: auditTitle(row.summary, row.subject ?? undefined),
      undoneAt: row.undoneAt?.toISOString() ?? null,
      affectedCount: row.affectedCount,
    }),
  );
}

/** Owner operation only; the agent bridge exposes no audit-detail or application operation. */
export async function changeDetails(body: unknown) {
  const { id } = operationContracts.training['history-details'].input.parse(body);
  const [row] =
    await connection()`select id,created_at,summary,undone_at,changes from host.changes where id=${id}`;
  assert(row, 'not_found', 'This training change is no longer available.', 404);
  return operationContracts.training['history-details'].output.parse({
    id: row.id,
    createdAt: row.created_at.toISOString(),
    summary: row.summary,
    undoneAt: row.undone_at?.toISOString() ?? null,
    changes: row.changes,
  });
}
