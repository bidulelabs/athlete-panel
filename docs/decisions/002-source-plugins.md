# ADR 002: trusted build-time source composition

## Record

Status: accepted
Recorded on: 2026-10-24
Status basis: owner approval to implement the private MVP plan on this date; this accepts source composition and explicit trusted-code boundaries, not marketplace execution. [Execution record](../plans/mvp-execution.md).

## Context

Owner-created features should integrate without editing shell internals and survive upstream updates. Runtime remote-code installation would expand the deployment and security burden.

## Decision and rationale

Plugins declare versioned manifests, dependencies, routes, owned schemas, migrations, jobs and public services. Generate separate client/server registries from pinned local composition. Validate metadata, collisions and dependency order before activation. Build and restart to change source or enabled state. Retain data on disable/uninstall. Store owner source in `personal-plugins`.

## Consequences

- Expected benefits: reviewable reproducible artifacts, small host and ordinary source tooling.
- Costs/risks: plugins run with the process privileges; capability declarations are not a sandbox. Updates require compatibility checks and coordinated migration/recovery.
- Reconsider when: remote distribution or isolation becomes a separately approved requirement.

## Alternatives

Cordis/runtime loading and remote plugin execution were considered in the plan and deferred. DeepSeek Harness informed the composition/skill approach but is not a runtime dependency.
