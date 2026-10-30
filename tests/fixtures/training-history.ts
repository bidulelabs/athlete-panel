import type { AuditEntry } from '@athlete-panel/contracts';
import { calendarId as id } from './calendar';
import { plansFixture } from './plans';

export function trainingHistoryFixture(): AuditEntry[] {
  const data = plansFixture();
  const plan = data.plans[0]!;
  const workout = data.workouts[0]!;
  const copy = { ...plan, id: id(600), title: `${plan.title} copy`, startDate: null };
  return [
    {
      id: id(700),
      createdAt: '2030-10-29T10:35:00Z',
      summary: 'workout.update',
      undoneAt: null,
      changes: [
        {
          entity: 'workout',
          id: workout.id,
          before: workout,
          after: {
            ...workout,
            revision: 2,
            durationSeconds: 3600,
            notes: 'Keep this conversational.\n\n**Extend** the ride only if recovery feels good.',
          },
        },
        { entity: 'plan', id: plan.id, before: plan, after: { ...plan, revision: 2 } },
      ],
    },
    {
      id: id(701),
      createdAt: '2030-10-29T09:15:00Z',
      summary: 'plan.duplicate',
      undoneAt: null,
      changes: [
        { entity: 'plan', id: copy.id, before: null, after: copy },
        {
          entity: 'workout',
          id: id(601),
          before: null,
          after: { ...workout, id: id(601), schedule: { kind: 'plan', planId: copy.id, day: 1 } },
        },
      ],
    },
    {
      id: id(702),
      createdAt: '2030-10-28T16:40:00Z',
      summary: 'plan.delete',
      undoneAt: '2030-10-29T09:00:00Z',
      changes: [{ entity: 'plan', id: data.plans[1]!.id, before: data.plans[1]!, after: null }],
    },
    {
      id: id(703),
      createdAt: '2030-10-27T08:00:00Z',
      summary: 'workout.create',
      undoneAt: null,
      undoable: false,
      changes: [{ entity: 'workout', id: workout.id, before: null, after: workout }],
    },
  ];
}
