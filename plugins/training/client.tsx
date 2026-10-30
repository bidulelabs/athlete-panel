'use client';

import { sportSelectionLabel, type Plan, type Workout } from '@athlete-panel/contracts';
import {
  AddButton,
  Button,
  dateLabel,
  duration,
  distance,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  MarkdownContent,
  markdownToPlainText,
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
import { ChevronRight, Copy, Edit3, Layers, Moon, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { mutate, WorkoutEditor, WorkoutInspector } from './editors';
import { addDays } from './dates';
import { planWeeks, plannedDuration } from './plan-workouts';
import { prescriptionPreview } from './prescription';
import { TrainingHistory } from './history';
import './plans.css';
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
        <Field label="Description" hint="Markdown supported">
          <Textarea
            name="description"
            maxLength={20000}
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

function DurationSummary({ workouts }: { workouts: Workout[] }) {
  const total = plannedDuration(workouts);
  if (!total.sessions) return null;
  return (
    <span>
      {total.seconds === null
        ? 'Duration not set'
        : `${duration(total.seconds)} ${total.missing ? 'known' : 'planned'}`}
      {total.missing > 0 && total.seconds !== null ? ` · ${total.missing} without duration` : ''}
    </span>
  );
}

function PlanMeta({ plan, workouts }: { plan: Plan; workouts: Workout[] }) {
  const total = plannedDuration(workouts);
  return (
    <span className="plans-meta">
      <span>
        {plan.startDate
          ? `Starts ${dateLabel(plan.startDate, { day: 'numeric', month: 'short', year: 'numeric' })}`
          : 'Unscheduled'}
      </span>
      <span>
        {total.sessions} {total.sessions === 1 ? 'workout' : 'workouts'}
        {total.rests ? ` · ${total.rests} ${total.rests === 1 ? 'rest day' : 'rest days'}` : ''}
      </span>
    </span>
  );
}

function WorkoutSummary({ workout }: { workout: Workout }) {
  const { data } = useWorkspace();
  const units = data.profile?.units ?? 'metric';
  const rest = workout.kind === 'rest';
  const exerciseCount = workout.exercises?.length ?? 0;
  const preview = prescriptionPreview(workout.steps, units);
  return (
    <>
      <span className="plans-session-meta">
        <span>{rest ? 'Rest day' : sportSelectionLabel(workout)}</span>
        {!rest && (
          <span>
            {workout.durationSeconds === null
              ? 'Duration not set'
              : duration(workout.durationSeconds)}
          </span>
        )}
        {workout.distanceMeters !== null && <span>{distance(workout.distanceMeters, units)}</span>}
        {workout.plannedElevationGainMeters != null && (
          <span>
            {Math.round(workout.plannedElevationGainMeters * (units === 'imperial' ? 3.28084 : 1))}{' '}
            {units === 'imperial' ? 'ft' : 'm'} ascent
          </span>
        )}
        {exerciseCount > 0 && (
          <span>
            {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
          </span>
        )}
      </span>
      {(preview || workout.notes) && (
        <span className="plans-session-preview">
          {preview || markdownToPlainText(workout.notes)}
        </span>
      )}
    </>
  );
}

function PlanDetails({
  plan,
  onClose,
  onEdit,
}: {
  plan: Plan;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { data, request } = useWorkspace();
  const confirm = useConfirm();
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const [workoutEdit, setWorkoutEdit] = useState<Workout | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const workouts = data.workouts.filter(
    (workout) => workout.schedule.kind === 'plan' && workout.schedule.planId === plan.id,
  );
  const selected = workouts.find((workout) => workout.id === selectedId);
  const weeks = planWeeks(workouts);
  return (
    <Modal
      open
      wide
      className="plans-dialog"
      title={plan.title}
      onClose={onClose}
      closeLabel="Close training plan"
      focusHeading
    >
      <div className="plans-dialog-scroll">
        <div className="plans-overview">
          <PlanMeta plan={plan} workouts={workouts} />
          <div className="plans-actions" role="group" aria-label="Plan actions">
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} />
              Add workout
            </Button>
            <Button variant="outline" onClick={onEdit}>
              <Edit3 size={15} />
              Edit plan
            </Button>
            <Button
              variant="ghost"
              disabled={action.busy}
              onClick={async () => {
                if (
                  await confirm(
                    `Duplicate “${plan.title}”? The copy will be unscheduled and will not include completion history.`,
                    'Duplicate plan',
                  )
                )
                  void action.run(() =>
                    mutate(request, [
                      {
                        action: 'plan.duplicate',
                        id: plan.id,
                        expectedRevision: plan.revision,
                        values: { title: `${plan.title} (copy)`, startDate: null },
                      },
                    ]),
                  );
              }}
            >
              <Copy size={15} />
              Duplicate
            </Button>
            <Button
              variant="ghost"
              disabled={action.busy}
              onClick={async () => {
                if (
                  await confirm(`Delete “${plan.title}” and its planned sessions?`, 'Delete plan')
                )
                  void action.run(
                    () =>
                      mutate(request, [
                        { action: 'plan.delete', id: plan.id, expectedRevision: plan.revision },
                      ]),
                    onClose,
                  );
              }}
            >
              <Trash2 size={15} />
              Delete
            </Button>
          </div>
          <ErrorMessage error={action.error} />
          {plan.description && (
            <section className="plans-description" aria-label="Plan description">
              <h3>About this plan</h3>
              <MarkdownContent source={plan.description} />
            </section>
          )}
        </div>
        <div className="plans-schedule">
          <div className="plans-schedule-heading">
            <h3>Workouts</h3>
            <span>Weeks from the plan’s first day</span>
          </div>
          {!weeks.length ? (
            <div className="plans-empty">
              <p>No workouts yet. Add the first session to start building this plan.</p>
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Plus size={16} />
                Add first workout
              </Button>
            </div>
          ) : (
            weeks.map(({ week, days }) => (
              <section className="plans-week" key={week} aria-label={`Week ${week}`}>
                <header className="plans-week-heading">
                  <h4>Week {week}</h4>
                  <span>
                    {plan.startDate
                      ? `${dateLabel(addDays(plan.startDate, (week - 1) * 7))} – ${dateLabel(addDays(plan.startDate, week * 7 - 1), { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : `Days ${(week - 1) * 7 + 1}–${week * 7}`}
                  </span>
                  <DurationSummary workouts={days.flatMap(([, entries]) => entries)} />
                </header>
                {days.map(([day, entries]) => (
                  <div className="plans-day" key={day}>
                    <h5 className="plans-day-label">
                      <span>Day {day}</span>
                      {plan.startDate && (
                        <span>
                          {dateLabel(addDays(plan.startDate, day - 1), {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                      )}
                    </h5>
                    <div className="plans-day-sessions">
                      {entries.map((workout) => (
                        <div className="plans-session" key={workout.id}>
                          <Button
                            variant="unstyled"
                            className="plans-session-open"
                            aria-label={`Open ${workout.title}`}
                            onClick={() => setSelectedId(workout.id)}
                          >
                            {workout.kind === 'rest' ? (
                              <Moon size={18} />
                            ) : (
                              <SportIcon sport={workout.sport} size={18} />
                            )}
                            <span className="plans-session-copy">
                              <strong>{workout.title}</strong>
                              <WorkoutSummary workout={workout} />
                              {workout.completion && (
                                <span className="plans-session-status">
                                  {workout.completion.status}
                                </span>
                              )}
                            </span>
                            <ChevronRight size={16} className="plans-chevron" />
                          </Button>
                          <Button
                            variant="ghost"
                            className="plans-edit-workout"
                            aria-label={`Edit ${workout.title}`}
                            onClick={() => setWorkoutEdit(workout)}
                          >
                            <Edit3 size={14} />
                            <span>Edit</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      </div>
      {selected && (
        <WorkoutInspector
          key={selected.id}
          workout={selected}
          onClose={() => setSelectedId(null)}
          alwaysOverlay
        />
      )}
      {adding && <WorkoutEditor defaultPlan={plan} onClose={() => setAdding(false)} />}
      {workoutEdit && <WorkoutEditor workout={workoutEdit} onClose={() => setWorkoutEdit(null)} />}
    </Modal>
  );
}

export default function TrainingPage({ data }: PluginPageProps) {
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.plans.find((plan) => plan.id === selectedId);
  return (
    <div className="plans-page">
      <PageHeader
        title="Training plans"
        description="Build a block, schedule it, and adjust as you go."
        actions={
          <>
            <TrainingHistory />
            <AddButton onClick={() => setEditing('new')}>Create plan</AddButton>
          </>
        }
      />
      {!data.plans.length ? (
        <EmptyState
          icon={<Layers size={26} />}
          title="Start with a training block"
          action={
            <Button onClick={() => setEditing('new')}>
              <Plus size={16} />
              Create your first plan
            </Button>
          }
        >
          Organize workouts into a plan. Set its start date whenever you’re ready.
        </EmptyState>
      ) : (
        <section className="plans-list" aria-label="Training plans">
          <div className="plans-list-heading">
            <h2>Your plans</h2>
            <span>
              {data.plans.length} {data.plans.length === 1 ? 'plan' : 'plans'}
            </span>
          </div>
          {data.plans.map((plan) => (
            <Button
              variant="unstyled"
              className="plans-list-row"
              key={plan.id}
              aria-label={`Open ${plan.title}`}
              onClick={() => setSelectedId(plan.id)}
            >
              <span className="plans-list-copy">
                <strong>{plan.title}</strong>
                {plan.description && (
                  <span className="plans-list-description">
                    {markdownToPlainText(plan.description)}
                  </span>
                )}
                <PlanMeta
                  plan={plan}
                  workouts={data.workouts.filter(
                    (workout) =>
                      workout.schedule.kind === 'plan' && workout.schedule.planId === plan.id,
                  )}
                />
              </span>
              <span className="plans-open-label">
                View plan
                <ChevronRight size={17} />
              </span>
            </Button>
          ))}
        </section>
      )}
      {selected && (
        <PlanDetails
          key={selected.id}
          plan={selected}
          onClose={() => setSelectedId(null)}
          onEdit={() => setEditing(selected)}
        />
      )}
      {editing && (
        <PlanEditor
          plan={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
