'use client';

import { useState } from 'react';
import { Field, Input, Modal, distance, duration, useAction } from '@athlete-panel/ui';
import type { CommandInput, RacePlan, RaceScenario } from '@athlete-panel/contracts';
import { DialogActions } from './race-day-dialogs';
import { changedScenarioValues, createScenarioCommand, stopMinutesText } from './scenario-form';
import { scenarioStations } from './scenarios';

type Draft = Pick<RaceScenario, 'effortPercent' | 'weatherPercent' | 'stops'>;

export function ScenarioDialog({
  scenario,
  racePlan,
  courseId,
  outdated,
  units,
  finishOf,
  onSave,
  onClose,
}: {
  scenario: RaceScenario | undefined;
  racePlan: RacePlan;
  courseId: string | null;
  outdated: boolean;
  units: string;
  finishOf: (draft: Draft) => string;
  onSave: (command: CommandInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const action = useAction();
  const [opened] = useState({ scenario, plan: racePlan, outdated });
  const stations = opened.scenario
    ? scenarioStations(opened.plan.stations, opened.scenario)
    : opened.plan.stations;
  const assumption = opened.scenario ?? opened.plan;
  const [typedEffort, setTypedEffort] = useState(String(assumption.effortPercent));
  const [typedWeather, setTypedWeather] = useState(String(assumption.weatherPercent));
  const [typedStopMinutes, setTypedStopMinutes] = useState(
    stations.map((station) => stopMinutesText(station.stopSeconds)),
  );
  const complete = [typedEffort, typedWeather, ...typedStopMinutes].every((text) => text !== '');
  return (
    <Modal
      open
      onClose={() => !action.busy && onClose()}
      title={scenario ? 'Edit scenario' : 'New scenario'}
      description="Starts from the plan. The plan does not change."
      className="race-dialog"
    >
      <form
        className="dialog-body race-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          if (!opened.scenario)
            return void action.run(
              () => onSave(createScenarioCommand(form, opened.plan, courseId)),
              onClose,
            );
          const changed = changedScenarioValues(
            form,
            { scenario: opened.scenario, plan: opened.plan, outdated: opened.outdated },
            { scenario: scenario!, plan: racePlan, courseId },
          );
          if (Object.keys(changed).length === 0) return onClose();
          void action.run(
            () =>
              onSave({
                action: 'raceScenario.update',
                id: scenario!.id,
                expectedRevision: scenario!.revision,
                values: changed,
              }),
            onClose,
          );
        }}
      >
        <Field label="Name">
          <Input
            name="name"
            required
            maxLength={80}
            defaultValue={opened.scenario?.name ?? ''}
            readOnly={action.busy}
          />
        </Field>
        <Field label="Effort (%)" hint="Positive is slower. Applied on moving time.">
          <Input
            type="number"
            name="effortPercent"
            required
            min={-30}
            max={50}
            step={0.5}
            inputMode="decimal"
            value={typedEffort}
            onChange={(event) => setTypedEffort(event.target.value)}
            readOnly={action.busy}
          />
        </Field>
        <Field label="Weather (%)" hint="Your own assumption, not a forecast.">
          <Input
            type="number"
            name="weatherPercent"
            required
            min={-20}
            max={50}
            step={0.5}
            inputMode="decimal"
            value={typedWeather}
            onChange={(event) => setTypedWeather(event.target.value)}
            readOnly={action.busy}
          />
        </Field>
        <Field label="Why this weather assumption">
          <Input
            name="weatherNote"
            maxLength={300}
            defaultValue={assumption.weatherNote}
            readOnly={action.busy}
          />
        </Field>
        {stations.length === 0 ? (
          <p className="race-hint">
            The plan has no aid stations yet, so there are no stops to change.
          </p>
        ) : (
          <table className="race-stations">
            <thead>
              <tr>
                <th scope="col">Station</th>
                <th scope="col">In the plan</th>
                <th scope="col">In this scenario</th>
              </tr>
            </thead>
            <tbody>
              {stations.map((station, index) => (
                <tr key={station.id}>
                  <th scope="row">
                    {station.name} · {distance(station.distanceMeters, units)}
                  </th>
                  <td data-label="In the plan">
                    {duration(
                      opened.plan.stations.find((planned) => planned.id === station.id)!
                        .stopSeconds,
                    )}
                  </td>
                  <td data-label="In this scenario">
                    <span className="race-rehearsal-amount">
                      <Input
                        type="number"
                        name="stopMinutes"
                        required
                        min={0}
                        max={1440}
                        step="any"
                        inputMode="decimal"
                        aria-label={`${station.name} stop in this scenario (minutes)`}
                        value={typedStopMinutes[index]}
                        onChange={(event) =>
                          setTypedStopMinutes(
                            typedStopMinutes.map((text, kept) =>
                              kept === index ? event.target.value : text,
                            ),
                          )
                        }
                        readOnly={action.busy}
                      />
                      min
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="race-hint" role="status">
          Finish:{' '}
          <strong>
            {complete
              ? finishOf({
                  effortPercent: Number(typedEffort),
                  weatherPercent: Number(typedWeather),
                  stops: stations.map((station, index) => ({
                    stationId: station.id,
                    stopSeconds: Math.round(Number(typedStopMinutes[index]) * 60),
                  })),
                })
              : 'enter every value'}
          </strong>
        </p>
        <DialogActions action={action} onClose={onClose} />
      </form>
    </Modal>
  );
}
