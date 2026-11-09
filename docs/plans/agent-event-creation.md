# Execution: agent race and goal proposals

## Authority and scope

On 2026-11-08 the owner approved the plan “Agent proposals for races and dated goals” in this chat and requested implementation. The owner explicitly changed event permission to **on by default for new planning connections**, retaining an opt-out. Existing grants retain their permissions. The approved scope includes race/goal creation only, deterministic duplicate blocking, exact owner review, atomic apply/undo, skills, documentation and synthetic verification. Subsequent requests authorized the local testing preview and publishing a reviewed PR, as recorded below; private-server deployment remains separate.

Behavioral authority: [agent-training specification](../features/agent-training.md#race-and-goal-proposals). Decision: [event permission](../decisions/020-agent-event-creation.md). Commands: [development guide](../development.md#verification).

## Implementation and verification

Implemented in the working tree. Training 2.2 and Agent Bridge 2.3 are pinned together, with regenerated contracts, registry metadata and Claude adapters. Shared contracts preserve absent legacy permissions; the bridge validates new events at submission and application; review projections use event dates without altering stored diffs. No SQL migration or production deployment was performed.

The default test port and alternate 55449 were occupied. This task used a separate disposable Compose project, `athlete-panel-events-test`, with automatically assigned loopback port 62064, preserving existing test services. Integration used `athlete_panel_test`; browsers used a separately seeded `athlete_panel_events_ui_test` database and the built server on port 3027. Dependencies were installed from the existing local pnpm cache with the frozen lockfile. No owner configuration, production data or Garmin credentials were used.

| Check | Actual result on 2026-11-08 |
| --- | --- |
| Generation | Registry, contract reference and all three skill adapters regenerated; freshness checks passed. |
| Repository check | Passed: formatting, lint (zero errors; configured warnings remain), boundaries, both TypeScript modes, 376 unit tests across 45 files, and documentation checks. |
| Full integration | Final run passed: 263 tests across 19 files, including events, historical grants, migration lifecycle, audit failure rollback and backup/restore. |
| Production build | Web and worker builds passed. This is local build evidence, not deployment. |
| Browser matrix | 38 relevant scenarios passed across desktop/phone: 34 connection/proposal/workspace scenarios, plus four event-flow scenarios on the corrected focused rerun. Event review/calendar/undo and workout logging exercised both light and dark themes. |
| Visual inspection | Inspected connection approval and event-review screenshots at desktop/phone widths in both themes; labels, date/type fields, wrapping and application controls remain readable. Inspected calendar detail screenshots in both themes. Screenshots are under `.runtime/browser/agent-connect-*` and `.runtime/browser/agent-event-*`. |
| Skills | Both canonical skills passed the skill validator; generated copies passed freshness checking. Scenario walkthrough below is instruction review, not an independent live-model trial. |

The first full integration run found an outdated test classifying all event creation as owner-only; it now checks event updates/deletions, and the entire suite passed on rerun. The first browser run reached successful application and undo but its assertion matched both the original audit entry and the new undo entry. The selector now matches the original summary exactly; all four affected scenarios passed on rerun. Runtime implementation did not need changes for either test correction. Local execution logs are `/tmp/athlete-events-check.log`, `/tmp/athlete-events-integration-final.log`, `/tmp/athlete-events-build.log`, `/tmp/athlete-events-browser.log` and `/tmp/athlete-events-browser-final.log`.

## Coaching scenario walkthrough

Reviewed the canonical planning and coaching instructions against these synthetic inputs and the enforced API boundary:

| Input and context | Result required by the updated instructions |
| --- | --- |
| “Prepare for Winter race on 2027-01-31,” permission and dates sufficient | Propose a race with its preparation without requiring proof of registration or another outline approval. |
| “I might try a marathon next spring” | Clarify target intent and date; no invented event. |
| “Prepare for Winter race,” date missing | Ask for the material missing date before proposing the event. |
| Matching event in permitted context | Use it as context; do not create another entry. |
| Similar title or conflicting date | Clarify the match rather than silently editing or duplicating the existing event. |
| Permission absent/false, or target outside proposal dates | Explain the specific limitation; continue independently authorized work and use owner browser approval when expanded access is needed. |
| No matching event with incomplete visibility | Say “not found in the shared context”; do not claim absence from the whole calendar. |
| Definite dated goal with notes excluded | Use explicit goal kind and omit notes; an undated general-fitness goal does not become a calendar event. |

## Documentation validation

| Topic | Canonical document | Coverage completed | Remaining gaps |
| --- | --- | --- | --- |
| Permissions and persisted behavior | Agent-training feature specification | Approved source, contracts, duplicate behavior, acceptance cases and implementation evidence linked. | None for this scope. |
| Ownership and consequential choice | Architecture and ADR 020 | Plugin ownership preserved; default-on fresh approval, old-grant compatibility and rollback tradeoff recorded. | None for this scope. |
| Access and operation | README, development guide and Unreleased changelog | Owner opt-out, fresh approval for old agents, matched CLI/app upgrade and backup-based rollback documented. Commands remain in the development guide. | Deployment not performed. |
| Coaching guidance | Canonical skills and generated adapters | Clarification, existing-event reuse, permission checks and truthful pending status updated. | Live model adherence remains unverified. |

No new visual convention or diagram was introduced; the shared design record and templates remain unchanged. Local documentation links and placeholder checks passed. No claimed implementation behavior depends solely on passing link checks.

Cleanup completed: the synthetic web server, dedicated test database project, failed initial container/network and temporary workspace dependency store were removed. Verification screenshots and logs remain available; existing services were preserved.

## Owner testing preview — 2026-11-08

The owner subsequently requested a deployment to test this implementation. A separate local synthetic preview was launched at `http://127.0.0.1:3037/agent` using the already verified build and the canonical disposable preview launcher. Its web artifact is copied before startup, and web/worker run in the background. The dedicated `athlete-panel-events-preview` PostgreSQL service uses loopback port 63425; its newly created database is `history_preview_85447_b6558194_test`. Existing local applications were preserved.

The documented demo password applies. The pending proposal **Demo: add Riverside 10 km race, a dated goal, and preparation** contains two event creations plus a plan and three workouts. Its fictional race is dated 2026-11-21. The server reports it ready for owner review; nothing has been applied. The standard historical preview fixture and annual proposal are also available for exploration.

A headless browser smoke check passed sign-in, opening the demo proposal, displaying both events, and keeping application disabled before owner acknowledgement. The proposal remains pending. Screenshot evidence is saved at `.runtime/event-preview/ready-for-review.png`.

Runtime information and logs are under `.runtime/event-preview/`; the canonical preview keeps its own protected configuration and process ID under `.runtime/history-preview/history_preview_85447_b6558194_test/`. This preview is intentionally left running for owner testing. It uses synthetic data and is reachable on this computer only; no private-server deployment was performed.

The owner then approved a real CLI connection to this synthetic preview. Scoped reads confirmed event creation was permitted and private notes excluded. Through that connection, the agent submitted a second six-command sample proposal with a plan, three workouts, a fictional race and a dated goal; a subsequent read confirmed submission did not change the calendar. The owner later applied the earlier Riverside demo. A refreshed scoped read verified that demo's plan, all three workouts, race and goal, and correctly distinguished it from the newer un-applied sample. This is one live synthetic workflow, not comprehensive coaching-model compliance evidence.

## Pre-publication review — 2026-11-08

The owner requested implementation review and publication as a PR with a title and description. Reviewed permission defaults and scope preservation, agent-only command validation, duplicate checks under the shared domain lock, notes and date limits, persisted proposal compatibility, event review projections and atomic audit/undo. No runtime blocker was found. The review identified and corrected missing shared-contract release metadata: contracts 2.3.0 now accompanies Training 2.2.0 and Agent Bridge 2.3.0.

Rebased the feature onto main `127c82c`, preserving its Charts changes and both Unreleased entries. Regenerated all derived artifacts. Final verification uses separate project `athlete-panel-events-pr` on loopback port 63891, with integration database `athlete_panel_test` and browser database `athlete_panel_events_pr_ui_test`; the owner preview on port 3037 is preserved.

- Generation and `pnpm check` passed: 385 unit tests in 46 files, formatting, lint, both TypeScript modes, boundaries, generated freshness and documentation checks.
- Full integration passed: 265 tests in 19 files.
- Production web and worker builds passed.
- Relevant desktop/phone browser verification passed all 38 scenarios in one run: connection approval/opt-out, proposal review, event application/calendar/undo and workout logging, including both themes. The first invocation stopped during test discovery because `E2E_DATABASE_URL` was omitted; the corrected invocation supplied the isolated UI database.

Logs for this review use `/tmp/athlete-events-pr-*.log`. Private CLI configuration, exported context/proposals, runtime artifacts and screenshots remain excluded from the commit.

The PR verification server and its dedicated PostgreSQL project were removed after the checks. The separate owner preview on port 3037 remains running.

## PR review follow-up — 2026-11-09

The owner requested assessment of the review comments. The reviewer approved PR #95 with one [optional Unicode-normalization observation](https://github.com/bidulelabs/athlete-panel/pull/95#discussion_r4510558615). It was confirmed: composed and decomposed spellings of “Trail des Écrins” bypassed both submission duplicate rejection and the later review/application conflict check. Four new integration cases failed before the fix; the existing case/whitespace case passed.

The comparison key now uses Unicode NFC after case and whitespace normalization. Stored event titles are preserved, accents remain significant, and same-title events on different dates remain permitted. Regression coverage exercises both encoding directions, existing and same-batch duplicates across kinds, and duplicates introduced before application of a mixed proposal. The feature specification and existing Unreleased entry document this refinement. No new contract, migration, UI change or extra version bump is needed for this unreleased correction.

Verification passed after the fix: `pnpm check` (385 unit tests in 46 files plus the configured static/documentation checks), full integration (269 tests in 19 files), and production web/worker builds. The first repository check requested formatter line wrapping; the formatted rerun passed. No browser suite was repeated for this comparison-only change; desktop/mobile UI evidence above remains the prior verification. The dedicated `athlete-panel-events-unicode` project used loopback port 52793 and disposable `athlete_panel_test`, and was removed after testing. Logs are `/tmp/athlete-events-unicode-before.log`, `/tmp/athlete-events-unicode-check-final.log`, `/tmp/athlete-events-unicode-integration.log` and `/tmp/athlete-events-unicode-build.log`.
