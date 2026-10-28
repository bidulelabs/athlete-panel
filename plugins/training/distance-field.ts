export function distanceFieldText(
  meters: number | null | undefined,
  metersPerUnit: number,
): string {
  return meters == null ? '' : String(Number((meters / metersPerUnit).toFixed(3)));
}

export function distanceMetersFromField(
  field: FormDataEntryValue | null,
  meters: number | null | undefined,
  metersPerUnit: number,
): number | null {
  if (field === '') return null;
  if (meters != null && field === distanceFieldText(meters, metersPerUnit)) return meters;
  return Number(field) * metersPerUnit;
}
