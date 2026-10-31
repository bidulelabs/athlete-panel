# 016: Independent historical review and annual proposal capabilities

## Record

Status: accepted
Recorded on: 2026-10-31
Status basis: the owner's explicit implementation instruction and choices recorded in the [execution record](../plans/historical-agent-review.md#authority-and-ownership).

## Context

The original connector couples a 121-day context window to proposal authority. Five-year analysis needs efficient, selective historical reads, while annual planning needs a distinct bounded mutation proposal. Imports can change records while an external agent traverses pages.

## Decision and rationale

Use versioned grants with independent optional history and planning scopes, each with its own inclusive calendar dates and notes permission. History is bounded by the fifth calendar anniversary; planning by the first. Leap-day anniversaries clamp to February 28. Existing grants retain their approved scope and gain no history permission. Owner review and application remain mandatory.

Historical reads use plugin-owned range projections, explicit public DTOs and bounded keyset pages. Authenticated review/cursor envelopes bind the grant, scope, query and transactional source versions. Changes require restarting the review instead of retaining duplicate health snapshots. Plugin-owned database triggers invalidate reviews on inserts, corrections, deletions, schedule changes and coverage changes. Conservatively, an unrelated change in a participating collection also invalidates the review. Every page rechecks access.

Annual proposals permit 1,500 commands and a 4 MiB request, with existing manual-operation limits retained. Exact changes, context freshness, seven-day proposal expiry, idempotency, atomic application and undo remain authoritative. Proposal lists fetch full diffs on demand.

## Consequences

- Expected benefits: independent least-authority approval, stable pagination or explicit failure, bounded transfer, and one review for representative annual programs.
- Costs: new read indexes/version counters, broader proposal validation and review testing, and possible review restarts during imports. Local benchmarks measure these costs; they do not establish production sizing.
- Reconsider snapshot retention if uninterrupted concurrent importing becomes more important than avoiding stored historical exports.
- Rollback must account for new schema signatures and persisted grant/proposal JSON, not just executable code.

## Alternatives

Increasing the old shared date bound would silently couple history to proposal permission and was rejected. Temporary immutable history copies were considered; the owner selected explicit restart behavior. Separately approved annual batches were considered; the owner selected one annual review.

## Relationships

- Requirements: [Agent training](../features/agent-training.md).
- Ownership: [Architecture](../architecture.md).
- Verification and deployment evidence: [Execution record](../plans/historical-agent-review.md).
