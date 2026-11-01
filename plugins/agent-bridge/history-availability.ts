import type { HistoryRecord, HistorySelection } from '@athlete-panel/contracts';

/** The keyset date orders a record; it is not necessarily its full dated extent.
 * Owning readers supply clipped interval endpoints. Keep only facts inside this
 * selection, even when the grant permits a wider range. */
export function historyRecordBounds(
  row: HistoryRecord,
  range: Pick<HistorySelection, 'from' | 'to'>,
) {
  const dates = [
    row.date,
    row.data.scheduledDate,
    row.data.performedDate,
    row.data.startDate,
    row.data.endDate,
    row.data.from,
    row.data.to,
  ]
    .filter((date): date is string => Boolean(date && date >= range.from && date <= range.to))
    .sort();
  return { from: dates.at(0), to: dates.at(-1) };
}
