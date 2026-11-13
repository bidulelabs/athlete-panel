# Calendar navigation — issue 125

## Authority and scope

The owner requested implementation of [issue 125](https://github.com/bidulelabs/athlete-panel/issues/125) on 2026-11-12, explicitly including sticky weekday labels. Scope: sticky date controls and desktop weekday labels, desktop day add cards, touch/keyboard access, predictable date reveal and focus/position preservation. Cross-page scroll restoration, keyboard shortcuts and visibility filters remain deferred.

Behavioral authority is the [training workspace specification](../features/training-workspace.md#persistent-calendar-navigation-and-day-creation); visual conventions live in [DESIGN.md](../../DESIGN.md). This task changes no training rules, persisted contracts, permissions, plugin composition or migrations. Ownership is unchanged, so no architecture rewrite or ADR is needed.

## Implementation

- Calendar-local sticky band with aligned weekday columns and measured scroll clearance; shared date controls accept a navigation handler.
- Desktop add control below all day cards, revealed without layout shift; visible phone date-rail controls retain the existing creation chooser.
- Explicit date navigation waits for its loaded range; failed reads retain the existing error/retry behavior.
- New browser scenarios use synthetic populated/empty days, both themes and desktop/phone viewports.

## Verification

Completed locally on 2026-11-12. Canonical commands remain in the [development guide](../development.md#verification).

- Dependency installation used the pinned lockfile.
- The standard disposable database start encountered occupied port 55439. Existing previews were left running. A task-specific copy of the test Compose configuration uses project `athlete-panel-issue125-test` and loopback port 55525, with separate integration and browser databases; the browser app uses port 3025.
- `pnpm check` passed: formatting, lint (zero errors; repository warnings remain), registry/contracts/skill freshness, import boundaries, both type checks, 49 unit files / 406 tests, and documentation content/local links.
- `pnpm test:integration` passed: 19 files / 276 tests against this task's isolated test database, including domain and operational checks.
- `pnpm build` passed for the final application and worker. The generated Next declaration's local build-path change was restored to keep it out of the feature diff.
- Relevant browser suites passed against a fixed copy of the final production build: calendar navigation, cards, state/linking, week starts, weekly summaries, workout inspector and workspace. Result: **74 passed, 4 existing project-specific skips**. All 10 new navigation scenarios passed, including rejected out-of-range input, failed-load retry, timezone Today, same-week reveal, hover/keyboard creation, all four dated editors, empty days and unchanged scroll/focus on cancellation.
- Visually inspected synthetic desktop and phone captures in both themes, including the 320px phone layout. Local evidence is under `.runtime/calendar-navigation/`; detailed logs are `.runtime/issue125-check.log`, `.runtime/issue125-integration.log`, `.runtime/issue125-build.log` and `.runtime/issue125-browser-final.log`.
- The initial new browser run exposed an ambiguous alert selector (the framework also supplies an alert), corrected by scoping to the workspace error. An intermediate broader run was interrupted after rebuilding replaced files under its running server; the final run used a separate build copy and passed. Neither result was counted as successful verification.
- Applied framework validation to the feature, design, changelog and this record: requirements/acceptance/source alignment, local links, scope/deferred work, and activation/rollback statements checked. No new architecture decision, diagram, public data contract or migration was introduced.
- The temporary app server was stopped and this task's test container/network removed after verification. Existing previews were left running; local screenshots and logs remain available.

## Activation

No real server has been deployed. Normal rebuild/restart and browser reload activate the change. No composition, migration or configuration update is required; the previous code can use the same database.

## Owner-requested local preview

After implementation, the owner requested a running local app on 2026-11-12. The final build snapshot is running at `http://127.0.0.1:3025` with its worker and an isolated synthetic database on port 55525. The demo includes three weeks of workouts plus populated note days for scroll/add testing. Browser smoke verification confirmed readiness, successful login, 21 calendar dates, seven weekday labels and a sticky navigation band after scrolling. Web and worker run in the background; their PIDs/logs are under `.runtime/issue125-preview-*`. This preview was intentionally left running for the owner and contains no personal athlete data.

## PR preparation

The owner reviewed the local preview and requested a PR on 2026-11-12. Rebased onto `main` at `8ffdfe3`, preserving the day groups/full-date names, first-workout heading and shared-control transition changes from issue 106. Updated its empty-day accessibility assertion to the dated **Add to** chooser introduced here; both changelog entries remain intact.

Fresh verification of the combined branch passed: `pnpm check` (50 unit files / 411 tests, both type checks, lint and documentation), `pnpm test:integration` (19 files / 276 tests), and `pnpm build`. Eight relevant browser suites, now including calendar accessibility, passed **82 scenarios with 4 existing project-specific skips**. Logs are `.runtime/issue125-pr-{check,integration,build,browser}.log`. Browser checks used a separate synthetic database and fixed build on port 3026; the owner's preview on port 3025 was not modified.

## Review follow-up — 2026-11-13

- Accepted the [pending-load regression-test comment](https://github.com/bidulelabs/athlete-panel/pull/127#discussion_r4556328554). The test now selects 16 January, which already exists in the loaded 7–27 January grid, while holding the new 14 January range request. It asserts unchanged scroll position after effects/painting and before releasing that request, then checks failed-load recovery and the successful retry. Native input focus happens before the scroll baseline; the held request is released even if an assertion fails.
- The [36px spacing observation](https://github.com/bidulelabs/athlete-panel/pull/127#discussion_r4556328564) describes the intended tradeoff. Reserving the footer keeps the add control below all cards without shifting cards or changing week height on hover/focus, as required by the approved scope. Phone date-rail actions reserve no second footer. Kept the layout and made this choice explicit in the design record.
- Verified the strengthened scenario against an isolated build with only the loaded-range guard removed: both desktop and phone failed at the new scroll assertion (unexpected movement of 1,193px and 3,172px respectively). The real build passed the same scenario on both. Original source and production build were restored automatically; no runtime code change is included in this follow-up. Evidence: `.runtime/issue125-review-{guard,mutant-test,restored-build}.log`.
- Final verification passed: `pnpm check` including 411 unit tests, the restored production build, and all 10 navigation browser scenarios in both themes/form factors. The existing integration results remain applicable because this follow-up changes only a browser test and documentation. Final logs: `.runtime/issue125-review-check.log` and `.runtime/issue125-review-browser-final.log`. Temporary test servers were stopped; the owner's local preview was left unchanged.

## Rebase verification — 2026-11-13

Rebased onto `main` at `849e18d`, including the plan phases and weekly targets from #105 and #129. The only conflict was in the changelog; both feature entries and the upstream upgrade guidance were preserved. The calendar retained the new weekly duration targets alongside its sticky navigation. A range comparison confirmed no other changes to the two rebased commits.

Fresh verification passed: `pnpm check` (56 unit files / 471 tests, both type checks, zero lint errors and documentation validation), `pnpm test:integration` (21 files / 288 tests), and `pnpm build`. The eight relevant calendar/accessibility, inspector and workspace browser suites passed **86 scenarios with 4 existing project-specific skips**, including weekly phase targets and desktop/phone coverage in both themes. Logs are `.runtime/issue125-rebase-{check,integration,build,browser}.log`.

Browser verification used a separate synthetic database and fixed production build on port 3026. The temporary test server was stopped; the owner's preview on port 3025 was left unchanged. No real server deployment was performed.
