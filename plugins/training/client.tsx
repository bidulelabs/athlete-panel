'use client';

import type { Plan, Workout } from '@athlete-panel/contracts';
import {
  AddButton,
  Badge,
  Button,
  dateLabel,
  duration,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  requestId,
  SportIcon,
  SubmitButton,
  Textarea,
  useAction,
  useConfirm,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { Copy, Edit3, Layers, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { mutate, WorkoutEditor } from './editors';
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
