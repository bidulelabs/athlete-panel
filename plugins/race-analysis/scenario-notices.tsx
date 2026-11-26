'use client';

import { Button } from '@athlete-panel/ui';
import type { ScenarioColumn } from './scenario-comparison';
import { scenarioNotices } from './scenarios';

export function ScenarioNotices({
  columns,
  onReviewStops,
}: {
  columns: ScenarioColumn[];
  onReviewStops: (scenarioId: string) => void;
}) {
  return (
    <>
      {columns.flatMap(({ scenario, outcome, outdatedReasons }) =>
        scenarioNotices(scenario, outcome, outdatedReasons).map(({ kind, title, body }) => (
          <div
            key={`${scenario.id}-${kind}`}
            className={`race-data-notice${kind === 'missed-cutoffs' ? ' race-notice-danger' : ''}`}
            role="status"
          >
            <strong>{title}</strong>
            <p>{body}</p>
            {kind === 'outdated' && (
              <Button variant="outline" onClick={() => onReviewStops(scenario.id)}>
                Review stops
              </Button>
            )}
          </div>
        )),
      )}
    </>
  );
}

export function ScenarioExplanations() {
  return (
    <>
      <div className="race-data-notice" role="note">
        <strong>Ranges are not guarantees</strong>
        <p>
          Each range comes from your course estimate. Effort and weather are your own assumptions:
          the app does not model heat or forecast the weather.
        </p>
      </div>
      <details className="race-disclosure">
        <summary>
          <span>How this is worked out</span>
          <small>Effort, weather, stops and ranges</small>
        </summary>
        <ul className="race-disclosure-body">
          <li>
            Effort and weather change moving time only, by the percentages you enter. Each
            station&apos;s stop is added to the moving time, once, at that station.
          </li>
          <li>
            The range widens or narrows with moving time, as in the course estimate. Margins use the
            latest arrival.
          </li>
          <li>What to carry uses the same leg times and products as Race day.</li>
          <li>
            A scenario is marked outdated when the course, or the plan&apos;s stations, stops,
            effort or weather changed after you saved it.
          </li>
        </ul>
      </details>
    </>
  );
}
