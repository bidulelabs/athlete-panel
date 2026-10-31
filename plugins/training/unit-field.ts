export function unitFieldText(stored: number | null | undefined, storedPerUnit: number): string {
  return stored == null ? '' : String(Number((stored / storedPerUnit).toFixed(3)));
}

export function storedFromUnitField(
  field: FormDataEntryValue | null,
  stored: number | null | undefined,
  storedPerUnit: number,
): number | null {
  if (field === '') return null;
  if (stored != null && field === unitFieldText(stored, storedPerUnit)) return stored;
  return Number(field) * storedPerUnit;
}
