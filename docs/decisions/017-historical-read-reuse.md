# 017: Revalidate historical reads without holding the domain write lock

## Record

Status: accepted
Recorded on: 2026-10-31
Status basis: the owner explicitly requested implementation of annual-proposal performance, reusable history summaries and focused code organization in this chat. Scope and actual verification are recorded in the [execution report](../plans/agent-review-performance.md). No durable conversation URL is available.

## Context

Each summary page previously rescanned the entire approved selection under the shared domain write lock. A complete five-year export therefore repeated identical aggregation and could delay workout saves or imports. ADR 016 already requires monotonic transactional source counters and explicit restart after changes; it does not require historical reads to serialize with all writes.

## Decision and rationale

Use the host's generic read-only READ COMMITTED transaction helper, without the domain advisory lock. The bridge reads participating collection versions before retrieving facts and again before returning them. A committed write during retrieval changes a participating counter and rejects the response with `history_changed`. READ COMMITTED deliberately supplies fresh snapshots for the final version, credential and maintenance checks. Grant expiry/revocation is rechecked even for reused results. There is no cross-request database snapshot, writable read transaction or new host training policy.

Reuse sanitized summary rows in a disposable process-local LRU cache keyed by grant identity, approved scope, participating versions and normalized summary query. Entries become ineligible for reuse after five minutes or grant expiry, whichever comes first. Expired entries are pruned on cache reads/insertion; an idle process can retain their allocations until the next cache operation or process exit. Retention is limited to eight entries and 32 MiB of serialized rows per process; object overhead means this is not a 32 MiB RSS guarantee. Oversized results are served without retention. Access/version checks precede cache lookup and run again before response publication. Entries never contain raw records, credentials or opaque review tokens. Cached note permissions and filters cannot be reused for another scope/query/grant.

Eviction, restart and requests routed to a different process may recompute the same summaries; authenticated cursors retain their existing meaning. A source change continues to require a new review rather than automatic mixing/retry. No cache table, migration or saved historical export is introduced.

## Consequences

- Expected benefits: subsequent pages avoid source scans, and historical database reads no longer queue behind or hold the domain write lock.
- Costs: the first request still scans its selected source records; process-local reuse is not shared across workers. JavaScript aggregation can still occupy the process briefly. Frequent imports can still require restarts, and inaccessible old summary entries can remain privately in memory until pruning/eviction or process exit.
- Consistency depends on every participating source write advancing its owning-schema counter in the same transaction, including deletion, truncation, plan moves and coverage corrections. Existing triggers remain unchanged.
- Generic host API 1.3.0 adds read-only transactions and bounded repository batch writes. Updated Training and Agent bridge manifests require that host version; activate the matched application and composition together.
- Reconsider durable snapshots or more precise invalidation only after measuring a need. Full raw-record snapshots and long-lived shared caches are outside this decision.

## Alternatives

Period-by-period aggregation would reduce first-request work but must preserve health-source discovery, empty-period series, cross-date workout attribution and correction semantics. For this iteration, bounded reuse retains the verified full-range calculations. Holding the write lock during reuse would still unnecessarily serialize independent owner actions. Removing the lock without final fresh counter/authorization checks was rejected because it could return mixed or revoked access.

## Relationships

- [ADR 018](018-history-factual-invalidation.md) refines the original trigger policy to compare source facts, excluding no-op writes and operational metadata; cache authorization and final fresh version checks remain unchanged.

- Extends [independent historical access](016-historical-agent-access.md); its permission and restart decisions remain in force.
- Requirements: [Agent training](../features/agent-training.md#historical-read-protocol).
- Ownership: [Architecture](../architecture.md#historical-agent-reads-and-annual-proposals).
- Evidence: [Performance and reliability execution report](../plans/agent-review-performance.md).
