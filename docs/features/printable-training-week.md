# Feature: Printable training week

## Purpose and scope

Provide an optional print view of one week’s prescribed training. It is a small reference for building a personal source plugin across sports, using public data and shared UI without new storage or services.

Outside scope: recorded activity/completion reports, training edits, automatic PDF generation, external services and background jobs.

## Intended behavior

Specification status: approved scope. Requirement source: [issue #114 and the owner’s decision](https://github.com/bidulelabs/athlete-panel/issues/114#issuecomment-6794250299), followed by the owner’s implementation request in this chat on 2026-11-11 to remove Cycling & sleep and add the printable example disabled by default.

The default composition includes the example’s exact version with `enabled: false`; no page or navigation entry loads until explicit activation. Cycling & sleep is removed. The replacement can preview a selected week, list planned sessions in date/session order, include prescribed intervals and strength exercises, optionally include notes, and invoke browser printing/Save as PDF. It follows the athlete’s week-start and units preferences and preserves unknown values. It is read-only and works without an agent after activation.

Implementation choices within that scope: the page uses the workspace’s loaded week anchor and date navigation; notes start excluded. Notes include workout descriptions, interval notes and exercise instructions. Plan descriptions, unrelated calendar notes, profile goals and completion notes are never printed. Completed/skipped workouts retain their original prescription and scheduled date; imported activities and recorded actuals are excluded. Unscheduled plans have no printable date. All seven days are shown, distinguishing an explicitly prescribed rest day from a day with no planned session. Long weeks may use multiple pages instead of shrinking or truncating prescriptions. Paper size/margins and PDF destination remain browser choices.

## Acceptance scenarios

| Situation or input | Expected observable result | Verification |
| --- | --- | --- |
| Default composition | Printable week is disabled and absent from client imports/navigation; old route is unavailable | [Registry tests](../../tests/unit/registry-contributions.test.ts), [browser checks](../../tests/e2e/printable-week.spec.ts) |
| Example explicitly enabled | Registered page loads without host-specific routing code or a server entry | Registry and enabled browser checks |
| Independent and plan-based sessions, mixed sports and multiple sessions per day | Scheduled dates and explicit order retained; unscheduled/out-of-week entries excluded | [Projection tests](../../tests/unit/printable-week.test.ts) |
| Sunday/Monday weeks, DST or year boundary | Seven correct floating dates using the selected boundary | Projection and browser checks |
| Completion on a different date | Original planned date/values printed, no completion narrative or recorded metrics | Projection and browser checks |
| Intervals, repeat groups, lap-button steps and strength prescriptions | Full ordered prescription, targets and selected units | Formatting and browser checks |
| Notes excluded/included | All three supported note fields absent/present; completion notes always absent | Browser checks |
| Missing duration or known zero | “Duration not specified” for unknown; explicit zero for known zero | Formatting and browser checks |
| Empty week or refresh failure | Explicit empty week; failed refresh retains the last loaded week/date label and visible retry | Browser checks |
| Desktop/phone in either theme; print with long content | Wrapping screen preview, monochrome print with shell/controls omitted, no clipped prescription | Browser screenshots, generated A4 PDFs and visual inspection |

## Observed implementation

The [manifest](../../personal-plugins/printable-training-week/manifest.json) registers `/printable-training-week` and depends on Training’s public interface. The [projection](../../personal-plugins/printable-training-week/week.ts) uses its public `effectiveDate` helper and shared calendar arithmetic. The [page](../../personal-plugins/printable-training-week/client.tsx) consumes typed workspace props, public UI components and a plugin-local prescription renderer. The [stylesheet](../../personal-plugins/printable-training-week/printable-week.css) scopes print overrides to the mounted page; it does not alter other pages’ print layout after navigation. The print button calls the browser’s print dialog. No server entry, schema, migration or write operation is introduced.

Evidence: source and tests linked above. Actual results and limitations are recorded in the [task record](../plans/printable-training-week.md). Browser PDF generation checks layout, not a physical printer or every browser’s native print UI.

## Contracts and constraints

Use the existing [workspace and workout contracts](../../packages/contracts/src/domain.ts), [Training public date helpers](../../plugins/training/public/shared.ts) and [public UI](../../packages/ui/src/index.ts). Missing measurements are not inferred from intervals or completion. Notes are rendered with the shared safe Markdown component; interval notes remain plain text. Units are converted for display only. The plugin owns its print presentation and makes no training changes.

No shared visual convention or ownership boundary changes; existing [design rules](../../DESIGN.md) and [plugin architecture](../architecture.md) apply. No new ADR is required for this application of the existing source-plugin decision.

## Verification and release details

The [development guide](../development.md#printable-training-week-example) owns preview, activation and rollback procedures. The new plugin is `1.0.0`, pinned and disabled by default. Removing Cycling & sleep requires the usual reviewed composition change; neither example owns stored athlete data or applied migrations. Source/build rollback for this change has no data conversion, subject to other changes in the release.

Backup/restore and hosted-upgrade checks use the separate [synthetic fixture](../../tests/fixtures/owner-plugin/manifest.json). CI exercises both the default and enabled compositions. Implementation, actual verification and deployment remain separate in the [task record](../plans/printable-training-week.md).
