import { AppError } from './errors';
/** Only for queries whose contract is at most one result. Absence is deliberately optional. */
export function optionalRow<T>(rows: readonly T[]): T | undefined {
  if (rows.length > 1)
    throw new AppError('unexpected_rows', 'The stored result was not unique.', 500);
  return rows[0];
}
export function requiredRow<T>(
  rows: readonly T[],
  missing: Error = new AppError('missing_row', 'An expected stored result is missing.', 500),
): T {
  const row = optionalRow(rows);
  if (row === undefined) throw missing;
  return row;
}
