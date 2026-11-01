# Pre-release historical review simplification

## Scope and authority

The owner requested implementation of the ranked PR #70 simplification review, explicitly permitting consolidation of migrations and compatibility formats introduced only by this unreleased branch, and recreation of disposable synthetic databases. Baseline: PR head `cc29d5e`, main `09770bda9119a380982284726ad5364a4c5b13dd`. Migrations already on main, deployed databases and production data remain untouched. Existing main grants, CLI configurations and stored proposal snapshots remain supported.

## Execution sequence

1. Record the main migration baseline and comparison measurements; consolidate eight branch migrations into four final owning-plugin migrations and remove intermediate history-format compatibility.
2. Introduce category-specific historical contracts and transport-free read selections; distinguish proposal list items from loaded details.
3. Simplify summary state and evidence construction while preserving factual calculations and source distinctions.
4. Specialize historical queries and use database availability projections. Retain/remove indexes based on query-plan evidence.
5. Coordinate final plugin versions and generated outputs; consolidate benchmarks and provide a guarded reproducible synthetic preview.
6. Verify main upgrades, permissions, pagination, summaries, annual apply/undo, desktop/phone flows in both themes, performance, documentation and production builds; update PR and preview.

## Results

### Implementation

- Consolidated eight PR-only SQL migrations into four final owning-plugin migrations. Each installs its final counter, transition-table triggers and read indexes directly; removed the intermediate replacement triggers and one-time counter bumps. No table/JSON rewrite, duplicate history store or cross-plugin trigger framework was added.
- Listed the 16 migration paths from main in `tests/fixtures/main-migrations.json`. The upgrade test applies those files without a separate checksum inventory, seeds source data, a legacy grant and unversioned/v2 pending proposals, then verifies unchanged stored values and working counters under a restricted runtime role.
- Replaced the all-purpose optional history record object with category-specific schemas/types and SQL projections. Health records no longer contain irrelevant distance fields, and plans no longer contain prescription counters. Event kind and calendar-note title remain available. Invalid older optional fields remain explicit diagnostics. Coverage requires stable `hasCompletedScan`; intermediate timestamp-format compatibility was removed.
- Separated transport queries from database filters/positions. Review tokens/cursors remain in the bridge. Replaced discovery's detail-page traversal with owning SQL count/min/max queries; training reuses its date selection for discovery/details and omits plan joins for plans/events. Removed the bridge's now-unused per-record availability helper.
- Split summary calculations into three concrete accumulators in the same module: training/activity volume, daily health corrections followed by period totals, and import coverage. Corrected health days no longer get copied into additional record arrays for repeated reductions. A calendar-day lookup replaces repeated period searches; one final pass constructs evidence references. Public summary meanings remain unchanged; drill-down references use the standard 100-item default.
- Proposal lists and opened details now have distinct contracts. Lists require count/date bounds and carry no placeholder `changes: []`; the dialog explicitly loads the exact details. No visual redesign or permission change was introduced.
- Added one `pnpm generate` preparation command for registry/contracts/skill adapters. Consolidated the two benchmark programs into `scripts/benchmark-review.ts`, including automatic discovery plus complete exports and actual detail SQL plans. Added a guarded `pnpm preview:history` command that creates its own database, prepares synthetic data and a pending annual proposal, copies the built artifact, supervises web/worker and drops only its own database on shutdown.
- Final feature versions relative to main: Athlete 1.3.0; Training, Activity Records, Garmin and Agent bridge 2.1.0; host API 1.3.0. Composition, manifest dependencies, registry and generated contracts match. Canonical commands, feature specification, architecture and ADR 018 describe the final design.

### Preserved boundaries and compatibility

Five calendar years of reading, separate one-calendar-year proposal authority, independent private-note exclusions, browser approval, protected credentials, expiry/revocation, authenticated cursors, bounded responses and explicit restart on source changes remain intact. Source/result checks, exact immutable diffs, stale-context acknowledgement, seven-day proposal expiry, atomic owner application and whole-batch undo remain unchanged. No agent apply operation or embedded model service was introduced.

The main migration files, JSON source stores, four plugin-owned counters and eight read indexes remain. Collection-wide invalidation is intentionally conservative; unchanged rescans and no-op writes still preserve reviews. The bounded process cache and annual batching/order logic remain unchanged.

Existing main grants/configurations and legacy proposal digests/snapshots remain supported without broadening permissions. Only intermediate PR migrations/history formats are discarded. Old disposable PR databases must be recreated; no deployed database is an authorized reset target. Matching CLI/web/worker/contracts/composition must be upgraded together. Older binaries require their matching pre-upgrade backup after new persisted grants/snapshots are used.

### Output equivalence

Captured service exports before implementation at `cc29d5e`, then repeated them against the final design on fresh synthetic databases. The fixture spans 2021-10-31 through 2026-10-31 (1,827 inclusive days): 5,481 activities, 20,219 health readings, 5,481 workouts, one plan/profile and 28 coverage windows.

All seven discovery entries, 1,708 monthly summaries, 7,336 weekly summaries, and all detailed records match after the intentional contract cleanup: remove irrelevant null activity/health fields and zero plan prescription counters, and use 100-item supporting-detail references rather than inheriting the caller's 200-item overview page size. IDs, ordering, dates, measurement values, corrections, missing counts, source distinctions, coverage and duplicate warnings match. Separate integration cases cover events, notes, injuries, private notes and clipped intervals absent from the large comparison fixture.

### Verification

- `pnpm check`: 318 unit tests passed; formatting, generated-file freshness, public boundaries, both typechecks and documentation validation passed. ESLint reports 159 warnings, zero errors (the earlier head reported 160 warnings).
- `pnpm test:integration`: 221 tests passed across 17 files in 61.77 seconds on fresh loopback synthetic storage. Includes main upgrade preservation, runtime-role triggers, independent scopes, notes, expiry/revocation, cursor tampering/changes, health corrections and 1,500-command apply/undo/rollback/idempotency.
- `pnpm build`: web standalone and worker builds passed.
- An initial checksum fixture triggered a false positive in secret scanning. At the owner's request, the separate fingerprint assertion and its scanner exception were removed. The upgrade test retains a path-only baseline and verifies migration/data behavior; normal runtime migration-journal integrity checks are unchanged.
- Security Python suite: 117 tests completed successfully with two platform-specific skips on Python 3.12.8. An initial run selected Apple's Python 3.9 through PATH and failed on newer standard-library APIs; rerunning with the supported interpreter passed without application changes.
- Full desktop/phone browser matrix: 163 passed, three intentional device-specific skips in 6.2 minutes. Covers approval/revocation, annual review/apply/undo, desktop planning and phone logging in both themes. Approval and annual-review screenshots were also visually inspected; artifacts remain private under `.runtime/browser/`.
- Preview smoke: safe refusal of an occupied port; loopback/_test guards tested; fresh database initialized with 32,212 synthetic source/coverage records and a pending 1,500-command proposal. Shutdown removed only that invocation's database. Final preview refreshed on port 3017, with previous preview storage untouched. Manual browser inspection confirmed the 500/500/500 overview, collapsed months and disabled Apply before acknowledgement.

Raw logs, comparison exports, profiles, screenshot artifacts and benchmark JSON remain ignored under `.runtime/`. No production data, provider requests or VPS deployment were used. Detailed final performance results follow.

### Performance and query findings

Measured on 2026-11-01: Apple M4 Pro (14 cores, 48 GiB RAM), macOS/Darwin 27.2.0 arm64, Node 22.22.0, pnpm 11.28.8 and PostgreSQL 17.11 in local Docker. Baseline and final runs used fresh temporary databases on the same loopback test server. Browser/check jobs were finished before final timing runs. OS/PostgreSQL caches were not forcibly cleared.

The representative fixture has **32,212** rows: 5,481 activities, 20,219 health records, 5,481 historical workouts, 1,000 annual workouts, two plans, one profile and 28 coverage windows. The **101,029**-row stress fixture has 74,298 activities; every other category count is unchanged. Thus it stresses activity volume, not a 100,000-workout annual plan. Both cover five calendar years.

| Measurement (milliseconds) | Before, 32,212 | Final, 32,212 | Final stress, 101,029 |
| --- | ---: | ---: | ---: |
| Discovery, first call | — | 44.8 | 56.6 |
| Discovery, warm p50 / p95 | — | 35.9 / 36.2 | 51.3 / 51.4 |
| Monthly summary first page | 610.7 | 494.6 | 1615.0 |
| Fresh complete monthly export, excluding discovery | 662.9 | 539.0 | 1349.8 |
| Automatic discovery + fresh complete export | — | 571.1 | 1408.0 |
| Cached next summary page, warm p50 / p95 | 5.7 / 6.1 | 6.2 / 6.8 | 6.5 / 7.4 |
| Selected month records, warm p50 / p95 | — | 5.4 / 5.5 | 5.2 / 5.4 |
| Annual submit | 460.8 | 479.7 | — |
| Annual review, warm p50 / p95 | 412.4 / 419.1 | 423.2 / 429.7 | — |
| Opened proposal details, warm p50 / p95 | 20.9 / 21.4 | 21.2 / 22.7 | — |
| Atomic apply | 567.2 | 578.2 | — |
| Whole-batch undo | 504.5 | 499.1 | — |

The baseline did not time discovery/details as separate history operations. Warm p50/p95 values use only three subsequent observations; first/fresh exports and mutations are single observations. The initial final-design run also measured a fresh smaller export at 551.3 ms (the instrumented final rerun measured 539.0 ms). These measurements indicate reduced first-aggregation work, not a statistically established latency guarantee. Annual logic was intentionally left unchanged; its small timing differences should not be interpreted as an optimization or regression.

- Representative: 1,708 monthly rows across 18 pages; 1,151,486 serialized response bytes in total, maximum page 68,305 bytes. First summary page uses 49 SQL statements, including 34 source reads. Complete automatic export uses 326 SQL statements. Sampled first-page RSS/heap peaks: 170.2/56.9 MiB. Concurrent owner save: 294.8 ms; overlapping history read correctly returned `history_changed` after 678.4 ms.
- Stress: 1,708 monthly rows across 18 pages; 1,159,639 serialized response bytes in total, maximum page 68,819 bytes. First summary page uses 118 SQL statements, including 103 source reads. Complete automatic export uses 395 SQL statements. Sampled first-page RSS/heap peaks: 192.0/72.8 MiB. Concurrent owner save: 325.4 ms; overlapping history read correctly returned `history_changed` after 1551.6 ms.

Discovery uses seven availability projections plus 15 authorization/version/transaction statements, without detail materialization. A cached summary page uses 15 statements and zero source reads. A record page uses 16 statements, including one bounded source query. Authorization is deliberately retained on every page.

Annual request: 271,282 bytes for exactly 1,500 commands (500 creates, 500 updates/moves, 500 deletes). Stored snapshot/diff JSON: 695,389/1,420,144 bytes. Opened details: 1,292,939 bytes, loaded in one SQL query; the 1 MiB cap applies to historical pages, not the owner’s complete annual diff. Idempotent resubmission: 10.4 ms. Maximum sampled RSS across the representative run: 372.0 MiB; the stress run: 245.2 MiB. Memory includes fixture creation, caches and preceding operations; 5 ms sampling can miss short peaks.

| Actual representative SQL plan | Execution ms | Shared hit / read blocks | Finding |
| --- | ---: | ---: | --- |
| activitiesMonth | 0.177 | 27 / 0 | Sport/date index; 31 activity rows. |
| healthMonth | 0.093 | 29 / 0 | Metric/date index; 31 health rows. |
| workoutsMonth | 6.787 | 572 / 0 | Shared dated selection; scans 6,481 workouts and joins two plans; 93 selected rows. |
| workoutsFiveYears | 14.700 | 572 / 0 | Same dated selection; 5,481 permitted rows, sorted keyset page of 101. |
| plans | 0.026 | 2 / 0 | Plan-start index; no plan self-join. |
| events | 0.014 | 2 / 0 | Kind prefix of independent-date index; no plan self-join (empty event fixture). |

Index decision: retain the existing eight read indexes. Activity/health and plan queries demonstrate useful access paths; the small event fixture cannot establish indexing needs. The workout query still scans this 6,481-workout collection; the plan-day/performed-date indexes were not selected in these measured plans. Removing them or adding a more complicated UNION/materialized-date design needs broader training distributions and an A/B test. This iteration simplifies category paths without pretending that every training filter is index-driven.

Remaining limits: uncached summaries scan the selection once; health correction state is proportional to distinct source/day/metric combinations; process-local caches can be evicted or recomputed by another process; real changes anywhere in participating collections require explicit restart. The fixed preview history/annual dates are labelled synthetic, not an adaptive coaching program. Full 4 MiB worst-prescription payload timing, cold-cache latency, production concurrency and live provider/model behavior were not measured. Raw reports are local evidence only, not production sizing.

### Local delivery and deployment

Follow-up: removed the redundant pinned file fingerprints and their Gitleaks exception at the owner's request. The path-only baseline still exercises the main-to-final upgrade, preservation of source records, grants/proposal snapshots and the migration journal, and restricted-role counters. All 16 main SQL files were compared with the baseline revision and remain unchanged. The existing runtime checks for altered applied migrations remain intact. Reverification: `pnpm check` passed (318 unit tests and all static/documentation checks); all 221 integration tests passed in 63.20 seconds. No runtime/UI code changed, so the earlier build/browser evidence remains applicable rather than being claimed as rerun. Complete-history scanning also detected the removed fingerprint in the earlier PR commit. The owner explicitly approved replacing only the two affected tail commits with an equivalent cleaned commit, retaining a local backup and using force-with-lease. The replacement ancestry passed the pinned Gitleaks scan with no exception (45 commits, 6.40 MB, zero findings). The scan policy itself is unchanged.

PR #70 is updated with this changeset, the final migration boundary and actual results; existing before/after screenshots are retained. The synthetic preview at `http://127.0.0.1:3017/agent` remains running with the proposal pending. Ordinary browser approval can be exercised through the canonical CLI; the application does not apply that proposal automatically.

No deployment occurred. A release still requires review, passing remote checks, a coordinated web/worker/CLI upgrade and a verified matching backup. Never run the disposable preview/reset workflow against deployed storage. Commands live in [development](../development.md); the final feature behavior is in [agent training](../features/agent-training.md).
