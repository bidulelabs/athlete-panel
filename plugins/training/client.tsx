'use client';

import { ToggleGroup, ToggleGroupItem } from '@athlete-panel/ui';
import { useConfirm } from '@athlete-panel/ui';
import { NativeSelect, Input, Button, Textarea, Badge } from '@athlete-panel/ui';
import { useState, type FormEvent } from 'react';
import type { Plan, Workout, WorkoutStep, Schedule, CommandInput } from '@athlete-panel/contracts';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  Edit3,
  Layers,
  Link2,
  Plus,
  Repeat2,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  AddButton,
  dateLabel,
  distance,
  duration,
  EmptyState,
  ErrorMessage,
  ExtensionSlot,
  Field,
  localDate,
  Modal,
  PageHeader,
  requestId,
  SportIcon,
  sportLabel,
  SubmitButton,
  useAction,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { effectiveDate } from './dates';
import { InspectorPanel } from './inspector-panel';
import { WorkoutPrescription } from './prescription';

export async function mutate(
  request: PluginPageProps['request'],
  commands: CommandInput[],
  idempotencyKey = requestId(),
) {
  return request('training', 'mutate', { commands, idempotencyKey });
}

const blankStep = (): WorkoutStep => ({
  kind: 'work',
  durationSeconds: 300,
  distanceMeters: null,
  target: null,
  notes: '',
});
function IntervalRow({
  step,
  onChange,
  onRemove,
}: {
  step: any;
  onChange: (step: any) => void;
  onRemove: () => void;
}) {
  const distanceBased = step.distanceMeters !== null;
  return (
    <div className="interval-editor-row">
      <Field label="Phase">
        <NativeSelect
          value={step.kind}
          onChange={(event) => onChange({ ...step, kind: event.target.value })}
        >
          <option value="warmup">Warm up</option>
          <option value="work">Work</option>
          <option value="recovery">Recovery</option>
          <option value="cooldown">Cool down</option>
        </NativeSelect>
      </Field>
      <Field label={distanceBased ? 'Distance · meters' : 'Duration · minutes'}>
        <Input
          required
          type="number"
          min="0.01"
          step="any"
          value={(distanceBased ? step.distanceMeters : step.durationSeconds / 60) ?? ''}
          onChange={(event) =>
            onChange({
              ...step,
              ...(distanceBased
                ? { distanceMeters: Number(event.target.value) }
                : { durationSeconds: Number(event.target.value) * 60 }),
            })
          }
        />
      </Field>
      <Field label="Measure">
        <NativeSelect
          value={distanceBased ? 'distance' : 'time'}
          onChange={(event) =>
            onChange({
              ...step,
              durationSeconds: event.target.value === 'time' ? 300 : null,
              distanceMeters: event.target.value === 'distance' ? 1000 : null,
            })
          }
        >
          <option value="time">Time</option>
          <option value="distance">Distance</option>
        </NativeSelect>
      </Field>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="icon-button"
        aria-label="Remove interval"
        onClick={onRemove}
      >
        <X size={15} />
      </Button>
      <div className="interval-target">
        <Field label="Effort target">
          <NativeSelect
            value={step.target?.kind ?? ''}
            onChange={(event) =>
              onChange({
                ...step,
                target: event.target.value
                  ? {
                      kind: event.target.value,
                      min: event.target.value === 'rpe' ? 3 : 100,
                      max: event.target.value === 'rpe' ? 5 : 150,
                    }
                  : null,
              })
            }
          >
            <option value="">No target</option>
            <option value="heartRateBpm">Heart rate · bpm</option>
            <option value="powerWatts">Power · watts</option>
            <option value="paceSecondsPerKilometer">Pace · sec/km</option>
            <option value="rpe">RPE · 1–10</option>
          </NativeSelect>
        </Field>
        {step.target && (
          <>
            <Field label="Minimum">
              <Input
                required
                type="number"
                step="any"
                min="1"
                value={step.target.min}
                onChange={(event) =>
                  onChange({ ...step, target: { ...step.target, min: Number(event.target.value) } })
                }
              />
            </Field>
            <Field label="Maximum">
              <Input
                required
                type="number"
                step="any"
                min="1"
                value={step.target.max}
                onChange={(event) =>
                  onChange({ ...step, target: { ...step.target, max: Number(event.target.value) } })
                }
              />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}

function IntervalEditor({
  steps,
  setSteps,
}: {
  steps: WorkoutStep[];
  setSteps: (steps: WorkoutStep[]) => void;
}) {
  const replace = (index: number, value: WorkoutStep) =>
    setSteps(steps.map((s, i) => (i === index ? value : s)));
  return (
    <div className="interval-editor">
      {steps.map((step, index) =>
        step.kind === 'repeat' ? (
          <div className="repeat-group" key={index}>
            <div className="repeat-head">
              <span>
                <Repeat2 size={13} style={{ display: 'inline' }} /> Repeat{' '}
                <Input
                  aria-label="Repeat count"
                  type="number"
                  min="2"
                  max="100"
                  value={step.times}
                  onChange={(event) =>
                    replace(index, { ...step, times: Number(event.target.value) })
                  }
                />
                times
              </span>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                className="icon-button"
                aria-label="Remove repeat group"
                onClick={() => setSteps(steps.filter((_, i) => i !== index))}
              >
                <X size={15} />
              </Button>
            </div>
            {step.steps.map((child, childIndex) => (
              <IntervalRow
                key={childIndex}
                step={child}
                onChange={(next) =>
                  replace(index, {
                    ...step,
                    steps: step.steps.map((s, i) => (i === childIndex ? next : s)),
                  })
                }
                onRemove={() =>
                  replace(index, { ...step, steps: step.steps.filter((_, i) => i !== childIndex) })
                }
              />
            ))}
            <Button
              variant="link"
              type="button"
              className="text-button"
              onClick={() =>
                replace(index, { ...step, steps: [...step.steps, blankStep() as any] })
              }
            >
              <Plus size={13} />
              Add repeated step
            </Button>
          </div>
        ) : (
          <IntervalRow
            key={index}
            step={step}
            onChange={(next) => replace(index, next)}
            onRemove={() => setSteps(steps.filter((_, i) => i !== index))}
          />
        ),
      )}
      <div className="form-inline">
        <Button
          variant="outline"
          size="sm"
          type="button"
          className="button small"
          onClick={() => setSteps([...steps, blankStep()])}
        >
          <Plus size={14} />
          Add interval
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          className="button small"
          onClick={() =>
            setSteps([
              ...steps,
              {
                kind: 'repeat',
                times: 4,
                steps: [
                  blankStep() as any,
                  {
                    kind: 'recovery',
                    durationSeconds: 120,
                    distanceMeters: null,
                    target: null,
                    notes: '',
                  },
                ],
              },
            ])
          }
        >
          <Repeat2 size={14} />
          Add repeats
        </Button>
      </div>
    </div>
  );
}

export function ScheduleFields({
  schedule,
  onChange,
  plans,
}: {
  schedule: Schedule;
  onChange: (schedule: Schedule) => void;
  plans: Plan[];
}) {
  return (
    <>
      <ToggleGroup
        type="single"
        className="segmented"
        value={schedule.kind}
        aria-label="Schedule type"
        onValueChange={(value) => {
          if (value === 'independent' && schedule.kind !== value)
            onChange({ kind: 'independent', date: localDate() });
          if (value === 'plan' && schedule.kind !== value)
            onChange({ kind: 'plan', planId: plans[0]?.id ?? '', day: 1 });
        }}
      >
        <ToggleGroupItem value="independent">Calendar date</ToggleGroupItem>
        <ToggleGroupItem value="plan" disabled={!plans.length}>
          Day in a plan
        </ToggleGroupItem>
      </ToggleGroup>
      {schedule.kind === 'independent' ? (
        <Field label="Scheduled date">
          <Input
            required
            type="date"
            value={schedule.date}
            onChange={(event) => onChange({ ...schedule, date: event.target.value })}
          />
        </Field>
      ) : (
        <div className="form-grid">
          <Field label="Training plan">
            <NativeSelect
              value={schedule.planId}
              onChange={(event) => onChange({ ...schedule, planId: event.target.value })}
            >
              {plans.map((plan) => (
                <option value={plan.id} key={plan.id}>
                  {plan.title}
                  {!plan.startDate ? ' · undated' : ''}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Day in plan" hint="Day 1 is the plan's start date.">
            <Input
              required
              min="1"
              max="3660"
              type="number"
              value={schedule.day}
              onChange={(event) => onChange({ ...schedule, day: Number(event.target.value) })}
            />
          </Field>
        </div>
      )}
    </>
  );
}

export function WorkoutEditor({
  workout: initialWorkout,
  defaultDate,
  defaultPlan,
  onClose,
}: {
  workout?: Workout;
  defaultDate?: string;
  defaultPlan?: Plan;
  onClose: () => void;
}) {
  const { data, request } = useWorkspace();
  const [workout] = useState(initialWorkout);
  const [schedule, setSchedule] = useState<Schedule>(
    workout?.schedule ??
      (defaultPlan
        ? { kind: 'plan', planId: defaultPlan.id, day: 1 }
        : { kind: 'independent', date: defaultDate ?? localDate() }),
  );
  const [steps, setSteps] = useState<WorkoutStep[]>(workout?.steps ?? []);
  const [showStructure, setShowStructure] = useState(Boolean(workout?.steps.length));
  const [key] = useState(requestId);
  const [createId] = useState(requestId);
  const action = useAction();
  const [factor] = useState(data.profile?.units === 'imperial' ? 1609.344 : 1000);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const payload = {
      title: String(values.get('title')),
      sport: String(values.get('sport')) as 'cycling' | 'running',
      schedule,
      durationSeconds: values.get('duration') === '' ? null : Number(values.get('duration')) * 60,
      distanceMeters:
        values.get('distance') === '' ? null : Number(values.get('distance')) * factor,
      steps,
      notes: String(values.get('notes') ?? ''),
      order:
        workout?.order ??
        data.workouts.filter(
          (w) =>
            effectiveDate(w, data.plans) ===
            (schedule.kind === 'independent' ? schedule.date : null),
        ).length + 1,
    };
    await action.run(
      () =>
        mutate(
          request,
          [
            workout
              ? {
                  action: 'workout.update',
                  id: workout.id,
                  expectedRevision: workout.revision,
                  values: payload,
                }
              : { action: 'workout.create', values: { ...payload, id: createId } },
          ],
          key,
        ),
      onClose,
    );
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={workout ? 'Edit workout' : 'Add workout'}
      description="Build a session that fits your week."
      wide
    >
      <form className="dialog-body" onSubmit={submit}>
        <Field label="Workout title">
          <Input
            required
            autoFocus
            name="title"
            maxLength={255}
            defaultValue={workout?.title ?? ''}
            placeholder="e.g. Endurance ride"
          />
        </Field>
        <div className="form-grid three">
          <Field label="Sport">
            <NativeSelect name="sport" defaultValue={workout?.sport ?? 'cycling'}>
              <option value="cycling">Cycling</option>
              <option value="running">Running</option>
            </NativeSelect>
          </Field>
          <Field label="Duration · minutes">
            <Input
              name="duration"
              type="number"
              min="0"
              step="any"
              defaultValue={workout?.durationSeconds != null ? workout.durationSeconds / 60 : ''}
              placeholder="Optional"
            />
          </Field>
          <Field label={`Distance · ${factor === 1000 ? 'km' : 'mi'}`}>
            <Input
              name="distance"
              type="number"
              min="0"
              step="any"
              defaultValue={
                workout?.distanceMeters != null
                  ? Number((workout.distanceMeters / factor).toFixed(3))
                  : ''
              }
              placeholder="Optional"
            />
          </Field>
        </div>
        <ScheduleFields schedule={schedule} onChange={setSchedule} plans={data.plans} />
        <div className="form-divider" />
        <div className="section-heading" style={{ border: 0, paddingBottom: 10 }}>
          <h3>Session structure</h3>
          <Button
            variant="link"
            className="text-button"
            type="button"
            onClick={() => setShowStructure(!showStructure)}
          >
            {showStructure ? 'Collapse' : 'Add intervals'}
          </Button>
        </div>
        {showStructure && <IntervalEditor steps={steps} setSteps={setSteps} />}
        <Field label="Workout notes">
          <Textarea
            name="notes"
            rows={3}
            maxLength={4000}
            defaultValue={workout?.notes ?? ''}
            placeholder="Effort, route, or anything to remember…"
          />
        </Field>
        <ErrorMessage error={action.error} />
        <div className="dialog-actions">
          <Button variant="outline" type="button" className="button" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton busy={action.busy}>{workout ? 'Save workout' : 'Add workout'}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

export function CompletionEditor({ workout, onClose }: { workout: Workout; onClose: () => void }) {
  const { data, request } = useWorkspace();
  const [status, setStatus] = useState<'completed' | 'partial' | 'skipped'>(
    workout.completion?.status ?? 'completed',
  );
  const linked = workout.completion?.source === 'garmin';
  const action = useAction();
  const [key] = useState(requestId);
  const [factor] = useState(data.profile?.units === 'imperial' ? 1609.344 : 1000);
  return (
    <Modal open onClose={onClose} title="Log completion" description={workout.title}>
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          void action.run(
            () =>
              mutate(
                request,
                [
                  {
                    action: 'workout.complete',
                    id: workout.id,
                    expectedRevision: workout.revision,
                    values: {
                      status,
                      performedDate: linked
                        ? workout.completion!.performedDate
                        : String(fields.get('date')),
                      durationSeconds: linked
                        ? workout.completion!.durationSeconds
                        : status === 'skipped' || fields.get('duration') === ''
                          ? null
                          : Number(fields.get('duration')) * 60,
                      distanceMeters: linked
                        ? workout.completion!.distanceMeters
                        : status === 'skipped' || fields.get('distance') === ''
                          ? null
                          : Number(fields.get('distance')) * factor,
                      rpe:
                        status === 'skipped' || fields.get('rpe') === ''
                          ? null
                          : Number(fields.get('rpe')),
                      reason: String(fields.get('reason')),
                    },
                  },
                ],
                key,
              ),
            onClose,
          );
        }}
      >
        <ToggleGroup
          type="single"
          className="segmented"
          value={status}
          aria-label="Completion status"
          onValueChange={(value) => {
            if (value === 'completed' || value === 'partial' || value === 'skipped')
              setStatus(value);
          }}
        >
          {(['completed', 'partial', 'skipped'] as const)
            .filter((value) => !linked || value !== 'skipped')
            .map((value) => (
              <ToggleGroupItem key={value} value={value}>
                {sportLabel(value)}
              </ToggleGroupItem>
            ))}
        </ToggleGroup>
        <Field label="Performed date">
          <Input
            required
            readOnly={linked}
            type="date"
            name="date"
            defaultValue={
              workout.completion?.performedDate ?? effectiveDate(workout, data.plans) ?? localDate()
            }
          />
        </Field>
        {status !== 'skipped' && (
          <>
            <div className="form-grid">
              <Field label="Actual duration · minutes">
                <Input
                  readOnly={linked}
                  name="duration"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Unknown"
                  defaultValue={
                    workout.completion?.durationSeconds != null
                      ? workout.completion.durationSeconds / 60
                      : ''
                  }
                />
              </Field>
              <Field label={`Actual distance · ${factor === 1000 ? 'km' : 'mi'}`}>
                <Input
                  readOnly={linked}
                  name="distance"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Unknown"
                  defaultValue={
                    workout.completion?.distanceMeters != null
                      ? Number((workout.completion.distanceMeters / factor).toFixed(3))
                      : ''
                  }
                />
              </Field>
            </div>
            {linked && (
              <p className="form-footnote">
                Date, duration, and distance come from your Garmin activity. You can annotate effort
                and partial completion here.
              </p>
            )}
            <Field label="Perceived effort · RPE 1–10">
              <Input
                name="rpe"
                type="number"
                min="1"
                max="10"
                step="1"
                placeholder="Optional"
                defaultValue={workout.completion?.rpe ?? ''}
              />
            </Field>
          </>
        )}
        <Field label={status === 'partial' ? 'Reason for partial completion' : 'Completion notes'}>
          <Textarea
            name="reason"
            required={status === 'partial'}
            defaultValue={workout.completion?.reason ?? ''}
            rows={3}
            maxLength={2000}
            placeholder={
              status === 'partial' ? 'What changed during this session?' : 'How did it go?'
            }
          />
        </Field>
        <ErrorMessage error={action.error} />
        <div className="dialog-actions">
          <Button variant="outline" type="button" className="button" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton busy={action.busy}>Save completion</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

export function WorkoutInspector({
  workout,
  onClose,
  onActivityDetails,
}: {
  workout: Workout;
  onClose: () => void;
  onActivityDetails?: (id: string) => void;
}) {
  const confirm = useConfirm();
  const { data, request } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [linking, setLinking] = useState(false);
  const action = useAction();
  const date = effectiveDate(workout, data.plans);
  const completion = workout.completion;
  async function reorder(direction: -1 | 1) {
    if (!date) return;
    const siblings = data.workouts
      .filter((w) => effectiveDate(w, data.plans) === date)
      .sort((a, b) => a.order - b.order);
    const index = siblings.findIndex((w) => w.id === workout.id);
    const swap = index + direction;
    if (swap < 0 || swap >= siblings.length) return;
    [siblings[index], siblings[swap]] = [siblings[swap]!, siblings[index]!];
    await mutate(request, [
      {
        action: 'workout.reorder',
        date,
        workouts: siblings.map((w) => ({ id: w.id, expectedRevision: w.revision })),
      },
    ]);
  }
  return (
    <>
      <InspectorPanel onClose={onClose} deferResize={editing || completing || linking}>
        <div className="inspector-head">
          <span>
            {date
              ? dateLabel(date, { weekday: 'short', day: 'numeric', month: 'short' })
              : 'Undated plan'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="icon-button"
            onClick={onClose}
            aria-label="Close workout details"
          >
            <X size={18} />
          </Button>
        </div>
        <div className="inspector-sport">
          <SportIcon sport={workout.sport} size={29} />
        </div>
        <h2>{workout.title}</h2>
        <div className="inspector-subtitle">
          {duration(workout.durationSeconds)} · {sportLabel(workout.sport)}
          {workout.distanceMeters != null
            ? ` · ${distance(workout.distanceMeters, data.profile?.units)}`
            : ''}
        </div>
        <div className="inspector-log-action">
          <Button
            variant="default"
            className="button primary full-width"
            onClick={() => setCompleting(true)}
          >
            {completion ? 'Edit completion' : 'Log workout'}
          </Button>
        </div>
        {workout.steps.length > 0 && (
          <WorkoutPrescription steps={workout.steps} units={data.profile?.units ?? 'metric'} />
        )}
        {workout.notes && (
          <div className="inspector-section">
            <h3>Notes</h3>
            <p>{workout.notes}</p>
          </div>
        )}
        <div className="inspector-section">
          <h3>Completion</h3>
          {completion ? (
            <>
              <div className="completion-state">
                <CheckCircle2 size={16} />
                {completion.status}
                {completion.source === 'garmin' && <Badge className="badge">Garmin</Badge>}
              </div>
              <dl className="inspector-details">
                <div>
                  <dt>Duration</dt>
                  <dd>{duration(completion.durationSeconds)}</dd>
                </div>
                <div>
                  <dt>Distance</dt>
                  <dd>{distance(completion.distanceMeters, data.profile?.units)}</dd>
                </div>
                <div>
                  <dt>Effort</dt>
                  <dd>{completion.rpe == null ? '—' : `${completion.rpe} / 10`}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{dateLabel(completion.performedDate)}</dd>
                </div>
              </dl>
              {completion.reason && <p style={{ marginTop: 13 }}>{completion.reason}</p>}
              {completion.activityId && onActivityDetails && (
                <Button
                  variant="link"
                  className="text-button"
                  style={{ marginTop: 12 }}
                  onClick={() => onActivityDetails(completion.activityId!)}
                >
                  View imported activity
                </Button>
              )}
            </>
          ) : (
            <p>This session has not been logged yet.</p>
          )}
          {completion && (
            <Button
              variant="link"
              className="text-button"
              style={{ marginTop: 8 }}
              disabled={action.busy}
              onClick={() =>
                action.run(() =>
                  mutate(request, [
                    {
                      action:
                        completion.source === 'garmin'
                          ? 'workout.unlink'
                          : 'workout.clearCompletion',
                      id: workout.id,
                      expectedRevision: workout.revision,
                    },
                  ]),
                )
              }
            >
              {completion.source === 'garmin' ? 'Unlink Garmin activity' : 'Clear completion'}
            </Button>
          )}
        </div>
        <div className="inspector-actions">
          <Button variant="outline" className="button" onClick={() => setEditing(true)}>
            <Edit3 size={14} />
            Edit
          </Button>
          <Button
            variant="outline"
            className="button"
            disabled={action.busy}
            onClick={() =>
              action.run(() =>
                mutate(request, [
                  {
                    action: 'workout.duplicate',
                    id: workout.id,
                    expectedRevision: workout.revision,
                    values: { title: `${workout.title} (copy)`, schedule: workout.schedule },
                  },
                ]),
              )
            }
          >
            <Copy size={14} />
            Duplicate
          </Button>
        </div>
        <div className="inspector-actions">
          <Button
            variant="outline"
            size="sm"
            className="button small"
            onClick={() => setLinking(true)}
            disabled={completion?.source === 'garmin'}
          >
            <Link2 size={13} />
            Link activity
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="icon-button"
            onClick={() => action.run(() => reorder(-1))}
            aria-label="Move earlier in day"
            disabled={action.busy || !date}
          >
            <ArrowUp size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="icon-button"
            onClick={() => action.run(() => reorder(1))}
            aria-label="Move later in day"
            disabled={action.busy || !date}
          >
            <ArrowDown size={15} />
          </Button>
        </div>
        <div className="danger-zone">
          <Button
            variant="link"
            className="text-button"
            style={{ color: 'var(--danger)' }}
            disabled={action.busy}
            onClick={async () => {
              if (await confirm(`Delete “${workout.title}”?`))
                void action.run(
                  () =>
                    mutate(request, [
                      {
                        action: 'workout.delete',
                        id: workout.id,
                        expectedRevision: workout.revision,
                      },
                    ]),
                  onClose,
                );
            }}
          >
            <Trash2 size={13} />
            Delete workout
          </Button>
        </div>
        <ErrorMessage error={action.error} />
        <ExtensionSlot kind="inspector" selection={{ kind: 'workout', id: workout.id }} />
      </InspectorPanel>
      {editing && <WorkoutEditor workout={workout} onClose={() => setEditing(false)} />}
      {completing && <CompletionEditor workout={workout} onClose={() => setCompleting(false)} />}
      {linking && <LinkActivityDialog workout={workout} onClose={() => setLinking(false)} />}
    </>
  );
}

export function LinkActivityDialog({
  workout,
  onClose,
}: {
  workout: Workout;
  onClose: () => void;
}) {
  const { data, request } = useWorkspace();
  const action = useAction();
  const linked = new Set(data.workouts.map((w) => w.completion?.activityId).filter(Boolean));
  const available = data.activities.filter((a) => !linked.has(a.id));
  const [selected, setSelected] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Link an activity"
      description={`Choose the imported activity for ${workout.title}.`}
    >
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(
            () =>
              mutate(request, [
                {
                  action: 'workout.link',
                  id: workout.id,
                  expectedRevision: workout.revision,
                  activityId: selected,
                },
              ]),
            onClose,
          );
        }}
      >
        {available.length ? (
          <>
            <Field label="Garmin activity">
              <NativeSelect
                required
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">Choose an activity</option>
                {available.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {dateLabel(activity.localDate)} · {activity.title} ·{' '}
                    {duration(activity.durationSeconds)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <p className="form-footnote">
              The imported activity becomes this workout’s actual result. It is counted once in
              weekly totals.
            </p>
          </>
        ) : (
          <EmptyState title="No unlinked activities">
            Import activities from Garmin before linking a session.
          </EmptyState>
        )}
        <ErrorMessage error={action.error} />
        <div className="dialog-actions">
          <Button variant="outline" type="button" className="button" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton busy={action.busy || !selected}>Link activity</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function PlanEditor({ plan, onClose }: { plan?: Plan; onClose: () => void }) {
  const { request } = useWorkspace();
  const action = useAction();
  const [key] = useState(requestId);
  return (
    <Modal
      open
      onClose={onClose}
      title={plan ? 'Edit training plan' : 'Create a training plan'}
      description="Give your sessions a starting point. You can schedule the plan later."
    >
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const values = {
            title: String(form.get('title')),
            startDate: form.get('startDate') ? String(form.get('startDate')) : null,
            description: String(form.get('description')),
          };
          void action.run(
            () =>
              mutate(
                request,
                [
                  plan
                    ? {
                        action: 'plan.update',
                        id: plan.id,
                        expectedRevision: plan.revision,
                        values,
                      }
                    : { action: 'plan.create', values },
                ],
                key,
              ),
            onClose,
          );
        }}
      >
        <Field label="Plan title">
          <Input
            autoFocus
            required
            name="title"
            maxLength={255}
            defaultValue={plan?.title ?? ''}
            placeholder="e.g. Autumn endurance block"
          />
        </Field>
        <Field label="Start date" hint="Leave blank to build an unscheduled plan.">
          <Input name="startDate" type="date" defaultValue={plan?.startDate ?? ''} />
        </Field>
        <Field label="Description">
          <Textarea
            name="description"
            maxLength={4000}
            rows={3}
            defaultValue={plan?.description ?? ''}
            placeholder="Goals, focus, and training approach…"
          />
        </Field>
        <ErrorMessage error={action.error} />
        <div className="dialog-actions">
          <Button variant="outline" type="button" className="button" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton busy={action.busy}>{plan ? 'Save plan' : 'Create plan'}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

export default function TrainingPage({ data, request }: PluginPageProps) {
  const confirm = useConfirm();
  const { envelope } = useWorkspace();
  const historyAction = useAction();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [adding, setAdding] = useState<Plan | null>(null);
  const [workoutEdit, setWorkoutEdit] = useState<Workout | null>(null);
  const action = useAction();
  return (
    <>
      <PageHeader
        eyebrow="STRUCTURE YOUR TRAINING"
        title="Training plans"
        description="Build a block, schedule it, and adjust as you go."
        actions={<AddButton onClick={() => setEditing('new')}>Create plan</AddButton>}
      />
      <ErrorMessage error={action.error} />
      {!data.plans.length ? (
        <EmptyState
          icon={<Layers size={26} />}
          title="Start with a training block"
          action={
            <Button variant="default" className="button primary" onClick={() => setEditing('new')}>
              <Plus size={16} />
              Create your first plan
            </Button>
          }
        >
          Organize workouts into a plan. Set its start date whenever you’re ready.
        </EmptyState>
      ) : (
        data.plans.map((plan) => {
          const workouts = data.workouts
            .filter((w) => w.schedule.kind === 'plan' && w.schedule.planId === plan.id)
            .sort(
              (a, b) =>
                (a.schedule.kind === 'plan' ? a.schedule.day : 0) -
                  (b.schedule.kind === 'plan' ? b.schedule.day : 0) || a.order - b.order,
            );
          return (
            <section key={plan.id}>
              <div className="plan-row">
                <div className="plan-icon">
                  <Layers size={21} />
                </div>
                <div className="plan-row-copy">
                  <h3>{plan.title}</h3>
                  {plan.description && <p>{plan.description}</p>}
                  <div className="plan-row-meta">
                    <span>
                      {plan.startDate
                        ? `Starts ${dateLabel(plan.startDate, { day: 'numeric', month: 'long', year: 'numeric' })}`
                        : 'Unscheduled'}
                    </span>
                    <span>{workouts.length} workouts</span>
                    <span>
                      {duration(workouts.reduce((total, w) => total + (w.durationSeconds ?? 0), 0))}{' '}
                      planned
                    </span>
                  </div>
                </div>
                <div className="row-action-group">
                  <Button
                    variant="outline"
                    size="sm"
                    className="button small"
                    onClick={() => setAdding(plan)}
                  >
                    <Plus size={14} />
                    Workout
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="icon-button"
                    aria-label={`Edit ${plan.title}`}
                    onClick={() => setEditing(plan)}
                  >
                    <Edit3 size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="icon-button"
                    aria-label={`Duplicate ${plan.title}`}
                    disabled={action.busy}
                    onClick={() =>
                      action.run(() =>
                        mutate(request, [
                          {
                            action: 'plan.duplicate',
                            id: plan.id,
                            expectedRevision: plan.revision,
                            values: { title: `${plan.title} (copy)`, startDate: null },
                          },
                        ]),
                      )
                    }
                  >
                    <Copy size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="icon-button"
                    aria-label={`Delete ${plan.title}`}
                    disabled={action.busy}
                    onClick={async () => {
                      if (await confirm(`Delete “${plan.title}” and its planned sessions?`))
                        void action.run(() =>
                          mutate(request, [
                            { action: 'plan.delete', id: plan.id, expectedRevision: plan.revision },
                          ]),
                        );
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
              {workouts.length > 0 && (
                <div className="plan-workouts">
                  {workouts.map((workout) => (
                    <Button
                      variant="unstyled"
                      key={workout.id}
                      className="plan-workout-row"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        background: 'none',
                        borderTop: 0,
                        borderLeft: 0,
                        borderRight: 0,
                      }}
                      onClick={() => setWorkoutEdit(workout)}
                    >
                      <SportIcon sport={workout.sport} size={17} />
                      <strong>{workout.title}</strong>
                      <span>
                        Day {workout.schedule.kind === 'plan' ? workout.schedule.day : '—'}
                      </span>
                      <span>{duration(workout.durationSeconds)}</span>
                      <Edit3 size={13} />
                    </Button>
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
      <section className="section-block">
        <div className="section-heading">
          <h2>Recent changes</h2>
          <span className="muted-text">Review and recover manual edits</span>
        </div>
        <ErrorMessage error={historyAction.error} />
        {envelope.changes.length ? (
          envelope.changes.slice(0, 10).map((change) => (
            <div className="proposal-row" key={change.id}>
              <div>
                <strong>{change.summary || 'Training data updated'}</strong>
                <p>
                  {new Date(change.createdAt).toLocaleString('en-GB')} ·{' '}
                  {change.changes?.length ?? 0} records
                </p>
              </div>
              {change.undoneAt ? (
                <Badge className="badge">Undone</Badge>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="button small"
                  disabled={historyAction.busy}
                  onClick={async () => {
                    if (
                      await confirm(
                        'Undo this change? Later edits will be preserved if they conflict.',
                      )
                    )
                      void historyAction.run(() =>
                        request('training', 'undo', { id: change.id, idempotencyKey: requestId() }),
                      );
                  }}
                >
                  <RotateCcw size={14} />
                  Undo
                </Button>
              )}
            </div>
          ))
        ) : (
          <div className="quiet-empty">Your training changes will appear here.</div>
        )}
      </section>
      {editing && (
        <PlanEditor
          plan={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && <WorkoutEditor defaultPlan={adding} onClose={() => setAdding(null)} />}
      {workoutEdit && (
        <WorkoutEditor
          workout={data.workouts.find((w) => w.id === workoutEdit.id) ?? workoutEdit}
          onClose={() => setWorkoutEdit(null)}
        />
      )}
    </>
  );
}
