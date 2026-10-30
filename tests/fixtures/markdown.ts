import { eventSchema, injurySchema, noteSchema } from '@athlete-panel/contracts';
import { calendarId as id } from './calendar';
import { plansFixture } from './plans';

export const markdownSource = [
  '# Session focus',
  '',
  '**Steady** and *comfortable*. ~~Sprint~~',
  'Keep this line break.',
  '',
  '- Warm up',
  '- Cool down',
  '',
  '1. Prepare',
  '2. Recover',
  '',
  '- [x] Bottle ready',
  '- [ ] Check route',
  '',
  '> Leave room to recover.',
  '',
  '[Guide](https://example.com/guide)',
  '',
  '| Day | Session | Notes | Fuel | Recovery |',
  '| --- | --- | --- | --- | --- |',
  '| Monday | Easy | Stay relaxed | Water | Sleep |',
  '',
  '`cadence`',
  '',
  '```text',
  'steady '.repeat(40),
  '```',
  '',
  'Reference[^1]',
  '',
  '[^1]: Keep the effort conversational.',
  '',
  '![Route map](https://example.com/tracker.png)',
  '',
  '<img src="https://example.com/raw-tracker.png" onerror="alert(1)">',
  '',
  '[Unsafe](javascript:alert%281%29)',
].join('\n');

export function markdownFixture() {
  const data = plansFixture();
  data.profile!.goals = '**Plain profile goal**';
  data.plans[0]!.description = markdownSource;
  data.workouts[0]!.notes = markdownSource;
  data.workouts[0]!.completion = {
    status: 'completed',
    source: 'manual',
    activityId: null,
    performedDate: '2030-10-21',
    durationSeconds: 2700,
    distanceMeters: null,
    rpe: null,
    reason: '**Plain completion reason**',
    notes: markdownSource,
  };
  data.workouts[1]!.steps[0] = {
    kind: 'warmup',
    durationSeconds: 900,
    distanceMeters: null,
    target: null,
    notes: '**Plain interval note**',
  };
  data.workouts[2]!.exercises![0]!.instructions = '**Plain exercise instruction**';
  data.notes = [
    noteSchema.parse({
      id: id(600),
      revision: 1,
      title: 'Markdown note',
      body: markdownSource,
      schedule: { kind: 'independent', date: '2030-10-21' },
    }),
  ];
  data.events = [
    eventSchema.parse({
      id: id(601),
      revision: 1,
      title: 'Markdown event',
      date: '2030-10-21',
      notes: markdownSource,
    }),
  ];
  data.injuries = [
    injurySchema.parse({
      id: id(602),
      revision: 1,
      bodyPart: 'Markdown injury',
      startDate: '2030-10-21',
      endDate: '2030-10-21',
      description: markdownSource,
      notes: markdownSource,
    }),
  ];
  return data;
}
