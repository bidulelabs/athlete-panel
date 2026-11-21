# 024: Race-day timing in the race plan

## Record

Status: proposed. Recorded on: 2026-11-21.

Status basis: the decisions proposed on [issue #122](https://github.com/bidulelabs/athlete-panel/issues/122) on 2026-11-21, not yet confirmed by the owner.

## Context

Race day needs a start time, cutoffs and aid stations to give arrivals, margins and moving time, and later nutrition and what to carry. They belong to one race and change with its plan.

## Decision and rationale

Store the start time, the finish cutoff and the aid stations as fields of the [race plan record](023-race-plan-record.md), not as new record kinds or a Race analysis table. They are applied, reviewed and undone with the plan, need no SQL migration and keep one plan per race. A separate table would not apply with proposals or be covered by undo.

Validation lives in the field schemas: stations in course order with distinct ids, `HH:MM` times, cutoffs up to six days after race day. Owner update patches carry no defaults, so an update that omits a field keeps it. Agents cannot write these fields yet.

Arrivals, margins, legs and moving time are computed when shown, from the course estimate and the plan, and never stored. Times are wall-clock times in the profile timezone, counted from race-day midnight.

## Consequences

- Expected benefit: changing a station or the start time updates every view of the plan at once, with no stored result to fall out of date.
- Compatibility cost: older parsers reject a plan holding these fields; a planning context limited to a race changes shape, so a context read before the upgrade is stale. Matched application/CLI upgrades and backup-based rollback are documented in [race day upgrade](../development.md#race-day-upgrade).
- The race permission covers these fields for the agent of that race, as for the briefing.
- A race in another timezone and a clock change during the race are not handled.
- Reconsider when stations must be shared between races or imported from a course file.

## Relationships

- Extends [race plan as a Training record](023-race-plan-record.md).
- Requirements and acceptance: [race preparation](../features/race-preparation.md).
