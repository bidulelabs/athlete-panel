'use client';

import type { CommandInput, EntityChange } from '@athlete-panel/contracts';
import {
  AddButton,
  Alert,
  Button,
  dateLabel,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  MarkdownContent,
  OperationalStatus,
  orderedWeekdays,
  PageHeader,
  resolveWeekStartsOn,
  SubmitButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useAction,
  useConfirm,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import {
  Check,
  Edit3,
  Flag,
  HeartPulse,
  NotebookPen,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { mutate } from '../training/public/client';
import { effectiveDate } from '../training/public/shared';
import { OnboardingDialog, OnboardingResume } from './onboarding-client';
import { PreferenceFields, suggestedPreferences } from './preferences';
export const contributions = { welcome: OnboardingDialog };

import { ContextEditor, type ContextKind } from './context-editor';
function ProfileForm({ data, request }: PluginPageProps) {
  // A refresh must never advance the revision attached to an unsaved draft.
  const [profile, setProfile] = useState(data.profile);
  const stale = (data.profile?.revision ?? 0) > (profile?.revision ?? 0);
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [preferences, setPreferences] = useState(() => suggestedPreferences(profile, detected));
  const weekPreference = preferences.weekStartsOnPreference;
  const days = orderedWeekdays(resolveWeekStartsOn(weekPreference, navigator.language));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const zones = (name: string) =>
      String(form.get(name) ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map(Number);
    const values = {
      displayName: String(form.get('displayName')),
      timezone: String(form.get('timezone')),
      units: String(form.get('units')) as 'metric' | 'imperial',
      language: 'en' as const,
      weekStartsOnPreference: weekPreference,
      goals: String(form.get('goals')),
      ftpWatts: form.get('ftpWatts') ? Number(form.get('ftpWatts')) : null,
      heartRateZones: { cycling: zones('cyclingZones'), running: zones('runningZones') },
      weeklyAvailability: Object.fromEntries(
        days.map((day) => [day, Math.round(Number(form.get(day) ?? 0) * 3600)]),
      ) as any,
    };
    await action.run(async () => {
      const result = await mutate(request, [
        { action: 'profile.set', expectedRevision: profile?.revision ?? null, values },
      ]);
      const next = (result.changes as EntityChange[]).find(
        (change) => change.entity === 'profile',
      )?.after;
      if (next && 'timezone' in next) setProfile(next);
      setSaved(true);
    });
  }
  return (
    <div className="profile-layout">
      <form key={profile?.revision ?? 'new'} onSubmit={submit}>
        <section className="profile-form-section">
          <h2>Athlete profile</h2>
          <p>These preferences apply throughout your workspace.</p>
          {stale && (
            <Alert className="callout" role="status">
              <p>
                This profile changed elsewhere. Your draft is preserved. Copy anything you want to
                keep before loading the saved version.
              </p>
              <Button
                variant="outline"
                type="button"
                className="button"
                disabled={action.busy}
                onClick={() => {
                  setProfile(data.profile);
                  setPreferences(suggestedPreferences(data.profile, detected));
                  setSaved(false);
                  action.setError(null);
                }}
              >
                Load saved profile
              </Button>
            </Alert>
          )}
          <div className="form-grid">
            <Field label="Display name">
              <Input
                required
                name="displayName"
                defaultValue={profile?.displayName ?? ''}
                placeholder="Your name"
                maxLength={255}
              />
            </Field>
          </div>
          <PreferenceFields value={preferences} onChange={setPreferences} detected={detected} />
          <Field label="Training goals">
            <Textarea
              name="goals"
              rows={3}
              maxLength={4000}
              defaultValue={profile?.goals ?? ''}
              placeholder="What are you working toward?"
            />
          </Field>
        </section>
        <section className="profile-form-section">
          <h2>Weekly availability</h2>
          <p>Available training hours for a typical week.</p>
          <div className="availability-grid">
            {days.map((day) => (
              <Field label={day.slice(0, 3).replace(/^./, (s) => s.toUpperCase())} key={day}>
                <Input
                  type="number"
                  step="0.25"
                  min="0"
                  max="24"
                  name={day}
                  aria-label={`${day} available hours`}
                  defaultValue={(profile?.weeklyAvailability[day] ?? 0) / 3600}
                />
              </Field>
            ))}
          </div>
        </section>
        <section className="profile-form-section">
          <h2>Training zones</h2>
          <p>Use your own measured zones. Leave unknown values blank.</p>
          <div className="form-grid">
            <Field
              label="Cycling heart-rate zones"
              hint="Ascending upper bounds in bpm, separated by commas."
            >
              <Input
                name="cyclingZones"
                placeholder="e.g. 120, 140, 155, 170, 185"
                defaultValue={profile?.heartRateZones.cycling.join(', ') ?? ''}
              />
            </Field>
            <Field
              label="Running heart-rate zones"
              hint="Ascending upper bounds in bpm, separated by commas."
            >
              <Input
                name="runningZones"
                placeholder="e.g. 125, 145, 160, 175, 190"
                defaultValue={profile?.heartRateZones.running.join(', ') ?? ''}
              />
            </Field>
          </div>
          <Field label="Cycling FTP · watts">
            <Input
              type="number"
              min="1"
              max="3000"
              step="1"
              name="ftpWatts"
              placeholder="Unknown"
              defaultValue={profile?.ftpWatts ?? ''}
            />
          </Field>
        </section>
        <ErrorMessage error={action.error} />
        {saved && (
          <div className="success-message" role="status">
            <Check size={15} />
            Profile saved.
          </div>
        )}
        <SubmitButton busy={action.busy}>Save profile</SubmitButton>
      </form>
      <aside className="context-panel">
        <UserRound size={24} />
        <h3>Your training context</h3>
        <p>
          Your goals, availability, and zones help you plan consistently. External agents receive
          only the context you choose to share through an access grant.
        </p>
        <div className="info-line">
          <ShieldCheck size={15} />
          <span>Stored on your private instance.</span>
        </div>
      </aside>
    </div>
  );
}

export default function AthletePage(props: PluginPageProps) {
  const confirm = useConfirm();
  const { envelope } = useWorkspace();
  const { data, request } = props;
  const [tab, setTab] = useState<'profile' | 'notes' | 'events' | 'injuries'>('profile');
  const [editing, setEditing] = useState<{ kind: ContextKind; record?: any } | null>(null);
  const action = useAction();
  const kind: ContextKind = tab === 'notes' ? 'note' : tab === 'events' ? 'event' : 'injury';
  const records = tab === 'notes' ? data.notes : tab === 'events' ? data.events : data.injuries;
  return (
    <>
      <PageHeader
        eyebrow="THE ATHLETE BEHIND THE TRAINING"
        title="Athlete & context"
        description="Your preferences, goals, and the details that shape your plan."
        actions={
          tab !== 'profile' && (
            <AddButton onClick={() => setEditing({ kind })}>Add {kind}</AddButton>
          )
        }
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList className="workspace-tabs" aria-label="Athlete settings">
          {(['profile', 'notes', 'events', 'injuries'] as const).map((value) => (
            <TabsTrigger key={value} value={value}>
              {value === 'profile'
                ? 'Profile & zones'
                : value === 'injuries'
                  ? 'Injury constraints'
                  : value.replace(/^./, (s) => s.toUpperCase())}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab}>
          {tab === 'profile' ? (
            <>
              <OnboardingResume />
              <details>
                <summary>Instance status and recovery</summary>
                <OperationalStatus />
              </details>
              <ProfileForm key={`setup-${envelope.onboarding?.revision ?? 0}`} {...props} />
            </>
          ) : (
            <>
              <ErrorMessage error={action.error} />
              {!records.length ? (
                <EmptyState
                  icon={
                    kind === 'note' ? (
                      <NotebookPen size={25} />
                    ) : kind === 'event' ? (
                      <Flag size={25} />
                    ) : (
                      <HeartPulse size={25} />
                    )
                  }
                  title={
                    kind === 'note'
                      ? 'A place for the little details'
                      : kind === 'event'
                        ? 'Give yourself a date to aim for'
                        : 'No injury constraints recorded'
                  }
                  action={
                    <Button
                      variant="outline"
                      className="button"
                      onClick={() => setEditing({ kind })}
                    >
                      <Plus size={15} />
                      Add {kind}
                    </Button>
                  }
                >
                  {kind === 'note'
                    ? 'Travel, fatigue, or a good day. Keep useful context alongside your training.'
                    : kind === 'event'
                      ? 'Add a race, a goal, or another date that matters.'
                      : 'Record a constraint when it needs to inform your training.'}
                </EmptyState>
              ) : (
                records.map((record: any) => {
                  const date =
                    kind === 'note'
                      ? effectiveDate(record, data.plans)
                      : kind === 'event'
                        ? record.date
                        : record.startDate;
                  return (
                    <div className="context-record" key={record.id}>
                      <div className="context-record-icon">
                        {kind === 'note' ? (
                          <NotebookPen size={18} />
                        ) : kind === 'event' ? (
                          <Flag size={18} />
                        ) : (
                          <HeartPulse size={18} />
                        )}
                      </div>
                      <div className="context-record-copy">
                        <strong>{record.title ?? record.bodyPart}</strong>
                        <small>
                          {date
                            ? dateLabel(date, { day: 'numeric', month: 'long', year: 'numeric' })
                            : 'Undated plan'}
                          {kind === 'injury' &&
                            ` · ${record.endDate ? `until ${dateLabel(record.endDate)}` : 'ongoing'} · ${record.severity}`}
                          {kind === 'event' && ` · ${record.kind}`}
                        </small>
                        <MarkdownContent
                          source={record.body ?? record.description ?? record.notes}
                        />
                        {kind === 'injury' && record.notes && (
                          <section className="context-record-notes" aria-label="Additional notes">
                            <h3>Additional notes</h3>
                            <MarkdownContent source={record.notes} />
                          </section>
                        )}
                      </div>
                      <div className="row-action-group">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="icon-button"
                          aria-label={`Edit ${kind}`}
                          onClick={() => setEditing({ kind, record })}
                        >
                          <Edit3 size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="icon-button"
                          aria-label={`Delete ${kind}`}
                          disabled={action.busy}
                          onClick={async () => {
                            if (await confirm(`Delete this ${kind}?`))
                              void action.run(() =>
                                mutate(request, [
                                  {
                                    action: `${kind}.delete`,
                                    id: record.id,
                                    expectedRevision: record.revision,
                                  } as CommandInput,
                                ]),
                              );
                          }}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
      {editing && <ContextEditor {...editing} onClose={() => setEditing(null)} />}
    </>
  );
}
