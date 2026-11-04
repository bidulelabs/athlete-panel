# Feature: Charts

## Purpose and scope

The athlete sees how training built up over weeks and months, starting from a familiar chart template instead of a blank chart builder. The first template, **Training hours**, compares planned and recorded hours per week and marks the races entered in the calendar. **Training by sport** splits the same recorded hours by sport. **Workout heart rate** shows the average heart rate of each session, one sport at a time. **Weekly climbing** shows recorded elevation gain per sport and how steep running was. **Resting heart rate and HRV** compares each night with its 7-night average and a usual range.

Outside scope: other templates (each arrives in its own change, see [issue #79](https://github.com/bidulelabs/athlete-panel/issues/79)), day or month grouping, sport and category filters, an **Add metric** control, readiness scores, workload ratios and pace or power curves. Selecting a chart never grants an agent access or sends data anywhere.

## Intended behavior

Specification status: approved scope for the template picker, Training hours, Training by sport, Workout heart rate, Weekly climbing, and Resting heart rate and HRV.
Requirement source: [issue #79](https://github.com/bidulelabs/athlete-panel/issues/79), proposal by the maintainer and agreement of 2026-11-04 (built-in plugin, shadcn Charts, dedicated read-only summary request, small changes in the stated order).

- **Charts** is a built-in, optional plugin with one page. It opens on a template list; choosing a template opens that chart, and **All templates** returns to the list.
- **Training hours** shows recorded hours per week as bars and planned hours per week as a dashed line. Each `race` event in the period is a vertical line in the event colour with its title; goals and other events are not drawn.
- Weeks are the Calendar's weeks: the same week start preference, the same planned and recorded duration totals (the Calendar [weekly summary](training-workspace.md) calculation, run on the server for every week), and the same duration format.
- **Period** offers the last 4, 12 or 52 weeks ending with the current week, **This season**, or custom dates. This season runs from the start date of the active training plan to the current week; a plan is active when today falls between its start date and its last planned day, and the latest start wins when several are. Without an active plan (none, not started yet, or already ended), the season starts on 1 January. A season longer than 53 weeks shows the same error as custom dates. Custom dates expand to whole weeks and accept at most 53 weeks; an end date before the start date shows an error and sends no request.
- A week with no recorded session shows no bar and reads **No sessions recorded**, as in the Calendar. A session measured at zero minutes reads `0m`. A week whose recorded sessions all lack a duration shows no bar and **Duration missing**. A partly measured week shows the known sum with how many sessions lack a duration. A week without planned sessions has no point on the planned line and reads **No plan**.
- The current week is marked **in progress**: its bar is drawn as an outline. Weeks after today show no recorded value and read **Upcoming**.
- **Training by sport** stacks the recorded hours of each week by sport, in a fixed order from the baseline: running, cycling, winter sports, hiking, swimming, then **Other** on top. Other gathers every other sport group and every activity whose sport could not be identified. Each sport keeps its colour whatever the period; the legend and table list only sports recorded in the period. A subgroup (trail running) counts once, under its sport group. The planned line, races, current week outline and **Upcoming** weeks are the same as in Training hours. Per sport, a sport without sessions that week reads **No sessions recorded**, a session measured at zero reads `0m`, and missing durations follow the Training hours rules.
- **Workout heart rate** draws one dot per recorded session of the chosen sport (the Calendar's recorded sessions: imported activities, and manually logged workouts on their performed date; a workout linked to an activity counts once, as that activity), at its date and its average heart rate in bpm. **Sport** lists the chart sports with at least one session with heart rate in the period and starts on the one with the most. Sessions without heart rate are not drawn; the caption counts them and the table lists them as **No heart rate**. A period without any heart rate shows an empty state that counts the recorded sessions.
- **Weekly climbing** shows two charts with the same weeks and races, never two Y axes. The first stacks recorded elevation gain per sport, in metres or feet following the profile units, with the same sport order and colours as Training by sport; it lists only sports with a measured elevation in the period. Per sport, a week without sessions reads **No sessions recorded**, a session measured at zero reads `0 m`, a week where every session lacks elevation reads **Elevation missing**, and a partial week gives the known sum with the missing count. The second is running climb (m/km or ft/mi): the elevation gain divided by the distance of the runs that have both. It reads **No running** without running sessions, **Not measured** when no run has both, and **partial** when some runs were left out. Descent is not shown yet.
- **Resting heart rate and HRV** shows two charts, one per measure, never two Y axes: each night with a Garmin value is a dot, the 7-night average is a line (only when at least 4 of those 7 nights have a value), and a band shows the usual range. The usual range of a night is the average of the 60 nights before it plus or minus 0.75 standard deviation, shown only when at least 30 of those 60 nights have a value; otherwise the tooltip and table read **Not enough nights**. Nights without a value are gaps. When Garmin marks a resting heart rate as possibly the lowest heart rate of the day, the table reads **(daily minimum)** and the caption counts those nights. A measure with no night in the period is not drawn; with neither, the page shows an empty state.
- A period with no planned and no recorded session shows an empty state instead of empty axes.
- Choosing a period shows only that period's result. While it loads, the previous chart stays at reduced opacity; if the request fails, the chart is removed and an error with **Try again** replaces it. Opening or changing a chart reads only the chart: it does not reload the workspace or announce a save.
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
| Training by sport on any week | Sport durations add up to the Calendar recorded total | Unit tests |
| Trail run, unresolved running activity, other sport group | Counted once under Running; Other; Other | Unit tests |
| Sport with every duration missing, sport partly measured, sport measured at zero, sport not done that week | **Duration missing**; known sum with the missing count; `0m`; **No sessions recorded** | Unit and browser tests |
| Heart rate sessions of two sports | Sport with the most heart rate sessions first; sessions without heart rate in the table only | Unit and browser tests |
| Manually logged run, workout linked to an imported run | Manual run in the table on its performed date with **No heart rate** and no dot; linked run listed once | Unit tests |
| Running week with a run missing elevation, without elevation, without running; one run with only elevation and one with only distance; imperial units | `20 m/km (partial)`; **Not measured**; **No running**; **Not measured**; feet and ft/mi | Unit tests |
| Elevation and heart rate stored in activity records | Returned through `charts.summary` | Integration test |
| Nights 60 days before the period, both measures on one night, a null value | Returned from 60 days before the period; one night per date; null skipped | Unit and integration tests |
| 3 then 4 nights in the last 7; 29 then 30 nights in the previous 60 | No average then the average; no usual range then the mean plus or minus 0.75 standard deviation | Unit tests |
| Resting heart rate marked as a daily minimum | **(daily minimum)** in the table and a count in the caption | Unit and browser tests |
| Custom dates, then a reversed range | Request for the covering whole weeks; then an error, no request and no chart | Browser tests |
| Period change | Only the chart is requested; no workspace reload and no save notice | Browser tests |
| Period change whose request fails, then **Try again** | Error and retry instead of the previous weeks; then the new weeks | Browser tests |
| A save holds the domain write lock | The chart still loads | Integration test |
| Keyboard on the chart | Arrow key shows the week's values in the tooltip | Browser tests |
| Desktop, Pixel 7 and 320px, both themes | No page-level horizontal scroll; the table scrolls inside its own region | Browser tests and screenshots |

## Observed implementation

The [manifest](../../plugins/charts/manifest.json) registers `/charts` and one server operation. [`summary`](../../plugins/charts/server.ts) validates the selection with the [public contract](../../packages/contracts/src/charts.ts), reads plans, workouts, events and the selected weeks' activities and the health records from 60 days before the period in one read-only repeatable-read transaction (one consistent snapshot, without the domain write lock that saves and imports take), and maps each week through [the shared weekly calculation](../../plugins/charts/summary.ts). It returns only weekly duration and elevation totals (overall and per chart sport, from the Calendar sport breakdown), the weekly running climb inputs (elevation and distance of the runs that have both, and how many runs there were), race dates and titles, for each recorded session of the period (activity or manual workout) its date, title, chart sport, average heart rate and duration, and the nightly resting heart rate and HRV from 60 days before the period (the usual range needs that history). The [page](../../plugins/charts/client.tsx) builds the week rows in [one place](../../plugins/charts/training-hours.ts) for the chart, the tooltip and the table, and loads the [chart](../../plugins/charts/training-hours-chart.tsx) and Recharts only when a template opens. [`useChartsSummary`](../../plugins/charts/use-charts-summary.ts) calls the operation directly rather than through the workspace save helper, and keys each result by its weeks and retry count. [Training by sport](../../plugins/charts/training-by-sport.ts) adds the sport split to those rows; both charts share the [weekly frame](../../plugins/charts/weekly-chart.tsx).

The UI package adds the shadcn `chart` component on Recharts 3.10.1. Its dark selector follows `data-theme`, like the rest of the [shared UI](shared-ui.md). Series colours are plugin tokens in [charts CSS](../../plugins/charts/charts.css): a neutral graphite for recorded hours (not a sport colour, since the bar sums every sport) and the Calendar event amber for races. Sport colours are fixed per sport and checked with the palette validator in both themes; in the light theme cycling and swimming sit below 3:1 against the surface, so the legend and table carry their values. Other uses the neutral muted colour.

Evidence: unit, integration and browser tests linked above.
Limits: the general `GET /api/workspace` keeps its 121-day limit. Accessibility checks are the keyboard and table browser tests; no automated axe scan runs, and text contrast inside the SVG is not measured automatically.

## Contracts and constraints

- Contract: [`charts.summary`](../../packages/contracts/src/operations.ts) input `{ weekStart, weeks }` (1 to 53) and output `{ weeks, races, sessions, nights }`; each week carries `recordedSecondsBySport` and `recordedElevationMetersBySport` for the six chart sports, and `runningClimb` (`sessionCount`, `measuredSessionCount`, `elevationMeters`, `distanceMeters`).
- Architecture: [plugin boundaries](../architecture.md); the plugin depends on the public training calculation and has no schema or migration.
- Rationale: [ADR 007](../decisions/007-shared-shadcn-ui.md) for shared shadcn components.
