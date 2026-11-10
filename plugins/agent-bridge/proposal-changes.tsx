'use client';
import { useState } from 'react';
import { ChevronRight, Flag, Target, NotebookPen, Layers, Circle } from 'lucide-react';
import {
  Badge,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  dateLabel,
  distance,
  duration,
  sportLabel,
  useWorkspace,
  SportIcon,
} from '@athlete-panel/ui';
import type { Entity, ProposalDetails } from '@athlete-panel/contracts';
import { proposalRows } from './proposal-diff';
import {
  changeType,
  changeTitle,
  changeAction,
  describeTypes,
  editedWeekFacts,
  typeLabels,
  proposalDateOptions,
} from './proposal-presentation';
import {
  calendarDate,
  recordDates,
  groupChangesByWeek,
  groupChangesByMonth,
} from './proposal-weeks';
export function ProposalType({ type, record }: { type: string; record?: Entity | null }) {
  const Icon =
    type === 'race'
      ? Flag
      : type === 'goal'
        ? Target
        : type === 'note'
          ? NotebookPen
          : type === 'plan'
            ? Layers
            : Circle;
  return (
    <span className={`proposal-type proposal-type-${type}`}>
      <span aria-hidden="true">
        {type === 'workout' ? (
          <SportIcon sport={record && 'sport' in record ? record.sport : undefined} size={15} />
        ) : (
          <Icon size={15} />
        )}
      </span>
      {typeLabels[type] ?? type}
    </span>
  );
}

function GroupSummary({ changes }: { changes: ProposalDetails['changes'] }) {
  const deleted = changes.filter((change) => changeAction(change) === 'delete').length;
  return (
    <span className="proposal-group-counts">
      {describeTypes(changes)}
      {deleted > 0 && (
        <span className="proposal-deletions">
          {' '}
          · {deleted} deletion{deleted === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}

export function ProposedEdits({
  changes,
  planTitles,
}: {
  changes: ProposalDetails['changes'];
  planTitles: Record<string, string>;
}) {
  const months = groupChangesByMonth(changes);
  if (months.filter((month) => month.month).length <= 2 && changes.length <= 200)
    return <ProposedEditsByWeek changes={changes} planTitles={planTitles} />;
  return months.map((month) =>
    month.month ? (
      <ProposalMonth key={month.month} month={month} planTitles={planTitles} />
    ) : (
      <ProposedEditsByWeek key="undated" changes={month.changes} planTitles={planTitles} />
    ),
  );
}

function ProposalMonth({
  month,
  planTitles,
}: {
  month: { month: string | null; changes: ProposalDetails['changes'] };
  planTitles: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details className="proposal-month" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <strong>{dateLabel(`${month.month}-01`, { month: 'long', year: 'numeric' })}</strong>
        <GroupSummary changes={month.changes} />
        <ChevronRight size={16} aria-hidden="true" />
      </summary>
      {expanded && (
        <ProposedEditsByWeek changes={month.changes} planTitles={planTitles} collapsed />
      )}
    </details>
  );
}

function ProposedEditsByWeek({
  changes,
  planTitles,
  collapsed = false,
}: {
  collapsed?: boolean;
  changes: ProposalDetails['changes'];
  planTitles: Record<string, string>;
}) {
  const { weekStartsOn } = useWorkspace();
  return groupChangesByWeek(changes, weekStartsOn).map((week) => {
    const title = week.weekStart
      ? `Week of ${dateLabel(week.weekStart, { day: 'numeric', month: 'short', year: 'numeric' })}`
      : 'Plans';
    return (
      <section className="proposal-week" aria-label={title} key={week.weekStart ?? 'undated'}>
        <details open={!collapsed}>
          <summary className="proposal-week-heading">
            <h4>{title}</h4>
            <GroupSummary changes={week.changes} />
            <ChevronRight className="proposal-week-chevron" size={16} aria-hidden="true" />
          </summary>
          {week.changes.map((change) => (
            <ReviewChange
              change={change}
              planTitles={planTitles}
              caption="Proposed field changes"
              key={`${change.entity}:${change.id}`}
            />
          ))}
        </details>
      </section>
    );
  });
}

export function ReviewChange({
  change,
  planTitles,
  caption,
  context = false,
}: {
  change: ProposalDetails['changes'][number];
  planTitles: Record<string, string>;
  caption: string;
  context?: boolean;
}) {
  const { data } = useWorkspace();
  const units = data.profile?.units ?? 'metric';
  const [expanded, setExpanded] = useState(false);
  const record = change.after ?? change.before;
  const action = changeAction(change);
  const type = changeType(change);
  const date = calendarDate(change);
  const dates = recordDates(change);
  const dateChanged = change.before && change.after && dates.before !== dates.after;
  const summaryFacts = [
    date && dateLabel(date, proposalDateOptions),
    dateChanged && `moved from ${dates.before ? dateLabel(dates.before) : 'unscheduled'}`,
    change.entity === 'period' &&
      record &&
      'role' in record &&
      `${record.role[0]!.toUpperCase()}${record.role.slice(1)} phase until ${dateLabel(record.endDate, proposalDateOptions)}`,
    record && 'focus' in record && record.focus,
    ...(change.entity === 'period' && record && 'editedWeeks' in record
      ? editedWeekFacts(record)
      : []),
    change.entity !== 'period' &&
      record &&
      'startDate' in record &&
      record.startDate &&
      `starts ${dateLabel(record.startDate, proposalDateOptions)}`,
    record && 'kind' in record && record.kind === 'rest' && 'Rest day',
    record && 'sport' in record && record.sport && sportLabel(record.sport),
    record &&
      'durationSeconds' in record &&
      record.durationSeconds != null &&
      duration(record.durationSeconds),
    record &&
      'distanceMeters' in record &&
      record.distanceMeters != null &&
      distance(record.distanceMeters, units),
  ].filter(Boolean);
  const rows = expanded ? proposalRows(change, units, planTitles) : [];
  const single = !context && action !== 'update';
  const beforeLabel = context ? 'When the agent read it' : 'Before';
  const afterLabel = context ? 'Now' : 'After';
  const singleLabel = action === 'create' ? 'New value' : 'Will be removed';
  return (
    <details
      className="proposal-diff"
      data-type={type}
      data-action={action}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="proposal-diff-summary">
        <span className="proposal-row-copy">
          <span className="proposal-row-heading">
            <ProposalType type={type} record={record} />{' '}
            <span className="proposal-diff-title">{changeTitle(change)}</span>
          </span>
          <span className="proposal-diff-facts">{summaryFacts.join(' · ')}</span>
        </span>
        <Badge className={`badge proposal-action proposal-action-${action}`}>
          {context
            ? { create: 'Created', update: 'Updated', delete: 'Deleted' }[action]
            : { create: 'Create', update: 'Update', delete: 'Delete' }[action]}
        </Badge>
        <ChevronRight className="proposal-row-chevron" size={16} aria-hidden="true" />
      </summary>
      {expanded && (
        <>
          <Table className={`review-fields ${single ? 'review-single' : ''}`}>
            <caption className="sr-only">{caption}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                {!single && <TableHead>{beforeLabel}</TableHead>}
                <TableHead>{single ? singleLabel : afterLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.field}>
                  <TableHead scope="row">{row.field}</TableHead>
                  {!single && (
                    <TableCell>
                      <span className="review-mobile-label">{beforeLabel}: </span>
                      {row.before}
                    </TableCell>
                  )}
                  <TableCell>
                    {!single && <span className="review-mobile-label">{afterLabel}: </span>}
                    {single && action === 'delete' ? row.before : row.after}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <details className="review-technical">
            <summary>Technical details (complete record)</summary>
            <div className="diff-columns">
              <div>
                <small>BEFORE</small>
                <pre>{JSON.stringify(change.before, null, 2)}</pre>
              </div>
              <div>
                <small>AFTER</small>
                <pre>{JSON.stringify(change.after, null, 2)}</pre>
              </div>
            </div>
          </details>
        </>
      )}
    </details>
  );
}
