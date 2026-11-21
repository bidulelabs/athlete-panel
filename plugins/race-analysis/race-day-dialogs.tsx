'use client';

import {
  Button,
  Checkbox,
  ErrorMessage,
  Field,
  Input,
  Modal,
  NativeSelect,
  SubmitButton,
  Textarea,
  useAction,
} from '@athlete-panel/ui';
import type { RacePlan } from '@athlete-panel/contracts';
import { distanceFieldText, startAndCutoffFromForm, stationFromForm } from './race-plan-form';

type Station = RacePlan['stations'][number];
type ActionState = ReturnType<typeof useAction>;

function CutoffFields({
  field,
  label,
  cutoff,
  readOnly,
}: {
  field: string;
  label: string;
  cutoff: RacePlan['finishCutoff'];
  readOnly: boolean;
}) {
  return (
    <fieldset className="race-cutoff-fields">
      <legend>{label}</legend>
      <Field label="Day">
        <NativeSelect
          name={`${field}Day`}
          defaultValue={cutoff?.dayOffset ?? 0}
          disabled={readOnly}
        >
          <option value={0}>Race day</option>
          {[1, 2, 3, 4, 5, 6].map((dayOffset) => (
            <option key={dayOffset} value={dayOffset}>
              {dayOffset === 1 ? 'Next day' : `${dayOffset} days after`}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Time" hint="Leave empty for no cutoff.">
        <Input
          type="time"
          name={`${field}Time`}
          defaultValue={cutoff?.time ?? ''}
          readOnly={readOnly}
        />
      </Field>
    </fieldset>
  );
}

function DialogActions({ action, onClose }: { action: ActionState; onClose: () => void }) {
  return (
    <>
      <ErrorMessage error={action.error} />
      <div className="dialog-actions">
        <Button type="button" variant="outline" onClick={onClose} disabled={action.busy}>
          Cancel
        </Button>
        <SubmitButton busy={action.busy} />
      </div>
    </>
  );
}

export function StartAndCutoffDialog({
  racePlan,
  timezone,
  onSave,
  onClose,
}: {
  racePlan: RacePlan | undefined;
  timezone: string | undefined;
  onSave: (values: Pick<RacePlan, 'startTime' | 'finishCutoff'>) => Promise<unknown>;
  onClose: () => void;
}) {
  const action = useAction();
  return (
    <Modal
      open
      onClose={() => !action.busy && onClose()}
      title="Start and finish cutoff"
      description={`Wall-clock times${timezone ? ` in ${timezone}` : ''}.`}
      className="race-dialog"
    >
      <form
        className="dialog-body race-form"
        onSubmit={(event) => {
          event.preventDefault();
          const values = startAndCutoffFromForm(new FormData(event.currentTarget));
          void action.run(() => onSave(values), onClose);
        }}
      >
        <Field label="Start time" hint="Leave empty if it is not known yet.">
          <Input
            type="time"
            name="startTime"
            defaultValue={racePlan?.startTime ?? ''}
            readOnly={action.busy}
          />
        </Field>
        <CutoffFields
          field="finishCutoff"
          label="Finish cutoff"
          cutoff={racePlan?.finishCutoff ?? null}
          readOnly={action.busy}
        />
        <DialogActions action={action} onClose={onClose} />
      </form>
    </Modal>
  );
}

export function StationDialog({
  existingStation,
  units,
  onSave,
  onClose,
}: {
  existingStation: Station | undefined;
  units: string;
  onSave: (station: Station) => Promise<unknown>;
  onClose: () => void;
}) {
  const action = useAction();
  return (
    <Modal
      open
      onClose={() => !action.busy && onClose()}
      title={existingStation ? `Edit ${existingStation.name}` : 'Add aid station'}
      description="Copy what the race guide says. Stations are kept in course order."
      className="race-dialog"
    >
      <form
        className="dialog-body race-form"
        onSubmit={(event) => {
          event.preventDefault();
          const station = stationFromForm(
            new FormData(event.currentTarget),
            existingStation,
            units,
          );
          void action.run(() => onSave(station), onClose);
        }}
      >
        <Field label="Name">
          <Input
            name="name"
            required
            maxLength={80}
            defaultValue={existingStation?.name ?? ''}
            readOnly={action.busy}
          />
        </Field>
        <Field label={`Distance from the start (${units === 'imperial' ? 'mi' : 'km'})`}>
          <Input
            name="distance"
            type="number"
            required
            min={0}
            step="any"
            inputMode="decimal"
            defaultValue={
              existingStation ? distanceFieldText(existingStation.distanceMeters, units) : ''
            }
            readOnly={action.busy}
          />
        </Field>
        <CutoffFields
          field="cutoff"
          label="Cutoff"
          cutoff={existingStation?.cutoff ?? null}
          readOnly={action.busy}
        />
        <Field label="Planned stop (minutes)">
          <Input
            name="stopMinutes"
            type="number"
            required
            min={0}
            max={1440}
            step={1}
            defaultValue={existingStation ? Math.round(existingStation.stopSeconds / 60) : 0}
            readOnly={action.busy}
          />
        </Field>
        <fieldset className="race-dialog-group">
          <legend>What the station offers</legend>
          <label className="checkbox-row">
            <Checkbox
              name="water"
              defaultChecked={existingStation?.water ?? false}
              disabled={action.busy}
            />
            Water at this station
          </label>
          <Field label="Food offered">
            <Input
              name="food"
              maxLength={200}
              defaultValue={existingStation?.food ?? ''}
              readOnly={action.busy}
            />
          </Field>
        </fieldset>
        <Field label="What you do">
          <Textarea
            name="action"
            rows={2}
            maxLength={300}
            defaultValue={existingStation?.action ?? ''}
            readOnly={action.busy}
          />
        </Field>
        <fieldset className="race-dialog-group">
          <legend>Where this comes from</legend>
          <Field label="Source" hint="Such as the race guide or an email from the organizer.">
            <Input
              name="source"
              maxLength={120}
              defaultValue={existingStation?.source ?? ''}
              readOnly={action.busy}
            />
          </Field>
          <label className="checkbox-row">
            <Checkbox
              name="verified"
              defaultChecked={existingStation?.verified ?? false}
              disabled={action.busy}
            />
            Confirmed by the organizer or the race guide
          </label>
        </fieldset>
        <DialogActions action={action} onClose={onClose} />
      </form>
    </Modal>
  );
}
