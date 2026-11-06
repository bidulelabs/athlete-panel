# Charts sport filters and grouping

## Authority and scope

The owner approved implementation on 2026-11-05 in the implementation chat after reviewing the feature summary. This is the sport-selection/grouping slice of [issue #79](https://github.com/bidulelabs/athlete-panel/issues/79): Training hours, Training by sport and Climbing, with the existing period boundaries. Add metric, descent, race targets and import-completeness indicators remain separate work. Existing synthetic preview data and mockup assets are preserved.

## Implementation

- Charts owns shared Sports and Group by controls, with All sports/Week defaults, single/multiple sports, a keyboard/touch picker and at least one selected sport.
- Training's public range summary remains the calculation authority. Filtered planned/recorded sums, known/missing counts, subgroup identity, performed dates and linked-session deduplication are reused. Paired running ascent/distance is summed before division.
- Contracts 2.2.0 adds optional volume selection inputs and a nullable volume response. Week markers contain only dates; totals live in the selected volume buckets. Session, nightly and load templates keep their established behavior. Charts 1.1.0 and the composition/registry are updated together. There is no SQL migration or new host policy.
- Calendar-week date selection remains unchanged across groupings. Daily buckets retain every date; monthly buckets clip to that selection, including leap years. Current, future, missing and partial states share the chart/table model.
- Request identity includes the whole selection; aborted/stale responses cannot replace a newer result, and retries retain the choice.
- ADR assessment: existing plugin boundaries, read-only snapshot and public Training services are sufficient; no new architectural boundary or ADR is needed. The shared design system remains unchanged; controls use existing components with plugin-scoped layout.

## Verification results

- `pnpm check`: passed formatting, lint (0 errors; 174 warnings), generated registry/contracts/skills freshness, dependency boundaries, normal and strict TypeScript, 380 unit tests in 46 files, and documentation checks.
- `pnpm test:integration`: 249 tests in 18 files passed against the separate `athlete_charts_grouping_test` database on the isolated loopback PostgreSQL service. This includes actual stored records, input rejection before queries, and the existing read-lock regression checks. An initial run exposed stale generated composition metadata; regeneration resolved it before the passing rerun.
- `pnpm build`: web and worker production builds passed, including a final rebuild after the visual fixes.
- Browser matrix: Charts, new volume controls, Workspace and Workout inspector suites against a separate `athlete_charts_browser_test` instance: 82 passed, 2 intentional platform-specific skips. Desktop planning and phone review/logging paths remain covered. The new volume suite passed all 12 checks again after the final UI fixes, including both themes, 320px portrait, 844×390 landscape, keyboard tooltips, multi-selection, exact values, retry and stale-response handling. A new tooltip test initially selected November with ArrowRight; explicitly moving back to the first month corrected the test expectation.
- Visual inspection: reviewed desktop/light monthly totals, desktop/dark sport picker, phone/dark monthly chart, phone/light picker and landscape layouts. The landscape picker originally extended beyond the viewport; it now scrolls within available height, and the last sport remains reachable. Month axis labels use four-digit years to avoid looking like calendar days. Screenshots are local artifacts under `.runtime/charts/volume-*`.
- Real local API smoke: all three volume templates with Running + Cycling over the maximum 53 weeks returned the same 176800 recorded seconds for day/week/month, preserving 2025-11-03 through 2026-11-08. Responses contained 371 daily, 53 weekly or 13 monthly buckets; observed request times were 12–66 ms on this small synthetic fixture, not a production benchmark. The existing enriched preview also showed the filtered monthly values through the rendered UI.
- Final targeted formatting/lint and diff whitespace checks passed after the visual/test changes. Synthetic fixtures only; no real Garmin credentials or athlete data were used.

## Documentation validation

The 2026-11-06 PR review correction is recorded below, with its own regression evidence.

Scope: [Charts specification](../features/charts.md), [architecture](../architecture.md), [changelog](../changelog.md), generated contract reference and this task record. Framework validation compared requirements with implementation and exercised scenarios, reviewed source authority, local links, unresolved placeholders, ownership and release guidance. No diagram or ADR change is needed. Commands remain canonical in the development guide.

| Topic | Canonical document | Coverage completed | Remaining gaps |
| --- | --- | --- | --- |
| Sport selection and grouping | [Charts specification](../features/charts.md) | Defaults, selected dates, totals, missing values, supported templates, keyboard/touch, failure handling and acceptance evidence | Add metric, descent, race targets and import completeness are explicitly separate work |
| Ownership and public contract | [Architecture](../architecture.md), [contracts](../reference/contracts.json) | Plugin-owned controls/calculation, volume projection, date-only week markers, coordinated versions and generated registry | None within this feature |
| Verification and activation | This record and [development guide](../development.md) | Unit/integration/browser/build results, local synthetic activation and preserved preview data | Real-server deployment and real-provider checks were not requested or performed |

## Release status

Implementation is on `codex/charts-sport-grouping`; the owner authorized pushing the branch and opening a pull request on 2026-11-06. The existing synthetic preview at `http://127.0.0.1:3000/charts` was stopped, put in maintenance, snapshotted, updated to the matching composition, reopened and restarted with the new web/worker build. Existing demo data and mockup assets were preserved. The separate browser test server is stopped after verification. No real-server deployment or real Garmin request is included. External activation still requires the documented matched build/restart and composition validation; no new athlete records or SQL migrations are introduced. Deployment evidence remains separate from local verification.

## PR #94: narrow sport bars (2026-11-06)

The owner requested fixing the review finding, adding a regression test and pushing to PR #94. Long daily ranges could produce sport bars narrower than one CSS pixel; their two-pixel background-colored borders completely covered their fills. The shared sport renderer now omits borders on past-period bars and retains the sport-colored outline for the current period. This affects Training by sport and the elevation chart; calculations and public contracts are unchanged. No additional version, migration or shared design-system change is needed within this unreleased PR.

The browser regression requests 52 weeks grouped by day for both affected templates. It checks the 364 daily rows, verifies a positive colored interior on rendered SVG bars at desktop and 412px/320px phone widths in both themes, and verifies current-period outlines after switching to months. Against the previous production build it failed with 21 recorded bars hidden by their borders, establishing that it catches the reported defect rather than merely checking that SVG elements exist.

Fresh `pnpm check` passed (380 unit tests, normal/strict types, boundaries, generated files, formatting and 0 lint errors); all 249 integration tests and the web/worker production build also passed. The complete scoped browser rerun passed 86 tests with 2 intentional platform-specific skips, including all 4 new regression cases and the desktop planning/phone review and logging paths. Visual inspection confirmed colored bars in both templates across desktop and 320px phone layouts in light/dark themes; screenshots are under `.runtime/charts/daily-bars-*`. The first browser launch correctly stopped at the readiness guard because the lifecycle integration test had reset the shared synthetic runtime-role password; refreshing the test role through the canonical migration command restored readiness on both synthetic servers before rerunning. No real data or production configuration was involved.

The updated feature specification, Unreleased entry and this record were checked against the implementation and observed regression results using the scoped Framework validation. Local documentation links and diff whitespace checks passed. The user preview was restarted with the fixed build and its synthetic data preserved; the temporary browser server was stopped after verification. Publishing the fix updates PR #94, not a real server deployment.

## PR #94: reviewer follow-up (2026-11-06)

The owner authorized implementing, testing and pushing the three suggestions in [nathg31’s review](https://github.com/bidulelabs/athlete-panel/pull/94#pullrequestreview-5797408488). Week responses now contain only dates; the volume buckets own all measures, avoiding duplicate projections and payloads. The existing totals, missing-data, sport and climb assertions move to those buckets, and a new regression verifies the exact date-only response for all six templates. The regression failed before the fix because weekly measure totals were still present.

The three volume templates share empty-state wording that names a single selected sport, identifies multiple selected sports, and retains the original message for All sports. A browser regression covers all three templates, switching to empty single/multiple selections, restoring All sports, and choosing a genuinely empty period, on desktop and 320px phones in both themes. The Unreleased entry now introduces all six Charts templates before the new controls, with matched build/restart and browser reload guidance.

The Charts contract is unreleased; Contracts 2.2.0 and Charts 1.1.0 remain the coordinated versions for this PR. No stored data, migration, ownership boundary or shared visual convention changes. Existing synthetic data and mockup assets are preserved.

Verification completed: `pnpm generate` refreshed the public contract reference; `pnpm check` passed with 381 unit tests, both TypeScript checks, generated-file and dependency-boundary validation, formatting, documentation checks, and 0 lint errors (174 existing warnings). All 249 integration tests passed. The web and worker production builds passed. The scoped browser matrix passed 90 tests with 2 intentional platform-specific skips, including the 4 new empty-selection cases, all six chart templates, the existing narrow-bar regression, desktop planning, and phone review/logging. The totals tests continue comparing the volume buckets with the independent Calendar calculation; the final focused chart unit run passed all 42 tests.

Visual inspection confirmed that the multi-sport empty message fits desktop and 320px phone layouts in both themes; screenshots are under `.runtime/charts/empty-sports-*`. Framework validation covered the Charts feature specification, consolidated Unreleased entry, generated response schema and this execution record, including acceptance evidence, links, upgrade/reload guidance and the existing ownership boundary. No new ADR or design-system change is needed.

The user preview was restarted with the matched build and its existing synthetic data. The separate browser test server was stopped after verification. The synthetic runtime-role password was restored through the canonical migration command after the lifecycle integration suite changed it; readiness was checked before browser testing. No production data, live Garmin import or real-server deployment is involved.
