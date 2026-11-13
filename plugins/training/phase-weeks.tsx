'use client';

import type { Period, EditedWeek } from '@athlete-panel/contracts';
import {
  Badge,
  Button,
  Checkbox,
  dateLabel,
  ErrorMessage,
  Field,
  Input,
  Modal,
  requestId,
  SubmitButton,
  useAction,
  useWorkspace,
} from '@athlete-panel/ui';
import { Edit3, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { addDays } from './dates';
import { mutate } from './editors';
import {
  editedWeeksWith,
  findEditedWeek,
  targetRangeLabel,
  weekTargets,
  type TargetRange,
} from './phase-targets';
import { targetFields, type TargetField } from './phases';
import { storedFromUnitField, unitFieldText } from './unit-field';

const targetRangeLabelInUnit = (target: TargetRange, { unit, factor }: TargetField) =>
  `${targetRangeLabel(target, (value) => String(Number((value / factor).toFixed(1))))} ${unit}`;

export function readEditedWeek(
  form: FormData,
  fields: TargetField[],
  current: Record<string, TargetRange | null>,
) {
  const editedWeek: EditedWeek = {};
  for (const field of fields) {
    if (form.get(`${field.name}.min`) === null) continue;
    const bound = (name: 'min' | 'max') =>
      storedFromUnitField(
        form.get(`${field.name}.${name}`),
        current[field.name]?.[name],
        field.factor,
      )!;
    editedWeek[field.name] = { min: bound('min'), max: bound('max') };
  }
  return Object.keys(editedWeek).length ? editedWeek : null;
}

function WeekTargetField({
  field,
  target,
  edited,
}: {
  field: TargetField;
  target: TargetRange | null;
  edited: boolean;
}) {
  const [enabled, setEnabled] = useState(edited);
  return (
    <fieldset className="phase-target">
      <legend>
        {field.label} · {field.unit}
      </legend>
      <label className="checkbox-row">
        <Checkbox checked={enabled} onCheckedChange={(value) => setEnabled(value === true)} />
        Set this week by hand
      </label>
      {enabled && (
        <div className="form-grid">
          {(['min', 'max'] as const).map((bound) => (
            <Field key={bound} label={bound === 'min' ? 'At least' : 'At most'}>
              <Input
                required
                name={`${field.name}.${bound}`}
                type="number"
                min="0"
                step="any"
                defaultValue={unitFieldText(target?.[bound], field.factor)}
              />
            </Field>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function WeekTargetEditor({
  phase,
  weekStart,
  title,
  onClose,
}: {
  phase: Period;
  weekStart: string;
  title: string;
  onClose: () => void;
}) {
  const { data, request } = useWorkspace();
  const action = useAction();
  const [key] = useState(requestId);
  const fields = targetFields(data.profile?.units ?? 'metric');
  const current = weekTargets([phase], weekStart)!;
  const edited = findEditedWeek(phase, weekStart);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description="A target set by hand replaces the calculated one for this week only. Workouts stay as they are."
    >
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          const editedWeek = readEditedWeek(new FormData(event.currentTarget), fields, current);
          const editedWeeks = editedWeeksWith(phase, weekStart, editedWeek);
          void action.run(
            () =>
              mutate(
                request,
                [
                  {
                    action: 'period.update',
                    id: phase.id,
                    expectedRevision: phase.revision,
                    values: { editedWeeks },
                  },
                ],
                key,
              ),
            onClose,
          );
        }}
      >
        {fields.map((field) => (
          <WeekTargetField
            key={field.name}
            field={field}
            target={current[field.name]}
            edited={edited?.[field.name] !== undefined}
          />
        ))}
        <ErrorMessage error={action.error} />
        <div className="dialog-actions">
          <Button variant="outline" type="button" className="button" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton busy={action.busy}>Save week</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

export function WeekTarget({ phase, weekStart }: { phase: Period; weekStart: string }) {
  const { data, request } = useWorkspace();
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const fields = targetFields(data.profile?.units ?? 'metric');
  const targets = weekTargets([phase], weekStart)!;
  const edited = findEditedWeek(phase, weekStart);
  const title = `Week of ${dateLabel(weekStart)} in ${phase.name}`;
  const targetLabel = fields
    .map((field) => targets[field.name] && targetRangeLabelInUnit(targets[field.name]!, field))
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="week-target">
      <span>{targetLabel ? `Target ${targetLabel}` : 'No target'}</span>
      {edited && <Badge variant="secondary">Edited</Badge>}
      <Button
        variant="ghost"
        aria-label={`Edit target for the week of ${dateLabel(weekStart)}`}
        onClick={() => setEditing(true)}
      >
        <Edit3 size={14} />
        <span>Edit target</span>
      </Button>
      {edited && (
        <Button
          variant="ghost"
          disabled={action.busy}
          aria-label={`Reset target for the week of ${dateLabel(weekStart)} to calculated`}
          onClick={() =>
            void action.run(() =>
              mutate(request, [
                {
                  action: 'period.update',
                  id: phase.id,
                  expectedRevision: phase.revision,
                  values: { editedWeeks: editedWeeksWith(phase, weekStart, null) },
                },
              ]),
            )
          }
        >
          <RotateCcw size={14} />
          <span>Reset to calculated</span>
        </Button>
      )}
      <ErrorMessage error={action.error} />
      {editing && (
        <WeekTargetEditor
          phase={phase}
          weekStart={weekStart}
          title={title}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

export function CalendarWeekTarget({ phase, weekStart }: { phase: Period; weekStart: string }) {
  return (
    <section
      className="calendar-week-target"
      aria-label={`Calendar week of ${dateLabel(weekStart)}`}
    >
      <h4>Calendar week</h4>
      <span>
        {dateLabel(weekStart)} –{' '}
        {dateLabel(addDays(weekStart, 6), { day: 'numeric', month: 'short', year: 'numeric' })}
      </span>
      <WeekTarget phase={phase} weekStart={weekStart} />
    </section>
  );
}
