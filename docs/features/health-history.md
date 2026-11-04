# Feature: Health history navigation

For availability in your installed version, see the [changelog](../changelog.md).

## Purpose and scope

Review recorded sleep and daily health measurements over a recent historical period. Health owns its review dates independently of Calendar's forward planning position.

Outside scope: changing Garmin imports, estimating missing measurements, changing Activities navigation, new health scores or stored preferences.

## Intended behavior

Specification status: approved scope. Requirement source: [issue #76](https://github.com/bidulelabs/athlete-panel/issues/76) and the owner's 2026-11-02 instructions to implement it and simplify the interface with Impeccable, including reconsidering the standalone Ending field.

- A fresh Health visit shows the last 30 calendar days, including today in the athlete's configured timezone. November 2, 2026 therefore shows October 4–November 2. Week-start preferences do not align or shift this range.
- The owner can select 7, 30 or 90 days. The chart, summaries and range labels use the same inclusive interval, and each read is bounded to that interval.
- Previous/next period controls flank one visible date range. Selecting that range opens an optional Jump to date picker; Show period applies the date, while Escape dismisses an unfinished selection. Today appears only when reviewing an older interval. These controls never change Calendar's selected planning position.
- The default toolbar has one row on desktop and two on phones; no standalone Ending field or repeated date-range caption is needed. The sleep average states how many of the selected nights were recorded.
- Missing measurements stay unknown; measured zero stays zero. Empty periods explain the selected dates rather than implying that no history exists anywhere.
- Failed reads are retryable; pending, failed or superseded reads must not display measurements from a different period under the selected dates.

Implementation choices within this scope: range and metric selection are page-local, held only while Health is mounted. Leaving and reopening Health, including browser Back/Forward and reload, starts a fresh 30-day review; Calendar retains its existing session behavior. Presets retain the selected end date. Previous/next move by the selected number of calendar days; forward navigation stops at today. The end-date picker rejects future dates, so future days cannot be mistaken for missing past measurements. The earliest end date is March 31, year 1, allowing every preset to fit the existing date contract. These are navigation rules, not persisted settings.

## Acceptance scenarios

| Situation or input | Expected observable result | Verification |
| --- | --- | --- |
| Fresh visit on November 2, 2026 | October 4–November 2; 30 chart dates; summaries use those records | [Browser checks](../../tests/e2e/health-history.spec.ts) |
| Select 7/30/90 days or another end date | Data request, chart, average and range label refer to the selected interval | Browser checks; [date checks](../../tests/unit/health-history.test.ts) |
| Open the range picker using the keyboard | Focus enters the date field; future dates cannot be applied; Escape leaves the current range unchanged and returns focus to the trigger | Browser checks |
| Browser and athlete dates differ; Sunday/Monday preference | Athlete-local today controls the interval; week preference has no effect | Browser and date checks |
| Leap day, DST, year boundaries and earliest supported date | Inclusive floating-date arithmetic produces the correct number of days | Date checks |
| Change Health dates after selecting a future Calendar week | Returning to Calendar retains that planning position; reentering Health resets to 30 days | Browser checks |
| Missing measurements, known zero or an empty period | Unknown values remain unknown, zero remains measured, empty state describes these dates | Browser checks |
| Failed or overlapping requests | Old values disappear, failure offers retry, newest selected interval wins | Browser checks |
| Desktop/phone, light/dark | Reachable 44px controls, no page overflow, legible chart dates at every preset | Browser checks and rendered inspection |

## Observed implementation

[HealthPage](../../plugins/health/client.tsx) owns local range selection and continues to calculate summaries from normalized health records. [Date helpers](../../plugins/health/history-range.ts) and [navigation](../../plugins/health/history-navigation.tsx) implement the inclusive history intervals. [The read hook](../../plugins/health/use-history.ts) reuses the existing authenticated workspace endpoint, validates its response with the public envelope schema, retains only health records inside the selected dates and aborts obsolete requests. Data renders only when its request dates match the current selection. A 15-second timeout offers retry; an expired session returns to sign-in.

Health performs its own bounded read after the shell has loaded the owner profile. This adds a workspace request on entry, using the existing response shape; it introduces no endpoint, plugin operation, permission, manifest, migration or SDK change. Calendar's shared range and workspace data remain untouched. The chart uses existing shared bars with plugin-local spacing and fewer visible axis labels for 30/90-day ranges; its accessible description contains every date and value. A keyboard-accessible Daily measurements disclosure retains exact values and missing-day labels in newest-first order without crowding the chart.

Evidence: the linked source and synthetic tests. Individual results and deployment limits are recorded in the [task record](../plans/health-history.md); test presence alone does not establish successful execution.

## Contracts and constraints

The [existing workspace endpoint](../../apps/web/app/api/workspace/route.ts) requires the owner session and validates floating dates and the maximum read span. The largest Health preset is 90 days. [Activity Records](../../instance/services.ts) still owns bounded health storage reads; the [public health schema](../../packages/contracts/src/domain.ts) remains unchanged. No provider request or data mutation is triggered by navigation.

## Verification and release details

Follow [development and verification](../development.md#verification). Rebuild/restart activates this client change; no migration or stored-data conversion is required. Rollback uses the previous code. Deployment is separate from local verification.
