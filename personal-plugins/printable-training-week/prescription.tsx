import type { Workout, WorkoutStep } from '@athlete-panel/contracts';
import { MarkdownContent } from '@athlete-panel/ui';
import {
  printLength,
  printTarget,
  printTime,
  printWeight,
  type Interval,
  type Units,
} from './format';

const phase = { warmup: 'Warm up', work: 'Work', recovery: 'Recovery', cooldown: 'Cool down' };

function Step({ step, units, notes }: { step: Interval; units: Units; notes: boolean }) {
  return (
    <li className="printable-week-step">
      <span>
        <strong>{phase[step.kind]}</strong> · {printLength(step, units)}
        {step.target && <> · {printTarget(step.target, units)}</>}
      </span>
      {notes && step.notes && <p className="printable-week-note">{step.notes}</p>}
    </li>
  );
}

export function PrintedSteps({
  steps,
  units,
  notes,
}: {
  steps: WorkoutStep[];
  units: Units;
  notes: boolean;
}) {
  if (!steps.length) return null;
  return (
    <section className="printable-week-prescription" aria-label="Session steps">
      <h4>Session steps</h4>
      <ol>
        {steps.map((step, index) =>
          step.kind === 'repeat' ? (
            <li key={index} className="printable-week-repeat">
              <strong>Repeat {step.times} times</strong>
              <ol>
                {step.steps.map((child, childIndex) => (
                  <Step key={childIndex} step={child} units={units} notes={notes} />
                ))}
              </ol>
            </li>
          ) : (
            <Step key={index} step={step} units={units} notes={notes} />
          ),
        )}
      </ol>
    </section>
  );
}

export function PrintedExercises({
  exercises,
  units,
  notes,
}: {
  exercises: NonNullable<Workout['exercises']>;
  units: Units;
  notes: boolean;
}) {
  if (!exercises.length) return null;
  return (
    <section className="printable-week-prescription" aria-label="Strength exercises">
      <h4>Strength exercises</h4>
      <ol>
        {exercises.map((exercise, index) => (
          <li key={index} className="printable-week-step">
            <strong>{exercise.name}</strong>
            <p>
              {[
                exercise.sets == null ? null : `${exercise.sets} sets`,
                exercise.repetitions,
                exercise.weightKg == null ? null : printWeight(exercise.weightKg, units),
                exercise.loadDescription,
                exercise.restSeconds == null ? null : `${printTime(exercise.restSeconds)} rest`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {notes && exercise.instructions && <MarkdownContent source={exercise.instructions} />}
          </li>
        ))}
      </ol>
    </section>
  );
}
