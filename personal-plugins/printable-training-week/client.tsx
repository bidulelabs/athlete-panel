'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { dateSchema, sportSelectionLabel, type Workout } from '@athlete-panel/contracts';
import {
  addDays,
  Button,
  Checkbox,
  dateLabel,
  Field,
  Input,
  MarkdownContent,
  PageHeader,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { printableWeek } from './week';
import { printDistance, printElevation, printTime, type Units } from './format';
import { PrintedExercises, PrintedSteps } from './prescription';
import './printable-week.css';

const earliest = '0001-01-07';
const latest = '9999-12-11';

function Session({
  workout,
  planTitle,
  units,
  notes,
}: {
  workout: Workout;
  planTitle?: string;
  units: Units;
  notes: boolean;
}) {
  return (
    <article className="printable-week-session">
      <header>
        <p className="printable-week-meta">
          {workout.kind === 'rest' ? 'Rest day' : sportSelectionLabel(workout)}
          {planTitle && <> · {planTitle}</>}
        </p>
        <h3>{workout.title}</h3>
        {workout.kind !== 'rest' && (
          <p className="printable-week-totals">
            {[
              workout.durationSeconds === null
                ? 'Duration not specified'
                : printTime(workout.durationSeconds),
              workout.distanceMeters === null ? null : printDistance(workout.distanceMeters, units),
              workout.plannedElevationGainMeters == null
                ? null
                : printElevation(workout.plannedElevationGainMeters, units),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </header>
      <PrintedSteps steps={workout.steps} units={units} notes={notes} />
      <PrintedExercises exercises={workout.exercises ?? []} units={units} notes={notes} />
      {notes && workout.notes && (
        <div className="printable-week-notes">
          <MarkdownContent source={workout.notes} />
        </div>
      )}
    </article>
  );
}

export default function PrintableTrainingWeek({ data }: PluginPageProps) {
  const { from, setFrom, weekStartsOn } = useWorkspace();
  const [chosenDate, setChosenDate] = useState(from);
  const [notes, setNotes] = useState(false);
  useEffect(() => setChosenDate(from), [from]);
  const days = printableWeek(data, from, weekStartsOn);
  const start = days[0]!.date;
  const end = days[6]!.date;
  const units = data.profile?.units ?? 'metric';
  const validDate =
    dateSchema.safeParse(chosenDate).success && chosenDate >= earliest && chosenDate <= latest;
  const count = days.reduce((sum, day) => sum + day.sessions.length, 0);
  return (
    <div className="printable-week">
      <div className="printable-week-controls">
        <PageHeader
          title="Printable training week"
          description="Take your planned sessions with you, on paper or as a PDF."
          actions={
            <Button onClick={() => window.print()}>
              <Printer size={16} />
              Print / save PDF
            </Button>
          }
        />
        <form
          className="printable-week-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            if (validDate) setFrom(chosenDate);
          }}
        >
          <div className="printable-week-navigation">
            <Button
              variant="outline"
              aria-label="Previous week"
              disabled={start < addDays(earliest, 7)}
              onClick={() => setFrom(addDays(start, -7))}
              type="button"
            >
              <ChevronLeft size={18} />
            </Button>
            <Field label="Week containing">
              <Input
                type="date"
                min={earliest}
                max={latest}
                value={chosenDate}
                onChange={(event) => setChosenDate(event.target.value)}
                required
              />
            </Field>
            <Button variant="outline" type="submit" disabled={!validDate}>
              Show week
            </Button>
            <Button
              variant="outline"
              aria-label="Next week"
              disabled={start > addDays(latest, -7)}
              onClick={() => setFrom(addDays(start, 7))}
              type="button"
            >
              <ChevronRight size={18} />
            </Button>
          </div>
          <label className="printable-week-notes-control">
            <Checkbox checked={notes} onCheckedChange={(checked) => setNotes(checked === true)} />
            Include notes
          </label>
        </form>
        <p className="printable-week-hint">
          Notes and exercise instructions are excluded unless selected. Choose “Save as PDF” in your
          browser’s print dialog.
        </p>
      </div>
      <section className="printable-week-sheet" aria-label="Printable training week preview">
        <header className="printable-week-heading">
          <p className="printable-week-meta">ATHLETE PANEL · PLANNED TRAINING</p>
          <h2>
            {dateLabel(start)} —{' '}
            {dateLabel(end, { day: 'numeric', month: 'short', year: 'numeric' })}
          </h2>
          <p>
            {data.profile?.displayName ?? 'Athlete'} · {notes ? 'Notes included' : 'Notes excluded'}
          </p>
        </header>
        {count === 0 && <p className="printable-week-empty">No sessions planned for this week.</p>}
        {days.map((day) => (
          <section className="printable-week-day" key={day.date} aria-label={day.date}>
            <h2>
              <span>{dateLabel(day.date, { weekday: 'long' })}</span>
              <time dateTime={day.date}>{dateLabel(day.date)}</time>
            </h2>
            <div>
              {day.sessions.length ? (
                day.sessions.map(({ workout, planTitle }) => (
                  <Session
                    key={workout.id}
                    workout={workout}
                    planTitle={planTitle}
                    units={units}
                    notes={notes}
                  />
                ))
              ) : (
                <p className="printable-week-free">No session planned</p>
              )}
            </div>
          </section>
        ))}
        <footer className="printable-week-footer">
          Planned sessions only. Recorded activities and completion details are not included.
        </footer>
      </section>
    </div>
  );
}
