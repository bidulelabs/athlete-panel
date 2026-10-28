# Garmin sport planning execution record

## Scope and authorization

The owner requested Garmin group/subgroup planning, expanded workout prescriptions and recorded activity detail on 2026-10-28. Product scope is defined in the [feature specification](../features/garmin-sport-planning.md) and [decision 011](../decisions/011-garmin-sport-hierarchy.md). Existing product architecture and design conventions remain authoritative. Production access and deployment are not performed by this task.

## Implementation

Shared catalog/identity, strict link validation, rest days, planned elevation, exercise prescriptions, completion notes, 20,000-character narrative, agent redaction, Garmin recorded metrics and in-place reimport enrichment are implemented in the owning contracts/plugins. Existing weekly details gain group/subgroup breakdowns; no new trends route or SQL migration is added. Composition and contract references are regenerated.

## Verification

Completed locally on 2026-10-28 using synthetic fixtures only:

- `pnpm check`: formatting, lint (advisory complexity warnings, no errors), registry/contract/skill synchronization, plugin boundaries, both type checks, 177 unit tests and documentation checks passed.
- `pnpm test:integration`: 114 PostgreSQL integration tests passed on isolated localhost `_test` storage. Tests include annotation-preserving history enrichment, subgroup correction rollback, and hidden exercise-instruction protection.
- `pnpm build`: Next.js application and worker build passed. Final check/build used Node 24; the deployment image remains pinned to Node 22 and was not rebuilt or deployed in this task.
- Relevant Playwright suites cover sport planning, workspace, workout inspector, weekly summary and proposal review: 38 distinct scenarios passed across desktop/mobile, with 2 intentional device-specific skips. Both themes, kg/lb editing, linking annotations, rest controls, filters and summaries were exercised. Changed label/table selectors were updated and their failed cases rerun successfully.

Live-provider verification, image deployment and backup/restore rehearsal for this new release remain unperformed. No production credentials or provider data were used. The catalog is a pinned recorded response, not a fresh authenticated taxonomy fetch; unknown or conflicting metadata remains unresolved.

## CI rehearsal follow-up

PR #64 exposed a stale version pin in the hosted rehearsal: its synthetic owner plugin copied the cycling/sleep manifest at version 1.1.0 while its composition entry still required 1.0.0. Local reproduction failed with `Version pin mismatch: owner-example`. The fixture now pins the version from the copied manifest; production version validation remains unchanged.

Follow-up verification on 2026-10-28 passed: registry generation for the actual synthetic upgrade candidate, all 20 hosted-controller tests, a Node 22 runtime image build, and both complete hosted rehearsals (source rebuild and registry image). Each rehearsal verified upgrade, interruption after commit, resume, backup recovery and restoration into an empty replacement cluster, then removed its disposable services, volumes and state. These local synthetic checks do not constitute production deployment or real off-host recovery acceptance.

## Deployment and rollback

Deploy through the documented [upgrade procedure](../development.md#coordinated-upgrades-and-plugin-activation) only after operator authorization. Existing activity records gain authoritative classifications and recorded metrics through the normal historical reimport described in the [sport contract upgrade guidance](../development.md#garmin-sport-contract-upgrade). A rollback after new classifications/fields are saved may need the matched pre-upgrade backup.

## Design review

The Impeccable finish reviewer inspected all 20 synthetic captures in `.runtime/sport-review/{desktop,mobile}-{dark,light}-{editor,exercises,inspector,activities,summary}.png`. The follow-up review marked all three requested fixes resolved: recorded values precede planned values in the sport table, mobile filter arrows sit inside their controls, and [PRODUCT.md](../../PRODUCT.md) describes the expanded sport editor. Its **ship** disposition is limited to those three fixes; it is not deployment approval or a broader accessibility certification.

The documenter checked the training editor, exercise editor and inspector styles, activity page and styles, weekly summary and styles against the [feature specification](../features/garmin-sport-planning.md), product context, [DESIGN.md](../../DESIGN.md) and [design sidecar](../../.impeccable/design.json), and sampled the mobile light activity and desktop dark summary captures. This ordinary extension preserves the graphite/near-white palette, orange actions, shared controls, compact desktop planning and phone review/logging conventions. No new shared visual rule is warranted; DESIGN.md and its sidecar remain unchanged.

The existing detector report at `/tmp/athlete-panel-design-detection.json` contains six advisory findings for pre-existing typography and radius values in `plugins/calendar/weekly-summary.css`. They remain outside this extension's fix scope, unmodified and not adopted as new system rules. The documenter did not rerun the detector.
