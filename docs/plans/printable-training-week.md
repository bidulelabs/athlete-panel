# Issue #114: Printable training week example

## Authority and scope

The owner requested implementation in this chat on 2026-11-11: remove Cycling & sleep and add Printable training week disabled by default. The [issue comment](https://github.com/bidulelabs/athlete-panel/issues/114#issuecomment-6794250299) records the agreed scope. [Feature specification](../features/printable-training-week.md).

## Implementation

- Removed Cycling & sleep source, default route and obsolete projection tests.
- Added a read-only printable-week example pinned with `enabled: false`, using public Training date resolution and workspace/UI contracts.
- Added optional notes and browser print layout, synthetic fixtures, formatting/projection checks and enabled/default browser coverage.
- Updated the scaffold to current Activity Records compatibility and all-sport bounded activity totals.
- Decoupled backup and hosted-upgrade fixtures from the example; updated docs and canonical skill.

## Verification record

The standard test database port 55439 was occupied by another preview. A separate disposable PostgreSQL 17 Compose project, `athlete-panel-printable-6c82`, uses loopback port 55469 with synthetic credentials and tmpfs storage. No owner configuration or athlete data is loaded.

Verified locally on 2026-11-11:

- `pnpm generate`: registry and canonical skill adapters synchronized. Default composition has eight enabled plugins; the printable example is pinned at 1.0.0 and disabled.
- `pnpm check`: formatting, lint (warnings only), generated freshness, public/browser boundaries, both TypeScript configurations, all 390 unit tests and documentation checks passed. Initial type errors in the new fixture/Markdown props were corrected before the passing run.
- `pnpm test:integration`: all 269 tests in 19 files passed against the dedicated test service, including actual encrypted backup/restore of the independent owner-plugin fixture.
- `pnpm build`: both default and explicitly enabled compositions passed.
- Default browser run: 34 passed, 10 intentional skips across desktop/phone. Covered both absent example routes, shared UI in both themes, planning, logging, reload, keyboard behavior and workout inspection. Eight skips are the enabled-only plugin cases; two are pre-existing project-specific cases.
- Enabled browser run: 8 passed, 2 intentional skips (the default-only route case on each device). Covered both themes, notes, units, Sunday weeks, failed refresh/retry, empty weeks, browser print invocation, read-only requests and print CSS isolation after leaving the page.
- Operational Python checks: 120 tests ran successfully, with two existing skips. The first sandboxed attempt could not create its `/var/tmp` fixtures; the run with temporary-directory access passed. Full hosted container/install rehearsals were not run locally.
- Visual review: desktop/phone previews in both themes, two-page normal A4 PDFs and seven-page long-prescription PDFs. Fixed desktop date-control wrapping, print opacity during the page-entry animation, detached headings and clipped list markers. Inspected all final light-PDF pages and the equivalent dark print styling; extracted text confirms all 36 long-case exercises, the final footer and no completion notes. Physical printers and other browser engines were not tested.
- Evidence is local under `.runtime/printable-week-review/` (screenshots and PDFs), with check/build/integration/browser logs in `.runtime/printable-*.log`.
- Framework validation covered README, architecture, plugin/shared-UI/training/new feature specs, development/changelog, this record and the canonical/generated skill. Requirements trace to the issue/owner request; implementation choices are labelled; links and acceptance evidence were reviewed. No shared visual convention or ownership decision changed, so no new ADR or design-system revision is needed.

Final restoration completed: `pnpm generate`, the repeated `pnpm check` (390 unit tests) and the final default `pnpm build` passed. Both the composition and generated metadata retain `enabled: false`; the generated client imports neither example. The temporary preview processes and this task’s disposable database service were stopped. The unrelated Next-generated environment declaration was restored to its original contents.

## Deployment

No deployment requested or performed. Default composition must remain disabled after local verification. Activation and rollback follow the [development guide](../development.md#printable-training-week-example).
