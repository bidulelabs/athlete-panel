# ADR 009: independent proposal lifetime and renewed review

## Record

Status: accepted
Recorded on: 2026-10-27
Status basis: the owner explicitly approved implementation of the R1–R4 plan in this chat, including seven-day proposals and fresh owner review. [Execution record](../plans/mvp-execution.md).

## Context

Short-lived agent access and routine imported facts unnecessarily invalidate reviewed work.

## Decision and rationale

Derive expiry seven days from submission. Owner application requires an unrevoked grant; agent reads/submissions still require active access. Store only the permitted bounded context in a versioned snapshot. Context-only changes permit owner re-review using the current digest; application revalidates it transactionally alongside scope, revisions and exact immutable edits. Legacy changed context requires replacement.

## Consequences

Expected benefits: durable review without extending agent access. Costs: bounded snapshot storage and renewed acknowledgement after relevant changes. Changed edits still require replacement; identical committed retries retain their result. Reconsider alongside any separately approved unattended workflow.

## Relationships

Partially supersedes [ADR 003](003-reviewed-proposals.md), as specified above. [Feature](../features/agent-training.md), [database evidence](../../tests/integration/proposal-review.test.ts), [browser evidence](../../tests/e2e/proposal-review.spec.ts).
