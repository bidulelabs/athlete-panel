# Agent review performance and reliability — 2026-10-31

## Authority and scope

The owner requested implementation of the three ranked improvements discussed in this chat: make large annual proposals reliably fast, avoid recalculating historical summaries on every page, and separate code responsibilities. The request includes a completion report and findings. This work uses the current Athlete Panel checkout, pnpm and isolated synthetic databases only. Existing history/planning permissions, owner approval, exact proposal digests, atomic apply/undo and manual-operation limits remain authoritative.

The implementing agent coordinates the host API, plugin manifests, composition and generated registry as one source release. [ADR 017](../decisions/017-historical-read-reuse.md) records read consistency and bounded summary reuse. No applied migration is edited and no new migration is required.

## Baseline findings

The new populated-year fixture has 1,000 existing workouts with interval prescriptions. One proposal contains 500 moves/edits, 500 deletions and 500 creations: exactly 1,500 commands. It is added to the existing five-year synthetic history. The smaller dataset contains 32,212 records in total; the activity-heavy stress dataset contains 101,029. These totals include the additional annual plan and its 1,000 workouts.

On the smaller fixture, original submission took 28,665 ms, review took 29,149–30,471 ms, application took 30,520 ms and undo took 1,571 ms. The valid annual workload therefore exceeded the browser's existing 15-second review timeout. The earlier 366-create benchmark did not establish reliability at the supported maximum. The first baseline process used Node CPU profiling: sampled self-time was dominated by calendar validation (92.1 s), date arithmetic (50.8 s) and full-workspace order normalization (8.4 s) across the complete run. These are CPU samples, not independent request timings.

Original complete summary exports took 10,604–10,727 ms on the smaller fixture and 27,888–28,213 ms on the larger fixture. Each next page repeated the same aggregation (about 590–628 ms and 1,541–1,593 ms respectively). Measurements are local synthetic service calls, not production or cold-cache guarantees.

## Implementation

- Training uses a batch-local day/order index. Ordinary placements and deletions renumber affected buckets; plan-wide changes explicitly rebuild the index. First-use normalization and final validation retain legacy ordering and immutable-diff behavior.
- The instance persistence coordinator checks new identities across owning repositories in sets, releases all old unique associations, then saves validated records in batches of at most 200. The caller's transaction still contains every write, audit, proposal-status and idempotency change. Undo reads stored revisions in bounded batches and retains its whole-change conflict checks.
- Historical authorization, query validation, note/scope sanitization, cursor handling and response sizing live in separate typed helpers. Response sizing counts each serialized item once while reserving cursor overhead and enforcing the final 1 MiB cap.
- Summary reuse and lock-free read-only transactions follow ADR 017. Every page independently rechecks authorization and fresh collection versions, including cache hits. Changed records still require explicit restart.
- Connection lists, proposal loading/application and record/month rendering have separate client components. Closed month groups defer mounting their workout rows; exact changes remain available when expanded. Owner acknowledgement and atomic application remain mandatory.

## Verification and measurements

### Method and fixture

Measured locally on 2026-10-31: Apple M4 Pro (14 CPUs), 48 GiB system RAM, macOS/Darwin 27.2.0 arm64, Node 22.22.0, PostgreSQL 17.11 arm64 in the disposable Docker test service. Baseline source is commit `4ca664f`; both smaller before/after runs used Node CPU profiling, while the larger history-only runs did not. Service timings include JSON serialization but exclude browser/network overhead. Database and OS caches were not cleared. A **fresh export** means a new grant with no reusable summary, not a cold database.

Both fixtures span 1,827 inclusive dates (2021-10-31 through 2026-10-31), with multiple sports, missing measurements, older shapes, linked/manual completions, source corrections and incomplete/overlapping import coverage. The smaller fixture contains 5,481 activities, 20,219 health records, 6,481 workouts, two plans, one profile and 28 coverage windows: **32,212 records**. The stress fixture increases activities to 74,298, for **101,029 records**. The separate concurrency observation adds one owner-created workout after the preceding measurements. The stress run does not repeat annual proposal measurements.

Raw benchmark JSON, CPU profiles, screenshots and logs remain ignored under `.runtime/`; canonical commands belong in [development](../development.md#historical-review-and-annual-planning-commands).

### Annual proposal: 1,500 mixed commands

| Operation | Before, ms | After, ms | Database statements before → after |
| --- | ---: | ---: | ---: |
| Submit and store | 28,665 | 494 | 17 → 17 |
| Review, warm p50 / p95 | 29,474 / 30,471 | 464 / 466 | 13 → 13 |
| Load full details, warm p50 / p95 | 24 / 25 | 21 / 22 | 1 → 1 |
| Apply atomically | 30,520 | 573 | 3,517 → 30 |
| Undo entire proposal | 1,571 | 518 | 3,516 → 34 |

Submission's unchanged query count and large speedup confirm a CPU bottleneck, not primarily database latency. Review now fits comfortably inside the unchanged 15-second browser timeout for this representative maximum-command fixture. Replay of the same submission took 9.7 ms. The request was 271,282 bytes; serialized planning context was 629,379 bytes. Stored context/diff JSON text measured 695,389 / 1,420,144 bytes. Full proposal details were 1,292,960 response bytes; this is a separate owner endpoint from the 1 MiB historical-page limit. Before/after snapshot and response sizes match.

Warm page/review p50/p95 use only the last three of four calls. Apply, undo and submit each have one observation. These are descriptive measurements, not reliable tail-latency estimates or a guarantee for every allowed 4 MiB proposal.

### Five-year monthly export

| Measurement | 32,212 before | 32,212 after | 101,029 before | 101,029 after |
| --- | ---: | ---: | ---: | ---: |
| First page, ms | 641 | 634 | 1,701 | 1,763 |
| Next page warm p50 / p95, ms | 598 / 614 | 6.6 / 7.3 | 1,542 / 1,585 | 7.1 / 7.7 |
| Complete export, ms | 10,604–10,727 | 707 fresh; 105–118 cached | 27,888–28,213 | 1,736 fresh; 109–119 cached |
| Next-page database statements | 49 | 15 | 118 | 15 |
| Complete-export database statements | 882 | 304 fresh; 270 cached | 2,124 | 373 fresh; 270 cached |
| Source-read matches across complete export | 612 | 34 fresh; 0 cached | 1,854 | 103 fresh; 0 cached |

Both exports contain **1,708 rows across 18 pages**. Total response bytes are 1,151,486 and 1,159,639; largest pages are 68,305 and 68,819 bytes, below 1 MiB. Totals include response envelopes/cursors. The raw `responseBytes` for export measurements describe their small returned statistics object; these table totals come from the separately accumulated page sizes. Source-read counts use benchmark SQL-pattern instrumentation; integration spies separately verify that cached pages call no historical source reader. Total statement counts include transaction/authentication/version checks.

First-page time is essentially unchanged. The improvement comes from calculating once per grant/scope/query/source-version selection and retaining bounded results. A whole export with no preceding cached overview is therefore the more useful default comparison.

### Concurrency, query plans and resource use

An ordinary owner workout save started after the first source query of an uncached summary completed in **310 ms / 373 ms** on the smaller/larger fixtures. It committed before the overlapping summaries finished at **833 ms / 1,887 ms**. Both summaries returned `history_changed`, requiring restart. Controlled integration barriers additionally verify that source changes, revocation, expiry and maintenance can commit during a paused read and prevent publication. No equivalent timed baseline concurrency observation was collected.

Representative `EXPLAIN (ANALYZE, BUFFERS)` for the bounded 1,000-activity date/identity query, with a simpler projection than the API: the smaller fixture used `records_local_date` plus incremental sort, 1.03 ms and 309 shared hit blocks; stress used `history_kind_date_id` bitmap scan plus top-N sort, 26.02 ms and 7,384 shared hit blocks. Neither read blocks from disk or spilled temporary blocks. The stress plan still visits all 74,298 matching activities before its limit; expression statistics/index-plan tuning remains a possible first-request improvement. These plans do not describe every API query or prove constant work per record page.

Five-millisecond sampling observed peak process RSS / heap during fresh exports of **219 / 88 MiB** and **201 / 83 MiB**. The smaller full workload's annual review peaked at 337 / 179 MiB; apply at 353 / 97 MiB; undo at 365 / 104 MiB. Original complete exports peaked at 310 / 167 MiB and 263 / 137 MiB. These are process-wide observations influenced by fixture generation and garbage collection, not per-request allocations. Sampling misses short synchronous peaks. Whole final-process CPU user/system time was 6.60 / 0.53 s and 7.52 / 0.51 s, including setup and other measurements. No PostgreSQL memory or production capacity claim is made.

### Correctness and browser verification

- `pnpm check`: passed, **307 unit tests**, both type configurations, generated registry/contracts/adapters, dependency boundaries and documentation checks. ESLint reports 159 warnings and zero errors.
- `pnpm test:integration`: passed, **198 tests across 16 files**. Tests cover unchanged legacy proposals/scopes, authorization and note exclusions, deterministic traversal, tampered cursors, cache isolation/expiry/eviction, fresh counter checks, read-only database enforcement, max-command stale-context acknowledgement, idempotency, forced mid-batch failure rollback, atomic apply and whole-batch undo. A differential ordering test compares the optimized index with the previous algorithm, including unnormalized first-use rows.
- `pnpm build`: web and worker passed.
- `pnpm test:e2e`: **161 passed, three intentional project-specific skips**, zero failures, across the full 164-case desktop/phone matrix in 6.2 minutes. This includes both themes, connection approval/revocation, exact annual review/application, ordinary planning/logging, stale edits and failed-request recovery. Skips avoid duplicate width-matrix/responsive coverage or a desktop-only nonmodal navigation case; they are not failing scenarios.

The production-build browser test uses the demo workspace plus the 1,000-workout annual fixture. One observation per device: review click to visible acknowledgement took **409 ms desktop / 418 ms phone**; apply click to closed dialog took **819 / 817 ms**; owner undo API took **246 / 221 ms**. These timings include loopback HTTP and browser rendering where stated, and are separate from the five-year service benchmark. Both devices inspected an exact record diff, checked that closed months had zero mounted week rows, and applied/undid all 1,500 changes. Captures of approval and annual review were visually inspected in both themes.

The existing synthetic preview on port 3017 was refreshed with the matched build/composition. Its 5,481 activities, 20,219 health records, 5,481 workouts and pending **367-command** proposal were verified unchanged before/after. The disposable browser instance uses port 3018 and separate storage; no test proposal was applied to the preview.

The first focused integration run had one test assertion failure: it compared newly encrypted cursors byte-for-byte. Encryption uses a fresh nonce, so the test now compares page content and checks the opaque cursor separately. This did not indicate duplicate or missing records. All subsequent integration checks pass.

### Findings and remaining limits

The maximum-command annual timeout was reproduced and resolved for the tested mixed workload without extending the timeout, reducing validation or splitting application. Historical pages no longer rescan their range on a cache hit or hold the domain write lock. UI code has clearer responsibilities, and closed month groups avoid mounting workout rows while preserving exact review details.

The first summary still scans its selection and does JavaScript aggregation. Cache retention is per process, capped at eight entries and 32 MiB of serialized rows; object overhead is additional. Reuse expires within five minutes, with expired allocations pruned on the next cache operation or process exit. Eviction, expiry, process restarts or another web process can cause recomputation. Collection-wide invalidation still requires explicit restart after imports or edits. The benchmark is one representative 1,500-command mix, not every maximum-payload prescription or plan-duplication pattern. No real network, cold database, long-duration concurrent workload or VPS performance was measured.

## Framework documentation validation

| Topic | Canonical document | Coverage completed | Remaining gaps |
| --- | --- | --- | --- |
| Permission, review and consistency behavior | Agent training feature specification | Scope/review unchanged; summary reuse and final authorization checks documented and tested | Production measurements excluded |
| Ownership and coordinated activation | Architecture and development guide | Generic host API, owning plugin logic, composition versions and canonical benchmark commands aligned | Deployment intentionally not performed |
| Read consistency and retention decision | ADR 017, extending ADR 016 | Source authority, alternatives, cache limits and measured evidence linked reciprocally | Reassess first-read tuning only if needed |
| Execution evidence | This record | Separates fixture sizes, service/browser results, limitations and compatibility | Cold-cache, sustained concurrency and production capacity unmeasured |

Affected links, anchors and placeholders were checked with the documentation validator; implementation/acceptance claims were sampled against tests and code. No diagrams or shared visual conventions changed. No conflicting permission limit or duplicate operational command was introduced.

## Compatibility and activation

The source release requires host API 1.3.0, Training 2.1.1 and Agent bridge 2.1.3, with matching composition pins and generated registry. No public JSON schema, cursor format, stored grant, stored proposal, SQL table or applied migration changes. Existing credentials, approved scopes and proposal snapshots retain their meaning. Deploy matching app/web/worker/CLI source and refresh the installed composition through the canonical coordinated upgrade. This follow-up adds no database-data conversion; the base historical feature still requires its four additive migrations and matched-backup rollback when upgrading older binaries.

No production data, provider credentials or VPS deployment is part of this work.
