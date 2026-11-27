'use client';

import type { ReactNode } from 'react';
import { Download, Flag, Printer } from 'lucide-react';
import { Button, EmptyState, PageHeader, dateLabel, type PluginPageProps } from '@athlete-panel/ui';
import type { RaceAnalysis } from '@athlete-panel/contracts';
import { carryPlan } from './carry';
import { NeedsReviewNotice } from './needs-review-notice';
import { raceCardContent, raceCardHasContent } from './race-card';
import { raceCardFile, raceCardFileName } from './race-card-file';
import { stationArrivals } from './race-day';
import { strategyNeedsReview } from './race-plan-form';

const longDate = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } as const;

function downloadHtml(filename: string, html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function RaceCard({
  race,
  course,
  estimate,
  data,
  request,
}: Pick<PluginPageProps, 'data' | 'request'> & Pick<RaceAnalysis, 'race' | 'course' | 'estimate'>) {
  const racePlan = data.racePlans.find((candidate) => candidate.eventId === race.id);
  const units = data.profile?.units ?? 'metric';
  const dateText = dateLabel(race.date, longDate);
  const header = (actions?: ReactNode) => (
    <PageHeader
      eyebrow="Race / Race card"
      title={race.title}
      description={dateText}
      actions={actions}
    />
  );
  if (!racePlan || !raceCardHasContent(racePlan))
    return (
      <div className="race-analysis race-card">
        {header()}
        <EmptyState icon={<Flag size={25} />} title="No race card yet">
          The card is built from the aid stations on Race day and the food plan on Nutrition. Add
          either one to see it here.
        </EmptyState>
      </div>
    );
  const raceDay = stationArrivals(estimate, course?.analysis.sections ?? [], racePlan);
  const products = data.profile?.nutrition?.products ?? [];
  const card = raceCardContent({
    racePlan,
    course,
    raceDay,
    carry: carryPlan(
      raceDay,
      racePlan.nutrition,
      products,
      data.profile?.nutrition?.carryCapacityMillilitres ?? null,
    ),
    products,
    units,
  });
  const needsReview = strategyNeedsReview(racePlan, course?.id ?? null);
  const download = () =>
    downloadHtml(
      raceCardFileName(race.title),
      raceCardFile({
        card,
        title: race.title,
        dateText,
        downloadedOn: new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }),
        needsReview,
      }),
    );
  return (
    <div className="race-analysis race-card">
      {header(
        <>
          <Button variant="outline" onClick={download}>
            <Download size={15} />
            Download offline copy
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer size={15} />
            Print
          </Button>
        </>,
      )}
      <NeedsReviewNotice racePlan={racePlan} courseId={course?.id ?? null} request={request}>
        The course or your target changed after this plan was written. Check that the card still
        holds.
      </NeedsReviewNotice>
      <section className="race-card-sheet" aria-labelledby="race-card-title">
        <h2 id="race-card-title">Your race card</h2>
        <p className="race-hint">
          {card.writtenFor} · plan revision {card.revision}
        </p>
        {card.effortAndWeather && <p className="race-hint">{card.effortAndWeather}</p>}
        {card.effortAndWeather && card.weatherNote && (
          <p className="race-hint">{card.weatherNote}</p>
        )}
        {needsReview && (
          <p className="race-card-review-line">
            This plan needs review: the course or the target changed after it was written.
          </p>
        )}
        {(card.expectedFinish || card.briefing) && (
          <div className="race-card-summary">
            {card.expectedFinish ? (
              <div>
                <div className="race-kicker">Expected finish</div>
                <strong className="race-card-finish">{card.expectedFinish}</strong>
                {card.finishRange && <p className="race-hint">Planning range {card.finishRange}</p>}
              </div>
            ) : null}
            {card.briefing && (
              <div>
                <div className="race-kicker">Keep in mind</div>
                <p className="race-card-text">{card.briefing}</p>
              </div>
            )}
          </div>
        )}
        {card.breakfast && (
          <div>
            <div className="race-kicker">Breakfast</div>
            <p className="race-card-text">{card.breakfast}</p>
          </div>
        )}
        {card.warning && (
          <p className="race-data-notice" role="status">
            {card.warning}
          </p>
        )}
        {card.timesFromStart && <p className="race-hint">Times are counted from the start.</p>}
        <ol className="race-card-stops">
          {card.stops.map((stop) => (
            <li key={stop.marker + stop.title}>
              <span className="race-card-marker" aria-hidden="true">
                {stop.marker}
              </span>
              <strong className="race-card-title">{stop.title}</strong>
              {stop.time && <span className="race-card-time">{stop.time}</span>}
              <div className="race-card-body">
                {stop.action && <p>{stop.action}</p>}
                {stop.leaveWith && (
                  <p className={stop.overCapacity ? 'race-late' : undefined}>{stop.leaveWith}</p>
                )}
                {stop.cutoff && (
                  <p
                    className={
                      stop.cutoffMissed ? 'race-card-detail race-late' : 'race-card-detail'
                    }
                  >
                    {stop.cutoff}
                  </p>
                )}
                {stop.details && <p className="race-card-detail">{stop.details}</p>}
              </div>
            </li>
          ))}
        </ol>
        {card.cues.length > 0 && (
          <div>
            <div className="race-kicker">During the race</div>
            <ul className="race-card-cues">
              {card.cues.map((cue, index) => (
                <li key={`${cue.when}-${index}`}>
                  <strong>{cue.when}</strong>: {cue.text}
                </li>
              ))}
            </ul>
          </div>
        )}
        {card.food && (
          <p>
            <strong>Food</strong> · {card.food}
          </p>
        )}
        {card.recovery && (
          <div>
            <div className="race-kicker">Recovery</div>
            <p className="race-card-text">{card.recovery}</p>
          </div>
        )}
      </section>
    </div>
  );
}
