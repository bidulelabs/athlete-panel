# 023: Race plan as a Training record

## Record

Status: proposed. Recorded on: 2026-11-16.

Status basis: the decisions proposed on [issue #121](https://github.com/bidulelabs/athlete-panel/issues/121) on 2026-11-16, not yet confirmed by the owner.

## Context

Race preparation needs a stored race plan that an agent proposes together with phases and workouts, and that the owner reviews, applies and undoes as one change. Training records already give atomic application, audit, undo and revision checks.

## Decision and rationale

Store the race plan as a Training record of kind `racePlan`, one per race, with no SQL migration. Reuse the immutable proposal and owner review workflow with two commands, `racePlan.create` and `racePlan.update`. A plugin-owned table with its own proposal channel was rejected: it would not apply atomically with workouts and would open a second agent write path. Fields on the race event were rejected: agents cannot update events.

Add optional `raceId` to modern planning scopes as the single permission for one race. The planning context carries `racePlans` only when it is set, so grants without it keep their exact context digest, and pending reads, proposals and saved contexts stay valid.

Agents never write the target. The engine records the course and target a strategy was written for, so a later change can mark the plan as needing review without rewriting it.

## Consequences

- Expected benefit: a race plan, phases and workouts are reviewed, applied and undone together.
- Compatibility cost: older parsers cannot read a workspace holding a race plan, grants limited to a race or race plan proposals; matched application/CLI upgrades and backup-based rollback are documented.
- The briefing reaches the agent of that race without notes access: the race permission covers it.
- A race beyond the one-year planning limit cannot be prepared with an agent.
- Reconsider when several versions of a plan or a plan without a race are requested.

## Relationships

- Extends the [reviewed proposal workflow](003-reviewed-proposals.md) and the [planning read baseline](019-planning-read-baseline.md).
- Follows [reviewed event creation](020-agent-event-creation.md) for optional planning permissions.
- Requirements and acceptance: [race preparation](../features/race-preparation.md) and [agent training](../features/agent-training.md#race-plan-proposals).
