# Proposal review UI execution record

## Authority and scope

On 2026-11-09 the owner asked to implement the review audit improvements, including colors/icons for workouts, races, goals and notes on desktop and phones in both themes. The preceding audit used published Impeccable guidance with browser/source inspection; the Impeccable CLI was unavailable. This implementation uses the canonical plugin-development skill and the existing application design. No external agent, deployment, contract, permission or storage change is required.

## Implementation

- Persistent dialog across loading, scrollable body, retained title/close/footer and explicit whole-proposal scope.
- Labeled slate workout/sport, amber race/flag, blue goal/target and olive note/notebook treatments; shared calendar goal/note/race colors.
- Type/action outcome summaries, readable rows, single-column new/deleted values, unchanged exact update fields and complete record disclosures.
- Search/type/action filters, empty results, group type/deletion counts, existing-context separation and nearby applicability/error states.
- Review later plus an application receipt with calendar navigation and existing confirmed whole-proposal undo.
- Feature/design/changelog updates. Ownership and persistent behavior are unchanged, so no architecture change or new ADR is necessary.

## Verification

Actual results on 2026-11-09:

| Check | Result |
| --- | --- |
| `pnpm check` | Passed: formatting, lint (warnings only), generated registry/contracts/adapters freshness, boundaries, both TypeScript configurations, 385 unit tests and documentation validation. |
| `pnpm test:integration` | 269 passed against the separate disposable PostgreSQL service, using PostgreSQL 17 client tools. Server/domain code is unchanged. |
| `pnpm build` | Passed for the final web and worker artifacts. |
| Relevant desktop/phone browser suites | 46 passed, 2 deliberate viewport-specific skips. Files: agent-events, proposal-review, agent-history, calendar-cards and workout-inspector. Includes the 1,500-command proposal, mixed types, exact updates, changed-context re-review, receipt undo and phone logging regression. |
| Manual visual inspection | Inspected desktop 1440×1000 and phone screenshots in both themes, including 320×740 and 390×844 phone layouts. Labels/icons remain distinct, long names wrap, body scroll preserves close/approval controls, and no horizontal modal overflow was observed. |
| Request failure/retry | Injected a synthetic 503 for review: “Review unavailable,” disabled Apply and reachable Retry; removing the interception and retrying returned “Ready for your review.” |
| Blocked review presentation | Injected a valid replacement-required review response: reason shown next to disabled Apply and no acknowledgement checkbox. This verifies presentation only; the integration suite owns real duplicate/conflict guarantees. |
| Keyboard | Automated and manual opening/closing after asynchronous detail loading return focus to the invoking Review button. |

The initial sandbox runs could not access local IPC/socket services; the same commands were rerun with the necessary local access. The standard disposable database command encountered an occupied port 55439. A copy of the documented test Compose fixture uses project `athlete-panel-review-ui-test` and port 63426, without touching the occupied database or original preview.

The first browser run used the annual preview, whose pre-existing fixed fixture IDs and daily workouts collided with tests that seed their own records. Those tests were rerun on a clean synthetic database. That run also exposed unfinished intercepted requests at test teardown; proposal-review now waits for its routes to finish before disposal. The final clean run passes. TypeScript's first pass caught optional event-kind narrowing, corrected before the successful checks. Contrast calculations also prompted a darker light-theme olive token before the final build.

Runtime evidence is under `.runtime/proposal-review/` (check, integration, build and browser logs) and `.runtime/browser/` (proposal-types, proposal-demo, proposal-retry and proposal-blocked screenshots plus the existing suite captures). These are local synthetic artifacts, not committed athlete data. Documentation coverage and links were checked against the affected feature/design/changelog and this record; no architecture ownership or persistent-contract change needs an ADR.

## Local review handoff

The final build is running at `http://127.0.0.1:3039/agent` on its own disposable synthetic database with the documented demo password. A pending “Synthetic UI demo” contains one plan, two workouts, a note, a goal and a fictional race for 16–21 November 2026. It has not been applied. The earlier preview on port 3037 was not replaced. Intermediate previews from this task were stopped and their temporary databases removed by their launchers.

This is local implementation and verification, not private-server deployment. No SQL migration, permission change or CLI upgrade is needed for these presentation changes. The application requires a normal rebuild/restart and browser reload when released; existing stored proposals remain unchanged.

## Pull request review

On 2026-11-09 the owner approved the before/after screenshots and requested implementation review, branch publication and a pull request. Source review covered async dialog/focus behavior, type and action presentation, exact field disclosure, filter/application scope, receipt navigation/undo and shared calendar styles. No blocking implementation issue was found. The annual browser assertion now explicitly checks that the footer includes all 1,500 changes, retaining the previous total-count coverage after the layout change.

The UI commit was rebased onto `origin/main` at `97ea2df`, excluding the already merged race/goal implementation. Verification was rerun on the rebased source:

| Check | Result |
| --- | --- |
| `pnpm check` | Passed: 390 unit tests across 47 files, formatting, type checks, boundaries, generated-reference freshness and 63 documentation files. Lint reported 178 warnings and no errors. |
| `pnpm test:integration` | 269 passed across 19 files on the isolated test service. |
| `pnpm build` | Web and worker passed. |
| Five relevant browser suites listed above | 48 passed, 2 deliberate viewport-specific skips, using a fresh empty synthetic preview on port 3042. Includes current main's lap-button interval coverage, both themes, narrow phones, focus restoration, filtered whole-proposal application and receipt undo. |
| Patch and documentation review | `git diff --check` passed. Feature, design, changelog and execution record agree with the implementation; no new contract, migration or architecture ownership change. |

Final-run logs are `.runtime/proposal-review/pr-check.log`, `pr-integration.log`, `pr-build.log` and `pr-browser.log`. The temporary verification preview is stopped after the run; the owner's port-3039 preview remains separate. The complete browser matrix and local-setup rehearsal are left to CI; these local results do not establish deployment.

## Visible summary follow-up

On 2026-11-09 the owner asked to keep the plan summary visible at the top by default on desktop and mobile and update PR #100. The full stored proposal summary now appears directly above the dates and outcome counts, with no disclosure required. Line breaks are preserved and long text wraps; the application deadline remains visible beneath the counts. The feature specification, design record and existing changelog entry reflect this preference.

Actual verification: `pnpm check` passed (390 unit tests, no lint errors, 178 warnings), web/worker build passed, and the same five desktop/mobile browser suites passed 48 cases with two deliberate skips. The mixed-proposal scenarios explicitly assert that the exact summary is in the viewport before any scrolling or disclosure interaction. Screenshots from all four desktop/mobile and light/dark combinations were inspected, including the 320px phone layout; summary, close and approval controls remain visible. Logs are `.runtime/proposal-review/summary-check.log`, `summary-build.log` and `summary-browser.log`; screenshot names remain `proposal-types-{desktop,mobile}-{light,dark}.png` under `.runtime/browser/`.

This follow-up changes presentation only. Integration tests were not rerun; the prior 269 passing cases remain the recorded server verification. The fresh port-3042 preview and its temporary database are stopped/removed after verification. No private-server deployment or replacement of the existing owner preview is included.

## Review comments and CI follow-up

On 2026-11-09 the owner requested checking PR #100's CI/review and fixing issues. The review had no blocking findings and two useful optional comments: [search the displayed dates](https://github.com/bidulelabs/athlete-panel/pull/100#discussion_r4513667277) and [singular receipt wording](https://github.com/bidulelabs/athlete-panel/pull/100#discussion_r4513667285). Both are addressed. Search shares the row's date formatter/options and accepts ISO, weekday/day/month, day/month and month text for event dates, effective workout/note dates, plan starts and both sides of moves. Empty searches skip date formatting. A one-change receipt now reads “Saved 1 change.”

Actual local verification: `pnpm check` passed with 390 unit tests, web/worker build passed, and the five relevant browser suites passed 48 cases with two deliberate skips. Existing browser scenarios now exercise displayed/ISO date searches across item types, moved/deleted records and plan starts, and apply/undo a single-plan proposal while checking its receipt. Both viewport projects and themes remain covered. Logs are `.runtime/proposal-review/review-fixes-check.log`, `review-fixes-build.log` and `review-fixes-browser.log`. No server code changed, so integration tests were not rerun locally.

CI inspection of screenshot commit `626f3e5` found successful check, integration, both full browser suites, local-setup, publication-security, container-build, release rehearsal, hosted-registry rehearsal and verify jobs. The hosted rehearsal was still running without a reported failure at the final pre-push inspection. Publishing these fixes starts fresh CI; this record does not claim that newer run has passed. Screenshot assets and their existing PR embeds remain unchanged.
