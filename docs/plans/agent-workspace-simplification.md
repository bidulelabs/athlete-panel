# Agent workspace simplification

## Authority and scope

The owner approved implementation of the complete `/agent` simplification plan in this chat on 2026-11-10, after choosing lists and review, keeping the full summary visible, and moving Change history to a secondary panel. The audit used current source and an older synthetic preview with Impeccable's upstream audit/distill guidance; no automated detector result is claimed. The plugin-development skill and existing product/design/feature records govern implementation.

This is UI work in Agent Bridge, with an owner-authorized shared history extraction into Training and `packages/ui` on 2026-11-11. Connection approval, permission defaults, CLI, public contracts, migrations, server validation, atomic apply and undo are unchanged. No private-server deployment or production athlete-data access is authorized by this task.

## Implementation

- Two associated tab panels, compact proposal previews with affected dates, one header Connect action, secondary history Sheet, and disclosed privacy copy.
- Active connections first; inactive group and precise permissions collapsed initially. Notes-sharing indicator, legacy scope preservation and confirmed revocation with failure recovery and focus restoration.
- Full review summary preserved; collapsed context records, lazy week groups above 20 changes, existing month thresholds, distinct loading/error states, total-count Apply action and conditional filter reminder.
- Plugin-local layout styles use existing controls and tokens, with readable metadata and 44px phone targets.

## Verification

All routine checks use synthetic data. Browser runs use newly created databases and a built, web-only instance on port 3048. The standard test database port 55439 was occupied; a separate copy of the documented Compose fixture uses port 65439. The original service and owner previews were not test targets. Dependencies were installed from the existing local pnpm cache.

| Check | Actual result |
| --- | --- |
| `pnpm check` | Passed: 390 unit tests across 47 files, formatting, lint (179 warnings, no errors), strict/ordinary types, import boundaries, generated freshness and 64 documentation files. |
| `pnpm test:integration` | Passed: 269 tests across 19 files, on the disposable test service. |
| `pnpm build` | Web and worker passed, including the final permission-aware empty-state copy. |
| Seven targeted desktop/mobile browser suites | 64 passed, two intentional viewport-specific skips. Covers agent-workspace, agent-connect, agent-events, agent-history, proposal-review, shared-ui and workout-inspector. |
| Final focused browser run | Passed: 22 desktop/mobile cases after the history-only empty-state correction and extra expired, revoked, conflict, replacement-required and unavailable review assertions. Changed-context records are explicitly checked as initially collapsed. |
| Visual review | Inspected synthetic desktop/phone captures in light/dark, including 390px and 320px layouts, long summaries, access rows and the fixed review footer. Browser scenarios check 200% text sizing, 44px controls, no horizontal overflow, first-action visibility, keyboard navigation and focus restoration. Physical-device testing is not claimed. |

The initial type check caught loss of the concrete proposal-change type when extracting a lazy week component; the component now accepts the exact existing proposal DTO. The first browser run found a five-pixel overflow from the shared tabs' unused decorative underline (49px scroll height inside a 44px bar); a plugin-local override removes it, and the rerun passes. The history Sheet uses the existing readable audit title and preserves undo confirmation/failure behavior. A final source review corrected the empty message for history-only grants so it does not imply proposal authority.

Logs are under `.runtime/agent-ui/` (`check-complete.log`, `integration.log`, `build-complete.log`, `browser-final.log`, and `browser-focused.log`). Screenshots are under `.runtime/browser/agent-{empty,connections,proposals,review,text-scale}-*`, with the existing annual, mixed-event and workout-inspector captures alongside them. These are local synthetic artifacts, not committed athlete data.

## Release and documentation

The feature specification, design record and Unreleased changelog describe the new presentation. No ownership or persisted/public contract changes require an architecture edit or ADR. Normal rebuild/restart and browser reload activate this UI; no CLI upgrade, SQL migration or data conversion is required. This change alone can be rolled back with the previous application code against the same compatible schema.

The final synthetic preview was stopped after verification and its launcher removed its temporary database. The task-specific disposable PostgreSQL service was removed; existing previews and the original occupied test service were not used or stopped. Generated build-only changes to `next-env.d.ts` were restored. `git diff --check` and the final documentation link/content check pass.

## Owner preview and primary action

On 2026-11-10 the owner tested a local synthetic preview containing short/multiweek proposals and active/inactive connections. The owner requested a consistently prominent Connect an agent button, then accepted the preview and requested the commit and PR. No private-server deployment was performed. Preview process and database lifecycle details are intentionally kept outside this durable record.

After the primary-button adjustment, `pnpm check` passed again (390 unit tests, 64 documentation files), and `pnpm build` passed for web and worker. Logs are `primary-button-check.log` and `primary-button-build.log` under `.runtime/agent-ui/`. Browser checks confirmed the orange token in both themes at desktop, 390px and 320px, with 44px phone targets, visible controls and no horizontal overflow. Closing the connection dialog restored focus to Connect. Captures are `.runtime/browser/agent-primary-button-{light,dark}.png`.

## PR review follow-up — 2026-11-11

Seven of the eight nonblocking comments are addressed in this revision: one explicit collapse threshold, immediately expanded filter results (including month groups), removal of a redundant React key, focus restoration after the revoked grant is rendered, matching expired-access confirmation wording, compact desktop controls with 44px phone targets, and removal of transient preview operating instructions.

The sole-connection/no-inactive focus scenario was already covered; the browser case now also gates the workspace refresh to verify focus after delayed rendering. The original timing concern was plausible, not a reproduced failure. Filter coverage verifies changing and clearing a search, empty matches, and applying all 1,500 stored changes while only 111 matching records are shown.

The shared history-shell extraction was initially deferred: both panels duplicate some overlay handling, but Training also owns detailed record review and uses its own undo operation. A shared extraction would touch Training and the shared UI surface beyond this plan's Agent Bridge boundary. Existing nested-confirmation coverage remains in place; the owner subsequently authorized including that refactor in this PR, as recorded below.

`pnpm check` passed (390 unit tests, types, formatting, boundaries, generated checks and documentation; 178 lint warnings, no errors). `pnpm test:integration` passed all 269 tests. Web and worker builds passed. The seven targeted agent/shared-UI/workout browser suites passed 64 tests with two intentional viewport-specific skips, including delayed revocation focus and filtered 1,500-change apply/undo. Light/dark desktop and phone connection captures were inspected; browser checks cover 390px, 320px and enlarged text. Logs are `.runtime/agent-ui/pr-review-{check,integration,build,browser}.log`. The disposable browser instance was separate from the owner's interactive synthetic preview. Physical-device testing and private-server deployment are not claimed.


## Shared history extraction — 2026-11-11

The owner explicitly expanded the PR scope to include a shared history component. `HistorySheet` in `packages/ui` now owns both panels' open state, fixed header/close action, caller-supplied description, scrolling region and theme/responsive shell. The existing confirmation provider supplies an internal pending-state guard, replacing both DOM-query checks. Plugin callbacks still clear their own errors on opening; record content, detail fetching and undo operations stay with Agent Bridge and Training. Desktop widths and plugin typography remain scoped locally.

The shared UI, training and agent specifications, design record and architecture record the ownership change. This is a UI extraction with no new persistence, runtime contract, migrations or composition change. The existing Unreleased entry and rebuild/restart procedure still apply; code-only rollback remains compatible.

The first browser run exposed a confirmation-backdrop edge case: focus moved to body and Escape was handled by the underlying Sheet, leaving confirmation open. The shared panel now delegates that Escape to provider cancellation, while preventing its own dismissal. Both consumers exercise this sequence in the new regression test. Final `pnpm check` passed with 390 unit tests, 64 documentation files, 178 lint warnings and no errors; web/worker builds passed. Isolated integration verification passed all 269 tests. The final-build browser matrix passed 80 cases and skipped two intentional viewport cases; two agent-history cases failed because the new test clicked outside before the reopened panel acquired focus. After making the test await initial focus, the focused shared-history rerun passed all four desktop/mobile cases. This verifies all 82 distinct non-skipped scenarios across the matrix and focused rerun. Surrounding coverage includes plans, workspace history, shared UI, onboarding, editor recovery and workout inspection. Both panel layouts were visually inspected at desktop and phone sizes in both themes; no physical-device testing is claimed.

Logs are `.runtime/agent-ui/shared-history-{integration,final-check,final-build,final-browser,focused-browser}.log`; screenshots use `.runtime/browser/shared-history-*` and the existing plan-review paths. Only disposable synthetic test instances and databases were used for these runs. The interactive owner preview was left untouched. Final documentation validation and `git diff --check` passed.


## Shared history review follow-up — 2026-11-11

The three new review comments are addressed together. Agent history now passes undo failures through the fixed notice area, matching Training. `HistorySheet` renders the caller's description unchanged, with no entry-count prop, training-specific copy or duplicated preview-limit constant. Both plugins use accurate recent-history descriptions. Removing the numeric limit claim avoids coupling presentation to SQL; a new server `hasMore` field is unnecessary for this UI and would expand the runtime contract.

The shared browser cases now check caller copy with 50, 49 and zero records, and force an undo failure on entry 40 while the list remains scrolled. They assert that the error and close control remain in the viewport at desktop, 390px and 320px in both themes, alongside the existing confirmation and focus coverage.

`pnpm check` passed: 390 unit tests, type checks, formatting, boundaries, generated freshness and 64 documentation files; lint reported 179 warnings and no errors. Isolated integration tests passed all 269 cases. Web and worker builds passed. All 32 browser cases passed across the history-sheet, agent-workspace, plans and shared-ui suites. Error visibility and descriptions were verified at desktop, 390px and 320px in both themes; late-entry error captures were visually inspected. Logs are `.runtime/agent-ui/history-notice-{check,integration,build,browser}.log`, and captures are `.runtime/browser/history-error-*`. No production data or private-server deployment was involved.


## Large filtered review follow-up — 2026-11-11

The third review identified that a broad filter could expand all 1,500 annual-proposal rows. Filtered results now auto-expand only up to the existing 200-record month-grouping threshold; larger results retain lazy month/week disclosures, including undated plans. Narrow filters still reveal matching rows immediately, group counts/deletions remain visible, and Apply still saves the entire immutable proposal. The unreachable ready-state footer branch was removed.

The optional suggestion to auto-open small changed-context lists was not adopted: the approved workspace plan explicitly keeps that list collapsed with its warning/count visible and explicit acknowledgement. Existing context disclosure and application safeguards remain unchanged.

Added rendering-budget regression coverage at 200/201/1,500 matches and for undated plans, and extended the annual browser scenario with broad type/action/search filters, manual expansion and narrowing before whole-proposal apply/undo. Actual verification: `pnpm check` passed with 395 unit tests across 48 files, documentation/link checks for 64 files, formatting, normal/strict types and dependency/generated checks; lint retained 179 warnings and no errors. The isolated PostgreSQL integration suite passed all 269 cases across 19 files, and web/worker builds passed. Initial rendering-test fixtures were corrected to include required sport/effective-date fields and the discriminated proposal type; an initial sandboxed full-unit attempt also could not bind the local lifecycle-test sockets. The final workflow used the required local process permissions.

The eight relevant browser suites passed 62 cases on the first run; the two annual cases timed out at the new test's exact-label selector. After using the combobox's accessible role/name, both annual cases passed (9.1 seconds total), verifying all 64 distinct scenarios. Broad type/action/first-letter filters mount no record rows until manual disclosure; narrowing renders 111 matches, and applying/undoing still persists all 1,500 changes. The 200/201 boundary and undated plan groups have direct rendering regression tests. Desktop/390px/320px captures in both themes show counts, deletions and reachable approval controls without horizontal overflow; representative captures were visually inspected.

Logs: `.runtime/agent-ui/proposal-filter-{check,integration,build,browser,annual-browser}.log`. Captures: `.runtime/browser/annual-broad-filter-*`. Verification used a fresh isolated synthetic database and standalone preview, separate from the owner-reviewed preview. No private-server deployment or production data was involved. The prior CI head `1be594a` failed browser dependency installation twice on Ubuntu mirror DNS resolution before tests ran; these local results do not claim that remote CI passed.
