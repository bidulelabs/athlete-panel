'use client';

import { useState, useSyncExternalStore } from 'react';
import { Badge, Field, NativeSelect, duration } from '@athlete-panel/ui';
import type { RacePlan, RaceScenario } from '@athlete-panel/contracts';
import { litres } from './carry';
import {
  arrivalRangeLabel,
  clockTime,
  cutoffMarginText,
  effortAndWeatherText,
  finishTime,
} from './presentation';
import { heaviestLeg, type ScenarioOutcome, type scenarioChanges } from './scenarios';

export type ScenarioAction = 'Edit' | 'Duplicate' | 'Delete';
export type ScenarioColumn = {
  scenario: RaceScenario;
  outcome: ScenarioOutcome;
  changes: ReturnType<typeof scenarioChanges>;
  outdatedReasons: string[];
};

type CellNote = { text: string; late?: boolean };
type ComparisonCell = { main: string; late?: boolean; notes?: CellNote[] };
type Changes = ScenarioColumn['changes'] | null;

export const finishText = ({ finish }: ScenarioOutcome) =>
  finish.timeOfDay
    ? clockTime(finish.timeOfDay.seconds)
    : finish.fromStart
      ? `${finishTime(finish.fromStart.seconds)} after the start`
      : 'Unknown';

const assumptionText = (
  assumption: Pick<RacePlan, 'effortPercent' | 'weatherPercent'>,
  { stopSeconds }: ScenarioOutcome,
  noChangeText: string,
) => `${effortAndWeatherText(assumption) ?? noChangeText} · ${duration(stopSeconds)} of stops`;

const marginNote = (arrival: Pick<ScenarioOutcome['finish'], 'cutoffMarginSeconds'>) =>
  arrival.cutoffMarginSeconds === null
    ? []
    : [{ text: cutoffMarginText(arrival)!, late: arrival.cutoffMarginSeconds < 0 }];

function finishCell(outcome: ScenarioOutcome, changes: Changes): ComparisonCell {
  const range = arrivalRangeLabel(outcome.finish)?.range;
  const delta = changes?.finishDeltaMinutes ?? null;
  const deltaText =
    delta === null
      ? null
      : delta === 0
        ? 'Same as the plan'
        : `${duration(Math.abs(delta) * 60)} ${delta > 0 ? 'later' : 'earlier'}`;
  return {
    main: finishText(outcome),
    notes: [
      ...(deltaText ? [{ text: deltaText }] : []),
      ...(range ? [{ text: `range ${range}` }] : []),
    ],
  };
}

function carryCell({ carry }: ScenarioOutcome): ComparisonCell {
  if (!carry) return { main: 'Unknown' };
  const { leg: heaviest, label: legName } = heaviestLeg(carry);
  if (heaviest.waterNeededMillilitres === null) return { main: 'No water need set' };
  const capacity = carry.carryCapacityMillilitres;
  return {
    main: `${legName.replace(/^./, (first) => first.toUpperCase())} needs ${litres(heaviest.waterNeededMillilitres)}`,
    notes: [
      {
        text: capacity === null ? 'no bottle size set' : `bottles hold ${litres(capacity)}`,
        late: heaviest.waterOverCapacity,
      },
    ],
  };
}

function comparisonRows(planOutcome: ScenarioOutcome) {
  const planFinish = planOutcome.finish;
  return [
    { key: 'finish', label: 'Expected finish', cell: finishCell },
    {
      key: 'time',
      label: 'Moving · stopped',
      cell: ({ movingSeconds, stopSeconds }: ScenarioOutcome): ComparisonCell => ({
        main: `${movingSeconds === null ? 'Unknown' : duration(movingSeconds)} · ${duration(stopSeconds)}`,
      }),
    },
    ...(planFinish.cutoffSeconds === null
      ? []
      : [
          {
            key: 'finish-cutoff',
            label: `Finish cutoff ${clockTime(planFinish.cutoffSeconds)}`,
            cell: ({ finish }: ScenarioOutcome): ComparisonCell => ({
              main: cutoffMarginText(finish) ?? 'Unknown',
              late: finish.cutoffMarginSeconds !== null && finish.cutoffMarginSeconds < 0,
            }),
          },
        ]),
    ...planOutcome.cutoffs.map((planCutoff) => ({
      key: planCutoff.stationId,
      label: `${planCutoff.name} · cutoff ${clockTime(planCutoff.cutoffSeconds!)}`,
      cell: ({ cutoffs }: ScenarioOutcome): ComparisonCell => {
        const cutoff = cutoffs.find((candidate) => candidate.stationId === planCutoff.stationId)!;
        return {
          main: cutoff.timeOfDay
            ? `${clockTime(cutoff.timeOfDay.seconds)} · latest ${clockTime(cutoff.timeOfDay.highSeconds)}`
            : 'Unknown',
          notes: marginNote(cutoff),
        };
      },
    })),
    {
      key: 'carry',
      label: 'What to carry',
      cell: carryCell,
    },
  ];
}

function CellView({ cell, planCell }: { cell: ComparisonCell; planCell?: ComparisonCell }) {
  const notes: CellNote[] = [
    ...(cell.notes ?? []),
    ...(planCell
      ? [
          {
            text: `plan: ${[planCell.main, ...(planCell.notes ?? []).map((note) => note.text)].join(' · ')}`,
            late: planCell.late || planCell.notes?.some((note) => note.late),
          },
        ]
      : []),
  ];
  return (
    <>
      <span className={cell.late ? 'race-late' : undefined}>{cell.main}</span>
      {notes.map((note) => (
        <small key={note.text} className={note.late ? 'race-late' : undefined}>
          {note.text}
        </small>
      ))}
    </>
  );
}

const WhyItChanges = ({ reasons }: { reasons: string[] }) =>
  reasons.length === 0 ? (
    <>No change from the plan</>
  ) : (
    <ul className="race-assumptions">
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  );

const subscribeToPhoneWidth = (notify: () => void) => {
  const query = window.matchMedia('(max-width: 760px)');
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const isPhoneWidth = () => window.matchMedia('(max-width: 760px)').matches;

export function ScenarioComparison({
  planOutcome,
  racePlan,
  columns,
  atLimit,
  busy,
  onAction,
}: {
  planOutcome: ScenarioOutcome;
  racePlan: RacePlan;
  columns: ScenarioColumn[];
  atLimit: boolean;
  busy: boolean;
  onAction: (scenario: RaceScenario, action: ScenarioAction) => void;
}) {
  const isPhone = useSyncExternalStore(subscribeToPhoneWidth, isPhoneWidth, () => false);
  const [selectedScenarioId, setSelectedScenarioId] = useState('');
  const selectedColumn =
    columns.find((column) => column.scenario.id === selectedScenarioId) ?? columns[0]!;
  const visibleColumns = isPhone ? [selectedColumn] : columns;
  const rows = comparisonRows(planOutcome);
  const assumptionSummary = ({ scenario, outcome }: ScenarioColumn) =>
    assumptionText(scenario, outcome, 'No effort or weather change');
  const actions = ({ scenario }: ScenarioColumn) => (
    <NativeSelect
      aria-label={`${scenario.name} actions`}
      aria-describedby={atLimit ? 'race-scenario-limit' : undefined}
      value=""
      disabled={busy}
      onChange={(event) => onAction(scenario, event.target.value as ScenarioAction)}
    >
      <option value="">Actions</option>
      <option value="Edit">Edit</option>
      <option value="Duplicate" disabled={atLimit}>
        Duplicate
      </option>
      <option value="Delete">Delete</option>
    </NativeSelect>
  );
  return (
    <>
      {isPhone && (
        <Field label="Scenario">
          <NativeSelect
            value={selectedColumn.scenario.id}
            onChange={(event) => setSelectedScenarioId(event.target.value)}
          >
            {columns.map((column) => (
              <option key={column.scenario.id} value={column.scenario.id}>
                {column.scenario.name} · {assumptionSummary(column)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <div className="race-scenario-scroll">
        <table className="race-scenario-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Measure</span>
              </th>
              {!isPhone && (
                <th scope="col" className="race-scenario-plan">
                  <strong>Current plan</strong>
                  <small>{assumptionText(racePlan, planOutcome, 'Estimate as is')}</small>
                </th>
              )}
              {visibleColumns.map((column) => (
                <th key={column.scenario.id} scope="col">
                  <strong>{column.scenario.name}</strong>
                  {column.outdatedReasons.length > 0 && <Badge variant="outline">Outdated</Badge>}
                  <small>{assumptionSummary(column)}</small>
                  {actions(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {!isPhone && (
                  <td className="race-scenario-plan">
                    <CellView cell={row.cell(planOutcome, null)} />
                  </td>
                )}
                {visibleColumns.map((column) => (
                  <td key={column.scenario.id}>
                    <CellView
                      cell={row.cell(column.outcome, column.changes)}
                      planCell={isPhone ? row.cell(planOutcome, null) : undefined}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {!isPhone && (
              <tr>
                <th scope="row">Why it changes</th>
                <td className="race-scenario-plan">The reference</td>
                {columns.map((column) => (
                  <td key={column.scenario.id}>
                    <WhyItChanges reasons={column.changes.reasons} />
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {isPhone && (
        <details className="race-disclosure">
          <summary>Why it changes</summary>
          <div className="race-disclosure-body">
            <WhyItChanges reasons={selectedColumn.changes.reasons} />
          </div>
        </details>
      )}
    </>
  );
}
