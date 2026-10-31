# Feature: reviewed external-agent training

## Purpose and scope

Let an external local harness read selected athlete context and propose pending training edits while the owner retains control. Athlete Panel runs no model or chat orchestration. Completion, links, athlete settings, injuries, secrets, activation, deployment and provider changes are outside agent mutation scope.

The [Garmin sport planning specification](garmin-sport-planning.md) extends structured context with sport groups/subgroups, rest, elevation and exercises. Notes-disabled grants redact exercise instructions and completion notes as well as existing narrative, and cannot duplicate or replace hidden instructions.

## Intended behavior

Specification status: approved. Authority: owner implementation request dated 2026-10-24, P6/R3–R4 and T6, preserved in the [execution record](../plans/mvp-execution.md).

On 2026-10-24 the owner additionally requested CLI connection with browser approval so tokens do not need to be copied manually. The owner approves a short-lived revocable grant with explicit date bounds and optional ordinary notes. The CLI stores the token in a private local file and never prints it. Exports include preferences/goals/zones, relevant training, injuries, activities and health within the selected range. Private plan descriptions, workout and interval notes, completion reasons, calendar notes, and event/injury notes are excluded by default. Relevant injury descriptions and profile goals remain explicit shared context. Secrets, operational settings, raw provider payloads and GPS are never exported. The owner sees categories before granting; the chosen harness may send this context to its model service.

Health in the context is daily for the last seven days only: today in the profile timezone and the six days before, within the grant. Earlier grant days are summarized in `healthWeeks`, one entry per calendar week clipped to the grant and to the day before the daily list, starting on Sunday when the profile prefers it and on Monday otherwise (the server has no browser locale for `auto`). Each entry lists `from`, `to`, the calendar `days` it covers and, for every health metric, the rounded `average` with the `days` that have a known value. A metric without a value that week is `{ "average": null, "days": 0 }`, never zero. Each account's latest correction for a day and metric replaces its earlier records, including a correction to unknown, with the calendar's revision rules; a day two Garmin accounts both still recorded is then left out. The `contextDigest` and the stored review snapshot still cover every daily record behind the averages, so a changed earlier day still requires owner review, and the digest does not change when a day leaves the daily list. Proposals stored before this summary keep their digest and snapshot and are reviewed as before. The hourly Garmin sync rewrites only the last seven days, which stay daily.

The agent reads a context digest, then submits typed commands, a summary and an idempotency key. Commands follow `agentCommandSchema`, the plan, workout and note actions an agent may propose; its generated JSON Schema (`agentCommands` in the [contract reference](../reference/contracts.json)) gives field units and meaning, as requested in [issue 37](https://github.com/bidulelabs/athlete-panel/issues/37). Any other action is refused before the context check with `400 validation`, listing the allowed actions under `commands.N.action`. Source records as well as resulting changes must be within the grant: copying an excluded source into an allowed date is forbidden. A full-plan operation needs access to all affected children.

The server validates and expands the entire batch before storing it. The UI presents before/after changes, derived dates and ordering effects. Proposals expire seven days after submission, independently of agent access expiry; reads/submissions still require active access and revocation still blocks owner application. New proposals store a versioned snapshot of the same permitted bounded context, preserving note exclusions. An owner-only review operation loads contextual differences and mutation conflicts on demand. Context-only changes permit renewed owner acknowledgement when domain validation, scope, revisions and the exact expanded diff still match. Application rechecks these conditions, the immutable digest and the reviewed current-context digest in one transaction. A further context change returns 409 and clears acknowledgement; changed edits require replacement. Legacy proposals without snapshots require replacement when context changes. There are no partial writes. See [ADR 009](../decisions/009-durable-proposal-review.md).

Retries with the same idempotency key and content return the original result. Reusing a key for different content conflicts; a proposal cannot be applied twice with different keys. Audit snapshots and results commit with domain writes.

Whole-batch undo checks every affected current entity against its recorded after-state. Any later edit rejects the whole undo, as does a restore that would move a workout or note added later, leave one without its plan, or give a later workout's position in its day to a restored one. Edits of other records in the same plan do not block it. Deleted state remains recoverable; restored entities receive higher revisions and deleted UUIDs cannot be recycled. Undo is another audit event. It does not reverse provider synchronization, migrations or external actions.

### Adaptive coaching clarification

Requirement source: the owner approved the adaptive clarification improvement with “implement this” on 2026-10-25 in the current chat, following examples of next-week adjustments and a three-month trail-running program. Scope and verification are preserved in the [execution record](../plans/mvp-execution.md#adaptive-coaching-clarification--2026-10-25).

The training-planning entry point loads a companion coaching skill for program creation and workout adaptation. The agent first reads permitted context and prior user answers, then asks only unresolved questions whose answers materially affect the goal, training dose, schedule, feasibility or constraints. It does not repeat known information or impose a universal questionnaire. Weekly adjustments can proceed directly when context is sufficient. New multi-month programs clarify relevant missing goals/events, dates, training baseline, availability, terrain and constraints; a race is not required for a general-fitness goal.

Questions are brief and grouped, with choices when useful and a free-text answer available. They use the external harness's supported interface or ordinary chat, without requiring a special planning mode. Essential answers are awaited before dependent prescriptions or submission. Silence does not count as an answer; minor gaps can use explicit assumptions. A follow-up with partial answers asks only for remaining essential information. Explicit changes to preferences apply to the requested proposal without changing the athlete profile. Excluded private notes are not requested to fill an intake checklist.

After clarification the agent completes the requested duration and level of detail, validates the proposed changes and submits them through the existing scoped workflow. A three-month request is not silently reduced to two weeks or twelve weeks. Material scope/access conflicts are explained and resolved through the owner connection workflow before affected changes are submitted. Context is refreshed after a clarification pause. Coaching answers do not authorize application; the exact proposal is still reviewed/applied in Agent workspace.

This addition defines agent instructions, not a server-enforced questionnaire, new coaching algorithm, sport model or persisted intake record. Broader sport-reference libraries, numerical coaching-policy tooling and automatic recurring reviews remain outside this change.

## Acceptance scenarios

| Input or situation | Expected result | Verification |
| --- | --- | --- |
| Read/propose grant attempts apply | Endpoint denied; owner session is required | HTTP/browser suite |
| Ordinary notes excluded | No private narrative field in context or submission response, including nested intervals and completion reasons; hidden interval notes cannot be overwritten | [Database cases](../../tests/integration/domain.test.ts) |
| Invalid second command | No mutation, audit or idempotency partial result | Database cases |
| New relevant injury/import | Fresh owner review required; further changes conflict; mutation conflicts require replacement | [Review cases](../../tests/integration/proposal-review.test.ts), [browser cases](../../tests/e2e/proposal-review.spec.ts) |
| Expired access / seven-day deadline / revoked grant | Access expiry preserves owner application; proposal expiry and revocation block it | Review cases |
| Legacy proposal / excluded notes | Matching legacy context remains usable; changed context requires replacement; snapshots preserve exclusions | Review cases |
| Multi-week proposal with a new plan, a move across weeks and a deletion | Edits grouped by week, one collapsed line per record, plan shown by title, no horizontal overflow at 320px | [Week grouping](../../tests/unit/proposal-weeks.test.ts), browser cases |
| Six-week grant with daily health | Last seven days daily, earlier days as weekly averages with known-day counts; missing metrics unknown, not zero; health payload cut by more than three quarters; digest unchanged when a day moves into a week | [Health summary](../../tests/unit/health-weeks.test.ts), database cases |
| Same payload/key retry | Same committed result | Database cases |
| Later edit before undo | Entire undo conflicts | Database cases |
| Out-of-scope duplication | Proposal denied before stored review | Database cases |
| CLI connection approved | Sign-in returns to the request; typing the terminal code and explicit scope issue one grant, then CLI saves it privately without printing it | [Browser/CLI cases](../../tests/e2e/agent-connect.spec.ts) |
| Declined, expired, cancelled or wrong-code request | No usable new connection; previous saved configuration remains unchanged | [Connection cases](../../tests/integration/agent-connections.test.ts), browser/CLI cases |
| Repeated approval or changed approval payload | Identical retry reuses the grant; changed scope conflicts | Connection cases |
| Anonymous approval or foreign browser origin | Denied; public enrollment and polling cannot approve | Browser/CLI cases |
| Disconnected agent | Context access denied and CLI explains how to reconnect | Browser/CLI cases |
| Next-week adjustment with sufficient goals, recent training and availability | Reads context, skips intake questions and prepares only the requested pending changes | Coaching scenario walkthrough |
| Weekly availability conflicts with the request and intent is unresolved | Asks a focused scheduling question; waits before dependent scheduling | Coaching scenario walkthrough |
| Three-month trail program with missing goal, start and terrain access | Groups the material missing questions; does not invent a race or submit before essential answers | Coaching scenario walkthrough |
| Fully specified three-month program, including dates and general-fitness goal | Skips redundant questions, preserves the full requested dates/detail and uses supported running prescriptions | Coaching scenario walkthrough |
| Minor missing preference, or only some essential questions answered | States a minor assumption; asks only remaining essential questions and does not treat silence as an answer | Coaching scenario walkthrough |
| Private notes excluded, or a user changes a preference for this proposal | Respects excluded notes and uses the current preference without editing the profile | Coaching scenario walkthrough; existing scope enforcement remains authoritative |
| Clarification pauses while context changes or access expires | Refreshes/reassesses context; expired access requires owner reconnection before submission | Coaching scenario walkthrough; existing stale-context/connection tests |
| Requested program exceeds granted dates | Explains the mismatch and obtains owner-approved scope before affected submission; does not silently truncate or bypass limits | Coaching scenario walkthrough; existing source/scope checks |
| Exact move-only edit, or harness without a question-card interface | Mechanical edit skips coaching intake; any required questions use ordinary chat | Coaching scenario walkthrough |

Coaching scenario walkthroughs inspect the instructions against synthetic requests and are not automated model evaluations. External-harness discovery, question rendering and live model adherence need separate demonstrations; individual results and remaining gaps belong in the execution record.

## Observed implementation

The [bridge service](../../plugins/agent-bridge/service.ts) implements bounded reads, source checks, immutable proposals and apply; [training service](../../plugins/training/service.ts) implements shared mutation, audit and undo. Owner endpoints use secure session cookies and same-origin checks. Granted training endpoints expose only context and proposal submission. Separate pairing endpoints enroll, poll, and cancel a connection; they cannot approve access. Grants are hashed at rest. Credential preflight rejects invalid requests before the domain lock; transactional checks remain authoritative for identity, expiry, revocation and scope. Unknown cancellation credentials remain a no-op. The [CLI](../../scripts/agent.ts) is a small HTTP adapter.

Legacy grants retain their original maximum of 121 inclusive days. New versioned grants independently support five-calendar-year historical review and one-calendar-year planning, with access lasting at most 24 hours. These capabilities do not broaden existing grants. The UI defaults to recent context plus upcoming training. The [connection service](../../plugins/agent-bridge/connections.ts) stores ten-minute pending requests in plugin-owned `agent_bridge.connections`. Enrollment is public and bounded to five requests per trusted client and 30 overall per ten minutes; it creates no grant. Host-owned counters persist across restarts, use database time and commit before enrollment work. Rejected clients do not spend the overall allowance. HTTP 429 responses include `Retry-After` seconds and matching `error.details.retryAfterSeconds`. Only the configured proxy supplies client identity; unproxied local use shares one bucket. Owner approval uses the existing authenticated, same-origin plugin operations. The CLI polls using an unguessable secret; only its hash is stored. On approval that hash becomes the ordinary scoped grant credential, with no raw secret exposed to the browser. Polling is paced, requests older than a day are cleaned on enrollment, and repeated identical approvals are idempotent. Tokens are never browser query parameters or terminal output. These are implementation limits, not an OAuth compatibility claim; the approval/polling design follows the separation described in [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html).

The [CLI implementation](../../scripts/lib/agent-client.ts) opens the default browser and provides an approval-link fallback. It atomically replaces private local configuration only after approval. Cancellation attempts server cleanup, and the owner can always disconnect access in the application. A lost network response or unavailable server can prevent immediate cancellation; no automatic renewal is provided. The owner chooses one, four or 24 hours in the browser. Manual stdin configuration remains an advanced compatibility path.

The [approval UI](../../plugins/agent-bridge/connections-client.tsx) preserves the connection through sign-in, shows the shared context and requires the owner to type the terminal code; the server never sends that code to the browser. Revoked/expired access requires fresh browser approval. Actual discovery/loading by each external harness remains a separate demonstration recorded in the execution record.

The [coaching skill](../../.agents/skills/athlete-panel-training-coaching/SKILL.md) implements the clarification instructions, and the [training-planning skill](../../.agents/skills/athlete-panel-training-planning/SKILL.md) links to it after context retrieval. Both have generated Claude discovery copies. Source inspection establishes the routing and instructions; it does not establish live model compliance. The CLI, proposal schema, server authorization and application UI are unchanged by this addition.

## Contracts and constraints

The [training skill](../../.agents/skills/athlete-panel-training-planning/SKILL.md), [runtime contracts](../../packages/contracts/src/index.ts), and [decision](../decisions/003-reviewed-proposals.md) define the shared workflow. Commands belong to the [development guide](../development.md); executed checks belong to the [execution record](../plans/mvp-execution.md).

Deploy web and checkout together after the additive [connection migration](../../plugins/agent-bridge/migrations/001-connections.sql), using the coordinated upgrade procedure in the [development guide](../development.md#coordinated-upgrades-and-plugin-activation). Previous artifacts do not support the new schema signature; use the matched pre-upgrade archive for rollback.

### Readable review

Proposed edits are grouped by calendar week, starting on the profile's first day of the week, as requested in [issue 39](https://github.com/bidulelabs/athlete-panel/issues/39); plan records come first. Each record has one line with its action, date, title, sport, duration and distance. A workout moved to another week appears in its new week with its previous date; a deletion stays in the week it leaves. Opening a record shows field-by-field before/after values with duration/distance units, interval targets, note text, schedule and derived calendar dates. Plans appear by title, including a plan created by the same proposal. Reordering and deletion effects remain visible. Identity/revision metadata and full original records are available under expandable technical details. Rendering does not change the stored proposal digest, freshness validation, permissions or whole-batch apply/undo. Unknown fields remain visible rather than being silently omitted.


## Historical review and annual planning

Requirement source: the owner approved and requested implementation on 2026-10-31; choices and verification are in the [execution record](../plans/historical-agent-review.md). [ADR 016](../decisions/016-historical-agent-access.md) records the permission and consistency decision.

A version-2 grant contains optional independent `history` and `planning` capabilities, with at least one enabled. Historical categories are activities, health, training and current profile/context. Each capability has independent notes permission, off by default. The browser displays the combined access when both capabilities are selected. Historical-only connections cannot retrieve planning context or submit proposals. Five-year visibility cannot authorize proposal sources or results outside planning dates. Applying the exact reviewed proposal always requires the owner in Agent workspace.

Both dates are inclusive floating calendar dates. A range is allowed when its end is no later than the corresponding first/fifth anniversary of its start; February 29 clamps to February 28 in a non-leap anniversary year. Thus 2021-10-31–2026-10-31 is valid history and 2026-10-31–2027-10-31 is valid planning. Future dates are allowed. The resolved profile week boundary is captured at approval, including browser resolution of Automatic; subsequent profile changes do not rewrite that grant's boundary.

Legacy grants, saved CLI credentials and proposal snapshots retain their original meaning. New annual snapshots have version 3. Agent proposals support up to 1,500 commands and 4 MiB, while owner mutation requests retain their existing limits. An oversized annual proposal fails clearly without changing training or silently shortening/splitting the requested program. List responses carry counts/date bounds; full diffs load when opened, with large reviews collapsed by week. Seven-day proposal lifetime, revocation, stale-context review, idempotency, atomic apply and whole-batch undo remain unchanged.

### Historical read protocol

The bearer-authenticated bridge exposes history discovery, summary, records and current context operations. Public runtime schemas and generated references define their requests/results. Records support category, date, sport/subgroup and health-metric filters; incompatible filters are rejected. Prescription steps/exercises are separately paged parts. Default/max page sizes are 100/200 and each JSON response is at most 1 MiB. Source records remain in their owning plugins; the bridge does not load a historical workspace.

A review token captures permitted collection versions. Keyset cursors bind the review, grant, query, filters and page size. Ordinary records sort by relevant date and ID; prescription parts sort by ordinal; summaries by period/category/sport/source/metric. Every page revalidates access and source versions. Changes in any participating collection, even outside the requested period, return `history_changed`; discard earlier pages/results and restart discovery. There is no cross-request frozen database transaction or stored duplicate historical export. Authorization, dates and notes are checked independently for each request and embedded facts. Secrets, operational state, raw provider payloads and GPS have no historical export representation.

Profile context is explicitly current, not a record of past settings. Dated events/injuries are retrieved through records. Excluded notes include plan descriptions, calendar notes, workout/interval/exercise instructions and completion narrative; injury descriptions and profile goals retain their established explicit context meaning. Unknown legacy fields are never substituted with current profile assumptions; invalid optional fields have explicit diagnostics. Unsupported health metrics remain visible as excluded summary contributions with null aggregates and a query for their supporting records.

### Summary semantics and evidence

Monthly summaries are the default; weekly summaries use the grant's captured week boundary. Partial periods are clipped and labelled. Source references and detail queries retain the review's context. Recorded count, seconds, meters, elevation meters, active days and sessions per seven calendar days describe stored observations, not inferred inactivity or training load.

Planned volume follows scheduled dates; actuals follow provider/performed dates. Imported activities contribute once, linked workout copies contribute no additional actual volume, and non-skipped manual completions contribute separately. Potential overlapping manual sessions remain counted with a warning. Rest prescriptions do not contribute session volume. Planned completion counts and actual volume are separate measures. Unselected categories never contribute facts; response warnings identify comparisons unavailable because training or activity access was excluded.

Known measurement sums carry known/missing counts; absent measurements are null, including an entirely unmeasured total. Known zero is retained. Health corrections resolve by source stream/account/day/metric, then highest revision, measured timestamp and ID, including corrections to null. Daily means/minima/maxima use known corrected values; only steps receive an additive total. Separate source series preserve conflicting streams and accounts and report ambiguity, unknown days and provenance uncertainty. Existing provider scores remain provider scores; no diagnosis or recovery/load score is created.

Import scan coverage is separate from available measurements. Overlapping windows count each scanned calendar day once. Failed/unavailable windows and unscanned dates remain visible. Window record counts are not prorated into partial periods. Successful scanning does not establish that the provider supplied every measurement.

### Additional acceptance scenarios

| Situation | Required result | Verification |
| --- | --- | --- |
| Historical-only or legacy connection | No proposal authority from history; no new history authority from a legacy grant | Historical integration tests |
| Both capabilities with different dates/categories/notes | Each read/source/result respects its own capability | Historical integration tests |
| Inclusive anniversary, leap day, partial month/week | Calendar arithmetic and captured boundary, never 365-day approximation | Historical unit tests |
| Concurrent correction, deletion, plan move or coverage update | Stale review/cursor rejected; no silent missing/duplicate page | Historical integration tests |
| Linked workout and activity, missing/legacy health facts | No double-counting or invented values; contributing counts and evidence | Unit/integration fixtures |
| Annual program above 200 commands | One pending proposal, explicit owner review, atomic apply and undo | Annual integration/browser tests |
| Expired/revoked grant, tampered cursor or changed filters | Request denied without disclosing records | Historical integration tests |
| Five-year dataset and larger stress dataset | Bounded responses and measured local latency/resources | Synthetic benchmark and execution record |

New plugin-owned migrations add read indexes and transactional version counters. Update web/worker/checkout together through the coordinated upgrade procedure. Previous binaries do not understand the new grant/snapshot JSON and schema signatures; use a matched pre-upgrade backup for rollback. Actual deployment and production-data testing are outside this delivery.

### Simpler assistant workflow

Authority: the owner requested implementation of the six simplifications discussed in this chat on 2026-10-31, using Impeccable for UI/UX refinement. This changes presentation and local CLI orchestration, not server permissions or stored proposals.

One connection screen offers independent “Read my history” and “Suggest training changes” checkboxes. Planning alone stays selected initially, with the existing four-week lookback and two-week lookahead. History presets cover the last one, three or five calendar years; planning offers the existing short window, next twelve weeks or next calendar year. Custom dates remain editable and inclusive. The live access summary shows exact dates, actual categories, separate private-note choices, resolved week start and expiry. Category/notes controls live under “Customize shared data”; notes default off. No capabilities or no history categories produce actionable errors. Approval remains browser-only, and existing grants never widen automatically.

The CLI defaults bare `history` to monthly summaries. It automatically discovers and reuses a protected review sidecar bound to the instance/credential, while explicit review/cursor files remain available. Summary and record exports with an output file fetch all pages atomically by default; `--page` preserves single-page behavior. Stale reviews require an explicit restart of the analysis; no automatic retry silently mixes versions. Each request retains the existing server authorization and bounded response checks. Canonical commands and compatibility guidance are in [development](../development.md#historical-review-and-annual-planning-commands).

Proposal review starts with affected date bounds (including both ends of moves), sports and added/changed/deleted record counts. Proposals spanning more than two months or more than 200 records use collapsed calendar-month groups, then weeks, then exact record diffs. Small proposals retain direct week groups. Month membership follows the resulting date, or prior date for deletions; a boundary week appears in each relevant month containing only that month's records. Undated plan records stay separate. Expensive field/JSON detail rendering is deferred until the record is opened. Every edit remains accessible and the whole proposal still requires owner acknowledgement and atomic application.

Acceptance covers permission receipt/submission agreement, presets and custom dates, both/individual/empty capability choices, private notes and category exclusions, automatic discovery and consistent drill-down, explicit pagination/restart, unchanged files on a failed export, and month-boundary moves/deletions without duplicate display. Desktop and phone flows must be checked in both themes; actual results belong in the execution record.
