# ADR 003: scoped proposals with owner application

## Record

Status: accepted
Recorded on: 2026-10-24
Status basis: the owner's approved implementation plan explicitly requires read/propose-only agent credentials and application of an exact reviewed proposal. [Execution record](../plans/mvp-execution.md).

## Context

An external harness can assist training and create source plugins, but should not silently change completed training, private settings or production deployments. Query results may change between export and review.

## Decision and rationale

Use bounded expiring grants, runtime schemas shared with manual edits, immutable stored expanded changes and digests, context-query freshness, expected revisions, atomic application, idempotency and conflict-aware whole-batch undo. Only owner sessions apply. Context excludes ordinary notes unless selected and never includes credentials/raw provider payloads/GPS.

The owner subsequently approved a simplified connection flow on 2026-10-24: a CLI command opens authenticated browser approval and stores the credential automatically. This changes credential setup, not read/propose-only permissions or owner review. The implementation uses temporary pairing requests with a matching terminal code; credentials remain outside browser URLs and model conversations.

## Consequences

- Expected benefits: exact review, consistent deterministic validation and recoverable domain edits.
- Costs: stale proposals must be rebuilt; whole-batch undo can be blocked by later edits. The owner-chosen harness has its own data/model-service boundary.
- Reconsider when: a separately approved unattended workflow defines narrower operations and explicit risk limits.

## Alternatives

Embedded model orchestration, unrestricted agent SQL and autonomous owner-equivalent tokens are excluded. MCP transport is deferred; CLI and versioned HTTP adapters provide the initial integration.

## Amendment

[ADR 009](009-durable-proposal-review.md) supersedes grant-expiry coupling and mandatory replacement for context-only changes. Other permissions, immutable edits and atomicity remain in force.
