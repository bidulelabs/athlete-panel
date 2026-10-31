'use client';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
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
} from '@athlete-panel/ui';
import type { Entity, ProposalSummary } from '@athlete-panel/contracts';
import { proposalRows } from './proposal-diff';
import { calendarDate, groupChangesByWeek, groupChangesByMonth } from './proposal-weeks';
function recordLabel(record: Entity | null): string | undefined {
  if (!record) return undefined;
  if ('title' in record) return record.title;
  if ('bodyPart' in record) return record.bodyPart;
  return undefined;
}
const weekdayDate = { weekday: 'short', day: 'numeric', month: 'short' } as const;

export function ProposedEdits({
  changes,
  planTitles,
}: {
  changes: ProposalSummary['changes'];
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
  month: { month: string | null; changes: ProposalSummary['changes'] };
  planTitles: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details className="proposal-month" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <strong>{dateLabel(`${month.month}-01`, { month: 'long', year: 'numeric' })}</strong>
        <span>
          {month.changes.length} change{month.changes.length === 1 ? '' : 's'}
        </span>
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
  changes: ProposalSummary['changes'];
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
            <span>
              {week.changes.length} change{week.changes.length === 1 ? '' : 's'}
            </span>
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
}: {
  change: ProposalSummary['changes'][number];
  planTitles: Record<string, string>;
  caption: string;
}) {
  const { data } = useWorkspace();
  const units = data.profile?.units ?? 'metric';
  const [expanded, setExpanded] = useState(false);
  const record = change.after ?? change.before;
  const date = calendarDate(change);
  const dateChanged =
    change.before && change.after && change.beforeEffectiveDate !== change.afterEffectiveDate;
  const summaryFacts = [
    date && dateLabel(date, weekdayDate),
    dateChanged &&
      `moved from ${change.beforeEffectiveDate ? dateLabel(change.beforeEffectiveDate) : 'unscheduled'}`,
    record &&
      'startDate' in record &&
      record.startDate &&
      `starts ${dateLabel(record.startDate, weekdayDate)}`,
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
  return (
    <details className="proposal-diff" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="proposal-diff-summary">
        <Badge className="badge">
          {!change.before ? 'Create' : !change.after ? 'Delete' : 'Update'}
        </Badge>{' '}
        <span className="proposal-diff-title">{recordLabel(record) ?? change.entity}</span>{' '}
        <span className="proposal-diff-facts">{summaryFacts.join(' · ')}</span>
      </summary>
      {expanded && (
        <>
          <Table className="review-fields">
            <caption className="sr-only">{caption}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Before</TableHead>
                <TableHead>After</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proposalRows(change, units, planTitles).map((row) => (
                <TableRow key={row.field}>
                  <TableHead scope="row">{row.field}</TableHead>
                  <TableCell>
                    <span className="review-mobile-label">Before: </span>
                    {row.before}
                  </TableCell>
                  <TableCell>
                    <span className="review-mobile-label">After: </span>
                    {row.after}
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
