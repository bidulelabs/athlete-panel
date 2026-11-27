'use client';

import { useState } from 'react';
import { Modal, duration, useAction } from '@athlete-panel/ui';
import type { CommandInput, RacePlan, RaceScenario } from '@athlete-panel/contracts';
import { signedPercent, arrivalRangeLabel } from './presentation';
import { finishText } from './scenario-comparison';
import { DialogActions } from './race-day-dialogs';
import { applyScenarioCommand } from './scenario-form';
import { planChanges, type PlanChange, type ScenarioOutcome } from './scenarios';

function planChangeRow(change: PlanChange) {
  switch (change.field) {
    case 'stop':
      return {
        key: change.stationId,
        label: `${change.name} stop`,
        now: duration(change.from),
        after: duration(change.to),
      };
    case 'weatherNote':
      return {
        key: change.field,
        label: 'Weather note',
        now: change.from || '—',
        after: change.to || '—',
      };
    default:
      return {
        key: change.field,
        label: change.field === 'effortPercent' ? 'Effort' : 'Weather',
        now: signedPercent(change.from),
        after: signedPercent(change.to),
      };
  }
}

export function ApplyScenarioDialog({
  scenario,
  racePlan,
  planOutcome,
  outcome,
  blockedReason,
  reloadedPreview,
  onApply,
  onClose,
}: {
  scenario: RaceScenario;
  racePlan: RacePlan;
  planOutcome: ScenarioOutcome;
  outcome: ScenarioOutcome;
  blockedReason: string | null;
  reloadedPreview: (
    scenario: RaceScenario,
  ) => Promise<{ planOutcome: ScenarioOutcome; outcome: ScenarioOutcome }>;
  onApply: (command: CommandInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const action = useAction();
  const [opened, setOpened] = useState({ scenario, plan: racePlan, planOutcome, outcome });
  const finishBefore = finishText(opened.planOutcome);
  const finishAfter = finishText(opened.outcome);
  const range = arrivalRangeLabel(opened.outcome.finish)?.range;
  return (
    <Modal
      open
      onClose={() => !action.busy && onClose()}
      title={`Apply “${opened.scenario.name}” to the plan`}
      description="Review what changes in the race plan before saving."
      className="race-dialog"
    >
      <form
        className="dialog-body race-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            const latest = await reloadedPreview(opened.scenario);
            if (
              JSON.stringify([latest.planOutcome.finish, latest.outcome.finish]) !==
              JSON.stringify([opened.planOutcome.finish, opened.outcome.finish])
            ) {
              setOpened({ ...opened, ...latest });
              throw new Error(
                'The estimate changed since you opened this. Review the new preview, then apply.',
              );
            }
            await onApply(applyScenarioCommand(opened.plan, opened.scenario));
          }, onClose);
        }}
      >
        <table className="race-stations">
          <thead>
            <tr>
              <th scope="col">In the plan</th>
              <th scope="col">Now</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {planChanges(opened.plan, opened.scenario)
              .map(planChangeRow)
              .map(({ key, label, now, after }) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td data-label="Now" className="race-was">
                    {now}
                  </td>
                  <td data-label="After">
                    <strong>{after}</strong>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="race-hint">
          {finishBefore === finishAfter
            ? `Expected finish stays ${finishAfter}`
            : `Expected finish moves from ${finishBefore} to ${finishAfter}`}
          {range ? ` (range ${range})` : ''}. Briefing, pacing, nutrition and the other stations
          stay as they are.
        </p>
        <div className="race-data-notice" role="note">
          <p>
            Applying changes the plan. An assistant proposal waiting on it will need a fresh one.
          </p>
        </div>
        <p className="race-hint">You can undo this from History.</p>
        {blockedReason && <p className="race-hint">{blockedReason}</p>}
        <DialogActions
          action={action}
          onClose={onClose}
          submitLabel="Apply to plan"
          submitDisabled={blockedReason !== null}
        />
      </form>
    </Modal>
  );
}
