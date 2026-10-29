'use client';

import type { WorkoutStep } from '@athlete-panel/contracts';
import { distance } from '@athlete-panel/ui';

type Interval = Exclude<WorkoutStep, { kind: 'repeat' }>;
const phaseLabels = {
  warmup: 'Warm up',
  work: 'Work',
  recovery: 'Recovery',
  cooldown: 'Cool down',
};
function timeLabel(seconds: number) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return (
    [minutes ? `${minutes} min` : '', remainder ? `${remainder} sec` : '']
      .filter(Boolean)
      .join(' ') || '<1 sec'
  );
}
function paceLabel(seconds: number) {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
function targetLabel(target: NonNullable<Interval['target']>, units: 'metric' | 'imperial') {
  const range = (format: (value: number) => string) =>
    target.min === target.max ? format(target.min) : `${format(target.min)}–${format(target.max)}`;
  if (target.kind === 'paceSecondsPerKilometer') {
    return `${range((value) => paceLabel(value * (units === 'imperial' ? 1.609344 : 1)))} / ${units === 'imperial' ? 'mi' : 'km'}`;
  }
  const value = range((value) => String(value));
  return target.kind === 'powerWatts'
    ? `${value} W`
    : target.kind === 'heartRateBpm'
      ? `${value} bpm`
      : `RPE ${value} / 10`;
}
/** A short prescription cue; the inspector remains the complete source of detail. */
export function prescriptionPreview(steps: WorkoutStep[], units: 'metric' | 'imperial') {
  const repeat = steps.find((step) => step.kind === 'repeat');
  const repeatedWork = repeat?.steps.find((step) => step.kind === 'work');
  const work = repeatedWork ?? steps.find((step) => step.kind === 'work');
  if (!work || work.kind === 'repeat')
    return steps.length ? `${steps.length} session ${steps.length === 1 ? 'step' : 'steps'}` : '';
  const length =
    work.durationSeconds !== null
      ? timeLabel(work.durationSeconds)
      : distance(work.distanceMeters, units);
  return `${repeat && repeatedWork ? `${repeat.times} × ` : ''}${length}${work.target ? ` · ${targetLabel(work.target, units)}` : ''}`;
}

function IntervalDetails({ step, units }: { step: Interval; units: 'metric' | 'imperial' }) {
  return (
    <li className="prescription-step">
      <div className="prescription-line">
        <span>{phaseLabels[step.kind]}</span>
        <strong>
          {step.durationSeconds !== null
            ? timeLabel(step.durationSeconds)
            : distance(step.distanceMeters, units)}
        </strong>
      </div>
      {step.target && <p className="prescription-target">{targetLabel(step.target, units)}</p>}
      {step.notes && <p className="prescription-note">{step.notes}</p>}
    </li>
  );
}

export function WorkoutPrescription({
  steps,
  units,
}: {
  steps: WorkoutStep[];
  units: 'metric' | 'imperial';
}) {
  return (
    <section className="inspector-section prescription" aria-label="Workout prescription">
      <h3>Session steps</h3>
      <ol className="prescription-list">
        {steps.map((step, index) =>
          step.kind === 'repeat' ? (
            <li key={index} className="prescription-repeat">
              <strong className="prescription-repeat-label">Repeat {step.times} times</strong>
              <ol>
                {step.steps.map((child, childIndex) => (
                  <IntervalDetails key={childIndex} step={child} units={units} />
                ))}
              </ol>
            </li>
          ) : (
            <IntervalDetails key={index} step={step} units={units} />
          ),
        )}
      </ol>
    </section>
  );
}
