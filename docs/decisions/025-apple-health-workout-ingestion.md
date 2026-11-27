# 025: Receive Apple Health workouts through a scoped upload

## Record

Status: accepted

Recorded on 2026-11-27. The owner approved implementation of the Apple Health plan. [Issue #157](https://github.com/bidulelabs/athlete-panel/issues/157)

## Context

Sync for Health sends workouts and HealthKit UUIDs in batches over HTTPS. It saves its HealthKit position after the server acknowledges a batch. Athlete Panel already has a private owner browser API and a shared transaction boundary for activities, calendar links and their audit. [Sync for Health protocol](https://github.com/vcnngr/sync-for-health/blob/main/docs/PROTOCOL.md)

## Decision and rationale

Use one Apple Health upload endpoint with a revocable, hashed token. Keep connection management and GPX download in owner operations. The Apple Health plugin owns connection state, observed sources, and UUID tracking. Activity Records owns normalized facts and the private route file. Training owns link reconciliation. Acknowledging after commit lets the phone retry and preserves consistent calendar and history views.

## Consequences

- The same Apple activity appears across the existing calendar and history views, with stable IDs when the phone resends it.
- Sync progress is observed through received batches. The client’s supported completion boundary is a batch, so the owner confirms Apple links.
- Revisit route history limits if the sender adds bounded route batches or a documented completion signal.

## Relationships

- [Apple Health workout import](../features/apple-health-import.md)
- [Execution record](../plans/apple-health-workout-import.md)
