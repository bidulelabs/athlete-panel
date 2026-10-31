# Historical agent review and annual proposals — execution record

## Authority and ownership

On 2026-10-31 the owner explicitly requested implementation of the approved five-year history / one-year proposal plan in this chat. Historical categories are selectable; changes during a review require a restart; weeks use the profile preference resolved at approval; future dates are permitted; a representative annual program uses one atomic owner-reviewed proposal. No durable conversation URL is available.

The implementing agent coordinates the integration-owned contracts, public services, composition/version pins, registry and additive migrations. Feature queries remain with their owning plugins. No applied migration was edited. Work stayed in the current Athlete Panel checkout, with synthetic local storage. No production data, real Garmin access, VPS deployment or external communication was used.

## Implemented behavior

- Version-2 grants independently approve history and planning, with separate inclusive dates and notes permissions. History permits the fifth calendar anniversary; planning the first, clamping February 29 to February 28 when needed. Legacy grants retain their exact scope and do not gain history. Existing credential files remain usable.
- Activity Records, Training, Athlete and Garmin expose public, plugin-owned historical projections. The instance layer composes them. Historical operations provide discovery, monthly/weekly summaries, filtered details, separately paged prescriptions and current profile context without loading the historical workspace. Pages default to 100 items, allow 200 and enforce a 1 MiB UTF-8 response ceiling.
- Authenticated review tokens/cursors bind grant, query and transactional collection versions. Every page rechecks permissions, expiry and revocation. Mutation, deletion, rescheduling or coverage changes invalidate the review with `409 history_changed`; sequential CLI exports publish atomically only after all pages succeed.
- Summaries distinguish planned prescriptions, imported activity observations and eligible manual completions, excluding linked copies from actual totals. Known/missing counts, source-stream/account daily correction precedence, null corrections, ambiguous measurements, unsupported legacy metrics and separate scan coverage are explicit. Period references retrieve supporting records under the same review. Profile settings describe the current profile only.
- Agent submissions permit 1,500 commands / 4 MiB. Manual limits remain unchanged. Version-3 annual snapshots coexist with old snapshots/digests. Lists load counts/date bounds; opening a proposal fetches its full diff, grouped into collapsed weeks for large reviews. Submission never edits training: the owner must acknowledge and apply the exact proposal in Agent workspace. Atomic application, stale-context acknowledgement, revisions, seven-day proposal expiry and whole-batch undo remain intact.
- Browser approval offers history, planning or both, keeping the ordinary short planning default. Dates, categories, notes, week boundary, expiry and proposal authority are visible. CLI guidance and generated training-planning adapters explain annual scope and mandatory owner application. No model SDK or application AI credentials were added.

The authoritative behavior is in [Agent training](../features/agent-training.md), ownership in [Architecture](../architecture.md#historical-agent-reads-and-annual-proposals), and the permission/consistency decision in [ADR 016](../decisions/016-historical-agent-access.md). Command definitions and five-year/year/month/page examples remain canonical in the [development guide](../development.md#historical-review-and-annual-planning-commands).

## Verification completed

All tests used synthetic fixtures. The shared disposable database disappeared early in verification; subsequent work used the separate Compose project `athlete-panel-history-verification` on loopback port 55449. Browser storage was `athlete_history_browser_4f17_test`. Benchmarks created and dropped their own uniquely named databases. No owner configuration was loaded. The task-specific server and disposable database project were stopped after verification.

| Check | Actual result |
| --- | --- |
| `pnpm check` | Passed: 275 unit tests in 37 files; strict types, boundaries, registry/contracts/adapters and documentation checks passed. Lint returned 152 warnings and zero errors. |
| `pnpm test:integration` | Passed: 189 tests in 15 files, 57.19 seconds on the final application code. |
| Relevant Chromium browser suites | Passed: 28 scenarios in 51.4 seconds across desktop and Pixel 7 emulation in `agent-history`, `agent-connect`, `proposal-review` and `workspace`. |
| `pnpm build` | Passed: optimized web standalone and worker bundle. |
| Final documentation/whitespace checks | Passed; semantic framework review below supplements automated checking. |

Coverage includes independent capability denial, unchanged legacy grant/configuration/proposal handling, planning source/result bounds, notes/default exclusions, expiry/revocation, tampered, empty and mismatched cursors; missing CLI review-file tokens, deterministic traversal, insert/delete/reschedule/coverage invalidation, calendar anniversaries/leap days, clipped periods and week preferences, correction-to-null/source ambiguity, duplicate prevention, unknown older measurements, large multibyte prescription pages, oversized summaries, the agent HTTP body ceiling and manual-limit preservation. A 366-command annual proposal was submitted, reviewed, applied and undone as one batch; existing domain/proposal suites cover rollback, revision conflicts, idempotency and stale acknowledgement. Browser checks deny agent application and require owner acknowledgement.

Browser evidence includes real CLI browser enrollment and protected credential storage, historical discovery and multi-page `--all` export, revocation, annual review/apply/undo, desktop planning and phone completion logging. Light/dark approval and annual review screenshots are in `.runtime/browser/history-approval-*` and `.runtime/browser/annual-review-*`; desktop/light, desktop/dark, phone/light and phone/dark captures were visually inspected in addition to the browser scenarios. No horizontal overflow was observed. Existing shared visual conventions were retained; new styles are plugin-owned. Chromium emulation is not physical-device or cross-engine validation.

During development, tests exposed the retained Zod 200-command bound, invalid synthetic sport/order fixtures and a review-region accessibility regression; each was corrected. A repeated standalone browser launch initially omitted Next static assets; local packaging was aligned with the existing Dockerfile and the suites rerun successfully. These intermediate failures are not counted as passing verification.

## Five-year performance evidence

Measurements ran sequentially on Apple M4 Pro (14 logical CPUs, 48 GiB RAM), macOS/Darwin 27.2 arm64, Node 22.22.0, pnpm 11.28.8 and local Docker PostgreSQL 17.11 Alpine/aarch64. The interval is 2021-10-31 through 2026-10-31 inclusive: 1,827 days. The representative fixture has 5,481 activities across running/cycling/fitness equipment, 20,219 health observations across eleven metrics, 5,481 linked/manual/pending workouts, one plan, one profile and 28 overlapping/incomplete import windows: **31,211 records**. Older optional workout fields and missing measurements are deliberate. Recurring same-source corrections to null and overlapping measurements from a second synthetic account are included every thirty days. The separately labelled stress fixture adds synthetic activities for **100,028 records** (74,298 activities; other counts unchanged), so it is activity-heavy, not a claim about every possible health or training distribution.

The benchmark commands in the [development guide](../development.md#historical-review-and-annual-planning-commands) generate raw reports under ignored `.runtime/history/`, recording individual timings, query counts, response bytes, before/peak memory and `EXPLAIN (ANALYZE, BUFFERS)` output. Raw generated reports are excluded from version control; measured results are retained below. Each read series has ten calls: first measured call plus nine warm samples. Quantiles are order statistics of those nine samples, not statistically strong capacity estimates. Discovery begins in a fresh benchmark process; OS/PostgreSQL caches were **not forcibly cleared** after seeding, so true cold-cache latency remains unmeasured. Timings include service execution and JSON serialization, not HTTP/TLS, browser rendering or an external model. Query counts include authorization/version/transaction statements.

| Dataset | Operation | First ms | Warm p50 ms | Warm p95 ms | Max response bytes | Queries/call |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 31,211 | Discovery | 228.17 | 192.34 | 205.27 | 1,946 | 27 |
| 31,211 | Five-year monthly overview, first 200 groups | 627.92 | 587.89 | 602.46 | 133,479 | 49 |
| 31,211 | October 2025 running details, at most 100 | 5.95 | 5.37 | 6.25 | 14,129 | 16 |
| 31,211 | Next activity page, 100 | 8.13 | 8.06 | 8.90 | 43,854 | 16 |
| 100,028 | Discovery | 243.25 | 205.98 | 221.04 | 1,947 | 27 |
| 100,028 | Five-year monthly overview, first 200 groups | 1675.60 | 1563.90 | 1631.30 | 134,356 | 118 |
| 100,028 | October 2025 running details, at most 100 | 8.87 | 8.08 | 9.87 | 44,042 | 16 |
| 100,028 | Next activity page, 100 | 7.74 | 7.91 | 9.04 | 44,454 | 16 |

Monthly summaries contain category/sport/source/metric groups, so the first page is not the entire overview. Subsequent summary pages currently recompute aggregates from bounded chunks; there is no summary cache. The CLI exports every page sequentially. Detailed activity reads use the `history_sport_date_id` index. Exact query-plan/buffer observations and sampled memory follow.

- **31,211 records:** monthly summary sampled RSS 177.5 → peak 249.8 MiB; peak heap 125.7 MiB. Activity index probe returned 31 rows in 0.041 ms, 27 shared-hit blocks, 0 shared-read blocks. The captured actual Training read plan returned 1000 rows in 21.068 ms, 459 shared-hit blocks and 0 shared-read blocks.
- **100,028 records:** monthly summary sampled RSS 167.7 → peak 248.6 MiB; peak heap 127.0 MiB. Activity index probe returned 101 rows in 0.094 ms, 104 shared-hit blocks, 0 shared-read blocks. The captured actual Training read plan returned 1000 rows in 21.945 ms, 459 shared-hit blocks and 0 shared-read blocks.

Memory is sampled every 5 ms and includes shared process history/fixture allocations; it is not a per-request allocation profile. The locally generated reports record heap/RSS baselines and peaks for every operation. The Training query computes effective plan-relative dates with a join and can scan/sort candidate records; bounded returned rows do not imply constant database work.

## Annual proposal measurements

Each fixture also measured a single proposal creating 366 future independent running workouts, one per day, against 5,481 existing historical workouts. The selected future planning range was initially empty apart from current profile context. This measures creation, not a worst-case 1,500-command edit or a fully populated annual snapshot. Validation/storage, apply and undo each ran once; review validation and diff loading ran three times. Small-sample warm review statistics are recorded in the local reports and are not presented as robust percentiles.

| Dataset | Submit/validate/store ms | Review validation first ms | Diff load first ms | Apply ms | Whole-batch undo ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 31,211 | 7551.25 | 7775.85 | 6.57 | 7738.16 | 396.06 |
| 100,028 | 7798.92 | 7667.23 | 5.78 | 8028.83 | 424.85 |

- **31,211 records:** stored context 844 bytes, context JSON 684 bytes, stored diff JSON 164,224 bytes; owner detail response 151,351 bytes. Submit/review/detail/apply/undo used 17/13/1/1481/748 SQL statements respectively.
- **100,028 records:** stored context 844 bytes, context JSON 684 bytes, stored diff JSON 164,224 bytes; owner detail response 151,351 bytes. Submit/review/detail/apply/undo used 17/13/1/1481/748 SQL statements respectively.

The existing domain validation/application path still inspects current training state and took roughly eight seconds for this annual workload; historical detail pages are a separate bounded path. This is a material local latency limitation. No production-scale, simultaneous-import or HTTP/browser-render performance claim is made.

## Framework documentation validation

| Review area | Result |
| --- | --- |
| Coverage and authority | Feature requirements, acceptance scenarios, observed behavior, architecture ownership, ADR rationale and this measured execution record are linked; the explicit owner-approved plan is the decision evidence. |
| Public contracts and implementation | Sampled independent grant bounds, public plugin services, cursor/version checks, summary rules, annual snapshot parsing and owner-only application against code/tests. Generated contracts, registry and skill adapters passed drift checks. |
| Links, placeholders and duplication | Automated local-link/anchor/placeholder checks passed. CLI definitions stay in development; this record owns individual results. No framework/template changes or competing skill source were introduced. |
| Design and diagrams | Existing approval/review controls and shared theme conventions retained; styles are scoped to Agent bridge. No new or changed architecture diagram required rendering. |
| Compatibility and upgrade | Existing JSON/snapshot meaning retained; additive migrations, versions, composition and runtime-role refresh move together. Code-only rollback is not asserted. |
| Evidence limits | Cold caches, physical devices/cross-engine rendering, maximum-sized annual snapshots, concurrent imports and production operation were not measured. These are explicit limitations, not passing checks. |

## Local delivery and future deployment

The source changes, tests, public contracts, manifests, generated registry and docs are complete locally. Versions are Activity Records/Training/Garmin/Agent bridge 2.1.0 and Athlete 1.3.0, with matched instance pins. Four **new** migrations add owning-schema counters/indexes: Activity Records 003, Training 003, Athlete 004 and Garmin 005. Existing migration files are unchanged.

Future activation requires the canonical coordinated upgrade: matched application/web/worker and CLI checkout, forward migrations, runtime-role permission refresh and build/restart through the documented deployment procedure. No VPS deployment was performed. Historical access or longer planning requires a fresh browser approval; an existing connection never gains either automatically. New versioned grants/snapshots and schema signatures cannot be interpreted by old binaries. Roll back with the matching pre-upgrade source/database/configuration backup rather than deleting migrations or swapping executable code alone.

Review invalidation deliberately includes unrelated changes in a participating collection, and active historical reads share the existing domain transaction lock. Large summaries may therefore delay concurrent domain writes; imports between pages require a review restart. Missing imports/measurements remain unknown. The external agent performs analysis; this feature introduces no embedded AI service or live agent dependency.

## PR preparation and verification after rebase — 2026-10-31

At the owner's request, prepared the implementation for [issue 69](https://github.com/bidulelabs/athlete-panel/issues/69) on `codex/issue-69-history-annual-planning`. Rebased onto `09770bd` from current main, retaining its weekly planning-health context and Cloudflare deployment-health changes. Resolved the skill guidance and Activity Records public-export conflicts by retaining both capabilities, then regenerated the Claude adapters and registry. Historical read behavior and the independent grant design remain unchanged.

Verification after rebase passed: `pnpm check` (292 unit tests in 38 files; 153 lint warnings and zero errors), all 190 integration tests in 15 files (58.40 seconds), the optimized web/worker build, and 28 relevant desktop/mobile browser scenarios (47.1 seconds), including both themes. Checks used a separate synthetic Compose project and browser database on ports 55459/3018, rather than the owner's requested preview. Documentation and whitespace checks also passed. The benchmark results above remain the original feature measurements; they were not repeated solely for this rebase.

The temporary PR-check server and database were removed after verification. The separately requested synthetic preview on port 3017 was retained with a preserved build and its existing data. Preview configuration, credentials, screenshots and exports remain ignored under `.runtime/` and are excluded from the commit. Publication of the branch/PR is explicitly authorized; production access, deployment and merging remain separate actions.
