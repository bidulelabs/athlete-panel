# 020: Reviewed event creation with explicit planning permission

## Record

Status: accepted. Recorded on: 2026-11-08.

Status basis: the owner's approved implementation plan and explicit default-on correction, recorded in the [task authority](../plans/agent-event-creation.md#authority-and-scope).

## Context

Race preparation can require a calendar target alongside training. Existing agents can read events but cannot propose them. Broadening all saved grants would change previously approved permissions.

## Decision and rationale

Add an optional event-creation permission to modern planning scopes. Only explicit true permits race/goal creation. New browser planning approvals select it by default and visibly allow opting out; old grants keep their exact stored shape and authority. Reuse the existing immutable proposal, owner review and atomic apply/undo workflow. Event creation inherits proposal dates and notes access. Existing event edits and generic event creation stay owner-only.

Block equal normalized titles on the same date, across kinds, both at submission and application. A concurrent duplicate requires a replacement proposal rather than an override. The external coaching skill clarifies tentative targets and uncertain dates; the server enforces contracts and access, without model orchestration.

## Consequences

- Expected benefit: a race and preparation can be reviewed/applied together without a manual calendar step.
- Compatibility cost: older parsers cannot read newly permissioned grants or event proposals; matched application/CLI upgrades and backup-based rollback are documented. No SQL migration or event-storage change is needed.
- Exact matching cannot identify differently named copies. The agent checks context and clarifies ambiguous matches; no fuzzy uniqueness rule is imposed on manual event creation.
- Reconsider when event updates, generic events or independently scoped event dates are requested.

## Relationships

- Extends the [reviewed proposal workflow](003-reviewed-proposals.md) and [durable review](009-durable-proposal-review.md).
- Requirements and acceptance: [agent training](../features/agent-training.md#race-and-goal-proposals).
- Implementation and actual verification: [execution record](../plans/agent-event-creation.md).
