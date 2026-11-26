'use client';

import { useMemo, useState } from 'react';
import { Flag, Upload } from 'lucide-react';
import {
  Button,
  EmptyState,
  ErrorMessage,
  Field,
  NativeSelect,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  dateLabel,
  distance,
  localDate,
  type PluginPageProps,
  type ExtensionSelection,
} from '@athlete-panel/ui';
import type { RaceAnalysis, RacePlan } from '@athlete-panel/contracts';
import { CourseRoute, ElevationProfile } from './course-figures';
import { UploadDialog } from './upload-dialog';
import { ReferenceEfforts } from './reference-efforts';
import { Preparation } from './preparation';
import { Nutrition } from './nutrition-tab';
import { RaceCard } from './race-card-tab';
import { RaceDay } from './race-day-tab';
import { useRaceAction, useRaceAnalysis } from './use-analysis';
import { estimateCourse } from './estimate';
import { adjustedEstimate } from './race-day';
import { effortAndWeatherText, finishTime, elevationLabel, terrainNames } from './presentation';
import './race-analysis.css';

type TerrainDraft = { terrain: number; sectionTerrain: Record<string, number>; revision: number };
function AnalysisView({
  value,
  request,
  reload,
  loading,
  loadError,
  units,
  racePlan,
}: {
  value: RaceAnalysis;
  request: PluginPageProps['request'];
  reload: () => Promise<RaceAnalysis | null>;
  loading: boolean;
  loadError: string | null;
  units: string;
  racePlan: RacePlan | undefined;
}) {
  const [selected, setSelected] = useState(0),
    [upload, setUpload] = useState<'course' | 'reference' | null>(null);
  const [draft, setDraft] = useState<TerrainDraft | null>(null),
    [notice, setNotice] = useState('');
  const { busy, error, setError, run } = useRaceAction(reload);
  const terrain = draft?.terrain ?? value.terrain,
    sectionTerrain = draft?.sectionTerrain ?? value.sectionTerrain;
  const track = value.course?.analysis ?? null;
  const preview = useMemo(
    () => (draft ? estimateCourse(track, terrain, sectionTerrain, value.references) : value),
    [draft, track, terrain, sectionTerrain, value],
  );
  const estimate = preview.estimate;
  const displayPace = (estimate?.paceSecondsPerKm ?? 0) * (units === 'imperial' ? 1.609344 : 1);
  const chosen = Math.min(selected, (track?.points.length ?? 1) - 1);
  const keepDraftAfterReferenceChange = (fromRevision: number, toRevision: number) =>
    setDraft((current) =>
      current?.revision === fromRevision ? { ...current, revision: toRevision } : current,
    );
  const onSaved = async (fromRevision: number, toRevision: number) => {
    if (upload === 'course') {
      setDraft(null);
      setSelected(0);
    }
    const saved = await reload();
    if (upload === 'reference') keepDraftAfterReferenceChange(fromRevision, toRevision);
    setNotice(saved ? 'Course analysis saved.' : 'Saved. Reload the analysis to see the result.');
  };
  function saveTerrain() {
    setNotice('');
    void run(async () => {
      await request('race-analysis', 'settings', {
        raceId: value.race.id,
        expectedRevision: draft?.revision ?? value.revision,
        idempotencyKey: crypto.randomUUID(),
        terrain,
        sectionTerrain,
      });
      setDraft(null);
      await reload();
      setNotice('Terrain saved. Estimate updated.');
    });
  }
  return (
    <div className="race-analysis" aria-busy={loading || busy}>
      <PageHeader
        eyebrow="Race / Course analysis"
        title={value.race.title}
        description={dateLabel(value.race.date, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
        actions={
          <Button
            variant={value.course ? 'outline' : 'default'}
            onClick={() => setUpload('course')}
            disabled={loading || busy}
          >
            <Upload size={15} />
            {value.course ? 'Replace GPX' : 'Upload GPX'}
          </Button>
        }
      />
      {value.course && (
        <p className="race-file-meta">
          {value.course.filename} · {value.course.analysis.pointCount.toLocaleString('en')} points ·
          Saved version {value.revision}
        </p>
      )}
      {loadError && (
        <div className="race-recovery" role="alert">
          <p>{loadError} The last loaded analysis is shown below.</p>
          <Button variant="outline" onClick={() => void reload()} disabled={loading}>
            Reload saved data
          </Button>
        </div>
      )}
      {notice && (
        <p className="race-notice" role="status">
          {notice}
        </p>
      )}
      {!track ? (
        <EmptyState
          icon={<Flag size={25} />}
          title="See what the course asks of you"
          action={<Button onClick={() => setUpload('course')}>Choose a GPX file</Button>}
        >
          Upload the race route to see distance, climbing and its elevation profile. Add past
          efforts when you are ready for a personal estimate.
        </EmptyState>
      ) : (
        <>
          <div className="race-overview">
            <section className="race-estimate" aria-label="Finish estimate">
              <div className="race-kicker">
                {draft ? 'Preview · unsaved terrain' : 'Your estimated finish time'}
              </div>
              {estimate ? (
                <>
                  <strong className="race-finish">{finishTime(estimate.seconds)}</strong>
                  <p className="race-range">
                    Planning range {finishTime(estimate.lowSeconds)}–
                    {finishTime(estimate.highSeconds)}
                  </p>
                  {effortAndWeatherText(racePlan) && (
                    <p className="race-hint">Before effort and weather</p>
                  )}
                  <p className="race-hint">
                    From {estimate.referenceCount} of your past efforts · moving time
                  </p>
                </>
              ) : (
                <>
                  <h2 className="race-estimate-empty">A few past efforts will make this yours</h2>
                  {preview.estimateReasons.map((reason) => (
                    <p className="race-hint" key={reason}>
                      {reason}
                    </p>
                  ))}
                  <Button variant="outline" onClick={() => setUpload('reference')}>
                    Add a past effort
                  </Button>
                </>
              )}
              <dl className="race-metrics">
                <div>
                  <dt>Distance</dt>
                  <dd>{distance(track.distanceMeters, units)}</dd>
                </div>
                <div>
                  <dt>Smoothed climbing</dt>
                  <dd>{elevationLabel(track.ascentMeters, units)}</dd>
                </div>
                <div>
                  <dt>Terrain</dt>
                  <dd>
                    {terrain} / 5 <small>{terrainNames[terrain - 1]}</small>
                  </dd>
                </div>
              </dl>
              <details className="race-measurement-note">
                <summary>Why does climbing differ from the GPX?</summary>
                <p>
                  Raw gain: {elevationLabel(track.rawAscentMeters, units)}. We sample height every
                  25 m, then take a median over five points to reduce GPS spikes. These measurements
                  are approximate; no external elevation service is used.
                </p>
              </details>
            </section>
            <CourseRoute track={track} selected={chosen} onSelect={setSelected} units={units} />
          </div>
          {track.warnings.length > 0 && (
            <div className="race-data-notice" role="status">
              {track.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
          <ElevationProfile track={track} selected={chosen} onSelect={setSelected} units={units} />
          <section className="race-terrain" aria-labelledby="race-terrain-title">
            <div>
              <h2 id="race-terrain-title">How technical is the terrain?</h2>
              <p className="race-hint">
                Each terrain level adds an illustrative 3.5% of base time, independently of slope.{' '}
                {estimate?.harderTerrainSeconds !== null &&
                estimate?.harderTerrainSeconds !== undefined
                  ? `One level harder adds about ${Math.round(estimate.harderTerrainSeconds / 60)} minutes in this model.`
                  : 'Choose the footing and technical difficulty.'}
              </p>
            </div>
            <div className="race-terrain-options" role="group" aria-label="Overall terrain">
              {terrainNames.map((name, i) => (
                <Button
                  key={name}
                  variant={terrain === i + 1 ? 'default' : 'outline'}
                  aria-pressed={terrain === i + 1}
                  onClick={() =>
                    setDraft({
                      terrain: i + 1,
                      sectionTerrain,
                      revision: draft?.revision ?? value.revision,
                    })
                  }
                  disabled={busy}
                >
                  <strong>{i + 1}</strong>
                  <span>{name}</span>
                </Button>
              ))}
            </div>
          </section>
          <details className="race-disclosure">
            <summary>
              <span>Section by section</span>
              <small>Terrain and estimated time for each part</small>
            </summary>
            <div className="race-disclosure-body">
              <p className="race-hint">
                Sections are consecutive 5 km parts, ending at the finish. Local terrain overrides
                the overall level.
              </p>
              <div className="race-section-list">
                {track.sections.map((section) => (
                  <div className="race-section-row" key={section.index}>
                    <Button
                      variant="ghost"
                      className="race-section-select"
                      onClick={() => {
                        const index = track.points.findIndex(
                          (p) => p.distanceMeters >= section.fromMeters,
                        );
                        setSelected(Math.max(0, index));
                      }}
                    >
                      <span className="sr-only">Select section </span>
                      <strong>{section.index + 1}</strong>
                      <span>
                        {distance(section.fromMeters, units)}–{distance(section.toMeters, units)}
                      </span>
                    </Button>
                    <span>
                      {elevationLabel(section.ascentMeters, units)} up ·{' '}
                      {elevationLabel(section.descentMeters, units)} down
                    </span>
                    <Field label={`Section ${section.index + 1} terrain`}>
                      <NativeSelect
                        value={sectionTerrain[String(section.index)] ?? ''}
                        disabled={busy}
                        onChange={(event) => {
                          const next = { ...sectionTerrain };
                          if (event.target.value === '') delete next[String(section.index)];
                          else next[String(section.index)] = Number(event.target.value);
                          setDraft({
                            terrain,
                            sectionTerrain: next,
                            revision: draft?.revision ?? value.revision,
                          });
                        }}
                      >
                        <option value="">Overall · {terrainNames[terrain - 1]}</option>
                        {terrainNames.map((name, index) => (
                          <option key={name} value={index + 1}>
                            {index + 1} · {name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <strong className="race-section-time">
                      {finishTime(estimate?.sectionSeconds[section.index])}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          </details>
          {draft && (
            <div className="race-save-bar">
              <span>
                {draft.revision !== value.revision
                  ? `Saved version ${value.revision} has changed. Your draft is retained; choose Use saved terrain to start again from the latest values.`
                  : 'Terrain changes are a preview until saved.'}
              </span>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
                disabled={busy}
              >
                Use saved terrain
              </Button>
              <Button onClick={saveTerrain} disabled={busy}>
                {busy ? 'Saving…' : 'Save terrain'}
              </Button>
            </div>
          )}
          <ErrorMessage error={error} />
        </>
      )}
      <details
        className="race-disclosure race-method"
        open={!track || value.references.length === 0}
      >
        <summary>
          <span>How we worked this out</span>
          <small>
            {value.references.length
              ? `${value.references.length} past efforts and model assumptions`
              : 'Add reference efforts for a personal estimate'}
          </small>
        </summary>
        <div className="race-disclosure-body">
          {estimate && (
            <>
              <dl className="race-model">
                <div>
                  <dt>Fitted flat pace</dt>
                  <dd>
                    {Math.floor(Math.round(displayPace) / 60)}:
                    {String(Math.round(displayPace) % 60).padStart(2, '0')} /{' '}
                    {units === 'imperial' ? 'mi' : 'km'}
                  </dd>
                </div>
                <div>
                  <dt>Climbing cost</dt>
                  <dd>
                    {Math.round(estimate.climbSecondsPer100m * (units === 'imperial' ? 0.3048 : 1))}{' '}
                    s / 100 {units === 'imperial' ? 'ft' : 'm'}
                  </dd>
                </div>
                <div>
                  <dt>Slowdown</dt>
                  <dd>{Math.round(estimate.fatiguePerHour * 100)}% / hour</dd>
                </div>
              </dl>
              <ul className="race-assumptions">
                {estimate.explanations.map((explanation) => (
                  <li key={explanation}>{explanation}</li>
                ))}
              </ul>
            </>
          )}
          <ReferenceEfforts
            value={{ ...value, references: preview.references }}
            request={request}
            units={units}
            reload={reload}
            onAdd={() => setUpload('reference')}
            onReferenceChanged={keepDraftAfterReferenceChange}
          />
        </div>
      </details>
      {upload && (
        <UploadDialog
          value={value}
          purpose={upload}
          onClose={() => setUpload(null)}
          onSaved={onSaved}
          reload={reload}
        />
      )}
    </div>
  );
}
function SelectedRace({ raceId, ...props }: PluginPageProps & { raceId: string }) {
  const { value, error, loading, reload } = useRaceAnalysis(raceId);
  const [tab, setTab] = useState<'course' | 'preparation' | 'race-day' | 'nutrition' | 'race-card'>(
    'course',
  );
  if (!value)
    return (
      <div className="race-analysis">
        <PageHeader title="Course analysis" />
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <Button variant="outline" onClick={() => void reload()}>
              Try again
            </Button>
          </div>
        ) : (
          <div role="status" aria-label="Loading course analysis">
            <Skeleton className="race-loading" />
            <p>Loading course analysis…</p>
          </div>
        )}
      </div>
    );
  const racePlan = props.data.racePlans.find((candidate) => candidate.eventId === value.race.id);
  const estimateWithEffortAndWeather = adjustedEstimate(value.estimate, {
    effortPercent: racePlan?.effortPercent ?? 0,
    weatherPercent: racePlan?.weatherPercent ?? 0,
  });
  return (
    <Tabs value={tab} onValueChange={(next) => setTab(next as typeof tab)}>
      <TabsList className="workspace-tabs race-tabs" aria-label="Race views">
        <TabsTrigger value="course">Course</TabsTrigger>
        <TabsTrigger value="preparation">Preparation</TabsTrigger>
        <TabsTrigger value="race-day">Race day</TabsTrigger>
        <TabsTrigger value="nutrition">Nutrition</TabsTrigger>
        <TabsTrigger value="race-card">Race card</TabsTrigger>
      </TabsList>
      <TabsContent value={tab}>
        {tab === 'course' ? (
          <AnalysisView
            value={value}
            request={props.request}
            reload={reload}
            loading={loading}
            loadError={error}
            units={props.data.profile?.units ?? 'metric'}
            racePlan={racePlan}
          />
        ) : tab === 'race-day' ? (
          <RaceDay
            race={value.race}
            course={value.course}
            estimate={estimateWithEffortAndWeather}
            estimateReasons={value.estimateReasons}
            data={props.data}
            request={props.request}
            onOpenCourse={() => setTab('course')}
          />
        ) : tab === 'nutrition' ? (
          <Nutrition
            race={value.race}
            course={value.course}
            estimate={estimateWithEffortAndWeather}
            data={props.data}
            request={props.request}
          />
        ) : tab === 'race-card' ? (
          <RaceCard
            race={value.race}
            course={value.course}
            estimate={estimateWithEffortAndWeather}
            data={props.data}
            request={props.request}
          />
        ) : (
          <Preparation
            race={value.race}
            course={value.course}
            data={props.data}
            request={props.request}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
export default function RacePage(props: PluginPageProps) {
  const races = props.data.events
    .filter((event) => event.kind === 'race')
    .sort((a, b) => a.date.localeCompare(b.date));
  const [raceId, setRaceId] = useState(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('race') : null,
  );
  const selected =
    races.find((race) => race.id === raceId) ??
    races.find((race) => race.date >= localDate()) ??
    races.at(-1);
  return (
    <div>
      {races.length > 0 && (
        <div className="race-selector">
          <Field label="Race">
            <NativeSelect
              value={selected?.id ?? ''}
              onChange={(event) => {
                setRaceId(event.target.value);
                window.history.replaceState(null, '', `/races?race=${event.target.value}`);
              }}
            >
              {races.map((race) => (
                <option key={race.id} value={race.id}>
                  {race.title} · {dateLabel(race.date)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button asChild variant="ghost">
            <a href="/calendar">Open calendar</a>
          </Button>
        </div>
      )}
      {selected ? (
        <SelectedRace key={selected.id} raceId={selected.id} {...props} />
      ) : (
        <>
          <PageHeader title="Races" description="Explore the course before race day." />
          <EmptyState
            icon={<Flag size={26} />}
            title="Add a race to your calendar"
            action={
              <Button asChild>
                <a href="/calendar">Open calendar</a>
              </Button>
            }
          >
            Create an event with type Race in the calendar. It will appear here, ready for a GPX
            course.
          </EmptyState>
        </>
      )}
    </div>
  );
}
function RaceCourseLink({ data, selection }: PluginPageProps & { selection?: ExtensionSelection }) {
  const race =
    selection?.kind === 'event'
      ? data.events.find((event) => event.id === selection.id && event.kind === 'race')
      : undefined;
  return race ? (
    <Button asChild variant="outline">
      <a href={`/races?race=${race.id}`}>View course analysis</a>
    </Button>
  ) : null;
}
export const contributions = { 'race-course-link': RaceCourseLink };
