# Printable training week

A read-only personal plugin that prints one week of planned sessions, intervals and strength exercises. It ships **disabled by default**.

- `manifest.json` declares its route and Training dependency; there is no server entry or migration.
- `week.ts` resolves schedules through Training’s public date helper and respects the selected week boundary.
- `client.tsx` uses public workspace/UI exports. `prescription.tsx` and `format.ts` format the existing prescription for paper; they never calculate a replacement training plan or read recorded actuals.
- `printable-week.css` owns responsive preview and scoped print styles. Printing uses the browser dialog, including its Save as PDF destination.

Notes start excluded. The checkbox includes workout notes, interval notes and exercise instructions. Completion notes and unrelated athlete context never enter the sheet.

Follow the [development guide](../../docs/development.md#printable-training-week-example) for synthetic preview, explicit composition activation, build/restart and rollback. The [feature specification](../../docs/features/printable-training-week.md) defines behavior and the [task record](../../docs/plans/printable-training-week.md) records verification.
