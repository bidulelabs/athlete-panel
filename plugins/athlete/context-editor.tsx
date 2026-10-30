'use client';

import type { CommandInput, Schedule } from '@athlete-panel/contracts';
import {
  Button,
  ErrorMessage,
  Field,
  Input,
  localDate,
  Modal,
  NativeSelect,
  requestId,
  SubmitButton,
  Textarea,
  useAction,
  useWorkspace,
} from '@athlete-panel/ui';
import { useState, type FormEvent } from 'react';
import { mutate, ScheduleFields } from '../training/public/client';

export type ContextKind = 'note' | 'event' | 'injury';
export function ContextEditor({
  kind,
  record,
  defaultDate,
  onClose,
}: {
  kind: ContextKind;
  record?: any;
  defaultDate?: string;
  onClose: () => void;
}) {
  const { data, request } = useWorkspace();
  const [schedule, setSchedule] = useState<Schedule>(
    record?.schedule ?? { kind: 'independent', date: defaultDate ?? localDate() },
  );
  const action = useAction();
  const [key] = useState(requestId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    const values =
      kind === 'note'
        ? { title: value('title'), body: value('body'), schedule }
        : kind === 'event'
          ? {
              title: value('title'),
              date: value('date'),
              kind: value('kind'),
              notes: value('notes'),
            }
          : {
              bodyPart: value('bodyPart'),
              description: value('description'),
              startDate: value('startDate'),
              endDate: value('endDate') || null,
              severity: value('severity'),
              notes: value('notes'),
            };
    const command = record
      ? { action: `${kind}.update`, id: record.id, expectedRevision: record.revision, values }
      : { action: `${kind}.create`, values };
    await action.run(() => mutate(request, [command as CommandInput], key), onClose);
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`${record ? 'Edit' : 'Add'} ${kind === 'injury' ? 'injury constraint' : kind}`}
      description={
        kind === 'injury'
          ? 'Keep your training constraints visible when planning.'
          : kind === 'event'
            ? 'Put a race, goal, or important date on your calendar.'
            : 'A little context for your training week.'
      }
    >
      <form className="dialog-body" onSubmit={submit}>
        {kind !== 'injury' && (
          <Field label="Title">
            <Input
              autoFocus
              required
              name="title"
              maxLength={255}
              defaultValue={record?.title ?? ''}
              placeholder={kind === 'note' ? 'e.g. Travel day' : 'e.g. Autumn half marathon'}
            />
          </Field>
        )}
        {kind === 'note' && (
          <>
            <Field label="Note" hint="Markdown supported">
              <Textarea name="body" maxLength={20000} rows={4} defaultValue={record?.body ?? ''} />
            </Field>
            <ScheduleFields schedule={schedule} onChange={setSchedule} plans={data.plans} />
          </>
        )}
        {kind === 'event' && (
          <>
            <div className="form-grid">
              <Field label="Date">
                <Input
                  required
                  type="date"
                  name="date"
                  defaultValue={record?.date ?? defaultDate ?? localDate()}
                />
              </Field>
              <Field label="Event type">
                <NativeSelect name="kind" defaultValue={record?.kind ?? 'goal'}>
                  <option value="goal">Goal</option>
                  <option value="race">Race</option>
                  <option value="other">Other</option>
                </NativeSelect>
              </Field>
            </div>
            <Field label="Notes" hint="Markdown supported">
              <Textarea name="notes" rows={3} maxLength={4000} defaultValue={record?.notes ?? ''} />
            </Field>
          </>
        )}
        {kind === 'injury' && (
          <>
            <Field label="Body area">
              <Input
                autoFocus
                required
                name="bodyPart"
                maxLength={255}
                placeholder="e.g. Left knee"
                defaultValue={record?.bodyPart ?? ''}
              />
            </Field>
            <Field label="Constraint or description" hint="Markdown supported">
              <Textarea
                name="description"
                maxLength={4000}
                rows={3}
                placeholder="What should you take into account?"
                defaultValue={record?.description ?? ''}
              />
            </Field>
            <div className="form-grid">
              <Field label="Start date">
                <Input
                  required
                  type="date"
                  name="startDate"
                  defaultValue={record?.startDate ?? defaultDate ?? localDate()}
                />
              </Field>
              <Field label="End date" hint="Leave blank while ongoing.">
                <Input type="date" name="endDate" defaultValue={record?.endDate ?? ''} />
              </Field>
            </div>
            <Field label="Severity">
              <NativeSelect name="severity" defaultValue={record?.severity ?? 'mild'}>
                <option value="mild">Mild</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
              </NativeSelect>
            </Field>
            <Field label="Additional notes" hint="Markdown supported">
              <Textarea name="notes" maxLength={4000} rows={2} defaultValue={record?.notes ?? ''} />
            </Field>
          </>
        )}
        <ErrorMessage error={action.error} />
        <div className="dialog-actions">
          <Button variant="outline" type="button" className="button" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton busy={action.busy}>{record ? 'Save changes' : `Add ${kind}`}</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
