'use client';

import type { Workout } from '@athlete-panel/contracts';
import { Button, Field, Input, Textarea } from '@athlete-panel/ui';
import { ArrowUp, Trash2 } from 'lucide-react';

type Exercise = NonNullable<Workout['exercises']>[number];
export function ExerciseEditor({
  exercises,
  onChange,
  imperial,
}: {
  exercises: Exercise[];
  onChange: (value: Exercise[]) => void;
  imperial: boolean;
}) {
  const change = (index: number, patch: Partial<Exercise>) =>
    onChange(exercises.map((exercise, i) => (i === index ? { ...exercise, ...patch } : exercise)));
  const numeric = (value: string) => (value === '' ? null : Number(value));
  return (
    <section aria-label="Strength exercises">
      <div className="section-heading">
        <h3>Exercises</h3>
        <Button
          variant="link"
          type="button"
          disabled={exercises.length >= 100}
          onClick={() => onChange([...exercises, { name: '', repetitions: '' }])}
        >
          Add exercise
        </Button>
      </div>
      {exercises.map((exercise, index) => (
        <fieldset key={index} className="exercise-editor">
          <legend>Exercise {index + 1}</legend>
          <Field label="Exercise name">
            <Input
              required
              maxLength={255}
              value={exercise.name}
              onChange={(event) => change(index, { name: event.target.value })}
            />
          </Field>
          <div className="form-grid three">
            <Field label="Sets">
              <Input
                type="number"
                min="1"
                step="1"
                value={exercise.sets ?? ''}
                onChange={(event) => change(index, { sets: numeric(event.target.value) })}
              />
            </Field>
            <Field label="Repetitions or hold">
              <Input
                maxLength={255}
                placeholder="8–10, AMRAP, 30 sec"
                value={exercise.repetitions ?? ''}
                onChange={(event) => change(index, { repetitions: event.target.value })}
              />
            </Field>
            <Field label={`Weight · ${imperial ? 'lb' : 'kg'}`}>
              <Input
                type="number"
                min="0"
                step="any"
                value={
                  exercise.weightKg == null
                    ? ''
                    : Number((exercise.weightKg * (imperial ? 2.2046226218 : 1)).toFixed(4))
                }
                onChange={(event) =>
                  change(index, {
                    weightKg:
                      event.target.value === ''
                        ? null
                        : Number(event.target.value) / (imperial ? 2.2046226218 : 1),
                  })
                }
              />
            </Field>
            <Field label="Load description">
              <Input
                maxLength={1000}
                placeholder="Bodyweight, band, per hand…"
                value={exercise.loadDescription ?? ''}
                onChange={(event) => change(index, { loadDescription: event.target.value })}
              />
            </Field>
            <Field label="Rest · seconds">
              <Input
                type="number"
                min="0"
                step="any"
                value={exercise.restSeconds ?? ''}
                onChange={(event) => change(index, { restSeconds: numeric(event.target.value) })}
              />
            </Field>
          </div>
          <Field label="Instructions">
            <Textarea
              rows={2}
              maxLength={4000}
              value={exercise.instructions ?? ''}
              onChange={(event) => change(index, { instructions: event.target.value })}
            />
          </Field>
          <div className="filter-row">
            <Button
              variant="ghost"
              type="button"
              disabled={index === 0}
              aria-label={`Move exercise ${index + 1} earlier`}
              onClick={() => {
                const next = [...exercises];
                [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                onChange(next);
              }}
            >
              <ArrowUp size={16} /> Move earlier
            </Button>
            <Button
              variant="ghost"
              type="button"
              aria-label={`Remove exercise ${index + 1}`}
              onClick={() => onChange(exercises.filter((_, i) => i !== index))}
            >
              <Trash2 size={16} /> Remove
            </Button>
          </div>
        </fieldset>
      ))}
    </section>
  );
}

export function ExercisePrescription({
  exercises,
  imperial,
}: {
  exercises: Exercise[];
  imperial: boolean;
}) {
  if (!exercises.length) return null;
  return (
    <section className="inspector-section prescription" aria-label="Strength prescription">
      <h3>Exercises</h3>
      <ol className="prescription-list">
        {exercises.map((exercise, index) => (
          <li key={index} className="prescription-step">
            <strong>{exercise.name}</strong>
            <p>
              {[
                exercise.sets == null ? null : `${exercise.sets} sets`,
                exercise.repetitions,
                exercise.weightKg == null
                  ? null
                  : `${Number((exercise.weightKg * (imperial ? 2.2046226218 : 1)).toFixed(2))} ${imperial ? 'lb' : 'kg'}`,
                exercise.loadDescription,
                exercise.restSeconds == null ? null : `${exercise.restSeconds} sec rest`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {exercise.instructions && <p className="prescription-note">{exercise.instructions}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
