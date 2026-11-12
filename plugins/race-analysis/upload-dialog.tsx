'use client';
import { useRef, useState } from 'react';
import { Button, ErrorMessage, Field, Input, Modal, NativeSelect } from '@athlete-panel/ui';
import { raceFileLimit, type RaceAnalysis, type RaceUploadInput } from '@athlete-panel/contracts';
import { terrainNames } from './presentation';
import { uploadRaceFile } from './use-analysis';

export function UploadDialog({
  value,
  purpose,
  onClose,
  onSaved,
  reload,
}: {
  value: RaceAnalysis;
  purpose: 'course' | 'reference';
  onClose: () => void;
  onSaved: () => Promise<void>;
  reload: () => Promise<unknown>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [title, setTitle] = useState(''),
    [duration, setDuration] = useState(''),
    [terrain, setTerrain] = useState(3);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [notice, setNotice] = useState('');
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  async function submit() {
    setError(null);
    setNotice('');
    if (!file || file.size === 0 || file.size > raceFileLimit) {
      setError(new Error('Choose a non-empty file up to 10 MiB.'));
      return;
    }
    const seconds = duration.trim() ? Number(duration) * 60 : null;
    if (seconds !== null && (!Number.isFinite(seconds) || seconds <= 0)) {
      setError(new Error('Enter a positive elapsed time in minutes.'));
      return;
    }
    const signature = JSON.stringify([
      file.name,
      file.size,
      file.lastModified,
      title,
      seconds,
      terrain,
      value.revision,
    ]);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    const base = {
      raceId: value.race.id,
      expectedRevision: value.revision,
      idempotencyKey: attempt.current.key,
    };
    const input: RaceUploadInput =
      purpose === 'course'
        ? { ...base, purpose }
        : { ...base, purpose, title, durationSeconds: seconds, terrain };
    setBusy(true);
    try {
      await uploadRaceFile(file, input);
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('The file could not be uploaded.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={
        purpose === 'reference'
          ? 'Add a past effort'
          : value.course
            ? 'Replace GPX course'
            : 'Upload GPX course'
      }
      description={
        purpose === 'reference'
          ? 'Use a comparable running or hiking effort. The original file stays on your server.'
          : 'One active course per race. The original file stays on your server.'
      }
      className="race-dialog"
    >
      <form
        className="dialog-body race-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label={purpose === 'course' ? 'GPX course file' : 'GPX or FIT effort file'}
          hint="Up to 10 MiB and 100,000 points. No provider connection is needed."
        >
          <Input
            type="file"
            accept={purpose === 'course' ? '.gpx' : '.gpx,.fit'}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              setFile(next);
              if (!title && next)
                setTitle(next.name.replace(/\.(gpx|fit)$/i, '').replaceAll('-', ' '));
            }}
          />
        </Field>
        {purpose === 'reference' && (
          <>
            <Field label="Effort name">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={160}
                required
                disabled={busy}
              />
            </Field>
            <Field
              label="Elapsed time (minutes)"
              hint="Include pauses. Leave blank to use file timestamps; files without a usable time can be completed later."
            >
              <Input
                type="number"
                min="0.01"
                max="43200"
                step="any"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                disabled={busy}
              />
            </Field>
            <Field label="Effort terrain">
              <NativeSelect
                value={terrain}
                onChange={(event) => setTerrain(Number(event.target.value))}
                disabled={busy}
              >
                {terrainNames.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {index + 1} · {name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </>
        )}
        {purpose === 'course' && value.course && (
          <p className="race-hint">
            The existing course stays active until the upload succeeds. Section terrain overrides
            reset for the new course; your reference efforts are kept.
          </p>
        )}
        {busy && <p role="status">Uploading and analysing {file?.name}…</p>}
        <ErrorMessage error={error?.message} />
        {error && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const fresh = await reload();
              setNotice(
                fresh
                  ? 'Saved data reloaded. Your draft is still here; check the saved course before retrying.'
                  : 'Reload failed. Your draft is still here.',
              );
              setBusy(false);
            }}
          >
            Reload saved data
          </Button>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="dialog-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !file}>
            {busy ? 'Analysing…' : purpose === 'reference' ? 'Add effort' : 'Use this course'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
