import {
  historicalRecord,
  workoutStepSchema,
  strengthExerciseSchema,
  type HistorySelection,
  type HistoryFilters,
} from '@athlete-panel/contracts';
import type { Transaction } from '../../packages/host/src/db';
export async function trainingHistoryVersion(tx: Transaction): Promise<string> {
  return (await tx`select revision::text from training.history_version where singleton=true`)[0]!
    .revision;
}
/** One dated selection for both availability and detail reads. Plans/events need no plan join. */
function selectedTraining(tx: Transaction, q: HistoryFilters) {
  const kind = { workouts: 'workout', plans: 'plan', notes: 'note', events: 'event' }[
    q.category as 'workouts' | 'plans' | 'notes' | 'events'
  ];
  const relative = kind === 'workout' || kind === 'note';
  const scheduled =
    kind === 'plan'
      ? tx`r.data->>'startDate'`
      : kind === 'event'
        ? tx`r.data->>'date'`
        : tx`case
    when r.data#>>'{schedule,kind}'='independent' then r.data#>>'{schedule,date}'
    when p.data->>'startDate' is not null then ((p.data->>'startDate')::date + (r.data#>>'{schedule,day}')::integer - 1)::text else null end`;
  return tx`
    with dated as (
      select r.id,r.revision,r.data,${scheduled} as scheduled,
        ${kind === 'workout' ? tx`r.data#>>'{completion,performedDate}'` : tx`null::text`} as performed
      from training.records r ${relative ? tx`left join training.records p on p.kind='plan' and p.id=r.data#>>'{schedule,planId}' and p.deleted=false` : tx``}
      where r.kind=${kind} and r.deleted=false
        ${q.recordId ? tx`and r.id=${q.recordId}` : tx``}
        ${q.sport ? tx`and r.data->>'sport'=${q.sport}` : tx``}
        ${q.subgroup ? tx`and r.data->>'sportSubgroup'=${q.subgroup}` : tx``}
    ), scoped as (
      select *,least(case when scheduled between ${q.from} and ${q.to} then scheduled end,
        case when performed between ${q.from} and ${q.to} then performed end) as date
      from dated where scheduled between ${q.from} and ${q.to} or performed between ${q.from} and ${q.to}
    )`;
}
export async function trainingHistoryAvailability(tx: Transaction, q: HistoryFilters) {
  const rows = await tx<
    { count: number; from: string | null; to: string | null }[]
  >`${selectedTraining(tx, q)}
    select count(*)::int as count, min(date) as "from",
      max(greatest(case when scheduled between ${q.from} and ${q.to} then scheduled end,
        case when performed between ${q.from} and ${q.to} then performed end)) as "to" from scoped`;
  return { category: q.category!, ...rows[0]! };
}
export async function readTrainingHistory(tx: Transaction, q: HistorySelection) {
  const fields =
    q.category === 'workouts'
      ? tx`jsonb_build_object('revision',revision,'title',data->'title','kind',data->'kind',
      'sport',data->'sport','subgroup',data->'sportSubgroup','durationSeconds',data->'durationSeconds',
      'distanceMeters',data->'distanceMeters','elevationMeters',data->'plannedElevationGainMeters',
      'scheduledDate',scheduled,'performedDate',performed,'planId',data#>'{schedule,planId}',
      'completionStatus',data#>'{completion,status}','completionSource',data#>'{completion,source}',
      'activityId',data#>'{completion,activityId}','actualDurationSeconds',data#>'{completion,durationSeconds}',
      'actualDistanceMeters',data#>'{completion,distanceMeters}','rpe',data#>'{completion,rpe}',
      'stepCount',case when jsonb_typeof(data->'steps')='array' then jsonb_array_length(data->'steps') else 0 end,
      'exerciseCount',case when jsonb_typeof(data->'exercises')='array' then jsonb_array_length(data->'exercises') else 0 end)
      ${q.facts ? tx`` : tx`|| jsonb_build_object('notes',data->'notes','reason',data#>'{completion,reason}','completionNotes',data#>'{completion,notes}')`}`
      : q.category === 'plans'
        ? tx`jsonb_build_object('revision',revision,'title',data->'title','startDate',scheduled,'scheduledDate',scheduled,'description',data->'description')`
        : q.category === 'events'
          ? tx`jsonb_build_object('revision',revision,'title',data->'title','kind',data->'kind','scheduledDate',scheduled,'notes',data->'notes')`
          : tx`jsonb_build_object('revision',revision,'title',data->'title','scheduledDate',scheduled,'planId',data#>'{schedule,planId}','body',data->'body')`;
  const rows = await tx<
    { id: string; date: string; data: Record<string, unknown> }[]
  >`${selectedTraining(tx, q)}
    select id,date,${fields} as data
    from scoped ${q.after && q.section === 'core' ? tx`where (date,id)>(${q.after.date},${q.after.id})` : tx``}
    order by date,id limit ${q.take}`;
  const core = rows.map((r) =>
    historicalRecord(
      q.category!,
      r.id,
      r.date,
      Object.fromEntries(Object.entries(r.data).filter(([, value]) => value !== null)),
    ),
  );
  if (q.section === 'core') return core;
  if (
    !core[0] ||
    core[0].category !== 'workouts' ||
    !core[0].data.scheduledDate ||
    core[0].data.scheduledDate < q.from ||
    core[0].data.scheduledDate > q.to
  )
    return [];
  // One repeat block has at most 50 bounded steps; each part fits the byte budget independently.
  const parts = await tx<{ part: unknown; index: number }[]>`select part,ordinality::int as index
    from training.records r, jsonb_array_elements(r.data->${q.section}) with ordinality as items(part,ordinality)
    where r.kind='workout' and r.deleted=false and r.id=${q.recordId!}
    and ordinality > ${Number(q.after?.id.split(':').at(-1) ?? 0)} order by ordinality limit ${q.take}`;
  return parts.map((row) => {
    const parsed = (q.section === 'steps' ? workoutStepSchema : strengthExerciseSchema).safeParse(
      row.part,
    );
    return historicalRecord(
      'workouts',
      `${q.recordId}:${row.index}`,
      core[0]!.date,
      parsed.success ? { part: parsed.data } : { unsupportedFields: [q.section] },
    );
  });
}
