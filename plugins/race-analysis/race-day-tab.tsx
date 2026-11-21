'use client';

import { useState } from 'react';
import { Flag, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorMessage,
  PageHeader,
  dateLabel,
  distance,
  duration,
  useAction,
  useConfirm,
  type PluginPageProps,
} from '@athlete-panel/ui';
import type { RaceAnalysis, RacePlan } from '@athlete-panel/contracts';
import { mutate } from '../training/public/client';
import { stationArrivals } from './race-day';
import { StartAndCutoffDialog, StationDialog } from './race-day-dialogs';
import { clockTime, elevationLabel, finishTime } from './presentation';
import { NeedsReviewNotice } from './needs-review-notice';
import { raceDayCommand, stationsAfterSave } from './race-plan-form';

type Station = RacePlan['stations'][number];
type RaceDayTiming = ReturnType<typeof stationArrivals>;
type Arrival = Omit<RaceDayTiming['finish'], 'distanceMeters'>;
type Leg = RaceDayTiming['legs'][number];

function arrivalRangeLabel(arrival: Arrival) {
  if (arrival.timeOfDay)
    return {
      range: `${clockTime(arrival.timeOfDay.lowSeconds)}–${clockTime(arrival.timeOfDay.highSeconds)}`,
      aim: `aim ${clockTime(arrival.timeOfDay.seconds)}`,
    };
  if (arrival.fromStart)
    return {
      range: `${finishTime(arrival.fromStart.lowSeconds)}–${finishTime(arrival.fromStart.highSeconds)}`,
      aim: 'after the start',
    };
  return null;
}

function ArrivalTimes({ arrival }: { arrival: Arrival }) {
  const label = arrivalRangeLabel(arrival);
  if (!label) return <>Unknown</>;
  return (
    <>
      {label.range}
      <small>{label.aim}</small>
    </>
  );
}

function CutoffWithMargin({ arrival }: { arrival: Arrival }) {
  if (arrival.cutoffSeconds === null) return <>None</>;
  return (
    <>
      {clockTime(arrival.cutoffSeconds)}
      {arrival.cutoffMarginSeconds !== null && (
        <small className={arrival.cutoffMarginSeconds < 0 ? 'race-late' : undefined}>
          {arrival.cutoffMarginSeconds >= 0
            ? `${duration(arrival.cutoffMarginSeconds)} margin`
            : `${duration(-arrival.cutoffMarginSeconds)} after the cutoff`}
        </small>
      )}
    </>
  );
}

function FinishCutoff({ finish }: { finish: Arrival }) {
  if (finish.cutoffSeconds === null) return <p className="race-day-cutoff">No finish cutoff</p>;
  const margin = finish.cutoffMarginSeconds;
  return (
    <p className="race-day-cutoff">
      Finish cutoff <strong>{clockTime(finish.cutoffSeconds)}</strong>
      {margin !== null && (
        <span className={margin < 0 ? 'race-late' : undefined}>
          {' · '}
          {margin >= 0
            ? `${duration(margin)} after the latest finish`
            : `Latest finish is ${duration(-margin)} after the cutoff`}
        </span>
      )}
    </p>
  );
}

function RaceDaySummary({
  raceDay,
  startTime,
  timezone,
  busy,
  onChangeStart,
}: {
  raceDay: RaceDayTiming;
  startTime: string | null;
  timezone: string | undefined;
  busy: boolean;
  onChangeStart: () => void;
}) {
  const { finish } = raceDay;
  const finishRange = arrivalRangeLabel(finish);
  return (
    <section className="race-estimate race-day-summary" aria-label="Race day timing">
      {finish.fromStart && (
        <>
          <p className="race-day-headline">
            {finish.timeOfDay
              ? `Start ${startTime} → finish ${clockTime(finish.timeOfDay.seconds)}`
              : `Finish ${finishTime(finish.fromStart.seconds)} after the start`}
          </p>
          {finishRange && <p className="race-range">Planning range {finishRange.range}</p>}
          <p className="race-day-moving">
            {finishTime(raceDay.movingSeconds)} moving, {duration(raceDay.plannedStopSeconds)} stops
          </p>
        </>
      )}
      <FinishCutoff finish={finish} />
      <div className="race-day-start">
        <span>
          {startTime ? (
            <>
              Start <strong>{startTime}</strong>
              {timezone && ` · ${timezone}`}
            </>
          ) : (
            'No start time yet'
          )}
        </span>
        <Button variant="outline" onClick={onChangeStart} disabled={busy}>
          Change start time
        </Button>
      </div>
    </section>
  );
}

function LegRow({ leg, from, to, units }: { leg: Leg; from: string; to: string; units: string }) {
  const measures = [
    distance(leg.toMeters - leg.fromMeters, units),
    leg.ascentMeters !== null && `${elevationLabel(leg.ascentMeters, units)} up`,
  ].filter(Boolean);
  return (
    <tr className="race-leg">
      <td colSpan={6}>
        {from} → {to} · <strong>{measures.join(' · ')}</strong>
        {leg.movingSeconds !== null && ` · about ${duration(leg.movingSeconds)} moving`}
      </td>
    </tr>
  );
}

function StationRow({
  arrival,
  units,
  busy,
  onEdit,
  onRemove,
}: {
  arrival: RaceDayTiming['stations'][number];
  units: string;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { station } = arrival;
  const offered = [
    station.water && 'water',
    station.food,
    station.dropBag.length > 0 &&
      `drop bag (${station.dropBag.length} item${station.dropBag.length === 1 ? '' : 's'})`,
  ].filter(Boolean);
  return (
    <tr>
      <th scope="row">
        <strong>{station.name}</strong>
        <small>{[distance(station.distanceMeters, units), ...offered].join(' · ')}</small>
        {arrival.beyondCourse && <Badge variant="outline">Beyond the course</Badge>}
        {station.verified ? (
          <Badge variant="secondary">
            {station.source ? `Confirmed · ${station.source}` : 'Confirmed'}
          </Badge>
        ) : (
          <Badge variant="outline" className="race-unconfirmed">
            Not confirmed
          </Badge>
        )}
      </th>
      <td data-label="Arrival">
        {arrival.beyondCourse ? 'No arrival' : <ArrivalTimes arrival={arrival} />}
      </td>
      <td data-label="Cutoff">
        <CutoffWithMargin arrival={arrival} />
      </td>
      <td data-label="Stop">{duration(station.stopSeconds)}</td>
      <td data-label="What you do">{station.action}</td>
      <td className="race-station-actions">
        <Button
          variant="outline"
          aria-label={`Edit ${station.name}`}
          disabled={busy}
          onClick={onEdit}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          aria-label={`Remove ${station.name}`}
          disabled={busy}
          onClick={onRemove}
        >
          Remove
        </Button>
      </td>
    </tr>
  );
}

export function RaceDay({
  race,
  course,
  estimate,
  estimateReasons,
  data,
  request,
  onOpenCourse,
}: Pick<PluginPageProps, 'data' | 'request'> &
  Pick<RaceAnalysis, 'race' | 'course' | 'estimate' | 'estimateReasons'> & {
    onOpenCourse: () => void;
  }) {
  const action = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<string | null>(null);
  const racePlan = data.racePlans.find((candidate) => candidate.eventId === race.id);
  const courseId = course?.id ?? null;
  const units = data.profile?.units ?? 'metric';
  const timezone = data.profile?.timezone;
  const stations = racePlan?.stations ?? [];
  const raceDay = stationArrivals(estimate, course?.analysis.sections ?? [], {
    startTime: racePlan?.startTime ?? null,
    finishCutoff: racePlan?.finishCutoff ?? null,
    stations,
  });
  const saveRacePlan = (values: Parameters<typeof raceDayCommand>[0]) =>
    mutate(request, [raceDayCommand(values, racePlan, race.id, courseId)]);
  async function removeStation(station: Station) {
    if (await confirm(`Remove ${station.name} from this race plan?`, 'Remove station'))
      await action.run(() =>
        saveRacePlan({ stations: stations.filter((saved) => saved.id !== station.id) }),
      );
  }
  const legEndingAt = (meters: number | null) =>
    raceDay.legs.find((leg) => leg.toMeters === meters);
  const placeNameAt = (meters: number) =>
    meters === 0
      ? 'Start'
      : (stations.find((station) => station.distanceMeters === meters)?.name ?? 'Start');
  const finishLeg = stations.some(
    (station) => station.distanceMeters === raceDay.finish.distanceMeters,
  )
    ? undefined
    : legEndingAt(raceDay.finish.distanceMeters);
  const legRow = (leg: Leg | undefined, to: string) =>
    leg && <LegRow leg={leg} from={placeNameAt(leg.fromMeters)} to={to} units={units} />;
  return (
    <div className="race-analysis race-day" aria-busy={action.busy}>
      <PageHeader
        eyebrow="Race / Race day"
        title={race.title}
        description={dateLabel(race.date, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      />
      <NeedsReviewNotice racePlan={racePlan} courseId={courseId} request={request}>
        The course or your target changed after this plan was written. Check that the stations still
        hold.
      </NeedsReviewNotice>
      <RaceDaySummary
        raceDay={raceDay}
        startTime={racePlan?.startTime ?? null}
        timezone={timezone}
        busy={action.busy}
        onChangeStart={() => setEditing('start')}
      />
      {!estimate ? (
        <div className="race-data-notice" role="status">
          <strong>Arrival times are unknown</strong>
          {estimateReasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
          <p>Cutoffs and stops still show.</p>
          <Button variant="outline" onClick={onOpenCourse}>
            Add past efforts on Course
          </Button>
        </div>
      ) : (
        !racePlan?.startTime && (
          <p className="race-hint" role="status">
            Set a start time to see arrival clock times and cutoff margins.
          </p>
        )
      )}
      {raceDay.stopsExceedEstimate && (
        <div className="race-data-notice" role="status">
          <p>Planned stops are longer than the whole estimate. Moving time is shown as 0.</p>
        </div>
      )}
      <section className="race-day-stations" aria-labelledby="race-stations-title">
        <div className="race-section-heading">
          <div>
            <h2 id="race-stations-title">Aid stations</h2>
            <p className="race-hint">
              Arrival ranges come from your course estimate. Margins use the latest arrival.
            </p>
          </div>
          {stations.length > 0 && (
            <Button onClick={() => setEditing('new')} disabled={action.busy}>
              <Plus size={15} />
              Add station
            </Button>
          )}
        </div>
        {stations.length === 0 ? (
          <EmptyState
            icon={<Flag size={25} />}
            title="No aid stations yet"
            action={
              <Button onClick={() => setEditing('new')} disabled={action.busy}>
                Add the first station
              </Button>
            }
          >
            Add the stations from the race guide: distance, cutoff and what they offer. Nothing is
            filled in for you.
          </EmptyState>
        ) : (
          <table className="race-stations">
            <thead>
              <tr>
                <th scope="col">Station</th>
                <th scope="col">Arrival</th>
                <th scope="col">Cutoff</th>
                <th scope="col">Stop</th>
                <th scope="col">What you do</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {raceDay.stations.map((arrival) => (
              <tbody key={arrival.station.id}>
                {legRow(legEndingAt(arrival.station.distanceMeters), arrival.station.name)}
                <StationRow
                  arrival={arrival}
                  units={units}
                  busy={action.busy}
                  onEdit={() => setEditing(arrival.station.id)}
                  onRemove={() => void removeStation(arrival.station)}
                />
              </tbody>
            ))}
            {finishLeg && <tbody>{legRow(finishLeg, 'Finish')}</tbody>}
          </table>
        )}
        <ErrorMessage error={action.error} />
      </section>
      {editing === 'start' && (
        <StartAndCutoffDialog
          racePlan={racePlan}
          timezone={timezone}
          onSave={saveRacePlan}
          onClose={() => setEditing(null)}
        />
      )}
      {editing !== null && editing !== 'start' && (
        <StationDialog
          existingStation={stations.find((station) => station.id === editing)}
          units={units}
          onSave={async (station) =>
            saveRacePlan({ stations: stationsAfterSave(stations, station) })
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
