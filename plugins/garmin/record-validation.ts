import { z } from 'zod';
import { GarminError } from './transport';
import {
  activitySchema,
  healthRecordSchema,
  type ImportStream,
  type RejectionDiagnostic,
} from '@athlete-panel/contracts';
import {
  normalizeActivities,
  normalizeHealth,
  object,
  providerId,
  dayKey,
  utcTimestamp,
  type ImportedActivity,
  type ImportedHealthRecord,
} from './normalize';

type Window = { stream: ImportStream; from: string | null; to: string; pageOffset: number };
const importedActivitySchema = activitySchema.omit({ id: true, revision: true });
const importedHealthSchema = healthRecordSchema.omit({ id: true, revision: true });
const rowError = (code: RejectionDiagnostic['code'], fields: string[]) => ({ code, fields });

export function validateRecords(rows: unknown[], window: Window, timeZone: string) {
  const activities: ImportedActivity[] = [],
    healthRecords: ImportedHealthRecord[] = [];
  const diagnostics: RejectionDiagnostic[] = [];
  let rejectedRecords = 0;
  rows.forEach((raw, index) => {
    const row = object(raw);
    try {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        throw rowError('invalid_record', []);
      if (window.stream === 'activities') {
        try {
          if (providerId(row.activityId) === null) throw new Error();
        } catch {
          throw rowError('invalid_identifier', ['activityId']);
        }
        if (!utcTimestamp(row.startTimeGMT)) throw rowError('invalid_date', ['startTimeGMT']);
        const records = normalizeActivities([row], timeZone).map((value) =>
          importedActivitySchema.parse(value),
        );
        activities.push(...records);
      } else {
        const payload =
          window.stream === 'daily'
            ? { data: [row] }
            : window.stream === 'hrv'
              ? { hrvSummaries: [row] }
              : [row];
        const records = normalizeHealth(window.stream, payload).map((value) =>
          importedHealthSchema.parse(value),
        );
        if (
          records.some(
            (record) =>
              (window.from !== null && record.localDate < window.from) ||
              record.localDate > window.to,
          )
        )
          throw rowError('outside_window', ['localDate']);
        healthRecords.push(...records);
      }
    } catch (error) {
      rejectedRecords++;
      if (diagnostics.length >= 50) return;
      const details = z
        .object({
          code: z.enum([
            'invalid_record',
            'invalid_identifier',
            'invalid_date',
            'outside_window',
            'schema_validation',
          ]),
          fields: z.array(z.string()),
        })
        .safeParse(error);
      if (
        !details.success &&
        !(error instanceof z.ZodError) &&
        !(error instanceof GarminError && error.code === 'invalid_payload')
      )
        throw error;
      let identifier: string | undefined;
      try {
        const id = providerId(row.activityId ?? row.id);
        if (id && /^\d{1,128}$/.test(id)) identifier = id;
      } catch {
        /* Invalid IDs are never copied into diagnostics. */
      }
      const date = dayKey(
        row.calendarDate ??
          row.date ??
          (typeof row.startTimeLocal === 'string' ? row.startTimeLocal.slice(0, 10) : undefined),
      );
      diagnostics.push({
        ...window,
        index,
        ...(identifier ? { identifier } : {}),
        ...(date ? { date } : {}),
        code: details.success
          ? details.data.code
          : error instanceof z.ZodError
            ? 'schema_validation'
            : 'invalid_date',
        fields: details.success
          ? details.data.fields
          : error instanceof z.ZodError
            ? error.issues.slice(0, 8).map((issue) => issue.path.join('.').slice(0, 160))
            : ['calendarDate'],
      });
    }
  });
  return {
    activities: [...new Map(activities.map((record) => [record.externalId, record])).values()],
    healthRecords: [
      ...new Map(healthRecords.map((record) => [record.externalId, record])).values(),
    ],
    rejectedRecords,
    diagnostics,
  };
}
