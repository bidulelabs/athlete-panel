'use client';
import { useState } from 'react';
import {
  Button,
  ErrorMessage,
  Field,
  Input,
  Modal,
  NativeSelect,
  distance,
  useConfirm,
  type ReloadableRequestError,
} from '@athlete-panel/ui';
import type { PluginRequest, RaceAnalysis, ReferenceEffort } from '@athlete-panel/contracts';
import { finishTime, elevationLabel, terrainNames } from './presentation';
import { raceRequestError } from './use-analysis';
import { referenceTimeProblem, usableReference } from './estimate';

function EditReference({
  value,
  reference,
  request,
  reload,
  onClose,
}: {
  value: RaceAnalysis;
  reference: ReferenceEffort;
  request: PluginRequest;
  reload: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(reference.title),
    [minutes, setMinutes] = useState(
      reference.durationSeconds === null ? '' : String(reference.durationSeconds / 60),
    ),
    [terrain, setTerrain] = useState(reference.terrain),
    [revision, setRevision] = useState(value.revision);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<ReloadableRequestError | null>(null);
  const saved = value.references.find((ref) => ref.id === reference.id);
  return (
    <Modal
      open
      title="Edit past effort"
      onClose={() => {
        if (!busy) onClose();
      }}
      className="race-dialog"
    >
      <form
        className="dialog-body race-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await request('race-analysis', 'reference-update', {
              raceId: value.race.id,
              expectedRevision: revision,
              idempotencyKey: crypto.randomUUID(),
              id: reference.id,
              title,
              terrain,
              durationSeconds: minutes.trim() ? Number(minutes) * 60 : null,
            });
            await reload();
            onClose();
          } catch (cause) {
            setError(raceRequestError(cause, reload));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Effort name">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={160}
            disabled={busy}
          />
        </Field>
        <Field
          label="Elapsed time (minutes)"
          hint="Include pauses. An effort without a time stays visible but is excluded from the estimate."
        >
          <Input
            type="number"
            min="0.01"
            max="43200"
            step="any"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label="Effort terrain">
          <NativeSelect
            value={terrain}
            onChange={(event) => setTerrain(Number(event.target.value))}
            disabled={busy}
          >
            {terrainNames.map((name, i) => (
              <option key={name} value={i + 1}>
                {i + 1} · {name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <ErrorMessage error={error} />
        {revision !== value.revision && (
          <div role="status">
            <p>
              Saved data changed. Your draft is retained.{' '}
              {saved
                ? 'Use the latest saved effort to start again.'
                : 'This effort was removed. Close this draft.'}
            </p>
            {saved && (
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setTitle(saved.title);
                  setMinutes(
                    saved.durationSeconds === null ? '' : String(saved.durationSeconds / 60),
                  );
                  setTerrain(saved.terrain);
                  setRevision(value.revision);
                  setError(null);
                }}
              >
                Use saved effort
              </Button>
            )}
          </div>
        )}
        <div className="dialog-actions">
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save effort'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function ReferenceEfforts({
  value,
  request,
  units,
  reload,
  onAdd,
}: {
  value: RaceAnalysis;
  request: PluginRequest;
  units: string;
  reload: () => Promise<unknown>;
  onAdd: () => void;
}) {
  const [editing, setEditing] = useState<ReferenceEffort | null>(null),
    [error, setError] = useState<ReloadableRequestError | null>(null),
    [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  return (
    <section className="race-evidence">
      <div className="race-section-heading">
        <h3>Reference efforts</h3>
        <Button variant="outline" onClick={onAdd} disabled={value.references.length >= 20 || busy}>
          Add a past effort
        </Button>
      </div>
      <p className="race-hint">
        Use comparable running or hiking efforts. Actual time includes pauses. Each prediction below
        excludes that effort from its fit; four usable efforts are needed for this independent
        check.
      </p>
      {!value.references.length && (
        <p>No past efforts yet. Upload GPX or FIT files to build a personal estimate.</p>
      )}
      <ul className="race-reference-list">
        {value.references.map((reference) => (
          <li key={reference.id}>
            <div className="race-reference-title">
              <strong>{reference.title}</strong>
              <span>
                {distance(reference.distanceMeters, units)} ·{' '}
                {elevationLabel(reference.ascentMeters, units)} climbing ·{' '}
                {terrainNames[reference.terrain - 1]}
              </span>
            </div>
            <dl>
              <div>
                <dt>Predicted</dt>
                <dd>{finishTime(reference.predictedSeconds)}</dd>
              </div>
              <div>
                <dt>Actual elapsed</dt>
                <dd>{finishTime(reference.durationSeconds)}</dd>
              </div>
            </dl>
            <div className="race-reference-actions">
              <Button
                variant="ghost"
                onClick={() => setEditing(reference)}
                disabled={busy}
                aria-label={`Edit ${reference.title}`}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                aria-label={`Remove ${reference.title}`}
                onClick={async () => {
                  if (
                    !(await confirm(
                      `Remove ${reference.title} from this race's estimate? Its original file remains stored.`,
                      'Remove effort',
                    ))
                  )
                    return;
                  setBusy(true);
                  setError(null);
                  try {
                    await request('race-analysis', 'reference-remove', {
                      raceId: value.race.id,
                      expectedRevision: value.revision,
                      id: reference.id,
                      idempotencyKey: crypto.randomUUID(),
                    });
                    await reload();
                  } catch (cause) {
                    setError(raceRequestError(cause, reload));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove
              </Button>
            </div>
            {!usableReference(reference) && (
              <p className="race-reference-note">
                Not used in the estimate:{' '}
                {reference.durationSeconds === null
                  ? 'elapsed time is missing'
                  : reference.ascentMeters === null
                    ? 'elevation is incomplete'
                    : reference.hasGaps
                      ? 'the track contains gaps'
                      : (referenceTimeProblem(
                          reference.distanceMeters,
                          reference.durationSeconds,
                        ) ?? 'the track is too short')}
                .
              </p>
            )}
            <small className="race-reference-note">
              {reference.durationSource === 'owner'
                ? 'Time entered by you'
                : reference.durationSource === 'file'
                  ? 'Time read from file'
                  : 'Time needed'}{' '}
              · {reference.filename}
            </small>
          </li>
        ))}
      </ul>
      <ErrorMessage error={error} />
      {editing && (
        <EditReference
          value={value}
          reference={editing}
          request={request}
          reload={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
