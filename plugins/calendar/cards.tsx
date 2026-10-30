'use client';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@athlete-panel/ui';
import { Button } from '@athlete-panel/ui';
import { sportSelectionLabel } from '@athlete-panel/contracts';
import { useState, type ReactNode } from 'react';
import type {
  Activity,
  CommandInput,
  Injury,
  Note,
  TrainingEvent,
  Workout,
} from '@athlete-panel/contracts';
import { ArrowUpRight, Flag, HeartPulse, Moon, NotebookPen, Pencil, Trash2 } from 'lucide-react';
import {
  dateLabel,
  distance,
  duration,
  ErrorMessage,
  Modal,
  MarkdownContent,
  markdownToPlainText,
  SportIcon,
  sportLabel,
  useAction,
  useWorkspace,
} from '@athlete-panel/ui';
import { effectiveDate } from '../training/public/shared';
import { mutate } from '../training/public/client';
import type { SleepNight } from './projection';
import './cards.css';

export type ContextItem =
  | { kind: 'note'; record: Note }
  | { kind: 'event'; record: TrainingEvent }
  | { kind: 'injury'; record: Injury };
export type CardSelection = { kind: ContextItem['kind'] | 'activity' | 'sleep'; id: string };
const fullDate = (date: string) =>
  dateLabel(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const time = (seconds: number | null) => (seconds === null ? 'Unavailable' : duration(seconds));
const contextTitle = (item: ContextItem) =>
  item.kind === 'injury' ? item.record.bodyPart : item.record.title;
const contextIcon = (kind: ContextItem['kind']) =>
  kind === 'note' ? (
    <NotebookPen size={16} />
  ) : kind === 'event' ? (
    <Flag size={16} />
  ) : (
    <HeartPulse size={16} />
  );

function CalendarCard({
  tone,
  icon,
  title,
  label,
  onClick,
  children,
}: {
  tone: string;
  icon: ReactNode;
  title: string;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="unstyled"
      type="button"
      className={`calendar-fact-card calendar-fact-${tone}`}
      aria-label={label}
      onClick={onClick}
    >
      <span className="calendar-fact-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="calendar-fact-copy">
        <strong>{title}</strong>
        {children}
      </span>
    </Button>
  );
}

export function SleepCard({ night, onClick }: { night: SleepNight; onClick: () => void }) {
  return (
    <CalendarCard
      tone="sleep"
      icon={<Moon size={16} />}
      title={night.durationSeconds === null ? 'Sleep' : `${duration(night.durationSeconds)} sleep`}
      label={`Open sleep details for ${fullDate(night.date)}`}
      onClick={onClick}
    >
      <span>Score {night.score === null ? 'unavailable' : `${Math.round(night.score)} / 100`}</span>
      {night.hrvMilliseconds !== null && <span>HRV {Math.round(night.hrvMilliseconds)} ms</span>}
    </CalendarCard>
  );
}

export function ContextCard({ item, onClick }: { item: ContextItem; onClick: () => void }) {
  const preview =
    item.kind === 'note'
      ? item.record.body
      : item.kind === 'event'
        ? item.record.notes
        : item.record.description || item.record.notes;
  return (
    <CalendarCard
      tone={item.kind}
      icon={contextIcon(item.kind)}
      title={contextTitle(item)}
      label={`Open ${item.kind} ${contextTitle(item)}`}
      onClick={onClick}
    >
      {item.kind === 'event' && (
        <span className="calendar-fact-tag">{sportLabel(item.record.kind)}</span>
      )}
      {item.kind === 'injury' && (
        <span className="calendar-fact-tag">
          {sportLabel(item.record.severity)} ·{' '}
          {item.record.endDate ? `until ${dateLabel(item.record.endDate)}` : 'Ongoing'}
        </span>
      )}
      {preview && <span className="calendar-fact-excerpt">{markdownToPlainText(preview)}</span>}
    </CalendarCard>
  );
}

export function ActivityCard({
  activity,
  linked,
  units,
  onClick,
}: {
  activity: Activity;
  linked: boolean;
  units?: string;
  onClick: () => void;
}) {
  return (
    <CalendarCard
      tone="activity"
      icon={<SportIcon sport={activity.sport} size={17} />}
      title={activity.title || 'Garmin activity'}
      label={`Open activity ${activity.title || 'Garmin activity'}`}
      onClick={onClick}
    >
      <span>
        {duration(activity.durationSeconds)} · {distance(activity.distanceMeters, units)}
      </span>
      <span className="calendar-fact-tag">{linked ? 'Linked activity' : 'Garmin activity'}</span>
    </CalendarCard>
  );
}

function Detail({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      className="calendar-detail-dialog"
    >
      <div className="dialog-body calendar-detail-body">{children}</div>
    </Modal>
  );
}
function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-actions">
      <Button variant="outline" className="button" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

export function SleepDetails({ night, onClose }: { night: SleepNight; onClose: () => void }) {
  const hasStages = night.stages.some((stage) => stage.seconds !== null);
  return (
    <Detail title="Sleep summary" description={fullDate(night.date)} onClose={onClose}>
      <div className="sleep-detail-hero">
        <Moon size={28} />
        <div>
          <span>Total sleep</span>
          <strong>{time(night.durationSeconds)}</strong>
        </div>
        <div className="sleep-detail-score">
          <span>Sleep score</span>
          <strong>
            {night.score === null ? (
              'Unavailable'
            ) : (
              <>
                {Math.round(night.score)}
                <small> / 100</small>
              </>
            )}
          </strong>
        </div>
      </div>
      <dl className="calendar-detail-metrics">
        <Metric label="Overnight HRV">
          {night.hrvMilliseconds === null
            ? 'Unavailable'
            : `${Math.round(night.hrvMilliseconds)} ms`}
        </Metric>
        <Metric label="Awake during sleep">
          {time(night.stages.find((stage) => stage.key === 'awake')!.seconds)}
        </Metric>
      </dl>
      <section className="sleep-stage-section" aria-labelledby="sleep-stage-heading">
        <h3 id="sleep-stage-heading">Sleep stages</h3>
        {night.stageTotal !== null && night.stageTotal > 0 && (
          <div
            className="sleep-stage-bar"
            role="img"
            aria-label={night.stages
              .map(
                (stage) => `${stage.label}: ${time(stage.seconds)}, ${Math.round(stage.percent!)}%`,
              )
              .join('; ')}
          >
            {night.stages.map((stage) => (
              <span
                key={stage.key}
                className={`sleep-stage-${stage.key}`}
                style={{ width: `${stage.percent}%` }}
              />
            ))}
          </div>
        )}
        <dl className="sleep-stage-values">
          {night.stages.map((stage) => (
            <div key={stage.key}>
              <dt>
                <span className={`sleep-stage-dot sleep-stage-${stage.key}`} />
                {stage.label}
              </dt>
              <dd>
                {time(stage.seconds)}
                {stage.percent !== null && <small>{Math.round(stage.percent)}%</small>}
              </dd>
            </div>
          ))}
        </dl>
        {!hasStages ? (
          <p className="form-footnote">Stage data unavailable for this night.</p>
        ) : !night.stagesComplete ? (
          <p className="form-footnote">Stage data is incomplete. Percentages are unavailable.</p>
        ) : night.stageTotal === 0 ? (
          <p className="form-footnote">
            Garmin reported zero stage durations. Percentages are unavailable.
          </p>
        ) : (
          <p className="form-footnote">
            Shares of recorded stage time, including awake time. This is a duration breakdown, not a
            timeline.
          </p>
        )}
        <p className="form-footnote">
          Total sleep is Garmin’s reported value and excludes awake time. Missing measurements stay
          unavailable.
        </p>
      </section>
      <p className="calendar-detail-source">Imported from Garmin · {dateLabel(night.date)}</p>
      <CloseButton onClose={onClose} />
    </Detail>
  );
}

export function ContextDetails({
  item,
  onClose,
  onEdit,
}: {
  item: ContextItem;
  onClose: () => void;
  onEdit: (item: ContextItem) => void;
}) {
  const { data, request } = useWorkspace();
  const action = useAction();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const date =
    item.kind === 'note'
      ? effectiveDate(item.record, data.plans)
      : item.kind === 'event'
        ? item.record.date
        : item.record.startDate;
  const planId =
    item.kind === 'note' && item.record.schedule.kind === 'plan'
      ? item.record.schedule.planId
      : undefined;
  const plan = data.plans.find((plan) => plan.id === planId);
  const body =
    item.kind === 'note'
      ? item.record.body
      : item.kind === 'event'
        ? item.record.notes
        : item.record.description;
  return (
    <Detail
      title={contextTitle(item)}
      description={`${sportLabel(item.kind === 'injury' ? 'Injury constraint' : item.kind)} · ${date ? fullDate(date) : 'Unscheduled plan'}`}
      onClose={onClose}
    >
      <dl className="calendar-detail-metrics">
        {plan && (
          <Metric label="Training plan">
            {plan.title}
            {item.kind === 'note' &&
              item.record.schedule.kind === 'plan' &&
              ` · Day ${item.record.schedule.day}`}
          </Metric>
        )}
        {item.kind === 'event' && (
          <Metric label="Event type">{sportLabel(item.record.kind)}</Metric>
        )}
        {item.kind === 'injury' && (
          <>
            <Metric label="Severity">{sportLabel(item.record.severity)}</Metric>
            <Metric label="Active through">
              {item.record.endDate ? fullDate(item.record.endDate) : 'Ongoing'}
            </Metric>
          </>
        )}
      </dl>
      <MarkdownContent source={body || 'No additional details.'} />
      {item.kind === 'injury' && item.record.notes && (
        <section className="calendar-detail-notes">
          <h3>Additional notes</h3>
          <MarkdownContent source={item.record.notes} />
        </section>
      )}
      <ErrorMessage error={action.error} />
      <div className="dialog-actions">
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={14} />
          Delete
        </Button>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={() => onEdit(item)}>
          <Pencil size={14} />
          Edit
        </Button>
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="ui-confirm">
          <AlertDialogTitle>
            Delete {item.kind === 'injury' ? 'constraint' : item.kind}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {item.kind === 'injury'
              ? 'Delete this constraint from every affected day?'
              : `Delete this ${item.kind}?`}
          </AlertDialogDescription>
          <ErrorMessage error={action.error} />
          <div className="ui-confirm-actions">
            <AlertDialogCancel disabled={action.busy}>
              Keep {item.kind === 'injury' ? 'constraint' : item.kind}
            </AlertDialogCancel>
            <Button
              variant="danger"
              disabled={action.busy}
              onClick={() =>
                action.run(
                  () =>
                    mutate(request, [
                      {
                        action: `${item.kind}.delete`,
                        id: item.record.id,
                        expectedRevision: item.record.revision,
                      } as CommandInput,
                    ]),
                  onClose,
                )
              }
            >
              {action.busy ? 'Deleting…' : 'Confirm delete'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Detail>
  );
}

export function ActivityDetails({
  activity,
  linkedWorkout,
  onClose,
  onOpenWorkout,
}: {
  activity: Activity;
  linkedWorkout?: Workout;
  onClose: () => void;
  onOpenWorkout: (id: string) => void;
}) {
  const { data } = useWorkspace();
  const units = data.profile?.units ?? 'metric';
  return (
    <Detail
      title={activity.title || 'Garmin activity'}
      description={`${sportSelectionLabel(activity)} · ${fullDate(activity.localDate)}`}
      onClose={onClose}
    >
      <dl className="calendar-detail-metrics">
        <Metric label="Duration">{time(activity.durationSeconds)}</Metric>
        <Metric label="Distance">
          {activity.distanceMeters === null
            ? 'Unavailable'
            : distance(activity.distanceMeters, units)}
        </Metric>
        <Metric label="Elevation gain">
          {activity.elevationMeters === null
            ? 'Unavailable'
            : `${Math.round(activity.elevationMeters * (units === 'imperial' ? 3.28084 : 1))} ${units === 'imperial' ? 'ft' : 'm'}`}
        </Metric>
        <Metric label="Average heart rate">
          {activity.averageHeartRateBpm === null
            ? 'Unavailable'
            : `${Math.round(activity.averageHeartRateBpm)} bpm`}
        </Metric>
        <Metric label="Start time (UTC)">
          {new Date(activity.startedAt).toLocaleString('en-GB', {
            timeZone: 'UTC',
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </Metric>
        <Metric label="TSS">{activity.trainingStressScore ?? 'Unavailable'}</Metric>
        <Metric label="Intensity factor">{activity.intensityFactor ?? 'Unavailable'}</Metric>
        <Metric label="Normalized power">
          {activity.normalizedPowerWatts == null
            ? 'Unavailable'
            : `${activity.normalizedPowerWatts} W`}
        </Metric>
        <Metric label="Source">Garmin</Metric>
      </dl>
      {activity.dateSource === 'inferred' && (
        <p className="form-footnote">The activity’s calendar date was inferred during import.</p>
      )}
      <section className="calendar-activity-link">
        <h3>Linked workout</h3>
        {linkedWorkout ? (
          <>
            <Button
              variant="link"
              className="text-button"
              onClick={() => onOpenWorkout(linkedWorkout.id)}
            >
              {linkedWorkout.title}
              <ArrowUpRight size={15} />
            </Button>
            <p className="form-footnote">
              {sportLabel(linkedWorkout.completion?.status)} · Counted once in actual totals.
            </p>
          </>
        ) : (
          <p>No workout linked. You can link this activity from a workout’s details.</p>
        )}
      </section>
      <p className="calendar-detail-source">Imported measurements are read-only.</p>
      <CloseButton onClose={onClose} />
    </Detail>
  );
}
