# Historical review reliability and planning guidance — 2026-11-01

## Authority and scope

The owner requested implementation of the two PR #70 review findings after an explanation of their practical effects: [unnecessary restarts](https://github.com/bidulelabs/athlete-panel/pull/70#discussion_r4434799395) and [recent-context guidance](https://github.com/bidulelabs/athlete-panel/pull/70#discussion_r4434799389). Work stays in the current checkout with pnpm and isolated synthetic storage. Production data, provider calls, VPS deployment, merging and broader issue #68 changes are outside this correction.

## Confirmed baseline

On the existing branch, an identical completed rescan advanced Garmin's counter twice while changing only `scanned_at` and `updated_at`; the next history page failed with `history_changed`. Zero-row updates also advanced Activity Records, Training and Athlete counters. With 21 days of synthetic activity/health data, the default combined grant's planning context contained one health date, no weekly entries and three activities; the legacy wider dates contained seven health dates, earlier weekly entries and 63 activities. Separate weekly historical reads retrieved the older facts. These were independent from the already-corrected date metadata findings in the [prior report](agent-review-performance.md#final-review-corrections--2026-11-01).

## Implementation

- Four additive owning-plugin migrations replace unconditional invalidation with transition-table comparisons and nonempty truncation checks. No applied SQL file changes. Bulk operations retain one counter update per changed event; transaction rollback restores counters with records.
- Garmin's stable history projection includes completed-scan evidence and retains a completed state during unchanged repeat scans. Live timestamps/progress stay in operational status. Public history DTOs add `hasCompletedScan`; older `lastScannedAt` exports remain readable, while new results omit the timestamp. [ADR 018](../decisions/018-history-factual-invalidation.md) defines this consistency boundary.
- Canonical planning guidance explicitly retrieves approved recent weekly history before choosing/adapting training, describes default/future-only planning health accurately, preserves the proposal digest separately and states material gaps when history is unavailable. Claude adapters are generated from the canonical skill. No permission, default date selection, proposal snapshot/digest or owner application rule changes.
- The integration changeset coordinates Athlete 1.3.1, Training 2.1.2, Activity Records 2.1.1, Garmin 2.1.1 and Agent bridge 2.1.5, public contracts, composition and generated registry/reference. Host API remains 1.3.0.

## Verification

Focused synthetic regression checks initially passed 51 tests across history, counter, migration-lifecycle and summary files. Coverage includes empty and identical statements, conflict upserts, operational timestamp updates, 1,500-row bulk writes, rollback, deletion/truncation, concurrent rescans/corrections, cached summary and record pagination, expiry/revocation, unchanged legacy scopes and default/future-only context. The upgrade case applies old migrations first, preserves records/grants/pending proposals, invalidates the old review once, and exercises the new triggers through a restricted runtime role.

Full `pnpm check` passed: 314 unit tests, normal/strict types, registry/contracts/adapter freshness, dependency boundaries and documentation content/local links (49 files). Lint reported 160 existing warnings and zero errors. All 220 integration tests passed across 17 files, including an actual mocked Garmin worker rescan and the upgrade/runtime-role case. `pnpm build` passed for web and worker. No provider network calls or production data were used. Raw output remains ignored under `.runtime/pr70-review-fixes/` and `.runtime/review-performance/`; benchmark JSON is not committed.

The full production-build browser matrix passed: 163 tests, three intentional device-specific skips, 6.3 minutes. It covers desktop/phone, both themes, approval/revocation, historical CLI reads, annual review/application/undo and routine planning/logging. The 1,500-command browser case measured desktop review/apply/undo at 421/820/250 ms and phone at 411/820/243 ms (single local observations, not quantiles). Agent-side application remains denied and owner acknowledgement remains mandatory. The disposable browser database was separate from the preserved preview below.

## Workload measurements

Canonical `benchmark-review` runs used an Apple M4 Pro (14 cores, 48 GiB), macOS arm64/Darwin 27.2.0, Node 22.22.0, pnpm 11.28.8 and local containerized PostgreSQL 17.11. Each run created and dropped its own synthetic database. Dates span 1,827 inclusive days, 2021-10-31 through 2026-10-31. Both fixtures contain 20,219 health records, 5,481 historical workouts, 28 coverage windows, a profile and a historical plan, plus a separate annual plan with 1,000 existing workouts. The smaller fixture has 5,481 activities (32,212 total records); the stress fixture has 74,298 activities (101,029 total). The stress run measured history only; annual timings below use the smaller fixture.

| Historical service operation | 32,212 records | 101,029 records |
| --- | --- | --- |
| First monthly-summary page | 619 ms; 49 queries, 34 history reads | 1,686 ms; 118 queries, 103 history reads |
| Reused next page, warm p50 / p95 | 5.82 / 6.06 ms | 5.89 / 5.96 ms |
| Complete fresh 18-page export | 678 ms; 304 queries, 34 history reads | 1,640 ms; 373 queries, 103 history reads |
| Complete reused export, two runs | 112 / 93 ms | 94 / 99 ms |
| Largest page / complete export | 68,305 / 1,151,486 bytes | 68,819 / 1,159,639 bytes |
| Sampled peak RSS during fresh export | 222.3 MiB | 210.9 MiB |
| Concurrent workout save | 302 ms | 345 ms |

Each reused page performed 15 authorization/version/control queries and zero source-history scans; complete reused exports performed 270 queries and zero scans. Both exports returned 1,708 summary rows, with every page below 1 MiB. Real concurrent saves invalidated the running summaries as intended (815 / 1,829 ms), rather than holding the writer for the whole scan. A representative 1,000-record SQL read used an index scan/incremental sort on the smaller fixture (1.05 ms, 309 shared-buffer hits) and bitmap index/heap scan with top-N sort on the stress fixture (26.34 ms, 7,384 hits); both had zero physical reads and temporary blocks. The latter plan still scans the matching set before sorting: these measurements do not establish worst-case query capacity.

The annual proposal contained 1,500 commands (500 creates, 500 edits and 500 deletions), with a 271,282-byte request. Submission took 474 ms (17 queries), idempotent resubmission 10.6 ms, review validation warm p50/p95 437/460 ms (13 queries), opened diff loading 20.7/22.3 ms (one query), atomic apply 574 ms (30 queries) and whole-batch undo 522 ms (34 queries). Stored context/diff sizes were 695,389 / 1,420,144 bytes; the opened-proposal response was 1,292,960 bytes (the 1 MiB history-response cap does not govern proposal diffs). Sampled peak RSS during apply was 316.9 MiB. These observations show no material regression in the measured workloads from factual-change comparisons; they are not a controlled speedup claim.

First calls were **not** cold OS/database-cache measurements. Warm page/review/detail quantiles use only three samples; other operations were single calls or two exports. Memory includes fixture generation and preceding operations, with 5 ms sampling that can miss synchronous peaks. These are local service timings, not HTTP/browser latency, production capacity, sustained concurrency or maximum-payload guarantees. Live model adherence to updated guidance has not been evaluated.

## Compatibility and activation

Use the canonical coordinated upgrade in [development](../development.md#coordinated-upgrades-and-plugin-activation): matched web/worker/CLI source, contracts, composition, registry and four new migrations. Existing grants and pending proposal data are retained. Existing historical review tokens restart once across the migration; older timestamp-shaped exports remain parseable. Reverting to an older schema signature/binary requires the matching pre-upgrade backup, not a down migration. No deployment to a private server is performed.

The isolated synthetic preview at `http://127.0.0.1:3017/agent` was backed up to a protected ignored file, migrated and restarted with the matching production build and worker. Health reports `ready` and `isolated-synthetic`. Before/after counts match: 5,481 activities, 20,219 health records, 5,481 workouts, one plan/event/note and the unchanged pending 367-command proposal. No proposal was applied in that preserved preview. Browser mutations run against a separate disposable instance on port 3018. No UI layout or wording changed in this correction; Garmin's live status still shows the latest scan time.

## Framework documentation validation

The feature specification, architecture, canonical commands and ADR describe the same independent scopes, stable coverage fields, no-op behavior and real-change restart rule. ADR links are reciprocal; no shared visual convention changes. Claims were checked against the trigger/projection code and the cited regression scenarios; commands remain canonical in development guidance, with no competing specification or unresolved template placeholder added. Actual test/performance results and remaining limitations are separate from implementation and activation claims. Content/local-link validation passed for all 49 documents after this report was added. No diagrams changed. Collection-wide invalidation for real unrelated changes and live model adherence remain explicit limitations, not completed guarantees.
