import { planSchema, workoutSchema, type CommandInput } from '../../packages/contracts/src';
import { addDays } from '../../plugins/training/dates';
import type { Transaction } from '../../packages/host/src/db';

export const annualRange = { from: '2026-11-01', to: '2027-11-01' };
export const annualId = (n: number) =>
  `92000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** A populated year: 500 moves/edits, 500 deletions and 500 new sessions in one proposal. */
export function annualReviewFixture(from = annualRange.from) {
  const plan = planSchema.parse({
    id: annualId(1),
    revision: 1,
    title: 'Synthetic annual plan',
    startDate: from,
  });
  const workouts = Array.from({ length: 1000 }, (_, i) =>
    workoutSchema.parse({
      id: annualId(1000 + i),
      revision: 1,
      title: `Synthetic existing ${i}`,
      sport: i % 2 ? 'cycling' : 'running',
      durationSeconds: 3600,
      schedule: { kind: 'plan', planId: plan.id, day: (i % 365) + 1 },
      order: Math.floor(i / 365) + 1,
      steps: Array.from({ length: 4 }, () => ({
        kind: 'work',
        durationSeconds: 300,
        distanceMeters: null,
        target: null,
        notes: '',
      })),
    }),
  );
  const commands: CommandInput[] = [
    ...workouts.slice(0, 500).map((workout, i) => ({
      action: 'workout.update' as const,
      id: workout.id,
      expectedRevision: 1,
      values: {
        title: `Synthetic revised ${i}`,
        durationSeconds: 2700,
        schedule: { kind: 'plan' as const, planId: plan.id, day: ((i + 7) % 365) + 1 },
      },
    })),
    ...workouts.slice(500).map((workout) => ({
      action: 'workout.delete' as const,
      id: workout.id,
      expectedRevision: 1,
    })),
    ...Array.from({ length: 500 }, (_, i) => ({
      action: 'workout.create' as const,
      values: {
        id: annualId(3000 + i),
        title: `Synthetic new ${i}`,
        sport: 'running' as const,
        durationSeconds: 1800,
        schedule: { kind: 'independent' as const, date: addDays(from, i % 365) },
      },
    })),
  ];
  return { plan, workouts, commands };
}

export async function seedAnnualReview(tx: Transaction, from = annualRange.from) {
  const fixture = annualReviewFixture(from);
  const rows = [
    { kind: 'plan', id: fixture.plan.id, revision: 1, data: fixture.plan },
    ...fixture.workouts.map((data) => ({ kind: 'workout', id: data.id, revision: 1, data })),
  ];
  for (let i = 0; i < rows.length; i += 200)
    await tx`insert into training.records ${tx(rows.slice(i, i + 200), 'kind', 'id', 'revision', 'data')}`;
  return fixture;
}
