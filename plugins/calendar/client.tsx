"use client";

import { Button } from '@athlete-panel/ui';
import { useMemo, useState } from 'react';
import type { Injury, Note, TrainingEvent, WorkspaceState } from '@athlete-panel/contracts';
import { CheckCircle2, Flag, NotebookPen, Plus, CalendarDays, HeartPulse, ArrowUpRight } from 'lucide-react';
import { AddButton, addDays, dateLabel, DateNavigation, duration, ExtensionSlot, localDate, Modal, SportIcon, useWorkspace, type PluginPageProps } from '@athlete-panel/ui';
import { effectiveDate } from '../training/dates';
import { weeklySummary } from '../training/summary';
import { WeeklySummary } from './weekly-summary';
import { weeklySleep, weeklyHrv } from './weekly-sleep';
import { WorkoutEditor, WorkoutInspector } from '../training/client';
import { ContextEditor } from '../athlete/client';
import { ActivityCard, ActivityDetails, ContextCard, ContextDetails, SleepCard, SleepDetails, type CardSelection, type ContextItem } from './cards';
import { injuriesOnDate, sleepNights, type SleepNight } from './projection';
import './layout.css';

type EditorState = { kind: 'note' | 'event' | 'injury'; record?: Note | TrainingEvent | Injury; defaultDate?: string };

function Day({ date, today, data, nights, selectedId, onWorkout, onCard, onAdd, onQuickAdd }: {
  date: string; today: string; data: WorkspaceState; nights: SleepNight[]; selectedId: string | null;
  onWorkout: (id: string) => void; onCard: (card: CardSelection) => void; onAdd: (date: string) => void; onQuickAdd: (date: string) => void;
}) {
  const workouts = data.workouts.filter(workout => effectiveDate(workout, data.plans) === date).sort((a, b) => a.order - b.order);
  const notes = data.notes.filter(note => effectiveDate(note, data.plans) === date);
  const events = data.events.filter(event => event.date === date);
  const injuries = injuriesOnDate(data.injuries, date);
  const activities = data.activities.filter(activity => activity.localDate === date && !workouts.some(workout => workout.completion?.activityId === activity.id));
  const manualActuals = data.workouts.filter(workout => workout.completion?.source === 'manual' && workout.completion.status !== 'skipped' && workout.completion.performedDate === date && effectiveDate(workout, data.plans) !== date);
  const sleep = nights.filter(night => night.date === date);
  const empty = !workouts.length && !activities.length && !manualActuals.length && !notes.length && !events.length && !injuries.length && !sleep.length;
  return <div className={`calendar-day ${date === today ? 'is-today' : ''}`} data-date={date}>
    <div className="calendar-day-head"><span className="week-mobile-label">{dateLabel(date, { weekday: 'short' })}</span><span className="day-number" aria-label={dateLabel(date, { weekday: 'long', day: 'numeric', month: 'long' })}>{Number(date.slice(-2))}</span><Button variant="ghost" size="icon" className="icon-button" aria-label={`Add to ${dateLabel(date)}`} onClick={() => onQuickAdd(date)}><Plus size={13} /></Button></div>
    <div className="calendar-day-content">
      {workouts.map(workout => <Button variant="unstyled" className={`calendar-workout ${selectedId === workout.id ? 'selected' : ''} ${workout.completion?.status === 'completed' ? 'complete' : ''}`} key={workout.id} onClick={() => onWorkout(workout.id)} aria-label={`Open ${workout.title}`}><div className="workout-icon-row"><SportIcon sport={workout.sport} size={18} />{workout.completion?.status === 'completed' && <CheckCircle2 className="complete-check" size={12} />}</div><strong>{workout.title}</strong><span>{duration(workout.durationSeconds)}{workout.completion?.status === 'partial' ? ' · Partial' : workout.completion?.status === 'skipped' ? ' · Skipped' : ''}</span></Button>)}
      {activities.map(activity => <ActivityCard key={activity.id} activity={activity} linked={data.workouts.some(workout => workout.completion?.activityId === activity.id)} units={data.profile?.units} onClick={() => onCard({ kind: 'activity', id: activity.id })} />)}
      {manualActuals.map(workout => <Button variant="unstyled" className="calendar-workout complete" key={`actual-${workout.id}`} onClick={() => onWorkout(workout.id)} aria-label={`Open actual ${workout.title}`}><div className="workout-icon-row"><SportIcon sport={workout.sport} size={17} /><CheckCircle2 className="complete-check" size={12} /></div><strong>{workout.title}</strong><span>{duration(workout.completion!.durationSeconds)} · Actual</span></Button>)}
      {sleep.map(night => <SleepCard key={night.id} night={night} onClick={() => onCard({ kind: 'sleep', id: night.id })} />)}
      {events.map(record => <ContextCard key={record.id} item={{ kind: 'event', record }} onClick={() => onCard({ kind: 'event', id: record.id })} />)}
      {notes.map(record => <ContextCard key={record.id} item={{ kind: 'note', record }} onClick={() => onCard({ kind: 'note', id: record.id })} />)}
      {injuries.map(record => <ContextCard key={record.id} item={{ kind: 'injury', record }} onClick={() => onCard({ kind: 'injury', id: record.id })} />)}
      {empty && <Button variant="unstyled" className="day-placeholder" aria-label={`Add workout on ${date}`} onClick={() => onAdd(date)}><Plus size={14} /><span className="week-mobile-label">Add session</span></Button>}
    </div>
  </div>;
}

function CardDetails({ selection, nights, onClose, onEdit, onOpenWorkout }: { selection: CardSelection; nights: SleepNight[]; onClose: () => void; onEdit: (item: ContextItem) => void; onOpenWorkout: (id: string) => void }) {
  const { data } = useWorkspace();
  // Resolve from refreshed workspace data rather than keeping a stale record snapshot.
  if (selection.kind === 'sleep') {
    const night = nights.find(night => night.id === selection.id);
    if (night) return <SleepDetails night={night} onClose={onClose} />;
  }
  if (selection.kind === 'activity') {
    const activity = data.activities.find(activity => activity.id === selection.id);
    if (activity) return <ActivityDetails activity={activity} linkedWorkout={data.workouts.find(workout => workout.completion?.activityId === activity.id)} onClose={onClose} onOpenWorkout={onOpenWorkout} />;
  }
  const note = selection.kind === 'note' ? data.notes.find(note => note.id === selection.id) : undefined;
  const event = selection.kind === 'event' ? data.events.find(event => event.id === selection.id) : undefined;
  const injury = selection.kind === 'injury' ? data.injuries.find(injury => injury.id === selection.id) : undefined;
  const item: ContextItem | undefined = note ? { kind: 'note', record: note } : event ? { kind: 'event', record: event } : injury ? { kind: 'injury', record: injury } : undefined;
  if (item) return <ContextDetails item={item} onClose={onClose} onEdit={onEdit} />;
  return <Modal open onClose={onClose} title="Record unavailable"><div className="dialog-body"><p>This record is no longer in the current calendar. Refresh or select another card.</p></div></Modal>;
}

export default function CalendarPage({ data }: PluginPageProps) {
  const { from } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);
  const [context, setContext] = useState<EditorState | null>(null);
  const [detail, setDetail] = useState<CardSelection | null>(null);
  const nights = useMemo(() => sleepNights(data.health), [data.health]);
  const selected = data.workouts.find(workout => workout.id === selectedId);
  const today = localDate(new Date(), data.profile?.timezone);
  return <section className="calendar-workspace" aria-label="Training calendar workspace">
    <header className="calendar-toolbar">
      <h1>Training calendar</h1>
      <AddButton onClick={() => setAddingDate(today)}>Add workout</AddButton>
      <div className="calendar-navigation"><DateNavigation /></div>
    </header>
    {data.workouts.length === 0 && <div className="first-workout-banner"><CalendarDays size={24} /><div><h3>A clear week starts here.</h3><p>Add a workout or create a plan. Your calendar will take shape as you go.</p></div><Button variant="outline" size="sm" className="button small" onClick={() => setAddingDate(today)}>Add your first workout <ArrowUpRight size={14} /></Button></div>}
    <div className={`calendar-layout ${selected ? '' : 'no-inspector'}`}><div className="calendar-main">
      <div className="calendar-weekdays">{Array.from({ length: 7 }, (_, index) => dateLabel(addDays(from, index), { weekday: 'short' })).map(day => <span key={day}>{day}</span>)}</div>
      {[0, 1, 2].map(week => {
        const weekStart = addDays(from, week * 7); const total = weeklySummary(data, weekStart);
        return <section className="calendar-week" key={weekStart} aria-label={`Week of ${dateLabel(weekStart)}`}>
          <WeeklySummary summary={total} sleep={weeklySleep(data.health, weekStart, today)} hrv={weeklyHrv(data.health, weekStart, today)} units={data.profile?.units ?? 'metric'} today={today} onSession={session => { if (session.kind === 'activity') setDetail({ kind: 'activity', id: session.id }); else setSelectedId(session.id); }} />
          <div className="calendar-days">{Array.from({ length: 7 }, (_, index) => {
            const date = addDays(weekStart, index);
            return <Day key={date} date={date} today={today} data={data} nights={nights} selectedId={selectedId} onWorkout={setSelectedId} onCard={setDetail} onAdd={setAddingDate} onQuickAdd={setQuickAddDate} />;
          })}</div>
        </section>;
      })}
      <div className="calendar-footer"><span>Calendar timezone · {data.profile?.timezone ?? 'Set your timezone in profile'}</span><span>Your training stays on this instance</span></div><ExtensionSlot kind="calendar" selection={{ kind: 'date', id: from }} />
    </div>{selected && <WorkoutInspector workout={selected} onClose={() => setSelectedId(null)} onActivityDetails={id => setDetail({ kind: 'activity', id })} />}</div>
    {detail && <CardDetails key={`${detail.kind}:${detail.id}`} selection={detail} nights={nights} onClose={() => setDetail(null)} onEdit={item => { setDetail(null); setContext(item); }} onOpenWorkout={id => { setDetail(null); setSelectedId(id); }} />}
    {addingDate && <WorkoutEditor defaultDate={addingDate} onClose={() => setAddingDate(null)} />}
    {context && <ContextEditor {...context} onClose={() => setContext(null)} />}
    <Modal open={Boolean(quickAddDate)} onClose={() => setQuickAddDate(null)} title={quickAddDate ? `Add to ${dateLabel(quickAddDate)}` : 'Add to calendar'}><div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}><Button variant="outline" className="button" onClick={() => { setAddingDate(quickAddDate); setQuickAddDate(null); }}><Plus size={16} />Workout</Button>{(['note', 'event', 'injury'] as const).map(kind => <Button variant="outline" className="button" key={kind} onClick={() => { setContext({ kind, defaultDate: quickAddDate ?? undefined }); setQuickAddDate(null); }}>{kind === 'note' ? <NotebookPen size={16} /> : kind === 'event' ? <Flag size={16} /> : <HeartPulse size={16} />}{kind === 'injury' ? 'Injury constraint' : kind[0]!.toUpperCase() + kind.slice(1)}</Button>)}</div></Modal>
  </section>;
}
