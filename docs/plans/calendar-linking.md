# Calendar clarity and automatic Garmin linking

## Authority and scope

On 2026-11-10 the owner explicitly requested implementation of the plan in this chat. A durable chat URL is unavailable. The owner selected unique matches only, replacement of manual measurements while preserving annotations/status, new imports only, respect for sport subtypes, one combined calendar card, and performed dates for manually logged workouts. No production deployment or private-data operation was requested.

## Audit evidence

Current-source inspection and a synthetic preview with matching workout-card behavior confirmed icon-only completion, invisible Garmin links, unlabelled planned values, incorrectly completed cross-date partial entries and approximately 69px cards at 1100px with the inspector open. Phone checks at 320/390px showed no horizontal overflow and retained keyboard dismissal/focus return. The preview differed in unrelated context-card styling. Impeccable's published audit/shape guidance was used; its launcher and detector were unavailable.

## Implementation

Training owns symmetric matching, link provenance and independent audit/undo. Garmin stages first-import identities, waits for complete successful scans and runs date-bounded matching with leases/account verification. Calendar cards share explicit status/source and recorded/planned presentation; activity details provide direct linking. The inspector overlays below 1536px. Contracts, manifests, registry and additive Garmin migration are coordinated in this change. The [feature specification](../features/training-workspace.md#calendar-state-clarity-and-automatic-garmin-linking) is authoritative.

## Verification

Completed locally on 2026-11-10 against isolated synthetic storage. The standard `pnpm test:db:start` encountered an occupied test port; this checkout used separately named `calendar_linking_6dac_test` and `calendar_linking_6dac_ui_test` databases on that existing test server. No personal configuration, credentials or real Garmin requests were used.

| Check | Actual result |
|---|---|
| `pnpm generate` | Registry, contracts and skill adapters generated; compatibility validated for all nine enabled plugins. |
| `pnpm check` | Passed formatting, lint (existing warnings, no errors), generated-file checks, import boundaries, both TypeScript configurations, 398 unit tests across 48 files and documentation validation. |
| `pnpm test:integration` | Passed all 274 tests across 19 files. Repeated after adding the provider-correction provenance assertion; also passed. |
| `pnpm build` | Web and worker production builds passed. Browser tests used the final build. |
| `pnpm test:e2e` with calendar-state, calendar-cards, workout-inspector, shared-ui, plans and weekly-summary suites | 62 passed; four intentional project-specific skips. Includes direct linking, stale drafts and original revisions, keyboard/focus recovery, resize preservation, manual/linked actuals and deduplicated totals. |
| Final calendar-state regression | Five passed; one duplicate mobile matrix skipped. Includes cross-date Garmin-linked partial completion, after extending the fixture. |
| Visual/accessibility checks | Dark/light at 320, 390, 1100, 1440 and 1600px. No horizontal overflow; status labels remain readable; columns exceed 110px with the inspector open; modal/adjacent placement matches the breakpoint. Reduced-motion transitions are disabled. At 320px, linking buttons are 44px high and the native select is 44.84px high. Normal-card text/token contrast is at least 6.02:1 in dark and 6.11:1 in light. |

Local screenshot evidence is in `.runtime/calendar-linking/calendar-{width}-{theme}.png`. Supporting inspector/context/summary images are in `.runtime/browser/`. Screenshots were inspected at desktop, intermediate and phone widths. The Impeccable automated detector was unavailable; verification used source review, Chromium interactions, screenshots, measured dimensions and color contrast.

Initial browser failures were test-selector mismatches after the inspector breakpoint changed, and an exact label lookup that included native option text. Tests now locate the active dialog and the combobox's accessible role. The added partial fixture initially omitted its required reason; it was corrected before the passing final run. No unresolved verification failure remains. Real-account import and production activation were not performed.

### Documentation validation

| Topic | Canonical document | Coverage completed | Remaining gaps |
|---|---|---|---|
| Matching, completion and card behavior | [Training workspace](../features/training-workspace.md#calendar-state-clarity-and-automatic-garmin-linking) | Rules, contract, exclusions, undo/unlink and acceptance evidence checked against implementation/tests. | None in implemented scope. |
| Import lifecycle and activation | [Garmin import](../features/garmin-import.md#automatic-workout-linking) | Scan staging, retries, cancellation, dependency and additive migration documented. | Production upgrade remains separate. |
| Visual conventions and responsive behavior | [Design](../../DESIGN.md), [shared UI](../features/shared-ui.md) | Status/source hierarchy, themes and 1536px breakpoint aligned. | None in implemented scope. |
| Ownership and decision authority | [Architecture](../architecture.md#automatic-activity-matching), [ADR 021](../decisions/021-automatic-activity-linking.md) | Public Training helper, Garmin ownership and explicit approved-plan evidence recorded. | No durable chat URL available; authority is transcribed above. |

README's deferred list, PRODUCT and Unreleased changelog agree with the implemented scope. Affected requirements, local links, anchors, upgrade ordering and rollback constraints were reviewed; no framework guide/template was changed.

## Activation and rollback

Use the [coordinated upgrade procedure](../development.md#coordinated-upgrades-and-plugin-activation) for the additive migration and matched composition/web/worker. Reload browser tabs. There is no history sweep. Rollback after new link metadata is written requires the matching pre-upgrade backup. Production deployment has not been performed.

### Local owner test instance

On 2026-11-10 the owner separately requested a generic-data test app and selected local operation on this Mac. The verified web build and worker were copied into `.runtime/calendar-demo/` and started on loopback port 3046 with a separate synthetic database, `calendar_demo_6dac_test`. The dataset contains 21 workouts, 3 notes, 4 events, 2 injury constraints, 11 activities and 161 health records, including two automatic associations and one explicitly linked cross-date partial session. No real Garmin connection is configured. Runtime files and login configuration remain ignored by Git.

Actual smoke checks passed: readiness, sign-in, automatic-link explanation, note edit persisted after reload, event/injury details, and same-day compatible manual link options. A local start/status/stop helper and storage-lifetime notes are in `.runtime/calendar-demo/README.md`. The background processes were left running for the owner to test; the shared test database service was not stopped or replaced.

### Approved subtle card refinement

On 2026-11-10 the owner requested implementation of the current-app mockup and an updated local demo. The approved direction retains the existing compact calendar, font stack, paired palette and context cards. Completed and partial workouts gain a 2px inset status edge. Recorded measurements have a distinct supporting label and stronger values (14px on phones); the Garmin/manual source moves below measurements and cross-date information, separated by a thin divider. Source styling is scoped to calendar cards so inspector composition stays intact. Accessible descriptions follow the visual reading order. The design record, Impeccable component example, training specification and Unreleased entry now describe this hierarchy. This presentation refinement adds no persisted behavior, contract or migration; no new ADR is needed.

Verification after the refinement: `pnpm check` passed, including 398 unit tests, both type checks and documentation validation (existing lint warnings only). `pnpm build` passed for web and worker. Calendar-state, calendar-cards and workout-inspector browser suites passed 33 tests with three intentional project-specific skips against `calendar_linking_6dac_ui_test` on port 3057. The matrix covers both themes at 320, 390, 1100, 1440 and 1600px, all completion states, missing/zero values, partial cross-date links, direct linking, stale-save recovery, keyboard focus, reduced motion, phone hit areas and editor resize preservation. Desktop, narrow-desktop and phone screenshots were inspected. Existing integration evidence above remains applicable; no server/domain behavior changed and integration tests were not repeated for this visual refinement. Documentation coverage and cited implementation were reviewed against the framework validation checklist.

The verified build copies replaced the local demo web/worker on port 3046; the prior copies remain in `.runtime/calendar-demo/refinement-previous/`. No seed or database migration was run. Readiness, both processes, the automatic-link explanation and phone focus/overflow checks passed after restart. A SHA-256 comparison of the loaded workspace before/after restart confirmed that its data was identical. Updated app screenshots are `.runtime/calendar-demo/refinement-desktop.png` and `refinement-mobile.png`; matrix images remain under `.runtime/calendar-linking/`. The owner demo remains running. Production deployment was not performed.

### Sea glass palette activation

On 2026-11-11 the owner selected Sea glass from the color mockups and explicitly requested implementation and a local demo update. Calendar-owned CSS now supplies paired light/dark fills and inks: teal completed workouts/imported activities, apricot partial sessions/events, slate-blue planned workouts/goals, lavender notes, periwinkle sleep and rose injury context. Skipped/rest cards remain neutral. Card structure and behavior are preserved; orange selection outlines retain the underlying status fill, and hover emphasizes the semantic border. Secondary text is tuned for the new fills. Tokens are scoped to calendar cards; global proposal-review colors and inspector styling are unaffected. DESIGN, the Impeccable example, the training specification and Unreleased entry are aligned. There is no contract, composition, migration or persisted-behavior change, and no new ADR is required.

Actual verification: `pnpm check` passed (398 unit tests across 48 files, generated checks, boundaries, both type checks and documentation; existing lint warnings only). `pnpm build` passed for web and worker. The calendar-state, calendar-cards and workout-inspector suites passed 33 browser tests with three intentional project-specific skips against the separate synthetic UI database. The matrix covers both themes at 320, 390, 1100, 1440 and 1600px, status/source text, missing and zero measurements, cross-date partial sessions, linking, stale saves, logging, keyboard/focus, resize recovery and reduced motion. Desktop and phone matrix screenshots were visually inspected. Existing integration results above remain applicable; no domain/server code changed and integration tests were not repeated for this palette-only change.

The local demo on port 3046 was restarted with the verified web/worker copies and left running. Previous compatible copies are retained under `.runtime/calendar-demo/sea-glass-previous/`; a palette-only rollback can use them without a database restore. No seed or migration was run. Readiness and both processes passed, and the loaded workspace SHA-256 remained identical before/after restart. Actual demo checks confirmed automatic-link explanations, phone focus return and no horizontal overflow. Measured card text contrast was at least 5.71:1 in dark and 4.77:1 in light, including context tags. Selected cards retained their status fill with the orange border in both themes. Current screenshots are `.runtime/calendar-demo/sea-glass-desktop.png` and `sea-glass-mobile.png`. Production deployment was not performed. Documentation coverage, source alignment and linked acceptance evidence were reviewed under the framework validation checklist.

### PR browser regression

On 2026-11-11 the complete PR browser matrix exposed two stale assertions outside the earlier focused suites: sport planning expected lowercase `partial`, while workspace logging targeted the removed `.completion-state` class. Both now assert the visible `Partial` and `Completed` labels. The sport-planning and workspace suites passed all 16 desktop/phone tests against `calendar_linking_6dac_ui_test`, including both themes, linking, completion persistence and failed-save recovery. Formatting, whitespace and documentation checks passed. Application code and the owner's local demo were unchanged by this test-only correction; the pushed commit triggers a fresh complete CI run.
