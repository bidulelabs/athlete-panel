# Feature: Plan phases

## Purpose and scope

The athlete splits the coming months into phases (base, build, peak, taper, recovery), each with what it trains and, if wanted, a weekly volume target. A fully written plan works with phases alone; a plan detailed two weeks at a time uses the targets as the volume estimate for the weeks not written yet.

Outside scope: generating or prefilling workouts from phases, automatic load or ramp-rate advice, and anything that changes existing workouts.

## Intended behavior

Specification status: draft. Covered so far: stored phases, editing them inside a plan and the Charts target band; the Calendar week header and agent proposals follow in separate changes.

Requirement source: [issue #97](https://github.com/bidulelabs/athlete-panel/issues/97), the owner's answers on it (ski touring counts fully in hours; phases stand on calendar dates, across plans) and the 2026-11-10 review summary (phases inside the plan view, optional targets, a focus per phase).

- A phase is stored on calendar dates, owned by Training and attached to no plan, so one season can span several plans and nothing is copied or counted twice.
- A phase has a name, a role (base, build, peak, taper or recovery), a first day, a last day and an optional focus of up to 120 characters, such as "VO2max" or "Taper for Grenoble-Vizille". Phases cannot overlap; a phase may start the day after the previous one ends.
- Weekly hours, distance and climbing targets are each optional; a phase can have none. A target is a range (at least, at most) for the first week and for the last week; the weeks between move in a straight line from one to the other.
- A week belongs to the phase that holds its first day, so targets follow the athlete's week start.
- Hours count every sport, ski touring included.
- A scheduled plan shows one block for each phase that overlaps it: from the plan's first day to the day before the next scheduled plan starts, or every later phase when no plan starts later. The block's header shows the name, role, dates, focus and targets, with **Edit** and **Delete**; the written weeks whose first day falls in the phase sit inside the block, on a shared border and background. Weeks outside every phase stay outside any block, and a phase past the last written week shows as a block without weeks. An unscheduled plan shows no phase.
- **Add phase** in a scheduled plan opens the editor with the first day after the last phase shown, or the plan's first day. Every target is off until the owner ticks it; unticking removes the target. Targets are entered in hours, in kilometres or miles, and in metres or feet following the profile units.
- Deleting a phase leaves workouts as they are.
- **Charts** draws the hours target behind Training hours and Training by sport, and the climbing target behind Weekly climbing, into future weeks, only for weeks whose phase has that target; **Plan phases** in Period shows every phase. Details in [Charts](charts.md).
- Agents read the phases that touch their planning dates as context, focus included. They cannot create, change or delete phases yet.

## Acceptance scenarios

| Situation or input | Expected observable result | Verification approach or reference |
| --- | --- | --- |
| Owner adds a phase with hours only, or with no focus and no target | Stored with an empty focus and no other target; the header lists only the targets set | `tests/unit/plan-phases.test.ts`, `tests/e2e/plan-phases.spec.ts` |
| Focus with spaces around it, or over 120 characters | Trimmed; refused over 120 | `tests/unit/plan-phases.test.ts` |
| Phase starting on the last day of another | Refused: phases cannot overlap; the next day is accepted | `tests/unit/plan-phases.test.ts` |
| Last day before first day, or a maximum below its minimum | Refused; a one-day phase and equal bounds are accepted | `tests/unit/plan-phases.test.ts` |
| Plan followed by a later scheduled plan, last plan, unscheduled plan | Phases until the next plan starts; every later phase; none | `tests/unit/plan-phases.test.ts` |
| Weeks inside a phase, before or after it, a phase starting after a week's first day, a phase past the last written week | Inside its block; outside every block; the week stays outside; a block without weeks | `tests/unit/plan-phases.test.ts`, `tests/e2e/plan-phases.spec.ts` |
| Owner saves a phase without touching a target, such as 8.25 h | The stored target is kept as it was, not rounded through the form | `tests/unit/phase-editor.test.ts`, `tests/e2e/plan-phases.spec.ts` |
| Owner unticks distance while editing | Distance target removed | `tests/e2e/plan-phases.spec.ts` |
| Agent proposal still pending from before this change | Its saved context still matches its digest; it reviews as ready and applies | `tests/integration/proposal-review.test.ts` |
| Agent sends `period.create` | Refused: not available to the training agent | `tests/unit/plan-phases.test.ts` |
| Agent planning read | Only phases touching the grant dates are shared | `tests/unit/plan-phases.test.ts` |
| Workspace read for any date range | Every phase is returned, focus included | `tests/integration/plan-phases.test.ts` |
| Week inside a phase, first week of a phase not aligned with the week start, one-week phase | Target interpolated by week; the week takes the phase holding its first day; first week target | `tests/unit/phase-targets.test.ts` |
| Charts by month, by day, or with a sport selection | Month adds up its days; no target by day or with a sport selection | `tests/unit/phase-targets.test.ts`, `tests/e2e/charts-volume.spec.ts` |

## Observed implementation

Phases are `period` records in `training.records`, handled by `period.create`, `period.update` and `period.delete` (`plugins/training/engine/handlers/period.ts`). The overlap check runs on every workspace validation (`plugins/training/engine/state.ts`). Which phases a plan shows, and which weeks each one holds, is `plugins/training/plan-phases.ts`; the phase block and editor are `plugins/training/phases.tsx`. The target of a week comes from `weekTargets` (`plugins/training/phase-targets.ts`), used by Charts.

Evidence: the tests listed above.
Limits: static inspection and automated tests only.

## Contracts and constraints

- Contract: `periodValuesSchema`, `periodSchema` and the period commands in [`packages/contracts/src/domain.ts`](../../packages/contracts/src/domain.ts); `periods` in the workspace state defaults to an empty list, so stored proposal contexts written before this change still read; review checks a saved context against its digest as it was stored.
- No SQL migration: the records table already stores any Training record kind.

## Verification and release details

[Development and verification guide](../development.md)

Release with the matching web and worker build through the [coordinated upgrade procedure](../development.md#coordinated-upgrades-and-plugin-activation). An agent that read planning context before the upgrade reads it again before submitting.
