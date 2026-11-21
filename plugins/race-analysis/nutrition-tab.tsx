'use client';

import { useState } from 'react';
import { Target } from 'lucide-react';
import {
  Button,
  EmptyState,
  ErrorMessage,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  dateLabel,
  useAction,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { emptyRaceNutrition, type RaceAnalysis, type RacePlan } from '@athlete-panel/contracts';
import { mutate } from '../training/public/client';
import { nutrients } from './nutrition';
import { PhaseTextDialog, TargetsDialog } from './nutrition-dialogs';
import { NeedsReviewNotice } from './needs-review-notice';
import { raceDayCommand } from './race-plan-form';

type RaceNutrition = RacePlan['nutrition'];
type PhaseField = 'daysBefore' | 'breakfast' | 'recovery';
type Editing = 'targets' | PhaseField;

const phases = [
  {
    field: 'daysBefore',
    title: 'Days before',
    hint: 'What you eat and drink in the days before the race.',
  },
  { field: 'breakfast', title: 'Breakfast', hint: 'Repeat a breakfast you already know.' },
  { field: 'recovery', title: 'Recovery', hint: 'What you eat and drink after the finish.' },
] as const;

function PhaseCard({
  phase,
  text,
  busy,
  onEdit,
}: {
  phase: (typeof phases)[number];
  text: string;
  busy: boolean;
  onEdit: () => void;
}) {
  return (
    <section className="race-estimate" aria-labelledby={`race-${phase.field}-title`}>
      <div className="race-section-heading">
        <div>
          <h2 id={`race-${phase.field}-title`}>{phase.title}</h2>
          <p className="race-hint">{phase.hint}</p>
        </div>
        <Button
          variant="outline"
          aria-label={`Edit ${phase.title.toLowerCase()}`}
          disabled={busy}
          onClick={onEdit}
        >
          Edit
        </Button>
      </div>
      <p className="race-nutrition-text">{text || 'Nothing written yet.'}</p>
    </section>
  );
}

function TargetsCard({
  targets,
  busy,
  onEdit,
}: {
  targets: RaceNutrition['targets'];
  busy: boolean;
  onEdit: () => void;
}) {
  const noTarget = nutrients.every(({ target }) => targets[target] === null);
  return (
    <section className="race-estimate" aria-labelledby="race-targets-title">
      <div className="race-section-heading">
        <h2 id="race-targets-title">Targets per hour</h2>
        {!noTarget && (
          <Button variant="outline" disabled={busy} onClick={onEdit}>
            Edit targets
          </Button>
        )}
      </div>
      {noTarget ? (
        <EmptyState
          icon={<Target size={25} />}
          title="No hourly targets yet"
          action={
            <Button disabled={busy} onClick={onEdit}>
              Set targets
            </Button>
          }
        >
          Carbohydrate, fluid and sodium per hour, as you agreed and tested them.
        </EmptyState>
      ) : (
        <dl className="race-nutrition-targets">
          {nutrients.map(({ target, label, unit }) => (
            <div key={target}>
              <dt>{label}</dt>
              <dd>{targets[target] === null ? 'unknown' : `${targets[target]} ${unit}`}</dd>
              <dd>{target === 'carbohydrateGramsPerHour' ? 'per hour moving' : 'per hour'}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function NutritionPreferences({ preferences }: { preferences: string }) {
  return (
    <details className="race-disclosure">
      <summary>
        <span>Your preferences</span>
        <small>From Settings{preferences && ` · ${preferences.split('\n')[0]}`}</small>
      </summary>
      <div className="race-disclosure-body">
        <p className="race-nutrition-text">{preferences || 'No preferences in Settings yet.'}</p>
        <p className="race-hint">
          To change them, <a href="/settings">open Settings</a>, then Nutrition.
        </p>
      </div>
    </details>
  );
}

function NutritionDialog({
  editing,
  nutrition,
  onSave,
  onClose,
}: {
  editing: Editing | null;
  nutrition: RaceNutrition;
  onSave: (changes: Partial<RaceNutrition>) => Promise<unknown>;
  onClose: () => void;
}) {
  const editedPhase = phases.find((phase) => phase.field === editing);
  return (
    <>
      {editing === 'targets' && (
        <TargetsDialog
          targets={nutrition.targets}
          onSave={(targets) => onSave({ targets })}
          onClose={onClose}
        />
      )}
      {editedPhase && (
        <PhaseTextDialog
          title={editedPhase.title}
          text={nutrition[editedPhase.field]}
          onSave={(text) => onSave({ [editedPhase.field]: text })}
          onClose={onClose}
        />
      )}
    </>
  );
}

export function Nutrition({
  race,
  course,
  data,
  request,
}: Pick<PluginPageProps, 'data' | 'request'> & Pick<RaceAnalysis, 'race' | 'course'>) {
  const action = useAction();
  const [editing, setEditing] = useState<Editing | null>(null);
  const racePlan = data.racePlans.find((candidate) => candidate.eventId === race.id);
  const courseId = course?.id ?? null;
  const nutrition = racePlan?.nutrition ?? emptyRaceNutrition;
  const saveNutrition = (changes: Partial<RaceNutrition>) =>
    mutate(request, [
      raceDayCommand({ nutrition: { ...nutrition, ...changes } }, racePlan, race.id, courseId),
    ]);
  return (
    <div className="race-analysis race-nutrition" aria-busy={action.busy}>
      <PageHeader
        eyebrow="Race / Nutrition"
        title={race.title}
        description={dateLabel(race.date, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      />
      <NeedsReviewNotice racePlan={racePlan} courseId={courseId} request={request}>
        The course or your target changed after this plan was written. Check that the nutrition plan
        still holds.
      </NeedsReviewNotice>
      <ErrorMessage error={action.error} />
      <Tabs defaultValue="race">
        <TabsList className="race-nutrition-phases" aria-label="Nutrition phase">
          <TabsTrigger value="daysBefore">Days before</TabsTrigger>
          <TabsTrigger value="breakfast">Breakfast</TabsTrigger>
          <TabsTrigger value="race">During the race</TabsTrigger>
          <TabsTrigger value="recovery">Recovery</TabsTrigger>
        </TabsList>
        {phases.map((phase) => (
          <TabsContent key={phase.field} value={phase.field}>
            <PhaseCard
              phase={phase}
              text={nutrition[phase.field]}
              busy={action.busy}
              onEdit={() => setEditing(phase.field)}
            />
          </TabsContent>
        ))}
        <TabsContent value="race">
          <div className="race-data-notice" role="note">
            <strong>Your plan, not a prescription</strong>
            <p>Targets and quantities are what you agreed and tested.</p>
          </div>
          <TargetsCard
            targets={nutrition.targets}
            busy={action.busy}
            onEdit={() => setEditing('targets')}
          />
        </TabsContent>
      </Tabs>
      <NutritionPreferences preferences={data.profile?.nutrition?.preferences ?? ''} />
      <NutritionDialog
        editing={editing}
        nutrition={nutrition}
        onSave={saveNutrition}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
