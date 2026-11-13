'use client';

import { periodRoles, type Period, type WeeklyTarget } from '@athlete-panel/contracts';
import {
  Button,
  Checkbox,
  dateLabel,
  ErrorMessage,
  Field,
  Input,
  Modal,
  NativeSelect,
  requestId,
  SubmitButton,
  useAction,
  useConfirm,
  useWorkspace,
} from '@athlete-panel/ui';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { mutate } from './editors';
import { editedWeeksInside } from './phase-targets';
import { storedFromUnitField, unitFieldText } from './unit-field';

type TargetFieldName =
  'weeklyDurationSeconds' | 'weeklyDistanceMeters' | 'weeklyElevationGainMeters';
export type TargetField = { name: TargetFieldName; label: string; unit: string; factor: number };

export function targetFields(units: string): TargetField[] {
  const imperial = units === 'imperial';
  return [
    { name: 'weeklyDurationSeconds', label: 'Weekly hours', unit: 'h', factor: 3600 },
    {
      name: 'weeklyDistanceMeters',
      label: 'Weekly distance',
      unit: imperial ? 'mi' : 'km',
      factor: imperial ? 1609.344 : 1000,
    },
    {
      name: 'weeklyElevationGainMeters',
      label: 'Weekly climbing',
      unit: imperial ? 'ft' : 'm',
      factor: imperial ? 0.3048 : 1,
    },
  ];
}

const toDisplayValue = (value: number, factor: number) => Number((value / factor).toFixed(1));

function formatTarget(target: WeeklyTarget, { unit, factor }: TargetField) {
  const range = ({ min, max }: WeeklyTarget['firstWeek']) =>
    min === max
      ? `${toDisplayValue(min, factor)}`
      : `${toDisplayValue(min, factor)}–${toDisplayValue(max, factor)}`;
  const first = range(target.firstWeek);
  const last = range(target.lastWeek);
  return first === last ? `${first} ${unit} a week` : `${first} → ${last} ${unit} a week`;
}

const roleLabel = (role: Period['role']) => role[0]!.toUpperCase() + role.slice(1);

export function readTargetFromForm(
  form: FormData,
  { name, factor }: TargetField,
  period: Partial<Pick<Period, TargetFieldName>> | undefined,
): WeeklyTarget | null {
  if (form.get(`${name}.firstWeek.min`) === null) return null;
  const value = (week: 'firstWeek' | 'lastWeek', bound: 'min' | 'max') =>
    storedFromUnitField(
      form.get(`${name}.${week}.${bound}`),
      period?.[name]?.[week][bound],
      factor,
    )!;
  return {
    firstWeek: { min: value('firstWeek', 'min'), max: value('firstWeek', 'max') },
    lastWeek: { min: value('lastWeek', 'min'), max: value('lastWeek', 'max') },
  };
}

function readPhaseFromForm(form: FormData, fields: TargetField[], phase: Period | undefined) {
  return {
    name: String(form.get('name')),
    role: String(form.get('role')) as Period['role'],
    startDate: String(form.get('startDate')),
    endDate: String(form.get('endDate')),
    focus: String(form.get('focus')),
    weeklyDurationSeconds: readTargetFromForm(form, fields[0]!, phase),
    weeklyDistanceMeters: readTargetFromForm(form, fields[1]!, phase),
    weeklyElevationGainMeters: readTargetFromForm(form, fields[2]!, phase),
  };
}

function TargetFields({ target, field }: { target: WeeklyTarget | null; field: TargetField }) {
  const [enabled, setEnabled] = useState(target !== null);
  const input = (week: 'firstWeek' | 'lastWeek', bound: 'min' | 'max', label: string) => (
    <Field label={label}>
      <Input
        required
        name={`${field.name}.${week}.${bound}`}
        type="number"
        min="0"
        step="any"
        defaultValue={unitFieldText(target?.[week][bound], field.factor)}
      />
    </Field>
  );
  return (
    <fieldset className="phase-target">
      <legend>
        {field.label} · {field.unit}
      </legend>
      <label className="checkbox-row">
        <Checkbox checked={enabled} onCheckedChange={(value) => setEnabled(value === true)} />
        Set a {field.label.toLowerCase()} target
      </label>
      {enabled && (
        <>
          <div className="form-grid">
            {input('firstWeek', 'min', 'First week, at least')}
            {input('firstWeek', 'max', 'First week, at most')}
          </div>
          <div className="form-grid">
            {input('lastWeek', 'min', 'Last week, at least')}
            {input('lastWeek', 'max', 'Last week, at most')}
          </div>
        </>
      )}
    </fieldset>
  );
}

function DroppedEditedWeeksNotice({
  phase,
  startDate,
  endDate,
}: {
  phase: Period;
  startDate: string;
  endDate: string;
}) {
  if (!startDate || !endDate) return null;
  const kept = editedWeeksInside(phase, startDate, endDate);
  const dropped = Object.keys(phase.editedWeeks).filter((weekStart) => !(weekStart in kept));
  if (!dropped.length) return null;
  return (
    <p role="status" className="phase-dropped-weeks">
      Saving drops the edited {dropped.length === 1 ? 'week' : 'weeks'} of{' '}
      {dropped.map((weekStart) => dateLabel(weekStart)).join(', ')}, now outside the phase.
    </p>
  );
}

function PhaseDateFields({
  phase,
  defaultStartDate,
}: {
  phase?: Period;
  defaultStartDate?: string;
}) {
  const [dates, setDates] = useState({
    startDate: phase?.startDate ?? defaultStartDate ?? '',
    endDate: phase?.endDate ?? '',
  });
  return (
    <>
      <div className="form-grid phase-dates">
        <Field label="First day">
          <Input
            required
            name="startDate"
            type="date"
            defaultValue={phase?.startDate ?? defaultStartDate}
            onChange={(event) => setDates({ ...dates, startDate: event.target.value })}
          />
        </Field>
        <Field label="Last day">
          <Input
            required
            name="endDate"
            type="date"
            defaultValue={phase?.endDate ?? ''}
            onChange={(event) => setDates({ ...dates, endDate: event.target.value })}
          />
        </Field>
      </div>
      {phase && <DroppedEditedWeeksNotice phase={phase} {...dates} />}
    </>
  );
}

function PhaseEditor({
  phase,
  defaultStartDate,
  onClose,
}: {
  phase?: Period;
  defaultStartDate?: string;
  onClose: () => void;
}) {
  const { data, request } = useWorkspace();
  const action = useAction();
  const [key] = useState(requestId);
  const fields = targetFields(data.profile?.units ?? 'metric');
  return (
    <Modal
      open
      onClose={onClose}
      title={phase ? 'Edit phase' : 'Add a phase'}
      description="Targets are optional. They move in a straight line from the first week to the last, except weeks set by hand."
    >
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          const values = readPhaseFromForm(new FormData(event.currentTarget), fields, phase);
          void action.run(
            () =>
              mutate(
                request,
                [
                  phase
                    ? {
                        action: 'period.update',
                        id: phase.id,
                        expectedRevision: phase.revision,
                        values,
                      }
                    : { action: 'period.create', values },
                ],
                key,
              ),
            onClose,
          );
        }}
      >
        <Field label="Name">
          <Input
            autoFocus
            required
            name="name"
            maxLength={255}
            defaultValue={phase?.name ?? ''}
            placeholder="e.g. Base before the spring races"
          />
        </Field>
        <Field label="Role">
          <NativeSelect name="role" defaultValue={phase?.role ?? 'base'}>
            {periodRoles.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Focus" hint="Optional">
          <Input
            name="focus"
            maxLength={120}
            defaultValue={phase?.focus ?? ''}
            placeholder="e.g. VO2max, threshold on flat"
          />
        </Field>
        <PhaseDateFields phase={phase} defaultStartDate={defaultStartDate} />
        {fields.map((field) => (
          <TargetFields key={field.name} field={field} target={phase?.[field.name] ?? null} />
        ))}
        <ErrorMessage error={action.error} />
        <div className="dialog-actions">
          <Button variant="outline" type="button" className="button" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton busy={action.busy}>{phase ? 'Save phase' : 'Add phase'}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

export function AddPhaseButton({ defaultStartDate }: { defaultStartDate: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Button variant="outline" className="phase-add" onClick={() => setAdding(true)}>
        <Plus size={16} />
        Add phase
      </Button>
      {adding && (
        <PhaseEditor defaultStartDate={defaultStartDate} onClose={() => setAdding(false)} />
      )}
    </>
  );
}

export function PhaseBlock({ phase, children }: { phase: Period; children?: ReactNode }) {
  const { data, request } = useWorkspace();
  const confirm = useConfirm();
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const fields = targetFields(data.profile?.units ?? 'metric');
  return (
    <div className="plans-phase" role="group" aria-label={`${phase.name} phase`}>
      <div className="plans-phase-heading">
        <h4>{phase.name}</h4>
        <span>{roleLabel(phase.role)}</span>
        <span>
          {dateLabel(phase.startDate)} –{' '}
          {dateLabel(phase.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        <span className="phase-actions">
          <Button
            variant="ghost"
            aria-label={`Edit ${phase.name}`}
            onClick={() => setEditing(true)}
          >
            <Edit3 size={14} />
            <span>Edit</span>
          </Button>
          <Button
            variant="ghost"
            aria-label={`Delete ${phase.name}`}
            disabled={action.busy}
            onClick={async () => {
              if (
                await confirm(
                  `Delete the “${phase.name}” phase? Workouts stay as they are.`,
                  'Delete',
                )
              )
                void action.run(() =>
                  mutate(request, [
                    { action: 'period.delete', id: phase.id, expectedRevision: phase.revision },
                  ]),
                );
            }}
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </Button>
        </span>
      </div>
      {phase.focus && <p className="plans-phase-focus">{phase.focus}</p>}
      <span className="plans-meta">
        {fields.map((field) => {
          const target = phase[field.name];
          return target && <span key={field.name}>Target {formatTarget(target, field)}</span>;
        })}
      </span>
      <ErrorMessage error={action.error} />
      {editing && <PhaseEditor phase={phase} onClose={() => setEditing(false)} />}
      {children}
    </div>
  );
}
