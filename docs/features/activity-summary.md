# Feature: Activity summary coverage

## Purpose and scope

Show recorded activity duration and distance without presenting incomplete measurements as complete totals. Coverage describes the measurements in the current selection, not Garmin import progress.

Outside scope: changing import semantics, estimating missing measurements, modifying stored activities or adding new filters.

## Intended behavior

Specification status: approved scope. Requirement source: [issue #75](https://github.com/bidulelabs/athlete-panel/issues/75) and the owner's request to implement it on 2026-11-02.

- Sum known duration and distance independently, using exactly the activities displayed by the active date, sport, subgroup and title-search filters.
- When some measurements are missing, label the known sum as partial and show the missing-activity count for that metric.
- Preserve measured zero as a known measurement. Never replace unknown values with zero or estimates.
- Distinguish fully measured, all-unknown and empty selections. Coverage must stay legible on desktop and phones in both themes and both unit systems.

Presentation choices: the headings are **Recorded time** and **Recorded distance**. A mixed selection shows the sum with **Partial · N activities missing duration/distance**. An all-unknown metric shows a dash with its missing count. A fully measured metric shows its value and recorded-activity count. An empty selection shows zero imported sessions, **No activities in this selection**, and dashes for the two measurements. Singular counts use **activity**. The existing empty list and filters remain available.

The Activities page uses the shared heading without an eyebrow, readable coverage text with **Partial** emphasized, and a compact session count on phones. Search and sport/subgroup controls stay together. **Clear filters** resets search, sport and subgroup while preserving the selected date range; it is also available in the filtered empty state. Desktop activities use a semantic table. Narrow layouts show each activity's title, sport, date, labeled measurements, linking status and a 44px **View** action without horizontal scrolling. Missing row measurements say **Not recorded**; known zero retains its formatted value. View buttons name their activity for assistive technology and retain the existing detail dialog and focus restoration.

## Acceptance scenarios

| Situation | Expected observable result | Verification |
| --- | --- | --- |
| Two valid Garmin activities: one has 5,400 seconds and 42,000 metres; the other omits both | 1h 30m and 42.0 km (26.1 mi), each partial with one missing activity | [Normalization and calculation tests](../../tests/unit/activity-summary.test.ts); [browser tests](../../tests/e2e/activity-summary.spec.ts) |
| Duration and distance have different gaps | Each value has its own recorded/missing count | Calculation and browser tests |
| Known zero with a missing neighbour | Zero remains a measured contribution; the missing neighbour keeps the metric partial | Calculation and browser tests |
| All measurements unknown | Dash and missing count, never a measured zero | Calculation and browser tests |
| Empty or fully measured selection | Empty state with no invented measurement, or complete sum with recorded count | Calculation and browser tests |
| Change dates, sport, subgroup or search | Counts and sums update from the same filtered activities, excluding records outside either date boundary | Browser tests |
| Desktop/phone, light/dark, metric/imperial | Visible coverage, correct units and no horizontal overflow, including 320px phones | Browser tests and rendered inspection |
| Narrow activity list with long titles and missing values | Measurements and the View action remain reachable without sideways scrolling; keyboard inspection restores focus when closed | Browser tests and rendered inspection |
| Filtered empty selection | Clear filters restores all sports and title matches without changing dates | Browser tests |

## Observed implementation

[ActivitiesPage](../../plugins/activity-records/client.tsx) passes its existing filtered list to the plugin-local [metric summary](../../plugins/activity-records/summary.ts). The helper returns the known sum (or null), known count and missing count independently for each metric. Existing shared formatters and `Stat` hints render the result. [Plugin-local styles](../../plugins/activity-records/client.css) let the explanation wrap, give the two measurements a shared row on phones and reflow the activity table at narrow widths.

No host, shared contract, registry, migration, storage or provider change is introduced. Existing authenticated workspace reads, activity rows, detail dialogs and explicit workout-linking actions retain their behavior. Summarizing and filtering perform no mutation or new request.

## Verification and release details

Use the [development verification workflow](../development.md#verification) with synthetic records. Actual results and deployment limits are recorded in the [task record](../plans/activity-summary.md). Tests establish presentation and synthetic normalization behavior, not the frequency of missing data in real Garmin accounts.

Rebuild/restart activates the client change; no migration is required. Rollback uses the previous code. No instance composition change is needed.
