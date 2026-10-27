import { activityScanSchema, type CoverageRow } from '@athlete-panel/contracts';
import type { Transaction } from '../../packages/host/src/db';
import type { GarminSyncCursor, SyncCoverage } from './sync';
import { requestCoverageIdentity } from './sync';

export type StoredCoverage = Omit<CoverageRow, 'lastScannedAt'> & { lastScannedAt: Date | null };
export const coverageDto = (row: StoredCoverage): CoverageRow => ({
  ...row,
  lastScannedAt: row.lastScannedAt?.toISOString() ?? null,
});

/** Preserve counts when resuming a pre-diagnostics activity checkpoint. */
export async function resumeActivityScan(tx: Transaction, cursor: GarminSyncCursor) {
  if (
    cursor.activityOffset === 0 ||
    cursor.activityScan ||
    !['recent-activities', 'history-activities'].includes(cursor.phase)
  )
    return cursor;
  const window = requestCoverageIdentity(cursor);
  const [old] = await tx<
    { records: number; rejected_records: number; diagnostics: unknown }[]
  >`select records,rejected_records,diagnostics from garmin.coverage where stream='activities' and start_date=${window.from ?? '0001-01-01'} and end_date=${window.to}`;
  return {
    ...cursor,
    activityScan: activityScanSchema.parse({
      records: old?.records ?? 0,
      rejectedRecords: old?.rejected_records ?? 0,
      diagnostics: old?.diagnostics ?? [],
      oldestReturnedDate: null,
    }),
  };
}

export async function persistCoverage(tx: Transaction, coverage: SyncCoverage) {
  if (coverage.stream === 'identity') return;
  const finished = coverage.scanState === 'scanned';
  await tx`insert into garmin.coverage(stream,start_date,end_date,status,records,error,missing_days,unknown_metrics,scan_state,scanned_at,rejected_records,diagnostics)
    values(${coverage.stream},${coverage.from ?? '0001-01-01'},${coverage.to},${coverage.status},${coverage.returnedRecords},${coverage.errorCode ?? null},${coverage.missingDays},${coverage.unknownMetrics},${coverage.scanState},${finished ? new Date() : null},${coverage.rejectedRecords},${tx.json(coverage.diagnostics)})
    on conflict(stream,start_date,end_date) do update set
      scan_state=excluded.scan_state,scanned_at=case when ${finished} then excluded.scanned_at else garmin.coverage.scanned_at end,
      status=case when ${finished || coverage.scanState === 'unavailable'} or garmin.coverage.scanned_at is null then excluded.status else garmin.coverage.status end,
      records=case when ${finished} or garmin.coverage.scanned_at is null then excluded.records else garmin.coverage.records end,
      rejected_records=case when ${finished} or garmin.coverage.scanned_at is null then excluded.rejected_records else garmin.coverage.rejected_records end,
      diagnostics=case when ${finished} or garmin.coverage.scanned_at is null then excluded.diagnostics else garmin.coverage.diagnostics end,
      error=excluded.error,missing_days=excluded.missing_days,unknown_metrics=excluded.unknown_metrics,updated_at=now()`;
}
