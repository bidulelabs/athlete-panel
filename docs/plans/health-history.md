# Health history implementation — issue #76

## Authority and scope

The owner requested implementation of [issue #76](https://github.com/bidulelabs/athlete-panel/issues/76) on 2026-11-02. Scope: trailing Health history, 7/30/90-day selection, independent Calendar navigation, bounded reads and synthetic verification. No production deployment or owner-data access is included.

## Implementation

- Health owns a transient review interval, initially the last 30 days ending in the athlete's local today. Presets retain the end date; previous/next move by the chosen period and stop at today. Leaving Health resets its selection on next visit.
- The plugin reuses the authenticated workspace read and public response schema. It aborts superseded reads and prevents old measurements from appearing under new dates. Loading, empty and retry states are explicit. The responsive chart keeps exact daily values in a native disclosure; Health bars update immediately when changing metrics, including unknown/zero values.
- Calendar, public DTOs, manifests, registry and migrations are unchanged. The extra bounded workspace read on Health entry avoids a new shared range contract or source-plugin dependency.
- The feature specification and architecture describe range ownership and reset behavior. No new shared visual convention is introduced. ADR assessment: this is a plugin-local UI policy using an existing read contract, not a new architectural boundary requiring an ADR.

## Verification results

Environment: Node 22.23.4, pnpm 11.28.8, macOS, isolated PostgreSQL 17 and loopback Chromium desktop/Pixel 7 previews. Only synthetic data was used. Repository, plugin and UI guidance were reviewed before editing.

| Check | Actual result |
| --- | --- |
| Disposable test database startup | Passed |
| Full repository check | Passed: formatting, lint (161 warnings, zero errors), generated-artifact freshness, browser/server import boundaries, both TypeScript configurations, 322 unit tests and documentation validation |
| Database integration suite | 230 tests passed across 17 files |
| Production web and worker build | Passed |
| Health browser scenarios | 8 passed across desktop and phone: both themes, 7/30/90 days, exact values/zero, empty periods, Calendar position, Back/Forward/reload reset, athlete timezone, failed reads/retry and overlapping requests |
| Existing planning/review/logging browser scenarios | 9 passed; 1 intentionally skipped desktop case reserved for phone layout. Covers paired themes, shared navigation/dialogs, workout inspection, compact Calendar, narrow/landscape layouts and future-workout logging |
| Visual inspection | Desktop/phone layouts inspected in both themes; compact controls, 30/90-day axis labels, daily-value disclosure and preserved Calendar/inspector layouts reviewed |
| Mechanical UI detector | No findings on the initial completed navigation/chart targets; later disclosure and rendering refinements inspected directly |

The first date-unit run exposed a missing Vitest alias for the public UI date helper; the test resolver now includes the UI source package. The first browser run exposed an ambiguous alert selector (Next also supplies a route announcer) and an intermittent animated phone-navigation click. The Health-specific error selector and keyboard navigation helper resolve those harness failures; subsequent Health runs passed. These adjustments do not change application navigation.

Canonical verification procedures remain in the development guide.

## Documentation validation

| Topic | Canonical document | Coverage completed | Remaining gaps |
| --- | --- | --- | --- |
| Health behavior | [Feature specification](../features/health-history.md) | Requirements, reset policy, date limits, failures, acceptance and implementation references | None in the requested local scope |
| Ownership and interfaces | [Architecture](../architecture.md) | Plugin-local dates and bounded existing read; no shared-contract change | No new ADR required |
| Discovery | [README](../../README.md#documentation) | Feature linked from documentation index | None |
| Verification versus rollout | This task record | Actual checks distinguished from deployment; local links/sections checked | Real-server deployment remains separate |

## Release status

Implementation is on branch `codex/health-history-range` and has been verified locally. No deployment, production database changes or real Garmin requests have been performed. Build/restart is required to activate the change; no migration is needed.

## Impeccable refinement — 2026-11-02

The owner requested a UI/UX refinement and questioned the standalone Ending field. Applied the Impeccable distill, clarify and polish guidance within the established notebook style.

- Removed the always-visible Ending input and the repeated range caption. Previous/next arrows now flank one clickable date range. A shared Popover exposes the native Jump to date field only when needed; Show period applies a complete date, and Escape preserves the current selection. Keyboard focus enters the field and returns to the range trigger after dismissal or application.
- Today appears only for an older range and returns focus to the range trigger when used. The presets and range fit one desktop row or two phone rows, including a 320px phone and ranges spanning two years. All history actions retain 44px hit areas.
- Removed the redundant page eyebrow, shortened the introduction, and stacked the header action below the title on the narrowest phones. Average sleep now reports recorded nights out of the selected total. The chart retains the missing-measurement explanation without repeating the dates.
- Changes remain local to the Health plugin; the feature specification records the revised controls. No shared design-system convention, stored behavior, public contract or composition change is introduced.

Actual follow-up verification:

| Check | Actual result |
| --- | --- |
| Full repository check | Passed, including 322 unit tests and documentation validation; lint reported 163 warnings and zero errors (two additional function-length warnings in the navigation and expanded browser scenario) |
| Database integration suite | 230 tests passed across 17 files |
| Production web and worker build | Passed after the final UI changes |
| Health and existing planning/review/logging browser scenarios | 17 passed; 1 intentionally skipped desktop case reserved for phone layout |
| Rendered review | Desktop, 900px intermediate, Pixel 7 and 320px phone; both themes; date picker, focus, two-year range, empty state, chart and existing planning/logging flows |
| Mechanical detector | No findings on the refined Health targets; subsequent sizing/focus adjustments checked in the rendered UI and browser assertions |

The first follow-up browser run exposed desktop arrow hit areas of 36px because shared icon sizing overrode the local rule. Scoped selectors now preserve 44px areas, and the final run passed. The 320px render also prompted a local header adjustment and slightly tighter preset padding so Today stays beside the presets. Deployment remains separate from this completed local refinement.

Final verification after test/documentation cleanup: `pnpm check` passed with 322 unit tests, and all 8 Health browser scenarios passed across desktop/phone and both themes. Application source is unchanged from the full integration/build verification above.
