# Feature: Charts

## Purpose and scope

The athlete sees how training built up over weeks and months, starting from a familiar chart template instead of a blank chart builder. The first template, **Training hours**, compares planned and recorded hours per week and marks the races entered in the calendar.

Outside scope: other templates (each arrives in its own change, see [issue #79](https://github.com/bidulelabs/athlete-panel/issues/79)), day or month grouping, sport and category filters, an **Add metric** control, readiness scores, workload ratios and pace or power curves. Selecting a chart never grants an agent access or sends data anywhere.

## Intended behavior

Specification status: approved scope for the template picker and Training hours.
Requirement source: [issue #79](https://github.com/bidulelabs/athlete-panel/issues/79), proposal by the maintainer and agreement of 2026-11-04 (built-in plugin, shadcn Charts, dedicated read-only summary request, small changes in the stated order).

- **Charts** is a built-in, optional plugin with one page. It opens on a template list; choosing a template opens that chart, and **All templates** returns to the list.
- **Training hours** shows recorded hours per week as bars and planned hours per week as a dashed line. Each `race` event in the period is a vertical line in the event colour with its title; goals and other events are not drawn.
- Weeks are the Calendar's weeks: the same week start preference, the same planned and recorded duration totals (the Calendar [weekly summary](training-workspace.md) calculation, run on the server for every week), and the same duration format.
- **Period** offers the last 4, 12 or 52 weeks ending with the current week, **This season**, or custom dates. This season runs from the start date of the active training plan to the current week; a plan is active when today falls between its start date and its last planned day, and the latest start wins when several are. Without an active plan (none, not started yet, or already ended), the season starts on 1 January. A season longer than 53 weeks shows the same error as custom dates. Custom dates expand to whole weeks and accept at most 53 weeks; an end date before the start date shows an error and sends no request.
- A week with no recorded session shows no bar and reads **No sessions recorded**, as in the Calendar. A session measured at zero minutes reads `0m`. A week whose recorded sessions all lack a duration shows no bar and **Duration missing**. A partly measured week shows the known sum with how many sessions lack a duration. A week without planned sessions has no point on the planned line and reads **No plan**.
- The current week is marked **in progress**: its bar is drawn as an outline. Weeks after today show no recorded value and read **Upcoming**.
- A period with no planned and no recorded session shows an empty state instead of empty axes.
- **View values** opens a native table with the same weeks, values and labels as the chart and tooltip. The chart has a legend, a caption describing the period, a tooltip that follows the pointer, and keyboard navigation (focus the chart, then the arrow keys).

## Acceptance scenarios

| Situation or input | Expected observable result | Verification approach or reference |
| --- | --- | --- |
| Any week of the selection | Planned and recorded duration equal the Calendar weekly summary for that week | [Unit tests](../../tests/unit/charts.test.ts) |
| 52 weeks requested | Server returns 52 weeks beyond the 121-day workspace limit and writes nothing | [Integration test](../../tests/integration/charts.test.ts) |
| 54 weeks requested | Request refused | Unit and integration tests |
| Week without sessions, session measured at zero, week with every duration missing, partly measured week | **No sessions recorded**; `0m`; **Duration missing**; known sum with the missing count | Unit tests, [browser tests](../../tests/e2e/charts.spec.ts) |
| Current week, later week, week without plan | **(in progress)**; **Upcoming**; **No plan** | Unit and browser tests |
| Race, goal and race outside the period | Only the race inside the period is drawn and listed | Unit tests |
| Empty period | Empty state, no figure | Browser tests |
| Active plan; no plan; plan starting later or already ended | Season from the plan start; from 1 January; from 1 January | Unit and browser tests |
| Custom dates, then a reversed range | Request for the covering whole weeks; then an error and no request | Browser tests |
| Keyboard on the chart | Arrow key shows the week's values in the tooltip | Browser tests |
| Desktop, Pixel 7 and 320px, both themes | No page-level horizontal scroll; the table scrolls inside its own region | Browser tests and screenshots |

## Observed implementation

The [manifest](../../plugins/charts/manifest.json) registers `/charts` and one server operation. [`summary`](../../plugins/charts/server.ts) validates the selection with the [public contract](../../packages/contracts/src/charts.ts), loads the workspace for the selected weeks with the same loader as `GET /api/workspace`, and maps each week through [the shared weekly calculation](../../plugins/charts/summary.ts). It returns only weekly duration totals and race dates and titles. The [page](../../plugins/charts/client.tsx) builds the week rows in [one place](../../plugins/charts/training-hours.ts) for the chart, the tooltip and the table, and loads the [chart](../../plugins/charts/training-hours-chart.tsx) and Recharts only when a template opens. While a new period loads, the previous chart stays at reduced opacity.

The UI package adds the shadcn `chart` component on Recharts 3.10.1. Its dark selector follows `data-theme`, like the rest of the [shared UI](shared-ui.md). Series colours are plugin tokens in [charts CSS](../../plugins/charts/charts.css): a neutral graphite for recorded hours (not a sport colour, since the bar sums every sport) and the Calendar event amber for races.

Evidence: unit, integration and browser tests linked above.
Limits: the general `GET /api/workspace` keeps its 121-day limit. Accessibility checks are the keyboard and table browser tests; no automated axe scan runs, and text contrast inside the SVG is not measured automatically.

## Contracts and constraints

- Contract: [`charts.summary`](../../packages/contracts/src/operations.ts) input `{ weekStart, weeks }` (1 to 53) and output `{ weeks, races }`.
- Architecture: [plugin boundaries](../architecture.md); the plugin depends on the public training calculation and has no schema or migration.
- Rationale: [ADR 007](../decisions/007-shared-shadcn-ui.md) for shared shadcn components.
