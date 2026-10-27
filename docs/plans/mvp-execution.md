# Private MVP execution record

## Authority and scope

On 2026-10-24 the owner explicitly requested: “PLEASE IMPLEMENT THIS PLAN” and supplied the complete private MVP implementation plan from the previous planning phase. This supersedes the earlier planning-only instruction. There is no durable conversation link available; this dated statement records the authority and its scope.

The accepted scope is the single-owner private PostgreSQL web application, manual cycling/running training, Garmin Personal import-only history, six health categories, reviewed agent edits, trusted source extensions, and private operational packaging. The legacy checkout, existing framework guides/templates and supplied mockups remain unchanged. No production deployment, legacy retirement, account cancellation or provider-account mutation is authorized by this local implementation record.

## Delivery and ownership

| Package                    | Owner                | Current implementation                                                                                                  |
| -------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| W00 contracts/tooling/docs | Integration          | Runtime schemas, pinned pnpm stack, registry/reference generation and canonical docs                                    |
| W01 host/access/registry   | Integration          | Owner bootstrap/recovery, sessions/origin checks, validated build-time composition and PostgreSQL migration coordinator |
| W02 manual slice           | Training/UI          | Profile, workout/calendar/completion and persistence                                                                    |
| W03 plans/context/order    | Training/UI          | Relative/unscheduled plans, intervals, notes/events/injuries, history guards and revisions                              |
| W04 records/projections    | Training/records     | Normalized records, missing-aware actual totals and linking                                                             |
| W05 Personal feasibility   | Garmin               | Public mapping and synthetic conformance; owner-account smoke remains open                                              |
| W06 sync/history/jobs      | Garmin/platform      | Encrypted credentials, durable leased jobs, recent-first traversal, resumable windows and error coverage                |
| W07 actuals/health UI      | UI                   | Explicit linking, activity history, weekly summaries and health display                                                 |
| W08 reviewed agent edits   | Integration/training | Scoped context, proposals, exact review/apply, idempotency, audit and undo                                              |
| W09 extensions/skills      | Extensions/UI        | Canonical skills, generated adapters, safe scaffold and separate cycling/sleep example                                  |
| W10 private operations     | Platform             | Packaging/backup/restore tools; operational rehearsal is recorded below                                                 |
| W11 integrated release     | Integration          | Local/container verification recorded below; container vulnerability triage and external deployment gates remain open   |

No task/PR URLs exist: this workspace was initially unversioned and has now been initialized as a new local Git repository. No commits or pull requests have been created during this work.

## Verification record — 2026-10-24

Executed locally against the final implementation:

- `pnpm check` passed: generated registry/contracts/skill adapters, import boundaries, TypeScript, **70 unit tests across seven files**, and documentation content/local links across 16 canonical files.
- `pnpm test:integration` passed: **47 PostgreSQL integration tests across four files**, including seven backup/restore operations tests and four migration/plugin lifecycle tests.
- `pnpm build` passed for the optimized Next.js standalone server and bundled worker. The standalone server started successfully; the compiled worker recorded its heartbeat and exited cleanly on SIGTERM.
- `pnpm test:e2e` passed: **10 browser tests** across desktop Chromium and a narrow Pixel 7 viewport, using the final standalone build. Checks include authentication, workout editing/completion/reload, plan persistence, keyboard interaction, theme switching, retained drafts/retry, scrolled mobile inspector geometry, and agent/origin authorization boundaries.
- PostgreSQL 17 was initialized in the ignored local runtime directory and exposed only on loopback port 55439. Dedicated `_test` databases isolate domain, UI and restore checks from ordinary application storage.
- Domain integration checks cover transaction rollback, concurrent revisions, persisted reload, digest review, changed query context, grant expiry/revocation, note privacy, out-of-scope duplication, deterministic proposal expansion, tombstone identity protection and undo conflicts.
- Mocked worker integration exercises credential encryption, duplicate/corrected import, malformed-batch rollback, checkpoint commit, Retry-After, account mismatch, disconnect retention and stale worker leases.
- Operational tests exercised real PostgreSQL dump/restore into isolated databases, authenticated encrypted archives, missing/wrong/tampered keys, maintenance and schema guards, source restoration, retention, session/grant invalidation and interrupted jobs. Migration tests exercised transactional rollback, incompatible schema/composition, changed or missing retained migration files, and disabled-plugin job recovery.
- Desktop/mobile and light/dark previews use synthetic training and health data. This is a local test instance, not a private-server deployment.
- Compose configuration validation passed. Application-image build attempts stalled while Docker resolved external image metadata and were stopped; the application container has **not** been verified. A cached Node base image running successfully is not evidence of application-image readiness.
- The legacy checkout remains clean at `9836b77a6b13aa717529c842b9cb62e99ca6e512`. Existing framework guides, templates and design references were preserved.

These are local command results, not a GitHub CI run or a deployment certification. Individual results here do not redefine the feature specifications.

At initial handoff, a clean synthetic preview was running on `http://127.0.0.1:3000` with its own isolated preview database and bundled worker. The demo password was the documented development default. The owner subsequently connected Garmin, so that database contained owner imports and was excluded from disposable testing despite its name. The explicit container reset recorded below supersedes that local database; the persistent owner instance must never be used for destructive test runs.

### Garmin historical sleep follow-up — 2026-10-24

The owner reported an invalid-calendar-date failure during historical health import. A bounded, authenticated diagnostic of the failed sleep request established three undated empty overnight DTOs carrying only ancillary metadata. No credentials or raw health payloads were saved to fixtures or logs. The actual request covered July 26–August 22; the previous coverage error incorrectly displayed the configured January 1 start.

The parser now excludes only the explicit empty overnight shape and retains coverage gaps. Undated actual sleep, numeric zero, malformed dates and unknown non-null fields still fail validation. Shared request identity now reports the exact metric/window on failure. Same-scope history retries resume the saved job; successful retry clears the corresponding failure, including the old phase-based coverage row. Synthetic regression verification passed **72 unit tests, 50 PostgreSQL integration tests, TypeScript and documentation checks**. The standalone web/worker production build passed and both processes were restarted successfully.

The original owner import job resumed at its saved checkpoint. Its previously failing July 26–August 22 sleep window committed successfully, reported partial coverage with the correct dates, and removed the obsolete failure row. The backfill then finished all six health streams through the configured January 1, 2026 start date: the job is `completed`/`done`, with no error and zero failed coverage windows. Existing activity count remained unchanged. Missing measurements remain partial coverage; successful traversal does not establish that Garmin supplied every historical measurement.

### Automatic history follow-up — 2026-10-24

The owner explicitly requested hiding the health-history date and importing everything possible in the past. This replaces the earlier user-selected history-bound decision. Connection now needs only a key, and the default history action carries no date. The importer uses a conservative January 1, 2000 internal health boundary (or preserves an older legacy bound), keeps activity pagination unbounded, and continues through empty health periods. This is an application scan policy, not a promise of provider retention. Explicit date-range repair remains available separately.

Existing automatic checkpoints expand without losing progress or replacing credentials. A response from the old in-flight checkpoint cannot overwrite the expansion. Completed limited imports can start a full traversal. Live owner data was preserved, and an expanded history job was queued and started. Its complete decades-long traversal remains background work, with pacing, pause/resume and durable checkpoints; no completion is claimed here. A read-only owner-account check confirmed all six health endpoints accept the internal January 2000 window and return empty/unknown data there.

Verification: **73 unit tests, 55 PostgreSQL integration tests, all 12 desktop/mobile browser tests, static/contract/boundary checks, TypeScript, documentation and the optimized standalone/worker build passed**. Desktop and mobile connection checks confirm the form has no date input, sends only the key and queues automatic history. Browser tests use a separate synthetic instance on port 3001, never the owner-data instance. A native-dialog centering issue found in visual verification was corrected and both layouts were inspected. The rebuilt owner web process and durable worker are running locally; readiness passed and the expanded history job continues without a reported error.

### Fresh local database container — 2026-10-24

The owner explicitly requested removing the native local database and using a container, with no data migration required. The requested local setup was verified using the packaged PostgreSQL 17 container and persistent volume, separate from disposable test storage. Machine-specific instance and secret configuration is omitted from this public record.

Only the existing password verifier was retained so the owner can use the same login. Profile, training, Garmin credentials/records, sessions, grants and import jobs were not copied. Fresh schema installation completed. Container restart retained the schema and owner; the authenticated workspace returned empty training/import collections, unauthenticated access was rejected, app readiness passed and the restarted worker reported a fresh heartbeat. The native PostgreSQL process was stopped and its exact `.runtime/test-postgres` data directory removed after those checks. Existing Homebrew client tools remain available for backup operations; unrelated containers were not modified.

An encrypted pre-reset application recovery archive was created and authenticated locally before removal. It is retained under `.runtime/backups/before-container-reset/`, with its separate key in `.secrets/garmin-reset-backup-key`; it is not an off-host backup. Local-container start/stop commands, persistence and test separation are documented in the development guide. Matched backups now include `compose.local.yml`. TypeScript and documentation checks passed; no feature or browser test suite was rerun for this operational switch.

### Browser-approved agent connection — 2026-10-24

The owner requested implementing `pnpm agent connect` with browser approval to avoid copying grant tokens. The CLI now opens the instance approval page, displays a matching code, waits for the signed-in owner to select dates/notes/expiry, and atomically stores the approved credential with restricted permissions. The browser never receives the secret. Sign-in preserves the pending request, the Agent workspace provides Connected agents/Disconnect, and expiry/revocation explains how to reconnect. Manual stdin configuration remains compatible but rejects interactive input rather than silently waiting.

Pairing requests use an additive plugin-owned migration, ten-minute expiry, hashed secrets, bounded enrollment, paced polling, identical-approval replay and cancellation cleanup. Existing read/propose-only permissions and owner application remain enforced. The associated privacy fix redacts plan descriptions, nested interval notes and completion reasons when notes are excluded, and blocks interval updates/duplication that could copy or overwrite hidden notes.

Verification: **75 unit tests, 63 isolated PostgreSQL integration tests, and all 20 desktop/mobile Chromium browser tests passed**, along with TypeScript, generated references/registry/adapters, boundary checks, documentation and the optimized standalone/worker build. Browser tests run the real CLI with a temporary private configuration and use its printed approval link (`--no-open`) in Playwright. They exercise sign-in return, approval, matching-code confirmation, scope, private file permissions, context export, disconnect, declined connection preserving previous configuration, terminal cancellation, and owner/origin boundaries. Both themes and responsive layouts were inspected. During verification, an ordinary-login redirect regression and a non-unique repeated-test selector were corrected before the final passing run. No credentialed Garmin request was part of these checks.

Browser verification now requires an explicit URL and a readiness marker available only with an explicit synthetic-server flag and loopback `_test` database. A read-only preflight confirmed that the guard refuses the owner instance before any browser mutation. Tests used an isolated synthetic database and separate application port.

Local activation: a matched pre-upgrade encrypted snapshot was created under maintenance, using the authenticated prior source snapshot and current database state. The additive migration was applied, schema verification passed, and the rebuilt owner web and worker were restarted. Owner readiness, unauthenticated agent rejection, approval sign-in return and absence of the synthetic test marker were checked. This is local activation, not a private Linux/container deployment. Actual default-browser launching on each supported OS remains separate from the automated `--no-open` browser checks.

## Release gates and remaining environment evidence

- Owner-account Garmin smoke: personal key entered in the app, automatic history traversal, actual identity/units/sentinel/permission checks, pagination behavior, device metrics, historical gaps and throttling. Routine CI contains no Garmin credential.
- Application container: complete the image build when registry metadata resolution is available, then exercise Compose startup and the critical workflow against that image.
- Actual private Linux deployment: server/domain, off-host backup destination and separately recovered encryption keys; verify HTTPS, worker health, backup delivery and restoration on that environment.
- Harness-specific discovery: canonical Markdown and generated adapters are checked mechanically; actual loading by installed Codex/Claude versions must be recorded separately. The personal example remains functional as ordinary application source after agent exit.
- Production sizing and restore-time objectives require measurements; no net savings or guaranteed recovery time is claimed.

## Operational costs

Required infrastructure is private server capacity, off-host backup storage and a domain for public HTTPS. TLS certificates need no paid certificate. Model/harness cost is optional for operating installed features. Vercel, Supabase, QStash, AI gateway, Stripe, email and analytics SaaS are not target dependencies. Existing legacy bills and Apple/Google/Workspace obligations are outside this rebuild action.

## Canonical handoff

Behavior belongs to the linked [feature specifications](../../README.md), durable boundaries to [architecture](../architecture.md), commands to [development](../development.md), and accepted consequential choices to [ADRs](../decisions). This file owns temporary package status, executed evidence and release gates.

## Configurable week start — 2026-10-25

Owner request: bring back the legacy app's configurable first day of the week, including Sunday for the USA. No durable conversation link is available. The legacy `lib/dates/weekStartsOn.ts` was inspected read-only; its Automatic/Sunday/Monday choices were adapted with support for both current and older browser week-info APIs.

Implementation: profile settings persist the optional `weekStartsOnPreference` field through the existing owner-only revision-checked domain mutation. Older profile/audit records remain unchanged and omission resolves as Automatic. Shared UI helpers align the three-week date range and weekday headings; date jumps, Today, navigation, weekly summaries and the cycling/sleep view consume the aligned range. Availability inputs reorder by named weekday without changing their values. Today uses the athlete timezone. No SQL migration or composition change was required. No legacy files were modified.

| Topic                                | Canonical document                                                            | Coverage completed                                                                                     | Remaining gaps                                       |
| ------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Week preference and training display | [Training workspace](../features/training-workspace.md#week-start-preference) | Scope, source, Automatic/manual behavior, persistence, unchanged dates, failure and boundary scenarios | Only Sunday/Monday supported, matching legacy scope  |
| Ownership and shared ranges          | [Architecture](../architecture.md#significant-interfaces-and-constraints)     | Athlete-owned preference and shared UI range contract                                                  | No new service boundary or ADR required              |
| Activation and rollback              | [Development](../development.md#coordinated-upgrades-and-plugin-activation)   | JSON compatibility warning despite unchanged SQL schema                                                | Private-server deployment remains separate           |
| Public contract                      | [Generated reference](../reference/contracts.json)                            | Optional validated preference in profile and command schemas                                           | Existing clients omitting the field remain supported |

Verification actually performed:

- `pnpm check`: passed registry/contract/skill drift, boundary checks, TypeScript, 82 unit tests and documentation validation. The calendar tests cover locale resolution, both Intl API shapes, unavailable-API fallback, real/leap/year/DST dates and athlete-timezone Today; summary tests cover Sunday actuals without moving records.
- Domain PostgreSQL integration suite: 26 passed against isolated loopback `_test` storage, including persisted preference across reconnects, stale-save rejection and unchanged workout dates.
- Production web/worker build: passed.
- Relevant Playwright suites: 16 passed across desktop and mobile Chromium (week-start and existing workspace workflows). Covered US/French locales, explicit preference persistence, year boundary, date navigation, aligned totals, both themes, unchanged prescriptions, failure/retry, normal manual workflows and auth checks. An initial failure was an ambiguous test alert selector matching Next's route announcer; scoping it to the profile form fixed the test, and the final run passed.
- Visually inspected `.runtime/browser/week-start-desktop-dark.png`, `week-start-desktop-light.png`, `week-start-mobile-dark.png` and `week-preference-mobile.png`. Responsive columns/lists and preference fields remain readable. Safari/Firefox were not run.
- Reviewed affected feature/architecture/operations claims and generated contracts against source. Documentation checks passed; runtime evidence is kept here rather than in the feature specification.

Local activation completed: took a source/database backup before edits, enabled maintenance, stopped the existing local web/worker processes, and authenticated a final matched pre-change-source/current-database snapshot (local archive filename omitted from public documentation). Verified installed composition/schema, restarted the built web server, checked health 200 plus unauthenticated settings redirect/workspace rejection, reopened writes and restarted the worker. Current profile validation and recent worker heartbeat passed. The owner database was not reset or seeded; browser mutations used only the isolated test instance. These archives are local recovery files, not off-host backups.

The feature is running on the local instance at port 3000. No private-server deployment was performed. An older binary rejects the new profile field after it is saved; rollback requires the matching pre-change snapshot, not only a code restart.

## Calendar cards and details — 2026-10-25

Owner request: implement the preceding short specification for legacy-inspired calendar cards and click-to-open details. The dated approval was “implement this”; no durable conversation link is available.

Implementation: compact cards for sleep, notes, events, injury constraints and imported activities open details inside the calendar. Sleep details show reported total, score, overnight HRV and Deep/Light/REM/Awake durations; complete positive stage data also has a proportional duration bar. Missing values, zero, score-only nights, account provenance and corrected measurements remain distinct. Injury cards cover their inclusive active range. Notes/events/injuries use explicit existing revision-checked edit and confirmed-delete operations. Imported measurements stay read-only; linked workouts expose their activity details without duplicating a same-day card. Desktop dialogs become scrollable phone sheets, and the shared modal restores keyboard focus on dismissal. No new provider requests, public contracts, persistence fields, migrations or composition changes were introduced. The legacy checkout remains unchanged.

| Topic                      | Canonical document                                                                      | Coverage completed                                                                                                    | Remaining gaps                                           |
| -------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Cards, details and actions | [Training workspace](../features/training-workspace.md#calendar-cards-and-detail-views) | Approved scope, interaction, missingness, account/date grouping, injury ranges, links, failure and boundary scenarios | Chronological sleep-stage timelines remain outside scope |
| Imported sleep facts       | [Garmin import](../features/garmin-import.md)                                           | Existing normalized measurements supply the views; no reimport required                                               | Missing provider measurements remain unavailable         |
| Component ownership        | [Architecture](../architecture.md#significant-interfaces-and-constraints)               | Calendar projection/UI, public DTOs and existing domain edits                                                         | No new service boundary or consequential ADR required    |
| Activation and recovery    | [Development](../development.md#coordinated-upgrades-and-plugin-activation)             | Existing coordinated local activation procedure applied                                                               | Private-server deployment remains separate               |

Verification actually performed:

- `pnpm check` passed registry/contract/skill drift, boundaries, TypeScript, **89 unit tests across 10 files**, and documentation validation. Seven new projection tests cover provenance, corrections, complete/incomplete/zero/unknown sleep and injury ranges.
- Domain PostgreSQL integration suite: **26 passed** against isolated loopback `_test` storage.
- Production standalone web and worker build: passed.
- Full Playwright suite: **36 passed** across desktop and mobile Chromium against the final production build. Ten new calendar checks cover detail viewing without writes, complete/incomplete/score-only sleep, full plain-text notes and plan context, event/injury dates, units, activity links, same-day deduplication, edit/confirmed delete, retry, stale-draft preservation, keyboard focus and both themes. An initial run exposed lost focus after dialog dismissal; the shared modal cleanup was fixed. An ambiguous textarea label selector was changed to its accessible textbox role. The final full run passed.
- Visually inspected desktop/mobile calendar and sleep-detail screenshots in both themes under `.runtime/browser/calendar-*.png`. Mobile sheets and card lists remain readable. Safari/Firefox were not run.
- Reviewed affected feature/architecture claims, links and documentation coverage against source. Current command authority remains the development guide; feature documents contain behavior, while this record contains executions. No credentialed Garmin request was part of verification.

Local activation completed: maintenance was enabled and the previous web/worker processes stopped. The pre-edit source backup was authenticated and combined with the current database into a verified matched recovery archive (local archive filename omitted from public documentation). Composition/schema verification passed. The rebuilt web server returned readiness 200, protected the calendar with a login redirect and rejected unauthenticated workspace access with 401. Maintenance was disabled, the worker restarted, and current profile validation plus fresh worker heartbeat passed. No owner data was reset or seeded; browser mutations used only a dedicated synthetic database on port 3001. The synthetic web/database processes were stopped after verification.

The feature is running on the local instance at port 3000. The backup is a local recovery file, not an off-host backup. The immediate previous week-start release supports the same persisted data and schema, so this UI change permits a compatible code rollback. No private-server deployment or new live-provider completeness claim is made.

## Richer weekly summaries — 2026-10-25

Owner request: “implement this specification for richer weekly summaries,” approving the preceding short specification in this chat. No durable conversation link is available. This work replaces the first-visible-week statistics strip with independently expandable summaries for all visible calendar weeks, retaining date navigation.

Implementation: each collapsed header shows dates, planned/recorded session counts and durations, including incomplete-data indicators. Expanded sections compare duration and running/cycling distance, show recorded elevation separately by sport, and show average sleep with elapsed/missing/upcoming night coverage. Partial totals expose missing counts; ratios require complete metrics, a positive plan and known actual measurements. Existing actual-date, linked-pair, partial/skipped, generic-sport and overlap rules remain intact. Sleep corrections resolve through the card projection; ambiguous overlapping source accounts are disclosed and excluded from the average. No database migration, provider request, persisted field or composition change was added. Existing staged work and the legacy checkout were preserved.

| Topic                           | Canonical document                                                              | Coverage completed                                                                                                | Remaining gaps                                              |
| ------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Weekly display and calculations | [Training workspace](../features/training-workspace.md#richer-weekly-summaries) | Approved scope, metric definitions, incomplete/zero/empty states, ratios, dates, units and read-only interactions | Planned elevation/sleep targets remain outside this version |
| Ownership and storage           | [Architecture](../architecture.md#significant-interfaces-and-constraints)       | Training volume/elevation projection, calendar sleep coverage, existing bounded DTOs                              | No additional persistence or consequential ADR required     |
| Activation and rollback         | [Development](../development.md#coordinated-upgrades-and-plugin-activation)     | Existing coordinated procedure and compatible prior-release rollback                                              | Private-server deployment remains separate                  |

Verification actually performed:

- `pnpm check` passed registry/contract/skill drift checks, import boundaries, TypeScript, **97 unit tests across 11 files**, and documentation validation. Eight new calculation tests cover volume/elevation scope, manual elevation missingness, complete/incomplete/empty/zero ratios, linked and generic activities, actual chronology, corrected sleep totals, overlapping accounts and elapsed/future/year-boundary sleep coverage.
- Domain PostgreSQL integration suite: **26 passed** against isolated loopback `_test` storage.
- Optimized standalone web and worker build: passed.
- Full Playwright suite: **42 passed** across desktop and mobile Chromium. Six new browser checks cover independent expansion, keyboard operation, both themes, expected totals, sleep coverage, missing-data ratios, unit/week-start changes, no viewing mutations and retained data during refresh failure/retry. Existing week-start checks now assert against the corresponding week's header instead of the removed strip.
- Visually inspected `.runtime/browser/weekly-summary-desktop-dark.png`, `weekly-summary-desktop-light.png`, `weekly-summary-mobile-dark.png` and `weekly-summary-mobile-light.png`. Comparisons and context sections remain readable in both layouts. Safari/Firefox were not run.
- Reviewed affected feature/architecture documentation, scope, links and acceptance attribution against source; documentation checks and whitespace checks passed. No live Garmin request was needed for verification.

Local activation completed: a source/database backup was created before edits. Under maintenance, the prior web/worker processes were stopped and a matched pre-change-source/current-database snapshot authenticated (local archive filename omitted from public documentation). Composition/schema verification passed. The updated web process returned readiness 200, unauthenticated calendar redirect and workspace 401. Maintenance was disabled and the worker restarted; current profile validation and recent worker heartbeat passed. Owner training data was not reset or seeded. Browser checks used a dedicated synthetic database on port 3001; those synthetic web/database processes were stopped afterward.

The feature is active locally on port 3000. No private-server deployment or Garmin history completeness claim is made. These archives are local recovery points, not off-host backups. The previous calendar-card release supports the same persisted data/schema, so a compatible code rollback can retain the database.

## Redesigned week header — 2026-10-25

Owner request: “implement this specification for the redesigned week header,” approving the preceding compact-header specification. No durable conversation link is available.

Implementation: a continuous calendar band shows the dated week, current-week indicator, session counts, recorded/planned duration and running/cycling distances, per-sport recorded elevation, and average sleep with coverage. Container queries adapt it to the actual calendar width, including the inspector; phones use four metrics in a 2×2 grid and retain elevation in expanded details. Expansion adds scheduled-session status counts, independently covered factual HRV averages, and up to six chronological session shortcuts opening existing details. Missing, partial, zero, no-plan and upcoming states remain distinct. Linked pairs count once; corrected activity identities resolve before filtering by date. Keyboard semantics, inert collapsed content and reduced-motion support accompany the 180ms reveal. No provider calls, persisted fields, migrations, dependencies or composition changes were added; the legacy checkout remains untouched.

| Topic                                | Canonical document                                                              | Coverage completed                                                                                                       | Remaining gaps                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Header and expanded facts            | [Training workspace](../features/training-workspace.md#richer-weekly-summaries) | Approved layout, scheduled versus performed dates, HRV missingness, preview ordering and limits, accessibility           | No inferred HRV baseline/readiness or training-load score       |
| Derived projections and interactions | [Architecture](../architecture.md#significant-interfaces-and-constraints)       | Training-owned status/preview, shared corrected daily metrics, calendar-owned nightly coverage and existing detail views | No new service/storage boundary                                 |
| Activation and recovery              | [Development](../development.md#coordinated-upgrades-and-plugin-activation)     | Existing maintenance, matched backup, schema verification and restart procedure                                          | Private-server deployment and off-host recovery remain separate |

Verification actually performed:

- `pnpm check` passed drift/boundary/TypeScript/documentation checks and **102 unit tests across 11 files**. Five new tests cover scheduled-status cohorts, recorded chronology and linking, corrected activity identities/account separation, HRV-only nights, null/zero corrections, ambiguous accounts and future dates.
- Isolated PostgreSQL domain integration suite: **26 passed**.
- Production standalone web/worker build: passed.
- Full Playwright suite against the final production build: **46 passed**, desktop/mobile Chromium. Added checks cover collapsed metrics, current-week labels, scheduled counts, independent HRV coverage, bounded chronological previews, detail/inspector navigation, focus restoration, no viewing mutations, reduced motion and empty states. Existing tests cover units/week preferences, missingness and refresh failures. Two focused preview/layout scenarios were repeated successfully after disabling transitions during screenshot capture; no application code changed after the full run.
- Visually inspected desktop/mobile light/dark header and expanded-summary screenshots, including the narrower inspector layout, under `.runtime/browser/week-header-*.png` and `.runtime/browser/weekly-summary-*.png`. Safari/Firefox were not run.
- Reconciled feature/architecture descriptions and links against implementation. Routine verification used synthetic data and made no credentialed Garmin requests.

Local activation completed: enabled maintenance, stopped previous web/worker processes, and authenticated a matched prior-source/current-database backup (local archive filename omitted from public documentation). Composition/schema verification passed. The rebuilt owner server returned readiness 200, redirected unauthenticated calendar access to login and rejected unauthenticated workspace access with 401. Maintenance was reopened and the worker restarted; current profile validation and fresh heartbeat passed. The owner database was not reset or seeded. Browser tests used only a dedicated synthetic database on port 3001; synthetic processes were stopped afterward.

The redesign is active locally on port 3000. No private-server deployment occurred. The immediate prior richer-summary build supports the same persisted contracts/database, allowing code-only rollback. Recovery archives are local, not off-host backups.

## Public-release fixes — 2026-10-25

The owner requested implementation of the eight audit improvement groups. This work changes source and documentation only; it does not publish a repository, commit/stage files, rewrite history, migrate the running owner database, restart the owner instance or make credentialed Garmin requests. Prior source edits, the anonymous MIT attribution and reference materials are preserved. Machine-specific paths/backup filenames in public documentation are generalized.

### Implemented

- Installation: `pnpm run owner` throughout runnable instructions; executable pnpm `.mjs` launcher in the image; Node minimum aligned with pnpm; separate runtime/admin configuration and explicit admin/recovery services.
- Privacy: Docker copies declared source roots; conventional exports, private directories, keys, dumps and Python caches are excluded. A local publication checker reads exact index/commit bytes, reports locations without values, and produces an optional local hash inventory. Current public documents use generic source paths.
- Security: per-client login limits using a Caddy-overwritten identity, IPv6 /64 grouping and mapped-address normalization; bounded asynchronous password verification. Runtime PostgreSQL access cannot administer roles/databases/schemas, truncate tables or modify owner credentials/migration history. Console recovery remains administrative.
- Recovery: executable disposable container rehearsal covers HTTPS, console setup, runtime access, persistence, encrypted backup and restoration. It exposed and fixed Node 22 directory-copy behavior that previously rejected the newly reserved restore destination. Restoration also clears process/backup health inherited from the previous machine.
- Feedback: worker health checks and stale-heartbeat guidance; backup attempt/age states; pending Garmin credential verification, aggregate coverage counts, missingness and retry timing.
- CI: pinned actions/scanners, exact-tree and reachable-history checks, locked dependency/image vulnerability scans, synthetic image-exclusion probes and the container rehearsal. High/critical findings fail the gate; no blanket ignore was added. Dependabot configuration supplies update proposals.
- Community: security policy, contributor guide, bug/feature forms, PR template and public-release checklist.
- Agent review: readable changed fields with units, intervals, schedule/order effects, notes and deletion visibility; complete JSON under technical details. Stored proposal digest, permissions and atomic application are unchanged.

### Verification performed

- `pnpm check`: passed generated-file drift, boundaries, TypeScript, **107 unit tests** and **21 documentation/link checks**.
- PostgreSQL integration: **65 tests passed** in six files on isolated storage; changed authentication/access and restore/provider suites were rerun after follow-up fixes and passed.
- Browser verification: **46 existing scenarios passed**, followed by **four new review/status scenarios passing** across desktop/mobile Chromium. The first review assertion was corrected to address the visible table row rather than hidden responsive text. Final review screenshots were inspected in dark/light themes; the screen-reader caption and borders were corrected after visual inspection.
- Optimized web/worker builds passed in an isolated checkout and Linux ARM64 Docker image. The production pnpm command, migration/bootstrap, authenticated create/reload, private runtime credentials, restart persistence and worker health passed the container rehearsal.
- Encrypted backup restored into a separate fresh database; missing-key restoration failed before writes; restored sessions were revoked; a changed applied migration was rejected while the original composition stayed usable. Separate-machine/off-host/public-certificate verification is still required.
- All six synthetic export/configuration probes were absent from the built image, including a custom-named root export and a nested documentation export.
- Two publication-checker regression tests passed, including detection of sensitive staged bytes after the working copy is fixed. Gitleaks found no secrets in the current candidate source tree. The current candidate pattern scan found no prohibited paths/secrets; all five documentation images were visually inspected (two show the synthetic 2030 fixtures; three are supplied design concepts).
- Trivy locked-dependency scan, including development dependencies: no HIGH/CRITICAL findings at scan time. This does not cover bundled native/runtime components; the container scan does.

### Remaining release gates

**The release is not yet cleared for publication.** The added container scan reported **128 package/advisory findings (123 HIGH, five CRITICAL; 52 distinct advisories)** in the initial candidate: Debian packages, bundled Node/undici and Go binaries in esbuild/gosu. These are scanner findings, not 128 proven remotely exploitable application bugs. Some require vendor-status/applicability review; for example the [Debian advisory notes](https://security-tracker.debian.org/tracker/CVE-2023-45853) identify zlib MiniZip source code that is not built into the relevant binary. No unreviewed exception was applied. Investigate a smaller updated runtime/client image, maintained Node/tool binaries and current vendor fixes; rerun the exact-image scan. Any exception needs specific evidence, scope and an expiry, with owner review.

At the time of this review, the Git repository had no committed history and its index still contained two private home-directory paths despite a sanitized working copy. Staging was intentionally preserved. The required follow-up was to stage the reviewed current files, rerun the exact-index check before the initial commit, then scan that commit and reachable history. An old staged snapshot must not be published merely because the working-copy scan is clean.

GitHub-hosted CI execution, private vulnerability reporting/branch protection, real DNS/public TLS, actual off-host delivery/restore on another machine, AMD64 container rehearsal, Safari/Firefox and account-specific Garmin readiness were not verified during this task. No private deployment or publication was performed. Apply the documented permission transition and restart procedure when deliberately activating these changes on an existing instance.

## Guided local setup — 2026-10-25

The owner approved implementation of the explained `pnpm run setup` and `pnpm run local` workflow. The [feature specification](../features/local-setup.md) records its intended behavior and boundaries; the [development guide](../development.md#local-development) owns commands and troubleshooting. The README now starts with installation, guided setup and combined startup.

Implemented protected random credential/URL/key generation, atomic exclusive `.env` creation, hidden password/confirmation input, reuse of existing migrations and owner bootstrap, and explicit preservation of existing owner databases. Missing configuration with retained local storage, invalid configuration and schema mismatches fail with guidance instead of replacement. Local startup loads configuration, validates restricted runtime access and supervises web/worker process groups together. Administrative and inherited test configuration are excluded from runtime children. Docker data survives shutdown. No dependencies or database migrations were added.

Verification actually performed:

- `pnpm check`: generated-file drift, boundaries, TypeScript, **118 unit tests** across 13 files, and **22 documentation/link checks** passed. The 11 new tests cover generated/private configuration, exclusive creation, symlinks/permissions, URL/credential validation, non-executable parsing, environment filtering, command locks, occupied ports, sanitized failures, sibling/descendant cleanup and password validation.
- `python3 scripts/rehearse-local.py`: passed on macOS with Node 22.22.0 and pnpm 11.25.0, using a disposable checkout, synthetic credentials, isolated ports, a separate Docker project and PostgreSQL volume. It exercised terminal password hiding/confirmation, invalid passwords, cancellation/resume, repeated setup without credential/account changes, login/save, worker heartbeat, Ctrl+C cleanup, restart persistence, incompatible-schema refusal and missing-configuration refusal. The real credential generator selected isolated port/project overrides; no owner configuration was loaded. The rehearsal passed again after adding runtime privilege checks.
- `pnpm build`: optimized Next web build and worker bundle passed.
- `git diff --check`, local publication-pattern scan and setup help command passed. No secrets or personal-path findings were reported in current candidate files; this does not replace exact staged/history review.
- Temporary test processes, containers, volumes and checkouts were removed. CI now invokes the same local rehearsal, but its GitHub-hosted execution and native Windows/WSL behavior were not verified here.

The owner's `.env` remains unchanged; a read-only compatibility check found that it uses the earlier configuration and needs to be preserved/moved aside before a deliberately fresh setup, or reconciled through the manual guide for an existing database. The existing web process was not stopped or restarted. No owner database was initialized, reset or seeded, no Garmin calls were made, and nothing was staged, committed, published or deployed.

### Visible setup password — 2026-10-25

The owner subsequently requested visible login-password entry. The setup prompt now displays both the chosen password and its confirmation, using ordinary terminal line editing with history disabled. This supersedes the hidden-input behavior above. Password hashing, validation, protected configuration and the non-echoing stdin workflow are unchanged. README, CLI help and canonical setup documentation describe the visible input.

Verification: `pnpm check` passed TypeScript, boundaries, generated-file checks, 118 unit tests and documentation checks. The isolated local rehearsal passed visible password/confirmation entry, invalid/mismatched input, cancellation/resume, login, save, worker startup and restart persistence. Initial rehearsal failures exposed two harness assumptions: cancellation output must be consumed before waiting for the terminal child to exit, and the development server may briefly return non-success HTTP status before readiness. The harness now drains cancellation output and waits for HTTP 200 with a bounded timeout; persistent failures still fail verification. `git diff --check` and final documentation checks passed. Only disposable synthetic storage was used; the owner's configuration, data and processes were not changed during this password-display update.

### Localhost login origin — 2026-10-25

The owner reported an origin rejection when signing in through `http://localhost:3000`. Inspection confirmed the generated canonical origin was `http://127.0.0.1:3000`; the previous exact comparison rejected the alternate local name. Local HTTP now accepts these two names on the configured port only when secure cookies and trusted proxy mode are disabled. HTTPS, proxy-hosted and non-loopback configurations retain exact origins. Missing/malformed origins, other hosts, protocols and ports remain rejected. Rejection messages now point to the configured application address. Documentation describes the local exception and hostname-scoped sessions.

Verification: `pnpm check` passed with **121 unit tests**, including local alias acceptance and strict hosted/malformed-origin rejection. The isolated local rehearsal passed real synthetic login/logout through both names, foreign-origin rejection and the existing setup/restart workflow. A validation-only request against the running owner server (empty body, no password or session) reached input validation through both local origins (400) and remained blocked for a foreign origin (403); no login attempt, session or training data was written by that probe. No credentials, configuration, migrations or deployment processes were changed. Temporary rehearsal storage was cleaned up.

## First time onboarding implementation — 2026-10-25

The owner requested implementation of the [approved onboarding specification](../features/first-time-onboarding.md). Implemented the authenticated three-step athlete contribution, shared preference/timezone controls, optional shared Garmin key form/status, background import continuation, saved progress and Settings resume. Existing owners are classified by an additive migration; new bootstrap initializes pending progress, and recovery preserves it. Preference/audit/progress writes are atomic and revision checked; configure retries retain only request fingerprints and safe results. SDK workspace contributions keep the feature out of the generic shell. Updated README, architecture, feature documentation and isolated browser-test configuration.

Verification on synthetic storage:

- `pnpm check`: registry/contracts/adapters, boundaries, TypeScript, 123 unit tests and documentation checks passed.
- `pnpm test:integration` with an explicit isolated test database: 73 tests passed, including eight new onboarding transaction/security/idempotency cases.
- `pnpm build`: production web and worker artifacts built successfully.
- Packaged-server browser suite: all 60 desktop/mobile tests passed. After the Settings refresh correction, 16 onboarding/week-start checks passed; after final polling/touch-target refinements, all 10 onboarding checks passed against the rebuilt artifact. These include an empty profile's detected defaults, reload/Back, skip, encrypted key queuing with no worker, dismissal/resume, close during a save, foreign-origin rejection, agent-approval deferral, draft retention and 320px layout.
- Light/dark desktop/mobile screenshots were visually inspected. A preliminary test run exposed test-only login-navigation timing and approval-heading assumptions; those assertions were corrected before the passing runs.
- `git diff --check` passed. No authenticated Garmin requests, owner database writes, public deployment, Git commit/staging or external publication were performed. Native screen-reader and physical mobile-keyboard checks remain manual verification limits.

Activation is separate: apply the additive migration through the documented matched-backup/maintenance upgrade procedure, then restart web and worker on the new artifact. Existing owners then have **Settings → Run welcome setup**; new owners see the dialog after sign-in. The schema signature changes, so do not assume a prior binary can run against the updated instance metadata without the matched recovery procedure. The temporary synthetic preview and test storage were stopped after verification.

## Priority audit fixes — 2026-10-25

Authority: the owner requested the five priority fixes, documentation and relevant tests, explicitly prohibiting publication or changes to the running instance. The active development server watches the original checkout, so implementation and verification use an isolated source copy with no owner `.env`. The original index/source and running database are preserved; integration back into that checkout requires stopping its development processes first.

Scope: exact publication-candidate checks; smaller production runtime with pinned pnpm 11.28.8; original-revision profile/workout drafts and truthful refresh feedback; paginated failed/unavailable Garmin coverage plus persisted worker failures; hosted secret generation and explicit local maintenance/verified backup/migration commands. No destructive migration or provider request is needed for these changes.

Implementation records and scan output are retained in the task's ignored `.runtime` evidence. The staged personal-path problem was already resolved when work began. Asset provenance and GitHub/server/account acceptance remain unverified. Local verification is recorded separately from deployment; no candidate is activated on the owner's instance.

Verification of the isolated priority-fix candidate: 125 unit tests, 75 PostgreSQL integration tests and 68 desktop/mobile Chromium browser tests passed; type/build/registry/contract/skill/boundary/documentation checks passed. Fresh dependency installation with pnpm 11.28.8 passed. The expanded local rehearsal passed cancellation/resume, both loopback hostnames, restart persistence, refusal of maintenance while running, authenticated backup, rejection outside maintenance/wrong key, and an explicit forward migration that leaves writes closed. The production container rehearsal passed local-CA HTTPS, restricted roles, restart persistence, authenticated separate-database restore, missing-key rejection and incompatible-candidate rejection. The candidate image scan found zero HIGH/CRITICAL vulnerabilities without exclusions. Scanner databases change; repeat against the release digest. Actual off-host/server/Garmin acceptance remains unperformed. All work stayed outside the active checkout.

## Guided VPS installation, upgrades and recovery — 2026-10-25

Authority: the owner requested implementation of the five VPS improvements, documentation and isolated tests, without publishing or changing the running instance. Work extends the previous isolated priority-fix candidate. The active checkout has an unborn Git history, with 229 staged files and no commit revision to report. Its source-file hashes remain unchanged. No owner configuration or data was used for tests, and no application migration was run against that instance.

Implemented:

- A Python standard-library controller for fresh Linux VPS installation, private generated configuration, console password creation, production Compose startup and HTTPS/worker checks. It needs no host Node/pnpm. Operator state is locked, checkpointed and kept outside source and archive storage.
- Guided upgrades build an immutable candidate before downtime, validate retained migration artifacts, pause writes, verify a fresh installed-release backup, stop processes and execute migrations plus runtime grants. Resume handles interruption after migration commit without replaying SQL. SQL rollback and post-commit permission failures have different diagnostics. Only preparation before maintenance can be cancelled.
- Backup archives are read back and authenticated before receiving a completed filename. Registered remote storage requires the expected Linux network filesystem and identity marker; missing or foreign storage fails closed. Legacy/manual archives remain usable but do not claim verified off-host protection. Backup status and maintenance-paused worker feedback reflect these distinctions.
- Recovery authenticates the archive, creates a new database, restores matching source, rebuilds it, refreshes restricted grants and checks the restored application and a fresh backup. The failed database is retained. A replacement-server procedure recovers separately held keys/state, without depending on old local images.
- The README, canonical operating guide, architecture, release checklist and new hosted-operations specification describe the managed workflow and retain advanced manual procedures. CI runs the same disposable hosted rehearsal. No production SQL migration or dependency change is required by this work.

Verification performed on macOS with Docker Desktop Linux ARM64 containers, PostgreSQL 17, host Node 22.22.0 and pinned pnpm 11.28.8:

- `pnpm check`: generated references/registries/skills, boundaries, TypeScript, **127 unit tests across 16 files**, and **24 documentation/link checks** passed.
- `python3 -m unittest discover -s tests/security`: **12 tests passed**, including controller locks, checkpoint retry, private state, storage identity, cancellation boundaries, retained release identity and publication-checker fixtures.
- `pnpm test:integration`: **76 tests across seven files passed** against explicitly isolated PostgreSQL storage with PostgreSQL 17 client tools. The added subprocess case proves migrations can commit before a permission refresh fails, and that correcting configuration/rerunning preserves the migration journal.
- The production Docker build passed. The release rehearsal (`scripts/rehearse-release.py`) against the disposable test image passed standalone backup compatibility, HTTPS certificate validation, owner bootstrap, restricted roles, restart persistence, authenticated separate-database restore, missing-key refusal and incompatible-candidate rejection.
- The hosted rehearsal (`scripts/rehearse-hosted.py`) against the disposable test image passed guided installation, preserved credentials on repeated setup, login/save/restart, missing-storage refusal, a real forward SQL migration, interruption immediately after commit, safe resume and old-artifact rejection. Matched-source recovery restored login, saved records and new writes/backups while retaining the previous database and revoking old sessions. A second unique Compose project with an empty volume recovered from separately copied keys and the archive; the encrypted synthetic fixture remained readable and a new backup succeeded. Rehearsal configuration also includes a stale container-PID lock to verify hosted setup uses its host lock rather than stale container identity.
- Configuration generation was independently exercised inside the image with networking and capabilities disabled, a stale PID lock and repeated invocation; generated secrets were preserved. No credentials were printed.
- `git diff --check` and the local working-candidate publication pattern check passed. The latter inspected **243 files**, found no prohibited patterns and identified five pre-existing media files requiring publication privacy/rights review. This is not a fresh full Git-history or vulnerability audit.

Verification exposed and corrected three integration defects before the passing runs: private recovered-source permissions prevented the backup UID from reading the rebuilt source; a circular top-level module import blocked the standalone backup CLI; and source/state separation needed canonical paths on macOS. Source files are now readable inside the image while their outer recovery directory stays private, shared archive primitives have their own module, and path comparisons resolve aliases. An initial database integration run selected PostgreSQL 14 client tools from the host path; the recorded passing run explicitly selected version 17.

Disposable test projects, databases, volumes and temporary recovery state are removed by the harness. Ignored logs, the local test image/build cache and a combined review patch remain in the isolated candidate. The patch includes the previous priority fixes; it is not a second patch to apply on top of their earlier handoff. It has not been applied to the active checkout.

Limits: the synthetic remote-storage fixture does not establish real NFS/SMB/SSHFS durability or transport behavior. Public DNS/certificate issuance and renewal, off-host retention, and recovery on another physical VPS remain operator acceptance checks. AMD64/GitHub-hosted CI execution, PostgreSQL major-version upgrades, and adoption of existing manual deployments were not verified or automated here. No account-specific Garmin calls, public release, deployment, owner restart, configuration change or data reset occurred. Previous vulnerability/browser-suite results are historical; they were not rerun or relabelled as current results for this operations change.

### Applying the combined fixes locally — 2026-10-25

The owner subsequently authorized applying the combined patch to the main project and stopping its local server as needed. The patch passed a clean applicability check. The supervised local web/worker and a second worker running from the same project were stopped before source changes. All 243 candidate source files matched after application; the existing Git index and protected `.env` remained unchanged. No database deletion, credential regeneration or schema migration was needed.

Corepack selected the pinned pnpm 11.28.8. Frozen dependency installation, `pnpm check` (127 unit tests plus type/generated/boundary/documentation checks), 12 Python safety tests, the production web/worker build and whitespace checks passed in the main checkout. A read-only check confirmed the existing owner database matches the applied schema and restricted runtime permissions. The earlier isolated integration/container recovery results still apply to the unchanged implementation; those suites were not rerun against owner storage.

The application was restarted using `pnpm run local` with its existing configuration and persistent PostgreSQL container. Readiness and the localhost login page returned HTTP 200, unauthenticated workspace access returned 401, and the worker health check passed. Normal background processing resumed. No direct authenticated Garmin verification, public deployment, publication, commit or staging operation occurred. The previous isolated patch remains a historical handoff and must not be applied a second time.

## Image-based installation and upgrades — 2026-10-25

Authority: the owner requested implementation of Docker image-based installation/upgrades, preserving migrations, backups, recovery and custom plugins, with documentation and isolated tests, without publishing or changing the running instance. Work was performed in a separate source copy. The original checkout has unborn Git history; the reviewed baseline contained 243 public working files over its existing staged state. No owner database/configuration was read into fixtures or used as test storage.

Implemented changes:

- The hosted controller accepts a trusted versioned registry image, a prebuilt local image, or reviewed custom source. It resolves and checkpoints immutable image identity before activation; resume does not follow moved tags. A small deployment bundle pins the portable registry digest and needs no source checkout or server-side application build. Python/Docker remain prerequisites. Local bundle packaging does not publish an image or release.
- Build metadata fingerprints the archived source and composition. Managed backups authenticate the matching local image ID, portable digest, version and fingerprint; source drift is rejected. Existing source-only archives remain supported. No production SQL migration or dependency change is introduced.
- The existing maintenance/backup/migration/grant/readiness sequence remains authoritative. Changing a custom/older build to a registry image, changing repositories or removing enabled plugins requires explicit review before maintenance. Retained migration artifacts remain mandatory even with acknowledgement. Source/local image options preserve owner extensions and edits.
- Recovery selects the authenticated archived image, pulling its digest when local images are absent. Explicit archived-source rebuild remains available for unavailable custom images; older archives use that path automatically. Restored data goes to a new database and the previous database remains. Registry availability, external keys and real off-host storage remain prerequisites.
- Updated README, canonical installation/update/recovery guidance, architecture, hosted feature specification, release checklist and decision record. CI now rehearses the registry/bundle path in addition to existing source/manual paths; no publication workflow or registry credentials were added.

Verification performed in this task:

- `pnpm check`: **129 unit tests passed**, plus TypeScript, registry, contract, skill, boundary and documentation checks.
- `python3 -m unittest discover -s tests/security`: **18 tests passed**, including bundle CLI selection, explicit image versions, moved-tag resume, custom-change guards, protocol/download errors and an allowlisted digest-only bundle.
- `pnpm test:integration`: **77 tests passed** against a unique disposable PostgreSQL 17 container bound to a random loopback port, explicitly selecting PostgreSQL 17 client tools. Includes authenticated image identity/source-drift refusal and existing source-only archive compatibility.
- Production Linux ARM64 Docker build passed. The hosted rehearsal (`scripts/rehearse-hosted.py`) against the disposable test image passed generated setup, repeat-install preservation, HTTPS/session/save/restart, missing-storage rejection, a real forward SQL migration, interruption after commit, safe resume, incompatible old-artifact rejection, explicit matched-source rebuild, retained prior database, session revocation and a fresh replacement cluster with encrypted fixtures/new backups.
- The registry-based hosted rehearsal (`scripts/rehearse-hosted.py`, with `--registry`) passed installation from an extracted source-free bundle using a disposable loopback registry; authenticated portable image identity; custom-build/plugin-removal guards before maintenance; image upgrade with real migration/interruption/resume; exact-image recovery; and a new replacement cluster recovering an added owner plugin, its composition and the migrated schema. The cold-image branch deliberately simulated absent local image lookup while performing real digest pulls; no source build was allowed in that branch.
- Current public working candidates passed the local publication pattern scanner. This is not a new complete secrets/history/asset-rights audit. No new images/screenshots contain owner data. Whitespace checks passed.

Disposable database, registry, application containers, volumes and recovery directories were removed. Ignored logs, local test images/build cache and a review patch remain in the isolated candidate. All 243 original public source-file hashes and exact Git index entries matched the baseline at handoff; the original web PID and healthy database container remained running. A dry application check of the incremental patch passed without applying it. The patch is incremental to the already-applied combined VPS changes; it is not applied to the running checkout.

Limits: no official image/bundle was published, registry location chosen, GitHub-hosted CI run, owner instance changed or authenticated Garmin call made. The latest browser/vulnerability suites were not rerun for this deployment change; existing CI gates remain. Loopback TLS uses a local CA and backup storage is explicitly synthetic. Public DNS/certificate renewal, actual remote mounts/retention and physical second-server recovery remain operator acceptance. AMD64/multi-architecture behavior, PostgreSQL major upgrades, controller-protocol transitions and automatic adoption of old manual/local installations are not claimed as verified.

### Applying the image-workflow patch to the main project — 2026-10-25

The owner subsequently authorized merging the prepared patch into the main project, permitting container removal if necessary. All 243 baseline source files still matched the prepared candidate and the incremental patch passed a clean applicability check. Applied its 25 files and verified their bytes against the tested candidate before adding this execution entry. A private snapshot of the affected original files and applied patch is retained under the ignored runtime directory. Existing Git index entries and protected local configuration were preserved; no commit or publication was performed.

The patch changes operational tooling, tests and documentation, not the running web/worker entry points or SQL migrations. Container deletion, database reset, migration and server restart were unnecessary. The existing web PID remained running, the original PostgreSQL container stayed healthy, and read-only health/login checks returned HTTP 200.

Post-merge verification: `corepack pnpm check` passed with 129 unit tests plus generated-reference, boundary, TypeScript and documentation checks; all 18 Python safety checks passed. The 77 integration tests were rerun successfully from the main checkout against a unique disposable PostgreSQL 17 container with explicit test configuration and PostgreSQL 17 client tools; that container/storage was removed. CLI help and whitespace checks passed. The earlier production image and isolated source/registry upgrade/recovery rehearsals remain the recorded build/deployment evidence for the matching implementation; they were not rerun against owner storage. No authenticated Garmin request was made by verification.

The README and operating guide in the main project now describe the image/bundle workflow. No official registry image or downloadable release bundle has been published. The isolated handoff patch has now been applied and must not be applied again.

## Hourly automatic Garmin synchronization — 2026-10-25

The owner requested automatic Garmin synchronization every hour. Changed the recent-import scheduling interval from six hours to one hour and updated the Garmin page, README, feature acceptance scenarios and operating guide. The worker continues running continuously; cadence is measured from the latest recent job’s creation, with scheduling checked between job steps. Existing active jobs, pause/disconnect handling, provider backoff and the seven-day refresh window remain unchanged. No migration, dependency, composition or permission change is required; the previous code remains schema-compatible.

Verification: `corepack pnpm check` passed with 129 unit tests plus generated-reference, boundary, TypeScript and documentation checks. All 79 integration tests passed using a disposable PostgreSQL 17 container and intercepted synthetic Garmin requests. New coverage checks the one-hour boundary, concurrent scheduler checks, preservation of active retry timing, and disabled scheduling while paused/disconnected. The production web/worker build and whitespace checks passed. No new visual workflow or browser interaction was introduced.

Local activation: stopped the supervised web/worker cleanly, built the updated application, and restarted `pnpm run local` with existing configuration. Health/login returned HTTP 200 and the new worker heartbeat was healthy. The protected configuration and existing Git index remained unchanged; PostgreSQL stayed running, with no data reset, schema migration or container deletion. Routine background processing resumed under the owner’s requested cadence. No direct authenticated Garmin smoke request, VPS deployment, staging, commit or publication was performed.

## Documentation review — 2026-10-25

Reviewed the README, development guide, architecture and execution records for consistent public documentation. The three design mockups use the current product label; their layouts remain concept references rather than claims of implemented features. Documentation content and local links passed validation across 25 files, and the whitespace check passed. This work changed documentation and design assets only; application code, private configuration and the running instance were unchanged.

## Application configuration and recovery validation — 2026-10-25

Application tooling uses the documented Athlete Panel configuration, credential locations, image metadata, storage marker and archive envelope. Hosted image preparation requires valid application metadata; unsupported backup envelopes fail before restore. Deterministic duplicate-child identifiers use the application namespace consistently during proposal preview and apply. SQL migration files and restricted runtime permissions are unchanged. The local and hosted specifications document these contracts.

Verification:

- `pnpm check` passed: registry, contracts, skill adapters, boundary checks, TypeScript, **131 unit tests** and documentation validation.
- **80 PostgreSQL integration tests** passed against a separate disposable database container, including authenticated backup/restore, invalid/truncated/corrupt envelopes, retention and transactional training/proposals.
- **22 Python controller/publication checks** passed, including missing image metadata, preserved database identities, upgrade guards and operation checkpoints.
- Production Docker and isolated standalone builds passed. **14 desktop/mobile browser checks** passed for the application identity, saved theme, browser-approved agent connection, proposal review/apply and operational feedback.
- The guided local rehearsal passed with a private temporary directory under the checkout: fresh setup, repeated setup, both loopback hostnames, save/restart persistence, maintenance, backup verification and a forward migration. Two attempts using the default macOS temporary directory failed during Next development-server startup with a missing `@swc/helpers/_/_interop_require_default` module. The same harness passed with the alternate temporary directory; no dependency or application-server workaround was applied. The temporary-directory difference is an observed environment limitation, not a diagnosed upstream cause.
- The registry-based hosted rehearsal passed source-free installation, HTTPS login, immutable image identity, custom/plugin guards, a real SQL migration, interruption/resume, exact-image recovery and recovery into an empty replacement cluster. It used a disposable loopback registry and synthetic storage, with no external publication.

Repository content and filenames were checked for consistent public application identifiers. Private configuration, Git metadata and ignored local artifacts were outside that scan and unchanged. Disposable services/storage were cleaned up. No owner data, private configuration or deployment was changed. Logs remain private under `.runtime/identity-cleanup/`. Public DNS/certificate renewal and real off-host recovery remain separate release checks.

## Impeccable calendar and inspector refinement — 2026-10-25

The owner requested the Impeccable workflow and selected desktop week planning with phone review/logging, keeping a precise training notebook with orange accents and flat paired themes. Created [product context](../../PRODUCT.md), the [design system](../../DESIGN.md), and its `.impeccable/design.json` component samples. Root instructions now load those records for UI work; documentation validation includes them. Existing design references remain preserved.

Two independent reviews established a **25/40 heuristic baseline**. The archived critique is `.impeccable/critique/2026-10-25T21-26-52Z__plugins-calendar-client-tsx.md`. Its two priority issues were incomplete/unreliable workout details and hard-to-read calendar facts/actions. Implemented:

- Complete read-only prescriptions with grouped repeats, duration/distance, HR/power/pace/RPE targets, notes and metric/imperial display. Logging appears near the title.
- A complementary desktop inspector that becomes a native modal sheet at narrow widths, with focus entry/return, background scroll lock, Escape/backdrop dismissal and nested-editor handling. An editor draft survives resizing; the sheet switches mode after the editor closes.
- Larger essential labels and phone hit areas, theme-specific text accents and destructive-button foregrounds, explicit completion-button states and date-input focus.
- A visible Recorded / planned key, matching expanded-table order, a Week in review heading and distinct Missing data qualifiers.

Feature behavior stays in calendar/training plugins. The shared modal now returns focus inside a remaining parent modal. No public schema, persistence, migration, manifest, registry composition, dependency or permission change was needed. Architecture ownership is unchanged; no new ADR was warranted. The feature specification and browser acceptance scenarios were updated.

### Verification and audit

Checks use a separately created loopback PostgreSQL 17 database, synthetic demo/fixtures, Node 24.19.0 and pnpm 11.25.0 available in this environment (the repository pins 11.28.8). Frozen-lockfile installation succeeded without dependency or lockfile changes.

- `pnpm check` passed: registry/contracts/skill adapters, boundaries, TypeScript, **131 unit tests** and documentation validation.
- Optimized web and worker builds passed. Browser checks used the built application on an isolated loopback port.
- Final production browser run: **47 passed**, with one duplicate desktop case intentionally skipped because it runs only under phone touch emulation. The final resize-mode and 44px completion-control assertions passed.
- Read-only prescription checks cover all target kinds, repeat grouping, notes and unit conversions without mutations. Interaction coverage includes creation/editing/completion/reload, nested Escape and focus return, viewport changes in both directions, long content at 320/768/1024px, synthesized touch, light/dark themes, missing/zero/partial data, failed saves/refreshes, stale drafts, week boundaries and permission regressions.
- Rendered desktop/phone screenshots were inspected. Computed summary-label contrast measured **6.02:1 dark** and **6.11:1 light**; current-week orange text measured **6.30:1 dark** and **5.54:1 light**, and active light navigation **5.01:1**. These are sampled color pairs, not a conformance certification.
- Initial failures exposed dialog-role ambiguity, nested focus restoration and a deferred resize transition; all were corrected. Existing tests now identify named editor dialogs. A hit-area assertion was changed to wait for the existing entrance animation to finish before measuring.
- The final manual source detector emitted 87 findings: 85 design-documentation advisories and two pattern warnings. The warnings are the established Inter/system font and an unchanged generic callout border outside this refinement; neither warrants changing the approved identity. Advisories mostly concern the deliberately partial documented size/radius palette and existing feature tints. Documented compact type roles were expanded. The scan is broader than the zero-result baseline and now reads DESIGN.md, so raw counts are not a before/after quality metric. No rule suppressions were added.

Audit judgment for this bounded surface: **16/20, Good**. Implementation integrity passes: the weekly ledger, fact provenance, paired themes and explicit controls remain coherent.

| Dimension | Score / 4 | Evidence and limit |
| --- | --- | --- |
| Accessibility | 3 | Named native dialogs, focus/dismissal tests, readable sampled contrast, explicit selected states; no full screen-reader certification. |
| Performance | 3 | Bounded calendar and existing short reduced-motion-aware transitions; no new assets/dependencies; no device performance benchmark. |
| Theming | 3 | Both themes inspected, semantic foreground repairs; feature tint literals remain intentional. |
| Responsive behavior | 3 | Desktop, phone, intermediate/landscape, long content and touch emulation checked; no physical phone/browser matrix. |
| Implementation integrity | 4 | Product-specific structure preserved; detector warnings assessed against scope and confirmed direction. |

No unresolved P0/P1 issue remains in the selected priorities. **P2 follow-up:** some shell captions and unrelated views retain 8–10px metadata in global CSS. A broader typography pass can assess these in their own tasks; this calendar/inspector pass does not certify those screens. Formal zoom/screen-reader, Safari/Firefox and physical iOS/Android checks remain unperformed. PostgreSQL integration tests were not rerun because no domain/storage behavior changed; the browser flows exercised real synthetic persistence.

Framework documentation validation:

| Topic | Canonical document | Coverage completed | Remaining gaps |
| --- | --- | --- | --- |
| Audience and direction | PRODUCT.md | Owner choices and existing product constraints recorded | None for this scope |
| Visual conventions | DESIGN.md and sidecar | Paired tokens, typography, layout and reusable samples | Deliberately not an exhaustive catalog of legacy declarations |
| Behavior and acceptance | Training workspace specification | Read-only prescriptions, responsive modal and comparison order | Broader device/accessibility acceptance above |
| Ownership and decisions | Architecture and existing ADRs | Reviewed against the implementation; no ownership/contract change | No new ADR required |
| Execution evidence | This record | Implementation distinguished from checks and activation | Real deployment not performed |

The temporary preview server was stopped and its dedicated synthetic database removed; screenshots and logs remain under ignored `.runtime/design-review/` and `.runtime/browser/`. Activation requires the existing build/restart procedure; rollback uses the prior code without a database migration. No owner data, existing application processes, private configuration or legacy checkout was changed. No deployment, commit or publication was performed.

## Calendar composition follow-up — 2026-10-25

The owner requested implementation of the proposed compact and session-focused calendar layouts. The refinement retains the confirmed notebook direction and the earlier prescription/modal work. Two independent layout reviews identified wasted header space, narrow columns beside details and phone cards losing width to a separate add-action column. The layout detector found no mechanical baseline issues; the rendered review supplied the design priorities.

Implemented in the calendar plugin:

- A combined title, Compact/Sessions switch, add action and date toolbar; the date range appears once.
- Compact defaults to seven desktop day columns with tighter spacing. Sessions uses chronological day rows and a 340–380px inspector. The same React tree retains the selected workout and expanded week context during switching.
- Phone views share a day list with add controls in the 44px date rail and full remaining card width. Existing native modal details, logging and nested editors remain intact.
- Weekly date/session metadata shares a line when space permits; recorded/planned order and missingness explanations remain explicit.

The Impeccable Live helper did not establish a browser connection. `live-resume` confirmed no active durable session before falling back to direct implementation. Its injected script and temporary source artifacts were removed; bootstrap diagnostics remain under ignored `.runtime/design-review/`. The app has no runtime dependency on that helper.

Verification used the separate `athlete_panel_layout_20261025_test` PostgreSQL database with synthetic demo data and browser fixtures. `pnpm check` passed all checks and **131 unit tests**; the web and worker production builds passed. The selected production Chromium suite passed **37 tests**, with one desktop duplicate skipped because its phone/landscape case runs under touch emulation. Coverage includes both layouts, selection and expanded-summary retention, no writes from switching, 21 dates, paired themes, intermediate widths of 1060/1280px, 320px phone card width and 44px targets, native modal/focus behavior, nested draft preservation, all prescription targets, actual creation/edit/log/reload, missing data and failed/stale requests. No domain or storage implementation changed; database integration tests were not rerun.

Rendered inspection covered both desktop layouts and themes, phone day lists and the intermediate session layout. The title/actions lead into date navigation, then weekly facts, then session cards; selected-session actions remain grouped in the adjacent inspector. Dated rows avoid equal-height empty desktop columns in Sessions. Compact deliberately preserves week alignment. At phone widths DOM order follows date, add action and cards; long content, empty days, reduced motion and failed requests retain existing tested behavior. The final layout detector returned **zero findings**. Physical-device, Safari/Firefox, full screen-reader and browser-zoom testing remain unperformed.

Framework validation: the training specification now owns layout semantics and acceptance, DESIGN.md records the composition, and this record owns evidence. Local links and documentation checks pass. Architecture, permissions, contracts, persistence, manifests and migrations are unchanged; no ADR or activation-composition change is required. The layout preference is intentionally ephemeral and resets on calendar mount.

The built synthetic preview remains available at `http://127.0.0.1:55722/calendar` for review. No real deployment, commit or publication occurred. Activation and rollback follow the existing code build/restart procedure; no database migration is needed.


## Compact-only calendar — 2026-10-26

The owner requested removal of the two-layout choice and a consistently compact desktop calendar. This supersedes the layout-switch behavior in the preceding composition follow-up. Removed the selector, its React state and all session-row styles; the toolbar now has only the title, add action and date navigation. The seven-column desktop planner, responsive phone day list, workout inspector and existing accessibility refinements remain. DESIGN.md and the training specification now describe the single layout; the existing layout acceptance scenario was updated. No ownership, persistence, permission, manifest, contract or migration change was required.

Verification: web/worker production builds, TypeScript and documentation checks passed. The focused production browser run passed **17 tests**, with one duplicate desktop scenario skipped. Checks cover seven columns at 1060/1280/1440px, absence of the selector, both themes, 320px phone cards and touch targets, weekly summaries, prescription details, nested dialogs, retained drafts, focus restoration and logging. Rendered desktop and phone captures were inspected. Unit and database integration suites were not rerun for this presentation-only removal. Existing physical-device and alternate-browser limits still apply.

The former synthetic database container was absent. Recreated test-only PostgreSQL storage and initialized the separate `athlete_panel_compact_20261026_test` database using migrations and the synthetic seed. The preview was rebuilt, restarted and refreshed at `http://127.0.0.1:55722/calendar`; no owner database was used. Evidence remains in ignored `.runtime/design-review/compact-only-*` files. Framework validation found the affected design/feature/acceptance records consistent with the implementation and local links valid. No deployment, commit or publication occurred.

## Shared shadcn UI and shorter week summaries

Authorization: on 2026-10-26 the owner explicitly requested implementation of “Shorter week summaries and full shadcn UI migration” in this conversation. The request covers all app screens, two-level week disclosures, factual tooltips/touch popovers, theme preservation, synthetic local checks and a rebuilt preview. It does not authorize production deployment. No durable conversation URL is available.

Implemented source: generated shadcn 4.22.1 `radix-nova` controls in `packages/ui`, web/UI configs and exports, prefixed theme mapping, compatible wrappers and provider; migrated common controls across bundled screens; replaced confirmations and mobile navigation/inspector interactions; moved workout editors above responsive mounting boundaries. The calendar retains its existing calculations, all five header metrics and duplicate warnings, with an eight-cell expanded band and independently reset detail disclosure. See [shared interface](../features/shared-ui.md), [training workspace](../features/training-workspace.md), and [ADR 007](../decisions/007-shared-shadcn-ui.md).

Verification completed against the production build using Node 24.19.0, pnpm 11.25.0 available in this environment (the repository pins 11.28.8), and isolated synthetic PostgreSQL storage on loopback port 55439:

- `pnpm check` passed registry/contracts/skill adapters, boundaries, TypeScript, **131 unit tests** and documentation checks across 29 files. Frozen-lockfile installation and `git diff --check` passed.
- `pnpm test:integration` passed **80 tests in seven files**. Production web and worker builds passed.
- The final full Chromium browser suite passed **82 tests**, with two intentional platform-specific skips: the width matrix runs once on desktop, and the long-content touch scenario runs once under mobile emulation. Both scenarios passed in their selected project.
- Weekly checks cover both themes at 320, 390, 768, 1060, 1280 and 1440px, open inspectors, long imperial values, year boundaries, week-start preferences, all five metric triggers, the 48px wide header, independent disclosures, unknown/zero/partial/future data, hover/focus/touch explanations, dismissal and absence of accidental expansion or writes. Explicit planned zero remains numeric in both the header and expanded band.
- App-wide checks cover login, navigation, onboarding, calendar, plan/workout forms, activity/health/settings, Garmin fixtures, agent connections/proposal review, plugin management and cycling/sleep. Nested editors and confirmations, keyboard focus/return, one-layer Escape, responsive draft preservation, stale/failed saves, native date/select behavior and reduced motion passed.
- Rendered screenshots were inspected across migrated screens in both themes, plus the calendar width/inspector matrix. Final evidence is in ignored `.runtime/shadcn-review/` (`browser-final.log`, `check-final.log`, `integration.log`, `build-final.log`, `summary-preview-light.png`, `screen-*.png`, `week-*.png`, and `inspector-*.png`), with additional scenario captures in `.runtime/browser/`.

Verification exposed and resolved generated state-selector compatibility, horizontal tabs and switch visibility, bottom-sheet placement, onboarding initial focus, responsive inspector focus/draft transitions, nested confirmation Escape, narrow desktop card wrapping, and a mobile navigation test that needed to wait for Sheet exit before reopening it. Native-dialog and old button-role assertions were updated while retaining their behavioral expectations. No known failing acceptance case remains. Safari/Firefox, physical devices, browser zoom and a formal screen-reader/conformance audit were not performed.

Framework documentation validation:

| Topic | Canonical document | Coverage completed | Remaining gaps |
| --- | --- | --- | --- |
| Shared interface and maintenance | Shared UI specification and development guide | Component ownership, wrappers, tokens, generation version, dependencies and acceptance | Alternate-browser/device accessibility verification above |
| Weekly behavior | Training workspace specification | Compact metrics, explanations, two disclosures, missingness and unchanged calculations | None identified within the approved behavior |
| Ownership and decision | Architecture and ADR 007 | Shared provider/package interactions and accepted library decision with explicit owner source | No backend or schema change |
| Visual direction | DESIGN.md | Existing themes, compact calendar and shared-control conventions | No formal conformance certification |
| Execution and release | This record | Actual checks and visual evidence separated from local preview and deployment | Private-server deployment remains separate |

Affected links, acceptance claims, ownership, command references and ADR status were checked against source and actual results. No diagrams were added or changed. The rebuilt preview remains available at `http://127.0.0.1:55722/calendar`, signed in with the new `athlete_panel_shadcn_preview_20261026_test` synthetic seed so regression-test records do not clutter review. The browser suite used the separate `athlete_panel_compact_20261026_test` database. No real Garmin credentials, production storage or private-server deployment were used. No commit or publication was performed. Rollback requires the previous code and matching lockfile followed by rebuild/restart; this migration needs no database rollback.

## Pre-push audit — 2026-10-26

The owner requested a final audit before pushing to GitHub. Reviewed the complete accumulated design change, including shared controls, plugin consumers, calendar/inspector state, package configuration, release packaging, tests and publication candidates. No GitHub push or production deployment is part of this audit.

Three verified issues were corrected:

1. **P1 — Noninteractive release build:** production dependency pruning aborted in Docker because pnpm requested a terminal before replacing the module tree. The pruning command now runs with scoped `CI=true`; the actual production image builds successfully using the repository-pinned pnpm 11.28.8 and Node 22 image.
2. **P2 — Incomplete source packaging:** the new product/design documents and durable design sidecar were absent from the explicit image/backup allowlists. Added exactly those files, preserving exclusion of local tool configuration. A regression test verifies inclusion, exclusion and source-digest sensitivity; the real backup/restore suite passed.
3. **P2 — Local paths in publication candidates:** the historical design critique contained two machine-specific home paths. Converted these to repository-relative references. Exact staged publication checks now pass without suppressions.

Implementation integrity: **pass**. Domain-specific calendar, prescription and chart composition remains in plugins; shared controls preserve the existing notebook identity and paired themes. The Impeccable source detector reported 59 findings: 57 design-token documentation advisories and two pattern warnings for the established Inter/system font and existing callout accent border. These are retained conventions, not newly discovered runtime defects; no ignore rules were added. Detector output is distinct from the rendered/browser evidence.

| Dimension | Score / 4 | Evidence and limits |
| --- | --- | --- |
| Accessibility | 3 | Named controls/dialogs, keyboard focus/dismissal and reduced-motion browser checks; no formal screen-reader certification |
| Performance | 3 | Production builds and bounded calendar rendering; no device performance benchmark |
| Theming | 3 | Shared semantic mappings and both-theme screenshots; domain styles retain documented literals |
| Responsive behavior | 3 | Six-width matrix, long values, touch emulation and responsive draft preservation; no physical-device or alternate-browser run |
| Implementation integrity | 4 | Consistent shared ownership, unchanged training calculations and repaired release/source packaging |
| **Total** | **16 / 20** | **Good; no verified unresolved blocking issue in the reviewed change set** |

Final verification: `pnpm check` passed **132 unit tests**, TypeScript, boundary/generated-source and documentation checks. **80 integration tests**, **82 browser tests** (two intentional platform duplicates skipped), and **22 publication/security tests** passed. Browser checks used the standalone production server at port 55723 and isolated synthetic storage. Web/worker builds and the full production Docker build passed. The resulting container served login and reported readiness; its filesystem contains all three durable product/design files. The pnpm production dependency audit reported zero known vulnerabilities. Exact staged-source publication and Gitleaks scans found no private paths/files or secrets. Ignored evidence lives in `.runtime/final-audit/`; the earlier screen captures were refreshed by this browser run.

Framework validation: shared-interface and training specifications cover the implemented behavior; architecture and ADR 007 cover ownership and the approved component choice; the source-packaging note now matches the image/backup implementation. Affected links and actual acceptance evidence were checked, with no new diagram or separate consequential design decision. Remaining verification limits are Safari/Firefox, physical devices, browser zoom, formal screen-reader/conformance checks and production infrastructure. The local preview at port 55722 remains separate from regression storage. This record documents local verification; any later GitHub push remains an explicit separate action.

## Hosted CI source-copy repair — 2026-10-26

The owner reported a `container-installation` CI failure: initial installation passed, but the hosted rehearsal failed while building its upgrade candidate. The Dockerfile and backup allowlists included the new design inputs, while the separate `copy_candidate` allowlist in `scripts/rehearse-hosted.py` still omitted PRODUCT.md, DESIGN.md and `.impeccable/design.json`. The earlier audit verified image build/startup, but did not run this complete hosted upgrade/recovery path; its checks did not cover the separate candidate copy.

Added those three exact inputs and parent-directory creation for the nested design file. The new `tests/security/test_hosted_rehearsal.py` derives required inputs from the actual Dockerfile and checks the candidate against them, independently of the copy allowlist. Its synthetic fixtures also verify that private exports, environment files, generated dependencies/build output and local design-tool configuration stay excluded while `.env.example` remains available. Before the fix, the test failed with precisely the three missing design inputs; after it, all 23 Python publication/controller tests passed.

The production image build and `pnpm check` (132 unit tests, types, generated-source/boundary and documentation checks) passed. The full source-based hosted rehearsal passed installation, HTTPS login, persistence, authenticated backups, forward migration, interruption/resume, matched-source recovery and an empty replacement instance. Private/generated-file and whitespace checks passed. Evidence is retained under ignored `.runtime/hosted-ci-fix/`. No runtime application behavior, migration, training API or production installation was changed.

The complete registry-based rehearsal also passed: source-free bundle installation, immutable image identity, custom/plugin-preservation guards, forward migration/resume, exact-image recovery, and replacement-cluster recovery with encrypted fixtures and a fresh verified backup. Both rehearsals removed their disposable services, volumes and private state. This closes the previously uncovered candidate-build path with a direct regression test and both actual hosted flows. Framework validation found the change confined to test-source completeness; existing ownership/behavior specifications remain authoritative and no new ADR or migration is required. GitHub check results remain distinct from these completed local rehearsals.

## Adaptive coaching clarification — 2026-10-25

Requirement source: the owner requested “implement this” after approving a summary of adaptive clarification for weekly adjustments and new multi-month training programs in the current chat. The authorized scope is context-first clarification, waiting for essential answers, stating minor assumptions, preserving the requested program and submitting it through the existing owner-reviewed workflow. A broader coaching-reference library, new numerical checker and automatic recurring reviews are not part of this slice.

Added the canonical training-coaching skill and linked it from training planning and AGENTS.md. The coaching instructions reuse existing facts and answers, skip redundant or irrelevant questions, group material questions, support ordinary chat, and avoid an extra outline-approval gate. They preserve grant/notes/profile boundaries and refresh context after a clarification pause. Updated the feature specification, README, operating guide, architecture and skill inventory. Claude adapters are generated from the canonical sources.

Verification performed with Node 24.22.1 and pinned pnpm 11.28.8:

- `pnpm check` passed: registry/contracts, all three generated skill adapters, import boundaries, TypeScript, **131 existing unit tests across 17 files**, and documentation/link validation across **27 files**. The adapter tests cover generation, drift and preservation of user-authored copies; these unit tests do not establish coaching decisions.
- The skill-creator frontmatter/placeholder validator passed for both the new coaching skill and the revised planning skill. The whitespace check passed.
- Manual instruction walkthroughs covered the synthetic cases below. These were source-level reviews of the decision path, not independent model runs or live application proposals.

| Synthetic case reviewed | Instruction path checked |
| --- | --- |
| Next-week adjustment with known goals, availability, recorded training and a clear requested change | Read context, skip intake and proceed to the scoped proposal. |
| Three-month trail request with recent training/availability known but no goal, start date or terrain access | Ask only the missing material questions together; wait before dependent prescriptions. |
| General trail fitness from 2026-11-01 through 2027-01-31, with availability, hills access, baseline and constraints supplied | No race or redundant intake questions; retain all 92 requested days. A synthetic grant starting 2026-10-12 spans 112 days and fits the existing bound. |
| Partial answer supplies the goal but not an essential date; another nonessential preference is unknown | Ask only the remaining essential question; allow an explicit minor assumption and do not treat silence as an answer. |
| User clearly changes a saved training day for this proposal, versus contradictory instructions about that day | Use the explicit temporary preference without a profile write; clarify only unresolved contradictions. |
| Private notes excluded, a grant ending before the requested program, or context/access changing during clarification | Do not request excluded narrative; preserve scope, resolve access through owner connection and refresh/reassess context after the pause. |
| Exact move-only request or a harness without question cards | Skip coaching intake for the mechanical edit; use ordinary chat when a material question is needed. |

Framework validation covered the changed instructions, feature requirements, linked documentation, acceptance scenarios and implementation claims. Required feature sections remain present; generated and canonical skill links resolve; source-level checks are distinguished from model execution. ADR assessment: this extends the existing external-harness ownership and reviewed-proposal decision; no new architecture decision is introduced.

Limits and activation: live Codex/Claude discovery, rendered question interactions and independent model adherence were not exercised. No private athlete context was read and no proposal was submitted. No application runtime code, schema, migration, dependency or server deployment changed; build, database and browser suites were not rerun for this instructions-only slice. The updated checkout supplies the skills when the harness reads them; there is no server rollout for this change.

Pre-push verification on 2026-10-26: installed the updated locked dependencies and reran `pnpm check` successfully: **132 unit tests across 17 files**, TypeScript, generated-source/boundary checks and **31 documentation files**. The reviewed changes contain only the coaching skills, generated adapters and related documentation. The live-model and deployment limits above still apply.

## A1–A4 source quality — 2026-10-27

Implemented the approved sequence while preserving response shapes, stored data and transaction ownership.

| Task | Outcome | Verification |
| --- | --- | --- |
| A1 | Pinned formatting/lint checks; mechanical commit registered for blame exclusion. | Formatting stable; zero lint errors, advisory warnings retained. |
| A2 | Resolved import graph, versioned public APIs and optional Garmin onboarding contribution. | Boundary/composition fixtures, fresh installation and prior-MVP upgrade passed; applied migrations unchanged. |
| A4 | Validated DTOs, typed repositories, explicit row helpers and production indexed-access checks. | Both typechecks, malformed-response/record and missing-row tests passed. |
| A3 | Pure handlers, one finalizer and transaction-scoped persistence/audit helper. | 42 differential batches matched; revision, proposal, undo and rollback regressions passed. |

Local verification: `pnpm check` (155 unit tests), 84 integration tests, 84 browser tests (two platform skips), 23 publication/controller tests, and web/worker/container builds passed. Synthetic desktop/phone checks covered both themes and enabled/disabled Garmin onboarding. Framework validation covered affected specifications, ownership, links and ADR 008. Limits: scripts/tests indexed-access enforcement remains follow-up; no deployment performed.
