# Feature: reviewed external-agent training

## Purpose and scope

Let an external local harness read selected athlete context and propose pending training edits while the owner retains control. Athlete Panel runs no model or chat orchestration. Completion, links, athlete settings, injuries, secrets, activation, deployment and provider changes are outside agent mutation scope.

The [Garmin sport planning specification](garmin-sport-planning.md) extends structured context with sport groups/subgroups, rest, elevation and exercises. Notes-disabled grants redact exercise instructions and completion notes as well as existing narrative, and cannot duplicate or replace hidden instructions.

## Intended behavior

Specification status: approved. Authority: owner implementation request dated 2026-10-24, P6/R3–R4 and T6, preserved in the [execution record](../plans/mvp-execution.md).

On 2026-10-24 the owner additionally requested CLI connection with browser approval so tokens do not need to be copied manually. The owner approves a short-lived revocable grant with explicit date bounds and optional ordinary notes. The CLI stores the token in a private local file and never prints it. Exports include preferences/goals/zones, relevant training, injuries, activities and health within the selected range. Private plan descriptions, workout and interval notes, completion reasons, calendar notes, and event/injury notes are excluded by default. Relevant injury descriptions and profile goals remain explicit shared context. Secrets, operational settings, raw provider payloads and GPS are never exported. The owner sees categories before granting; the chosen harness may send this context to its model service.

The agent reads a context digest, then submits typed commands, a summary and an idempotency key. Source records as well as resulting changes must be within the grant: copying an excluded source into an allowed date is forbidden. A full-plan operation needs access to all affected children.

The server validates and expands the entire batch before storing it. The UI presents before/after changes, derived dates and ordering effects. Proposals expire seven days after submission, independently of agent access expiry; reads/submissions still require active access and revocation still blocks owner application. New proposals store a versioned snapshot of the same permitted bounded context, preserving note exclusions. An owner-only review operation loads contextual differences and mutation conflicts on demand. Context-only changes permit renewed owner acknowledgement when domain validation, scope, revisions and the exact expanded diff still match. Application rechecks these conditions, the immutable digest and the reviewed current-context digest in one transaction. A further context change returns 409 and clears acknowledgement; changed edits require replacement. Legacy proposals without snapshots require replacement when context changes. There are no partial writes. See [ADR 009](../decisions/009-durable-proposal-review.md).

Retries with the same idempotency key and content return the original result. Reusing a key for different content conflicts; a proposal cannot be applied twice with different keys. Audit snapshots and results commit with domain writes.

Whole-batch undo checks every affected current entity against its recorded after-state. Any later edit rejects the whole undo, as does restoring a plan start that would move a workout or note added later. Edits of other records in the same plan do not block it. Deleted state remains recoverable; restored entities receive higher revisions and deleted UUIDs cannot be recycled. Undo is another audit event. It does not reverse provider synchronization, migrations or external actions.

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

Current implementation bounds grants to 121 calendar days and at most 24 hours. These operational limits keep the MVP context bounded; they do not grant additional data categories. The UI defaults to recent context plus upcoming training. The [connection service](../../plugins/agent-bridge/connections.ts) stores ten-minute pending requests in plugin-owned `agent_bridge.connections`. Enrollment is public and bounded to five requests per trusted client and 30 overall per ten minutes; it creates no grant. Host-owned counters persist across restarts, use database time and commit before enrollment work. Rejected clients do not spend the overall allowance. HTTP 429 responses include `Retry-After` seconds and matching `error.details.retryAfterSeconds`. Only the configured proxy supplies client identity; unproxied local use shares one bucket. Owner approval uses the existing authenticated, same-origin plugin operations. The CLI polls using an unguessable secret; only its hash is stored. On approval that hash becomes the ordinary scoped grant credential, with no raw secret exposed to the browser. Polling is paced, requests older than a day are cleaned on enrollment, and repeated identical approvals are idempotent. Tokens are never browser query parameters or terminal output. These are implementation limits, not an OAuth compatibility claim; the approval/polling design follows the separation described in [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html).

The [CLI implementation](../../scripts/lib/agent-client.ts) opens the default browser and provides an approval-link fallback. It atomically replaces private local configuration only after approval. Cancellation attempts server cleanup, and the owner can always disconnect access in the application. A lost network response or unavailable server can prevent immediate cancellation; no automatic renewal is provided. The owner chooses one, four or 24 hours in the browser. Manual stdin configuration remains an advanced compatibility path.

The [approval UI](../../plugins/agent-bridge/connections-client.tsx) preserves the connection through sign-in, shows the shared context and requires the owner to type the terminal code; the server never sends that code to the browser. Revoked/expired access requires fresh browser approval. Actual discovery/loading by each external harness remains a separate demonstration recorded in the execution record.

The [coaching skill](../../.agents/skills/athlete-panel-training-coaching/SKILL.md) implements the clarification instructions, and the [training-planning skill](../../.agents/skills/athlete-panel-training-planning/SKILL.md) links to it after context retrieval. Both have generated Claude discovery copies. Source inspection establishes the routing and instructions; it does not establish live model compliance. The CLI, proposal schema, server authorization and application UI are unchanged by this addition.

## Contracts and constraints

The [training skill](../../.agents/skills/athlete-panel-training-planning/SKILL.md), [runtime contracts](../../packages/contracts/src/index.ts), and [decision](../decisions/003-reviewed-proposals.md) define the shared workflow. Commands belong to the [development guide](../development.md); executed checks belong to the [execution record](../plans/mvp-execution.md).

Deploy web and checkout together after the additive [connection migration](../../plugins/agent-bridge/migrations/001-connections.sql), using the coordinated upgrade procedure in the [development guide](../development.md#coordinated-upgrades-and-plugin-activation). Previous artifacts do not support the new schema signature; use the matched pre-upgrade archive for rollback.

### Readable review

The owner sees field-by-field before/after values with duration/distance units, interval targets, note text, schedule and derived calendar dates. Reordering and deletion effects remain visible. Identity/revision metadata and full original records are available under expandable technical details. Rendering does not change the stored proposal digest, freshness validation, permissions or whole-batch apply/undo. Unknown fields remain visible rather than being silently omitted.
