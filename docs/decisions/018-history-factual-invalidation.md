# 018: Invalidate historical reviews when their source facts change

## Record

Status: accepted
Recorded on: 2026-11-01
Status basis: the owner explicitly requested implementation of both PR #70 review fixes after reviewing the findings in this chat. The [review comment](https://github.com/bidulelabs/athlete-panel/pull/70#discussion_r4434799395), synthetic reproduction and [execution record](../plans/agent-history-review-fixes.md) establish the scope and verification. This refines the trigger/projection policy of ADRs 016 and 017; independent permissions, collection-wide restart and owner application remain in force.

## Context

Statement-level triggers advanced versions even for zero-row updates or cleanup deletes. Coverage upserts advanced them twice and changed live scan timestamps on every completed rescan. An agent could lose a multi-page review without any training/health facts changing. Simply excluding timestamps from counters while continuing to return them would let one review contain different metadata on repeated reads.

## Decision and rationale

Use additive migrations in Activity Records, Training, Athlete and Garmin. INSERT/UPDATE/DELETE triggers inspect transition tables and advance once per changed statement/event. Record UPDATE comparisons include kind, identity, revision, JSON data and deleted state, excluding only the operational update time. Inserts/deletes with no affected rows and identical updates do not advance. BEFORE TRUNCATE checks for existing rows. All counter updates remain in the mutation transaction and roll back together. The [PostgreSQL 17 trigger contract](https://www.postgresql.org/docs/17/sql-createtrigger.html) supplies statement transition relations, including the separate INSERT/UPDATE sets for upserts.

Garmin versions the stable historical coverage projection: stream, date window, status, whether a scan has completed, and scan state. An in-progress rescan with prior completed evidence projects as scanned; a first scan remains in progress. Failures and unavailable states remain visible, including after an earlier completed scan. Operational record/rejection counts, diagnostics and live timestamps are not exported as historical facts and do not themselves invalidate. Normalized activity/health corrections still advance their own counters.

The historical DTO adds optional `hasCompletedScan` and omits the volatile `lastScannedAt` field from new responses. Garmin's owner-facing live status continues using the actual timestamp/progress unchanged. Summary scan-day counts use the flag, accepting older timestamp-based exported shapes only as a compatibility fallback. This makes records and cached summaries stable during an unchanged rescan without freezing or inventing a timestamp.

The migrations bump each counter once so old review tokens restart across the coordinated upgrade. Applied migrations and stored grants/proposals are not rewritten. True changes anywhere in a participating collection still require restart; this is not range-specific invalidation, import-tolerant proposal submission under issue #68, or a durable snapshot implementation.

## Consequences

- Benefits: unchanged polling, no-op mutations and cleanup can coexist with a long review; meaningful changes still fail closed. Bulk changes avoid one counter write per row.
- Costs and risks: UPDATE transition comparisons inspect changed row sets; large bulk statements require measured verification. Future historical projection fields must be included in the owning counter comparison. No historical last-checked time is returned; the owner retains that operational information in Garmin status.
- Compatibility: optional legacy fields remain readable. Deploy matching contracts, reader/aggregator, plugin manifests, composition, registry and migrations; restart web/worker. Old reviews restart once; grants and pending proposals retain their permissions and exact data. Older binaries require their matched pre-upgrade backup.
- Reconsider when: collection-wide invalidation on actual unrelated changes materially interrupts reviews. Durable snapshots or range-aware versions remain separate decisions.

## Alternatives

Row triggers with distinct-row predicates detect no-ops but write the same counter per changed row; transition tables retain batch efficiency. Suppressing all coverage invalidation would miss first scans, failures and date-bound corrections. Ignoring timestamp changes while returning the live timestamp would break review consistency. Freezing the operational timestamp would make Garmin status misleading. These alternatives were rejected within the authorized correction scope.

## Relationships

- Refines the trigger/projection parts of [ADR 016](016-historical-agent-access.md) and [ADR 017](017-historical-read-reuse.md).
- Requirements: [Agent training](../features/agent-training.md#historical-read-protocol).
- Ownership: [Architecture](../architecture.md#historical-agent-reads-and-annual-proposals).
- Actual verification and activation: [Execution record](../plans/agent-history-review-fixes.md).
