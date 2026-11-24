'use client';

import { useState } from 'react';
import {
  Button,
  Field,
  Input,
  Modal,
  NativeSelect,
  Textarea,
  dateLabel,
  distance,
  duration,
  numeric,
  useAction,
  useConfirm,
} from '@athlete-panel/ui';
import {
  rehearsalSchema,
  type NutritionProduct,
  type RacePlan,
  type Rehearsal,
  type Workout,
} from '@athlete-panel/contracts';
import { toleranceLabels } from '../athlete/public/client';
import { DialogActions } from './race-day-dialogs';
import {
  changedRehearsalValues,
  plannedItems,
  takenTotalsText,
  takenTotals,
  type PlannedItem,
  type RehearsalValues,
} from './rehearsal';

export const sessionOptionLabel = (workout: Workout, units?: string) =>
  [
    workout.completion &&
      dateLabel(workout.completion.performedDate, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
    workout.title,
    workout.completion?.durationSeconds != null && duration(workout.completion.durationSeconds),
    workout.completion?.distanceMeters != null &&
      distance(workout.completion.distanceMeters, units),
  ]
    .filter(Boolean)
    .join(' · ');

export function RehearsalDialog({
  raceTitle,
  rehearsal,
  sessions,
  schedule,
  products,
  units,
  onSave,
  onDelete,
  onClose,
}: {
  raceTitle: string;
  rehearsal: Rehearsal | undefined;
  sessions: readonly Workout[];
  schedule: RacePlan['nutrition']['schedule'];
  products: readonly NutritionProduct[];
  units: string | undefined;
  onSave: (workoutId: string, values: Partial<RehearsalValues>) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onClose: () => void;
}) {
  const action = useAction();
  const confirm = useConfirm();
  const [workoutId, setWorkoutId] = useState(rehearsal?.workoutId ?? sessions[0]?.id ?? '');
  const durationSeconds =
    sessions.find((session) => session.id === workoutId)?.completion?.durationSeconds ?? null;
  const [opened] = useState(rehearsal);
  const planned: PlannedItem[] = opened
    ? opened.items.map(({ takenServings: _taken, ...item }) => item)
    : plannedItems(schedule, products, durationSeconds);
  const [typedAmounts, setTypedAmounts] = useState(() =>
    rehearsal
      ? [
          ...rehearsal.items.map((item) => String(item.takenServings)),
          String(rehearsal.extraFluidMillilitres),
        ]
      : [...planned.map(() => ''), ''],
  );
  const takenAmounts = typedAmounts.map((text) => numeric(text));
  const plainWaterMillilitres = takenAmounts.at(-1)!;
  const items = planned.map((item, index) => ({ ...item, takenServings: takenAmounts[index]! }));
  const totals = takenAmounts.includes(null)
    ? null
    : takenTotals(items, plainWaterMillilitres, durationSeconds);
  const amountFields = [
    ...planned.map((item) => ({
      name: item.productName,
      planned: item.plannedServings ?? 'unknown',
      unit: 'servings',
      label: `${item.productName} servings taken`,
      max: 100,
      step: 0.5,
    })),
    {
      name: 'Plain water',
      planned: 'Not planned',
      unit: 'ml',
      label: 'Plain water taken in millilitres',
      max: 20000,
      step: 1,
    },
  ];
  return (
    <Modal
      open
      onClose={() => !action.busy && onClose()}
      title={rehearsal ? 'Edit fueling rehearsal' : 'Log a fueling rehearsal'}
      description={`For ${raceTitle}. Your recorded activity stays as imported.`}
      className="race-dialog"
    >
      <form
        className="dialog-body race-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const written: RehearsalValues = {
            items,
            extraFluidMillilitres: plainWaterMillilitres,
            stomach: form.get('stomach') as Rehearsal['stomach'],
            conditions: String(form.get('conditions')),
            lesson: String(form.get('lesson')),
          };
          void action.run(async () => {
            const changed = opened ? changedRehearsalValues(opened, rehearsal!, written) : written;
            if (Object.keys(changed).length > 0) await onSave(workoutId, changed);
          }, onClose);
        }}
      >
        <Field label="Completed session">
          <NativeSelect
            value={workoutId}
            disabled={Boolean(rehearsal) || action.busy}
            onChange={(event) => setWorkoutId(event.target.value)}
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {sessionOptionLabel(session, units)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <table className="race-stations race-rehearsal-taken">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Planned</th>
              <th scope="col">Taken</th>
            </tr>
          </thead>
          <tbody>
            {amountFields.map((row, index) => (
              <tr key={`${row.name}-${index}`}>
                <th scope="row">{row.name}</th>
                <td data-label="Planned">{row.planned}</td>
                <td data-label="Taken">
                  <span className="race-rehearsal-amount">
                    <Input
                      type="number"
                      required
                      min={0}
                      max={row.max}
                      step={row.step}
                      inputMode="decimal"
                      aria-label={row.label}
                      value={typedAmounts[index]}
                      readOnly={action.busy}
                      onChange={(event) =>
                        setTypedAmounts(
                          typedAmounts.map((text, kept) =>
                            kept === index ? event.target.value : text,
                          ),
                        )
                      }
                    />
                    {row.unit}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="race-hint">
          {totals ? `Taken: ${takenTotalsText(totals)}.` : 'Enter what you took, 0 if none.'}
          {totals &&
            totals.productsWithoutCarbohydrate.length > 0 &&
            ` Left out for an unknown carbohydrate value: ${totals.productsWithoutCarbohydrate.join(', ')}.`}
        </p>
        <Field label="Stomach">
          <NativeSelect
            name="stomach"
            defaultValue={rehearsal?.stomach ?? 'comfortable'}
            disabled={action.busy}
          >
            {rehearsalSchema.shape.stomach.options.map((level) => (
              <option key={level} value={level}>
                {toleranceLabels[level]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Conditions">
          <Input
            name="conditions"
            maxLength={120}
            defaultValue={rehearsal?.conditions ?? ''}
            readOnly={action.busy}
          />
        </Field>
        <Field label="What would you keep or change?">
          <Textarea
            name="lesson"
            rows={4}
            maxLength={4000}
            defaultValue={rehearsal?.lesson ?? ''}
            readOnly={action.busy}
          />
        </Field>
        <p className="race-hint">
          Saved with this race. Assistants do not read fueling rehearsals yet.
        </p>
        <DialogActions action={action} onClose={onClose}>
          {rehearsal && (
            <Button
              type="button"
              variant="ghost"
              className="race-dialog-delete"
              disabled={action.busy}
              onClick={async () => {
                if (
                  await confirm(
                    'Delete this fueling rehearsal? The session stays as it is.',
                    'Delete rehearsal',
                  )
                )
                  void action.run(onDelete, onClose);
              }}
            >
              Delete rehearsal
            </Button>
          )}
        </DialogActions>
      </form>
    </Modal>
  );
}
