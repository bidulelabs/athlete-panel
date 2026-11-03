'use client';

import { Button, NativeSelect, Input, Badge } from '@athlete-panel/ui';
import { useMemo, useState } from 'react';
import {
  canLinkSport,
  isUnresolvedActivitySport,
  isRest,
  sportGroups,
  sportSubgroups,
  sportTypeLabel,
  sportSelectionLabel,
  type Activity as ActivityRecord,
} from '@athlete-panel/contracts';
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
  Stat,
  SubmitButton,
  useAction,
  useWorkspace,
  type PluginPageProps,
} from '@athlete-panel/ui';
import { mutate } from '../training/public/client';
import { effectiveDate } from '../training/public/shared';
import { activityMetricSummary } from './summary';
import './client.css';

function metricCoverage(
  summary: ReturnType<typeof activityMetricSummary>,
  metric: 'duration' | 'distance',
) {
  const { knownCount, missingCount } = summary;
  if (!knownCount && !missingCount) return undefined;
  if (!missingCount)
    return knownCount === 1 ? '1 activity recorded' : `All ${knownCount} activities recorded`;
  return (
    <>
      {knownCount > 0 && <span className="activity-partial">Partial</span>}
      {knownCount > 0 && ' · '}
      {missingCount} {missingCount === 1 ? 'activity' : 'activities'} missing {metric}
    </>
  );
}

export default function ActivitiesPage({ data }: PluginPageProps) {
  const { from, to, navigate } = useWorkspace();
  const [sport, setSport] = useState('all');
  const [subgroup, setSubgroup] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ActivityRecord | null>(null);
  const activities = useMemo(
    () =>
      data.activities
        .filter(
          (activity) =>
            activity.localDate >= from &&
            activity.localDate <= to &&
            (sport === 'all' ||
              (sport === 'unresolved'
                ? isUnresolvedActivitySport(activity)
                : activity.sport === sport)) &&
            (!subgroup || activity.sportSubgroup === subgroup) &&
            activity.title.toLowerCase().includes(search.toLowerCase()),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [data.activities, from, to, sport, subgroup, search],
  );
  const time = activityMetricSummary(activities, 'durationSeconds');
  const length = activityMetricSummary(activities, 'distanceMeters');
  const hasFilters = Boolean(search || sport !== 'all');
  const clearFilters = () => {
    setSearch('');
    setSport('all');
    setSubgroup('');
  };
  return (
    <div className="activities-page">
      <PageHeader
        title="Activities"
        description="Your imported sessions, linked to the training you planned."
        actions={
          <Button variant="outline" className="button" onClick={() => navigate('/garmin')}>
            Garmin import <ArrowUpRight size={15} />
          </Button>
        }
      />
      <section className="summary-strip activity-summary" aria-label="Activity summary">
        <Stat
          label="Imported sessions"
          value={activities.length}
          hint={activities.length ? undefined : 'No activities in this selection'}
        />
        <Stat
          label="Recorded time"
          value={duration(time.value)}
          hint={metricCoverage(time, 'duration')}
        />
        <Stat
          label="Recorded distance"
          value={distance(length.value, data.profile?.units)}
          hint={metricCoverage(length, 'distance')}
        />
        <DateNavigation />
      </section>
      <div className="activity-filters" role="search" aria-label="Filter activities">
        <div className="activity-search">
          <Search size={16} aria-hidden="true" />
          <Input
            aria-label="Search activities"
            placeholder="Search activities"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="filter-row">
          <NativeSelect
            aria-label="Filter activities by sport"
            value={sport}
            onChange={(event) => {
              setSport(event.target.value);
              setSubgroup('');
            }}
          >
            <option value="all">All sports</option>
            {sportGroups.map((group) => (
              <option key={group.typeKey} value={group.typeKey}>
                {sportTypeLabel(group.typeKey)}
              </option>
            ))}
            <option value="unresolved">Unresolved classification</option>
          </NativeSelect>
          {sportSubgroups(sport).length > 0 && (
            <NativeSelect
              aria-label="Filter activities by subgroup"
              value={subgroup}
              onChange={(event) => setSubgroup(event.target.value)}
            >
              <option value="">All subgroups</option>
              {sportSubgroups(sport).map((type) => (
                <option key={type.typeKey} value={type.typeKey}>
                  {sportTypeLabel(type.typeKey)}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>
      {activities.length ? (
        <table className="activity-table">
          <caption className="sr-only">Imported activities in this selection</caption>
          <thead>
            <tr>
              <th scope="col">Activity</th>
              <th scope="col">Date</th>
              <th scope="col">Duration</th>
              <th scope="col">Distance</th>
              <th scope="col">Planned session</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {activities.map((activity) => {
              const linked = data.workouts.find(
                (workout) => workout.completion?.activityId === activity.id,
              );
              const title = activity.title || `${sportSelectionLabel(activity)} activity`;
              return (
                <tr key={activity.id}>
                  <td className="activity-name">
                    <SportIcon sport={activity.sport} size={21} />
                    <div>
                      <strong>{title}</strong>
                      <small>{sportSelectionLabel(activity)} · Garmin</small>
                    </div>
                  </td>
                  <td className="activity-date">
                    <time dateTime={activity.localDate}>{dateLabel(activity.localDate)}</time>
                  </td>
                  <td className="activity-measurement">
                    <span className="activity-mobile-label" aria-hidden="true">
                      Duration
                    </span>
                    <span
                      className={activity.durationSeconds === null ? 'activity-unknown' : undefined}
                    >
                      {activity.durationSeconds === null
                        ? 'Not recorded'
                        : duration(activity.durationSeconds)}
                    </span>
                  </td>
                  <td className="activity-measurement">
                    <span className="activity-mobile-label" aria-hidden="true">
                      Distance
                    </span>
                    <span
                      className={activity.distanceMeters === null ? 'activity-unknown' : undefined}
                    >
                      {activity.distanceMeters === null
                        ? 'Not recorded'
                        : distance(activity.distanceMeters, data.profile?.units)}
                    </span>
                  </td>
                  <td className="activity-link-status">
                    {linked ? (
                      <Badge className="badge success">
                        <Link2 size={12} aria-hidden="true" />
                        Linked
                      </Badge>
                    ) : (
                      <span>Unlinked</span>
                    )}
                  </td>
                  <td className="activity-details-action">
                    <Button
                      variant="link"
                      aria-label={`View ${title}`}
                      onClick={() => setSelected(activity)}
                    >
                      View <ArrowUpRight size={14} aria-hidden="true" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <EmptyState
          icon={<Activity size={26} />}
          title={
            search || sport !== 'all' ? 'No matching activities' : 'Your next session belongs here'
          }
          action={
            hasFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button
                variant="default"
                className="button primary"
                onClick={() => navigate('/garmin')}
              >
                Connect Garmin <ArrowUpRight size={15} />
              </Button>
            )
          }
        >
          {search || sport !== 'all'
            ? 'Try another search, sport, or date range.'
            : 'Connect Garmin to import your activities. Manual workouts are always available in the calendar.'}
        </EmptyState>
      )}
      {selected && <ActivityDetail activity={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ActivityDetail({ activity, onClose }: { activity: ActivityRecord; onClose: () => void }) {
  const { data, request } = useWorkspace();
  const action = useAction();
  const [workoutId, setWorkoutId] = useState('');
  const linked = data.workouts.find((workout) => workout.completion?.activityId === activity.id);
  const available = data.workouts.filter(
    (workout) =>
      !isRest(workout) &&
      workout.completion?.source !== 'garmin' &&
      workout.completion?.status !== 'skipped' &&
      effectiveDate(workout, data.plans) &&
      canLinkSport(workout, activity),
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={activity.title || 'Garmin activity'}
      description={`${sportSelectionLabel(activity)} · ${dateLabel(activity.localDate, { day: 'numeric', month: 'long', year: 'numeric' })}`}
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
            <dt>TSS</dt>
            <dd>{activity.trainingStressScore ?? '—'}</dd>
          </div>
          <div>
            <dt>Intensity factor</dt>
            <dd>{activity.intensityFactor ?? '—'}</dd>
          </div>
          <div>
            <dt>Normalized power</dt>
            <dd>
              {activity.normalizedPowerWatts == null ? '—' : `${activity.normalizedPowerWatts} W`}
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
              <p className="form-footnote">
                No compatible scheduled workouts. Check the sport group and subgroup, or resolve the
                activity classification through Garmin reimport.
              </p>
            )}
            <SubmitButton busy={action.busy || !workoutId}>Link workout</SubmitButton>
          </form>
        )}
        <ErrorMessage error={action.error} />
      </div>
    </Modal>
  );
}
