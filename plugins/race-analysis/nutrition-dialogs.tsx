'use client';

import { Plus } from 'lucide-react';
import { Button, Field, Input, Modal, Textarea, useAction } from '@athlete-panel/ui';
import {
  raceNutritionMaximums,
  type NutritionProduct,
  type RacePlan,
} from '@athlete-panel/contracts';
import { nutrients } from './nutrition';
import { DialogActions } from './race-day-dialogs';
import { ProductField, RemovableRow, useEditorRows, type EditorRow } from './editor-rows';
import { nutritionScheduleFromForm, nutritionTargetsFromForm } from './race-plan-form';

type Targets = RacePlan['nutrition']['targets'];
type RaceNutrition = RacePlan['nutrition'];

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

function ScheduleRow({
  index,
  row,
  products,
  readOnly,
  onRemove,
}: {
  index: number;
  row: EditorRow<RaceNutrition['schedule'][number]>;
  products: readonly NutritionProduct[];
  readOnly: boolean;
  onRemove: () => void;
}) {
  const { item } = row;
  return (
    <RemovableRow
      legend={`Product ${index + 1}`}
      className="race-nutrition-product-row"
      readOnly={readOnly}
      onRemove={onRemove}
    >
      <ProductField
        name="productId"
        productId={item?.productId}
        products={products}
        readOnly={readOnly}
        autoFocus={row.justAdded}
      />
      <Field label="Servings">
        <Input
          type="number"
          name="servings"
          required
          min={0.01}
          max={raceNutritionMaximums.servings}
          step="any"
          defaultValue={item?.servings ?? 1}
          readOnly={readOnly}
        />
      </Field>
      <Field label="Every (minutes)">
        <Input
          type="number"
          name="everyMinutes"
          required
          min={1}
          max={raceNutritionMaximums.everyMinutes}
          step={1}
          defaultValue={item?.everyMinutes ?? 30}
          readOnly={readOnly}
        />
      </Field>
    </RemovableRow>
  );
}

function CueRow({
  index,
  row,
  readOnly,
  onRemove,
}: {
  index: number;
  row: EditorRow<RaceNutrition['cues'][number]>;
  readOnly: boolean;
  onRemove: () => void;
}) {
  return (
    <RemovableRow
      legend={`Cue ${index + 1}`}
      className="race-nutrition-cue-row"
      readOnly={readOnly}
      onRemove={onRemove}
    >
      <Field label="When">
        <Input
          name="cueWhen"
          required
          pattern=".*\S.*"
          maxLength={raceNutritionMaximums.cueWhen}
          defaultValue={row.item?.when ?? ''}
          readOnly={readOnly}
          autoFocus={row.justAdded}
        />
      </Field>
      <Field label="What to do">
        <Input
          name="cueText"
          required
          pattern=".*\S.*"
          maxLength={raceNutritionMaximums.cueText}
          defaultValue={row.item?.text ?? ''}
          readOnly={readOnly}
        />
      </Field>
    </RemovableRow>
  );
}

export function SchedulePlanDialog({
  nutrition,
  products,
  onSave,
  onClose,
}: {
  nutrition: RaceNutrition;
  products: readonly NutritionProduct[];
  onSave: (plan: Pick<RaceNutrition, 'schedule' | 'cues'>) => Promise<unknown>;
  onClose: () => void;
}) {
  const action = useAction();
  const scheduleRows = useEditorRows(nutrition.schedule);
  const cueRows = useEditorRows(nutrition.cues);
  return (
    <Modal
      open
      onClose={() => !action.busy && onClose()}
      title="During the race"
      description="Products come from your profile. Cues are reminders in your own words."
      className="race-dialog"
    >
      <form
        className="dialog-body race-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void action.run(() => onSave(nutritionScheduleFromForm(form)), onClose);
        }}
      >
        {scheduleRows.rows.map((row, index) => (
          <ScheduleRow
            key={row.key}
            index={index}
            row={row}
            products={products}
            readOnly={action.busy}
            onRemove={() => scheduleRows.remove(row.key)}
          />
        ))}
        {products.length > 0 ? (
          <Button
            ref={scheduleRows.addButton}
            type="button"
            variant="outline"
            disabled={action.busy || scheduleRows.rows.length >= raceNutritionMaximums.scheduleRows}
            onClick={scheduleRows.add}
          >
            <Plus size={15} />
            Add product
          </Button>
        ) : (
          <p className="race-hint">Add products in Settings, then Nutrition, to plan them here.</p>
        )}
        {cueRows.rows.map((row, index) => (
          <CueRow
            key={row.key}
            index={index}
            row={row}
            readOnly={action.busy}
            onRemove={() => cueRows.remove(row.key)}
          />
        ))}
        <Button
          ref={cueRows.addButton}
          type="button"
          variant="outline"
          disabled={action.busy || cueRows.rows.length >= raceNutritionMaximums.cues}
          onClick={cueRows.add}
        >
          <Plus size={15} />
          Add cue
        </Button>
        <DialogActions action={action} onClose={onClose} />
      </form>
    </Modal>
  );
}
