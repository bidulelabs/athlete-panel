import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  commandsSchema,
  agentScopeSchema,
  agentGrantValuesSchema,
  type Command,
  type EntityChange,
  type WorkspaceState,
  type WorkoutStep,
} from '../../packages/contracts/src';
import { transaction, type Transaction } from '../../packages/host/src/db';
import { canonical, digest, randomToken } from '../../packages/host/src/crypto';
import { assert } from '../../packages/host/src/errors';
import { loadWorkspace, persistChanges } from '../../instance/services';
import { applyCommands, effectiveDate } from '../training/engine';
import { idempotent, audit, undoChange } from '../training/service';

const scopeSchema = agentScopeSchema;
type Scope = z.infer<typeof scopeSchema>;
export async function createGrant(body: unknown) {
  const input = agentGrantValuesSchema.parse(body);
  const scope = scopeSchema.parse(input);
  const id = randomUUID(),
    token = randomToken();
  const expiresAt = new Date(Date.now() + input.expiresInHours * 3600000).toISOString();
  await transaction(async (tx) => {
    await tx`insert into host.grants(id,token_hash,label,scope,expires_at) values(${id},${digest(token)},${input.label},${tx.json(scope)},${expiresAt})`;
  });
  return { grant: { id, label: input.label, ...scope, expiresAt, revoked: false }, token };
}
export async function revokeGrant(body: unknown) {
  const { id } = z.object({ id: z.uuid() }).parse(body);
  await transaction(async (tx) => {
    await tx`update host.grants set revoked=true where id=${id}`;
  });
  return { ok: true };
}
async function grantForToken(token: string, tx: Transaction) {
  const [grant] =
    await tx`select * from host.grants where token_hash=${digest(token)} and revoked=false and expires_at>now()`;
  assert(grant, 'invalid_grant', 'This agent grant is expired or revoked.', 401);
  return grant;
}
const hasStepNotes = (steps: WorkoutStep[]) =>
  steps.some((step) =>
    step.kind === 'repeat' ? step.steps.some((child) => Boolean(child.notes)) : Boolean(step.notes),
  );
const withoutStepNotes = (steps: WorkoutStep[]): WorkoutStep[] =>
  steps.map((step) =>
    step.kind === 'repeat'
      ? { ...step, steps: step.steps.map((child) => ({ ...child, notes: '' })) }
      : { ...step, notes: '' },
  );
function boundedContext(state: WorkspaceState, scope: Scope) {
  const within = (date: string | null) => date !== null && date >= scope.from && date <= scope.to;
  const workouts = state.workouts.filter(
    (w) =>
      within(effectiveDate(w, state.plans)) || (w.completion && within(w.completion.performedDate)),
  );
  const planIds = new Set(
    workouts.flatMap((w) => (w.schedule.kind === 'plan' ? [w.schedule.planId] : [])),
  );
  const notes = scope.includeNotes
    ? state.notes.filter((n) => within(effectiveDate(n, state.plans)))
    : [];
  for (const note of notes) if (note.schedule.kind === 'plan') planIds.add(note.schedule.planId);
  return {
    profile: state.profile,
    plans: state.plans
      .filter((p) => planIds.has(p.id) || within(p.startDate))
      .map((p) => (scope.includeNotes ? p : { ...p, description: '' })),
    workouts: workouts.map((w) =>
      scope.includeNotes
        ? w
        : {
            ...w,
            notes: '',
            steps: withoutStepNotes(w.steps),
            completion: w.completion ? { ...w.completion, reason: '' } : null,
          },
    ),
    notes,
    events: state.events
      .filter((e) => within(e.date))
      .map((e) => (scope.includeNotes ? e : { ...e, notes: '' })),
    injuries: state.injuries
      .filter((i) => i.startDate <= scope.to && (i.endDate === null || i.endDate >= scope.from))
      .map((i) => (scope.includeNotes ? i : { ...i, notes: '' })),
    activities: state.activities.filter((a) => within(a.localDate)),
    health: state.health.filter((h) => within(h.localDate)),
  };
}
export async function contextForToken(token: string) {
  return transaction(async (tx) => {
    const grant = await grantForToken(token, tx),
      scope = scopeSchema.parse(grant.scope);
    const context = boundedContext(await loadWorkspace(tx, scope), scope);
    return {
      version: 1,
      scope,
      context,
      contextDigest: digest(canonical(context)),
      expiresAt: grant.expires_at,
    };
  });
}
function assignIds(commands: Command[]): Command[] {
  return commands.map((c) =>
    c.action.endsWith('.create') || c.action.endsWith('.duplicate')
      ? ({
          ...c,
          values: {
            ...('values' in c ? c.values : {}),
            id: ('values' in c && 'id' in c.values && c.values.id) || randomUUID(),
          },
        } as Command)
      : c,
  );
}
function assertReadableSources(commands: Command[], state: WorkspaceState, scope: Scope) {
  const context = boundedContext(state, scope);
  for (const command of commands) {
    if (command.action === 'workout.reorder') {
      assert(
        command.workouts.every((w) => context.workouts.some((c) => c.id === w.id)),
        'out_of_scope',
        'Reordering references a workout outside the grant.',
        403,
      );
      continue;
    }
    if (!('id' in command)) continue;
    const kind = command.action.split('.')[0],
      items =
        kind === 'plan'
          ? context.plans
          : kind === 'workout'
            ? context.workouts
            : kind === 'note'
              ? context.notes
              : [];
    assert(
      items.some((i) => i.id === command.id),
      'out_of_scope',
      'The command references a source outside the granted context.',
      403,
    );
    if (command.action === 'workout.duplicate') {
      const source = state.workouts.find((w) => w.id === command.id)!;
      assert(
        scope.includeNotes || (!source.notes && !hasStepNotes(source.steps)),
        'forbidden',
        'Duplicating this workout requires access to its notes.',
        403,
      );
    }
    if (command.action === 'plan.duplicate') {
      const workouts = state.workouts.filter(
        (w) => w.schedule.kind === 'plan' && w.schedule.planId === command.id,
      );
      const notes = state.notes.filter(
        (w) => w.schedule.kind === 'plan' && w.schedule.planId === command.id,
      );
      assert(
        workouts.every((w) => context.workouts.some((c) => c.id === w.id)) &&
          notes.every((w) => context.notes.some((c) => c.id === w.id)),
        'out_of_scope',
        'Duplicating this plan requires access to every source record.',
        403,
      );
      assert(
        scope.includeNotes ||
          (!state.plans.find((p) => p.id === command.id)?.description &&
            workouts.every((w) => !w.notes && !hasStepNotes(w.steps))),
        'forbidden',
        'Duplicating this plan requires access to its notes.',
        403,
      );
    }
  }
}
function assertBounded(
  changes: EntityChange[],
  before: WorkspaceState,
  after: WorkspaceState,
  scope: Scope,
) {
  for (const change of changes) {
    assert(
      ['plan', 'workout', 'note'].includes(change.entity),
      'forbidden',
      'Agent changes are limited to pending plans, workouts and selected notes.',
      403,
    );
    if (change.entity === 'note')
      assert(scope.includeNotes, 'forbidden', 'This grant does not include notes.', 403);
    for (const [value, state] of [
      [change.before, before],
      [change.after, after],
    ] as const) {
      if (!value) continue;
      if (change.entity === 'plan') {
        if (
          change.before &&
          change.after &&
          canonical({ ...change.before, revision: 0 }) ===
            canonical({ ...change.after, revision: 0 })
        )
          continue;
        const plan = value as WorkspaceState['plans'][number];
        assert(
          plan.startDate !== null && plan.startDate >= scope.from && plan.startDate <= scope.to,
          'out_of_scope',
          'Plan dates must stay within the grant bounds.',
          403,
        );
        // A plan update can affect every child, including records omitted by the context.
        for (const item of [...state.workouts, ...state.notes].filter(
          (w) => w.schedule.kind === 'plan' && w.schedule.planId === value.id,
        )) {
          const date = effectiveDate(item, state.plans);
          assert(
            date && date >= scope.from && date <= scope.to,
            'out_of_scope',
            'This plan includes records outside the grant bounds.',
            403,
          );
        }
      } else {
        const date = effectiveDate(value as WorkspaceState['workouts'][number], state.plans);
        assert(
          date && date >= scope.from && date <= scope.to,
          'out_of_scope',
          'All affected records must remain within the grant dates.',
          403,
        );
      }
    }
  }
}
export async function submitProposal(token: string, body: unknown) {
  const input = z
    .object({
      commands: commandsSchema,
      summary: z.string().min(1).max(500),
      contextDigest: z.string().length(64),
      idempotencyKey: z.uuid(),
    })
    .strict()
    .parse(body);
  return transaction(async (tx) => {
    const grant = await grantForToken(token, tx),
      scope = scopeSchema.parse(grant.scope);
    return idempotent(
      tx,
      input.idempotencyKey,
      { operation: 'propose', grantId: grant.id, ...input },
      async () => {
        const before = await loadWorkspace(tx, scope),
          context = boundedContext(before, scope);
        assert(
          digest(canonical(context)) === input.contextDigest,
          'stale_context',
          'Training context changed. Read it again and review your proposal.',
          409,
        );
        const commands = assignIds(input.commands);
        assertReadableSources(commands, before, scope);
        const result = applyCommands(before, commands, { actor: 'agent' });
        if (!scope.includeNotes)
          for (const command of commands) {
            assert(
              !(
                'values' in command &&
                'notes' in command.values &&
                (command.action.endsWith('.update') || command.values.notes !== '')
              ),
              'forbidden',
              'This grant does not allow reading or editing notes.',
              403,
            );
            if (command.action === 'plan.update')
              assert(
                !('description' in command.values),
                'forbidden',
                'Editing plan notes requires notes access.',
                403,
              );
            if (command.action === 'plan.create')
              assert(
                !command.values.description,
                'forbidden',
                'Creating plan notes requires notes access.',
                403,
              );
            if (
              (command.action === 'workout.create' || command.action === 'workout.update') &&
              command.values.steps
            ) {
              const source =
                command.action === 'workout.update'
                  ? before.workouts.find((w) => w.id === command.id)
                  : undefined;
              assert(
                !hasStepNotes(command.values.steps) && (!source || !hasStepNotes(source.steps)),
                'forbidden',
                'Editing intervals with private notes requires notes access.',
                403,
              );
            }
          }
        assertBounded(result.changes, before, result.state, scope);
        const id = randomUUID();
        const proposalDigest = digest(
          canonical({
            commands,
            changes: result.changes,
            contextDigest: input.contextDigest,
            summary: input.summary,
          }),
        );
        await tx`insert into host.proposals(id,grant_id,status,summary,commands,changes,context,digest) values(${id},${grant.id},'pending',${input.summary},${tx.json(commands as never)},${tx.json(result.changes as never)},${tx.json({ scope, digest: input.contextDigest })},${proposalDigest})`;
        return {
          id,
          digest: proposalDigest,
          status: 'pending',
          affected: result.changes.map((c) => ({ entity: c.entity, id: c.id })),
        };
      },
    );
  });
}
export async function applyProposal(body: unknown) {
  const input = z
    .object({ id: z.uuid(), digest: z.string().length(64), idempotencyKey: z.uuid() })
    .strict()
    .parse(body);
  return transaction((tx) =>
    idempotent(tx, input.idempotencyKey, { operation: 'apply', ...input }, async () => {
      const [proposal] =
        await tx`select p.*,g.revoked,g.expires_at from host.proposals p join host.grants g on p.grant_id=g.id where p.id=${input.id} for update`;
      assert(
        proposal && proposal.status === 'pending',
        'proposal_unavailable',
        'This proposal is missing or no longer pending.',
        409,
      );
      assert(
        !proposal.revoked && new Date(proposal.expires_at).getTime() > Date.now(),
        'invalid_grant',
        'The proposal grant has expired or been revoked.',
        403,
      );
      assert(
        proposal.digest === input.digest,
        'digest_mismatch',
        'The reviewed proposal does not match this request.',
        409,
      );
      const scope = scopeSchema.parse(proposal.context.scope),
        before = await loadWorkspace(tx, scope);
      assert(
        digest(canonical(boundedContext(before, scope))) === proposal.context.digest,
        'stale_context',
        'Relevant context changed. Request a new proposal.',
        409,
      );
      const result = applyCommands(before, proposal.commands, { actor: 'agent' });
      assertBounded(result.changes, before, result.state, scope);
      assert(
        canonical(result.changes) === canonical(proposal.changes),
        'proposal_changed',
        'The expanded changes differ from the reviewed proposal.',
        409,
      );
      await persistChanges(result.changes, tx);
      const id = await audit(tx, result.changes, proposal.summary, 'agent');
      const output = { id, proposalId: proposal.id, changes: result.changes };
      await tx`update host.proposals set status='applied',result=${tx.json(output as never)} where id=${proposal.id}`;
      return output;
    }),
  );
}
export async function rejectProposal(body: unknown) {
  const { id } = z.object({ id: z.uuid() }).parse(body);
  await transaction(async (tx) => {
    await tx`update host.proposals set status='rejected' where id=${id} and status='pending'`;
  });
  return { ok: true };
}
export { undoChange };
