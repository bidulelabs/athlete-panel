'use client';

import { Button, NativeSelect, Input, Badge } from '@athlete-panel/ui';
import { useMemo, useState } from 'react';
import type { Activity as ActivityRecord } from '@athlete-panel/contracts';
import { Activity, ArrowUpRight, Link2, Search, Unlink } from 'lucide-react';
import {
  dateLabel,
  DateNavigation,
  distance,
  duration,
  EmptyState,
  ErrorMessage,
  Field,
  Modal,
  PageHeader,
  SportIcon,
  sportLabel,
  Stat,
  SubmitButton,
  useAction,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { mutate } from '../training/client';
import { effectiveDate } from '../training/dates';

export default function ActivitiesPage({ data, request }: PluginPageProps) {
  const { from, to, navigate } = useWorkspace();
  const [sport, setSport] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ActivityRecord | null>(null);
  const activities = useMemo(
    () =>
      data.activities
        .filter(
          (activity) =>
            activity.localDate >= from &&
            activity.localDate <= to &&
            (sport === 'all' || activity.sport === sport) &&
            activity.title.toLowerCase().includes(search.toLowerCase()),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [data.activities, from, to, sport, search],
  );
  const knownDuration = activities.filter((activity) => activity.durationSeconds != null);
  const knownDistance = activities.filter((activity) => activity.distanceMeters != null);
  return (
    <>
      <PageHeader
        eyebrow="THE WORK YOU HAVE DONE"
        title="Activities"
        description="Your imported sessions, linked to the training you planned."
        actions={
          <Button variant="outline" className="button" onClick={() => navigate('/garmin')}>
            Garmin import <ArrowUpRight size={15} />
          </Button>
        }
      />
      <div className="summary-strip">
        <Stat label="Imported sessions" value={activities.length} />
        <Stat
          label="Total time"
          value={duration(
            knownDuration.length
              ? knownDuration.reduce((sum, activity) => sum + activity.durationSeconds!, 0)
              : activities.length
                ? null
                : 0,
          )}
        />
        <Stat
          label="Total distance"
          value={distance(
            knownDistance.length
              ? knownDistance.reduce((sum, activity) => sum + activity.distanceMeters!, 0)
              : activities.length
                ? null
                : 0,
            data.profile?.units,
          )}
        />
        <DateNavigation />
      </div>
      <div className="section-toolbar" style={{ paddingBottom: 15 }}>
        <div className="filter-row">
          <NativeSelect
            aria-label="Filter activities by sport"
            value={sport}
            onChange={(event) => setSport(event.target.value)}
          >
            <option value="all">All sports</option>
            <option value="cycling">Cycling</option>
            <option value="running">Running</option>
            <option value="other">Other</option>
          </NativeSelect>
        </div>
        <Input
          className="search-input"
          aria-label="Search activities"
          placeholder="Search activities"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {activities.length ? (
        <div className="data-table">
          <div className="data-table-header activities">
            <span>Activity</span>
            <span>Date</span>
            <span>Duration</span>
            <span>Distance</span>
            <span>Planned session</span>
            <span />
          </div>
          {activities.map((activity) => {
            const linked = data.workouts.find(
              (workout) => workout.completion?.activityId === activity.id,
            );
            return (
              <div className="data-table-row activities" key={activity.id}>
                <div className="row-main">
                  <SportIcon sport={activity.sport} size={23} />
                  <div>
                    <strong>{activity.title || `${sportLabel(activity.sport)} activity`}</strong>
                    <small>{sportLabel(activity.sport)} · Garmin</small>
                  </div>
                </div>
                <span>{dateLabel(activity.localDate)}</span>
                <span>{duration(activity.durationSeconds)}</span>
                <span>{distance(activity.distanceMeters, data.profile?.units)}</span>
                <span>
                  {linked ? (
                    <Badge className="badge success">
                      <Link2 size={10} style={{ marginRight: 4 }} />
                      Linked
                    </Badge>
                  ) : (
                    <span className="muted-text" style={{ fontSize: 10 }}>
                      Unlinked
                    </span>
                  )}
                </span>
                <Button
                  variant="link"
                  className="text-button"
                  onClick={() => setSelected(activity)}
                >
                  View <ArrowUpRight size={12} />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Activity size={26} />}
          title={
            search || sport !== 'all' ? 'No matching activities' : 'Your next session belongs here'
          }
          action={
            !search && sport === 'all' ? (
              <Button
                variant="default"
                className="button primary"
                onClick={() => navigate('/garmin')}
              >
                Connect Garmin <ArrowUpRight size={15} />
              </Button>
            ) : undefined
          }
        >
          {search || sport !== 'all'
            ? 'Try another search, sport, or date range.'
            : 'Connect Garmin to import your activities. Manual workouts are always available in the calendar.'}
        </EmptyState>
      )}
      {selected && <ActivityDetail activity={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function ActivityDetail({ activity, onClose }: { activity: ActivityRecord; onClose: () => void }) {
  const { data, request } = useWorkspace();
  const action = useAction();
  const [workoutId, setWorkoutId] = useState('');
  const linked = data.workouts.find((workout) => workout.completion?.activityId === activity.id);
  const available = data.workouts.filter((workout) => workout.completion?.source !== 'garmin');
  return (
    <Modal
      open
      onClose={onClose}
      title={activity.title || 'Garmin activity'}
      description={`${sportLabel(activity.sport)} · ${dateLabel(activity.localDate, { day: 'numeric', month: 'long', year: 'numeric' })}`}
    >
      <div className="dialog-body">
        <div className="summary-strip" style={{ marginBottom: 20, marginTop: 0 }}>
          <Stat label="Duration" value={duration(activity.durationSeconds)} />
          <Stat label="Distance" value={distance(activity.distanceMeters, data.profile?.units)} />
        </div>
        <dl className="inspector-details">
          <div>
            <dt>Average heart rate</dt>
            <dd>
              {activity.averageHeartRateBpm == null
                ? '—'
                : `${Math.round(activity.averageHeartRateBpm)} bpm`}
            </dd>
          </div>
          <div>
            <dt>Elevation</dt>
            <dd>
              {activity.elevationMeters == null
                ? '—'
                : `${Math.round(activity.elevationMeters * (data.profile?.units === 'imperial' ? 3.28084 : 1))} ${data.profile?.units === 'imperial' ? 'ft' : 'm'}`}
            </dd>
          </div>
          <div>
            <dt>Date source</dt>
            <dd>
              {activity.dateSource === 'provider' ? 'Garmin local date' : 'Inferred local date'}
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>Garmin Connect</dd>
          </div>
        </dl>
        <div className="form-divider" />
        {linked ? (
          <>
            <h3 style={{ fontSize: 13 }}>Linked to {linked.title}</h3>
            <p className="form-footnote">
              This activity is the workout’s actual result and is counted once in summaries.
            </p>
            <Button
              variant="outline"
              className="button"
              disabled={action.busy}
              onClick={() =>
                action.run(() =>
                  mutate(request, [
                    { action: 'workout.unlink', id: linked.id, expectedRevision: linked.revision },
                  ]),
                )
              }
            >
              <Unlink size={14} />
              Unlink workout
            </Button>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const workout = available.find((w) => w.id === workoutId);
              if (workout)
                void action.run(() =>
                  mutate(request, [
                    {
                      action: 'workout.link',
                      id: workout.id,
                      expectedRevision: workout.revision,
                      activityId: activity.id,
                    },
                  ]),
                );
            }}
          >
            <Field label="Link to a planned workout">
              <NativeSelect
                required
                value={workoutId}
                onChange={(event) => setWorkoutId(event.target.value)}
              >
                <option value="">Choose a workout</option>
                {available.map((workout) => (
                  <option key={workout.id} value={workout.id}>
                    {effectiveDate(workout, data.plans) ?? 'Unscheduled'} · {workout.title}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {available.length === 0 && (
              <p className="form-footnote">Add a planned workout to your calendar first.</p>
            )}
            <SubmitButton busy={action.busy || !workoutId}>Link workout</SubmitButton>
          </form>
        )}
        <ErrorMessage error={action.error} />
      </div>
    </Modal>
  );
}
