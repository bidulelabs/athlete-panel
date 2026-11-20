# Feature: Race preparation

## Purpose and scope

The athlete keeps one plan per race: what they want from it, a briefing and the effort to hold on each section of the course. An external assistant can write the strategy; the owner reviews it before anything is saved.

Outside scope: nutrition and aid stations, a printable race card, scenarios, the post-race review, a list of past versions and watch export.

## Intended behavior

Specification status: draft. Covers the stored race plan, its commands and agent proposals. No screen shows or edits a race plan yet.

Requirement source: [issue #121](https://github.com/bidulelabs/athlete-panel/issues/121) and the decisions proposed on it on 2026-11-16 (one document per race with no version list, proposals stay immutable, assumptions and open questions travel with the proposal, one permission per race). Record: [decision 023](../decisions/023-race-plan-record.md).

- A race plan belongs to one race, an event of kind race, and a race has at most one plan. The race of a plan never changes.
- A plan holds a target of up to 120 characters such as "Finish comfortably", a briefing of up to 4000 characters, pacing, assumptions and open questions (up to 20 lines of 300 characters each).
- Pacing is a list of up to 200 sections in course order. Each section runs from one distance to a greater one, in meters from the start line, and carries an effort of up to 120 characters. Sections cannot overlap; one may start where the previous ends.
- Only the owner sets the target. An assistant writes the briefing, pacing, assumptions and open questions and leaves the target as it is.
- A plan remembers what its strategy was written for: the course it used and the target at that time. The owner changing the target alone leaves that memory untouched, so the plan can be shown as needing review; saving with a course named again refreshes it.
- Deleting a race deletes its plan in the same change, and one undo restores both. An event with a plan cannot become a goal or another kind.
- There is no command to delete a plan alone.
- Assistants read and propose a race plan only through a planning connection limited to that race. Details in [Agent training](agent-training.md#race-plan-proposals).

## Acceptance scenarios

| Situation | Expected result | Verification |
| --- | --- | --- |
| Owner creates a plan with the target alone | Stored with an empty strategy | [Race plan tests](../../tests/unit/race-plans.test.ts) |
| Second plan for a race / plan for a goal or a missing race | Refused | Race plan tests |
| Race with a plan turned into a goal | Refused | Race plan tests |
| Race deleted / undone | Its plan goes and comes back with it; another race keeps its plan | Race plan tests, [race plan integration](../../tests/integration/agent-race-plans.test.ts) |
| Assistant writes the strategy | Target kept, course and target remembered | Race plan tests, race plan integration |
| Owner changes the target alone / saves with the course named | Memory kept / refreshed | Race plan tests |
| Sections overlapping, out of order, empty, blank or more than 200 | Refused | Race plan tests |

## Observed implementation

Implementation status: implemented in the working tree for the stored record, its commands and agent proposals; the Preparation screen, the course summary shared with the assistant and the connection field that selects the race are not implemented.

Training stores race plans as records of kind `racePlan`, beside plans, workouts, notes, events and phases. The engine checks the race of each plan, keeps one plan per race and removes a plan with its race. Agent Bridge adds the plan of the granted race to the planning context and checks each proposed race plan against the grant.

## Contracts and constraints

- `racePlan.create` and `racePlan.update` are owner commands and agent proposal commands; the agent form has no target and requires `courseId`.
- Modern planning scopes carry optional `raceId`. The planning context has a `racePlans` key only when it is set.
- No SQL migration. Upgrade and rollback: [race plan upgrade](../development.md#race-plan-upgrade).
