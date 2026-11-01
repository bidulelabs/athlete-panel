# Historical review final corrections — 2026-11-01

## Authority and scope

The owner requested implementation and push of the four findings from the full review of PR #70 at `9dd5f20`. Work is confined to the current checkout and disposable synthetic databases. Production storage, deployed migrations and VPS deployment are excluded.

## Changes

1. Bind every outgoing summary/evidence reference to the response's review token, including cache hits. Bind before byte sizing and keep cached facts token-free. A forwarded reference now rejects a participating correction with `409 history_changed`.
2. Training supplies compact audit summaries to the workspace and an authenticated owner-only detail operation. Recent changes loads a diff only on expansion, offers retry and does not refresh/save the workspace. Readable headings, revision-only filtering, original stored diffs and atomic undo remain intact.
3. Older missing prescription collections have unknown counts; empty arrays have zero counts. Objects/scalars/null collections produce explicit, retrievable unsupported-field diagnostics instead of SQL array errors. A concurrent collection-shape correction between core and section queries also returns `history_changed`. Diagnostics are merged rather than overwritten by other invalid fields.
4. Reject coverage `recordId` filters with a clear period-filtering instruction rather than silently ignoring them.

No SQL migrations or stored-data changes are needed. Final pre-release plugin versions remain the coordinated versions chosen relative to main; generated contract references are refreshed. Web/worker and browser clients must update together for the workspace response shape. Existing grants, proposal snapshots, CLI configurations, note controls and mandatory owner application are unchanged. This extends existing bounded-read/on-demand-detail decisions, so a separate ADR is not warranted.

## Verification

Focused integration regressions initially passed 36 tests, including summary-cache rebinding, direct reference replay before/after correction, legacy collection shapes, filter rejection, readable audit metadata, 1,500 mixed annual commands, failure rollback, idempotency, stale acknowledgement and whole-batch undo. One initial test fixture omitted the required audit actor; the fixture was corrected before this passing run.


Full `pnpm check` passed: 318 unit tests, normal/strict types, boundary validation, generated registry/contracts/adapter freshness, formatting and documentation validation (51 files). Lint reports 161 warnings and no errors. The final full integration run passed 228 tests across 17 files. Web and worker builds passed. Publication-security tests passed (117 run, two platform-specific skips). All 16 migration files from the pinned main baseline were compared byte-for-byte and remain unchanged; generated JSON changes are limited to workspace responses and Training operations.

Framework validation covered the changed architecture, authoritative agent/training feature specifications, canonical development guidance and this execution record: acceptance evidence, local links, consistent terminology, upgrade constraints and ADR applicability. No new framework, dependency, table or embedded AI service was introduced.


The full browser matrix passed 165 tests with three intentional device-specific skips in 4.9 minutes. It covers desktop/phone planning, approval/revocation, owner-only audit access, annual application/undo, detail-loading retry and both themes; current screenshots were visually inspected. After the final collection-race guard was rebuilt, all six history/annual browser scenarios passed again against that final artifact. Single browser observations for annual review/apply/undo were 420/818/220 ms on desktop and 422/817/207 ms on phone. These are local observations, not quantiles.

The refreshed synthetic preview runs at port 3017 with five years of history and a pending 1,500-command proposal. A startup attempt used a nonexistent local test-database name; correcting that launcher setting restored the preview without application changes or modification of the pre-existing synthetic database. No deployment occurred.

## Local response measurements

Same synthetic workload as the review: one annual plan, 1,000 existing workouts and one 1,500-command proposal (500 additions, 500 edits, 500 deletions). Workspace selection: 2026-11-01 through 2026-11-07. Apple M4 Pro, Node 22.22.0, local PostgreSQL 17.11. Values below are uncompressed serialized JSON and single local service observations, not production capacity or latency estimates.

| State | Previous workspace bytes | Fixed workspace bytes | Fixed audit-list bytes | Fixed service latency |
| --- | ---: | ---: | ---: | ---: |
| Pending | 634,846 | 634,846 | 2 | 43.90 ms |
| Applied | 1,739,661 | 447,071 | 215 | 30.07 ms |
| Undone | 3,220,481 | 635,292 | 448 | 28.25 ms |

The full applied diff remains available on demand: 1,500 records, 1,292,803 bytes, 21.11 ms. This fix bounds routine audit-list transfer; opening a large diff intentionally still transfers that complete entry. The synthetic probe creates/drops its own database. Raw evidence stays ignored under `.runtime/pr70-full-review/`.
