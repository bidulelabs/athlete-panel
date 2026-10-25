# ADR 001: independent PostgreSQL instance

## Record

Status: accepted
Recorded on: 2026-10-24
Status basis: the owner explicitly approved the private MVP implementation plan in this chat on this date. The scope includes PostgreSQL, single owner, responsive web, fresh data and private-server operation; no durable conversation URL is available. See the [execution record](../plans/mvp-execution.md).

## Context

The rebuild must operate independently of an author backend, embedded model provider, hosted job service or legacy deployment. A single athlete still needs concurrent web requests, imports, durable jobs, transactional review and recoverable storage.

## Decision and rationale

Use PostgreSQL with plugin-owned schemas, a Next.js web process and a worker from the same source revision, behind Caddy on a private Linux server. Supply Compose installation and encrypted backups. Manual use needs no Garmin or model key. Keep the legacy checkout and data unchanged.

## Consequences

- Expected benefits: local ownership, explicit transactions and no mandatory application SaaS subscription.
- Costs: server operation, database/secret recovery, domain and off-host storage remain the owner's responsibility. Savings depend on actual invoices and utilization.
- Reconsider when: measured memory/operational burden outweighs concurrency benefits, or the owner changes the private-instance requirement.

## Alternatives

SQLite was viable for one athlete but the owner selected PostgreSQL. Separate frontend/backend and microservices were assessed in the plan and added no established MVP benefit.
