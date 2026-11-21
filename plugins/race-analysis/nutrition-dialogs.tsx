'use client';

import { Field, Input, Modal, Textarea, useAction } from '@athlete-panel/ui';
import { raceNutritionMaximums, type RacePlan } from '@athlete-panel/contracts';
import { nutrients } from './nutrition';
import { DialogActions } from './race-day-dialogs';
import { nutritionTargetsFromForm } from './race-plan-form';

type Targets = RacePlan['nutrition']['targets'];

export function TargetsDialog({
  targets,
  onSave,
  onClose,
}: {
  targets: Targets;
  onSave: (targets: Targets) => Promise<unknown>;
  onClose: () => void;
}) {
  const action = useAction();
  return (
    <Modal
      open
      onClose={() => !action.busy && onClose()}
      title="Targets per hour"
      description="Leave a target empty while you do not know it."
      className="race-dialog"
    >
      <form
        className="dialog-body race-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void action.run(() => onSave(nutritionTargetsFromForm(form)), onClose);
        }}
      >
        {nutrients.map(({ target, label, unit }) => (
          <Field key={target} label={`${label} · ${unit} per hour`}>
            <Input
              type="number"
              name={target}
              min={0}
              max={raceNutritionMaximums[target]}
              step="any"
              placeholder="Unknown"
              defaultValue={targets[target] ?? ''}
              readOnly={action.busy}
            />
          </Field>
        ))}
        <DialogActions action={action} onClose={onClose} />
      </form>
    </Modal>
  );
}

export function PhaseTextDialog({
  title,
  text,
  onSave,
  onClose,
}: {
  title: string;
  text: string;
  onSave: (text: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const action = useAction();
  return (
    <Modal open onClose={() => !action.busy && onClose()} title={title} className="race-dialog">
      <form
        className="dialog-body race-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void action.run(() => onSave(String(form.get('text'))), onClose);
        }}
      >
        <Field label="What you plan">
          <Textarea
            name="text"
            rows={8}
            maxLength={4000}
            defaultValue={text}
            readOnly={action.busy}
          />
        </Field>
        <DialogActions action={action} onClose={onClose} />
      </form>
    </Modal>
  );
}
