import { persistAndAudit } from './commit';
import { onboardingActionSchema, type Onboarding } from '../packages/contracts/src/onboarding';
import { transaction } from '../packages/host/src/db';
import { assert } from '../packages/host/src/errors';
import { readOnboarding, writeOnboarding } from '../packages/host/src/onboarding';
import { idempotent } from '../plugins/training/service';
import { applyCommands } from '../plugins/training/engine';
import { loadWorkspace } from './services';

/** Product coordination: preferences and progress share one domain transaction. */
export async function updateOnboarding(body: unknown) {
  const input = onboardingActionSchema.parse(body);
  return transaction((tx) =>
    idempotent(tx, input.idempotencyKey, { operation: 'onboarding', ...input }, async () => {
      const current = await readOnboarding(tx);
      assert(
        current.revision === input.expectedRevision,
        'onboarding_conflict',
        'Setup changed elsewhere. Refresh to see your saved progress.',
        409,
      );
      assert(
        current.status !== 'completed',
        'onboarding_complete',
        'Setup is already complete.',
        409,
      );
      const next: Onboarding = {
        ...current,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      if (input.action === 'resume') next.status = 'active';
      else if (input.action === 'defer') next.status = 'deferred';
      else {
        assert(
          ['pending', 'active'].includes(current.status),
          'onboarding_inactive',
          'Resume setup before continuing.',
          409,
        );
        next.status = 'active';
        if (input.action === 'preferences') {
          assert(
            current.step === 1,
            'onboarding_step',
            'Return to preferences before saving.',
            409,
          );
          const state = await loadWorkspace(tx, undefined, { records: 'linked' });
          assert(
            (state.profile?.revision ?? null) === input.expectedProfileRevision,
            'STALE_REVISION',
            'Your settings changed elsewhere. Review the latest values before saving.',
            409,
          );
          const { id: _id, revision: _revision, ...values } = state.profile ?? {};
          const result = applyCommands(
            state,
            [
              {
                action: 'profile.set',
                expectedRevision: input.expectedProfileRevision,
                values: { ...values, ...input.values },
              },
            ],
            { actor: 'owner' },
          );
          await persistAndAudit(tx, result.changes, 'Update workspace preferences');
          next.step = 2;
        } else if (input.action === 'back') {
          assert(current.step > 1, 'onboarding_step', 'You are already at the first step.', 409);
          next.step = current.step === 3 ? 2 : 1;
        } else if (input.action === 'continue') {
          assert(current.step === 2, 'onboarding_step', 'Save your preferences first.', 409);
          next.step = 3;
        } else if (input.action === 'complete') {
          assert(current.step === 3, 'onboarding_step', 'Review your setup before finishing.', 409);
          next.status = 'completed';
          next.completedAt = next.updatedAt;
        }
      }
      return writeOnboarding(tx, next);
    }),
  );
}
