# Activity summary coverage — issue #75

## Scope and implementation

The owner requested [issue #75](https://github.com/bidulelabs/athlete-panel/issues/75) on a new branch on 2026-11-02. Branch `codex/activity-total-coverage` starts from main at `fdf8845`, independently of the Health history branch.

The Activities summary reports known duration/distance with independent coverage from the existing filtered list. Partial, all-unknown, fully measured, empty and measured-zero states remain distinct. Plugin-local styling preserves readable supporting text on phones. Source ownership, public contracts, stored data, permissions and imports are unchanged; no ADR, composition or shared design-system change is required.

## Verification

Environment: Node 22.23.4, pnpm 11.28.8, macOS, isolated PostgreSQL 17 and Chromium desktop/Pixel 7. All fixtures are synthetic.

| Check | Actual result |
| --- | --- |
| Full repository check | Passed: format, lint (162 warnings, zero errors), generated-artifact freshness, import boundaries, both TypeScript configurations, 321 unit tests and documentation validation |
| Database integration suite | 230 tests passed across 17 files |
| Production build | Web and worker passed |
| Activity coverage browser checks | 8 passed: metric/imperial, both themes, desktop/phone, independent missing counts, known zero, empty/unknown/complete selections, date/sport/subgroup/search filters, no mutations, 320px/900px layouts |
| Existing shared UI, desktop planning and phone review/logging | 6 browser checks passed, including paired themes, compact Calendar and future-workout completion controls |
| Rendered inspection | Partial totals reviewed on desktop and phones in light/dark, including 320px; visible coverage text and no page overflow |

The first browser attempt rejected the new fixture because two required nullable fields were omitted. The fixture now supplies null elevation and average heart rate; all subsequent browser checks passed. No production data or provider access was involved.

## Documentation coverage

| Topic | Canonical document | Coverage | Remaining gaps |
| --- | --- | --- | --- |
| Selection totals and missingness | [Activity summary](../features/activity-summary.md) | Requirement source, states, filters, units, acceptance scenarios and passing verification | None in the requested scope |
| Ownership and activation | Feature specification; existing [architecture](../architecture.md) | Plugin-local calculation, unchanged contracts and no migration | No deployment performed |
| Discovery | [README](../../README.md#documentation) | Specification linked | None |

## Release status

Implementation is on branch `codex/activity-total-coverage` and has been verified locally. No production data, Garmin credentials or real provider requests were used. Activation requires build/restart; rollback uses the previous code. No deployment was performed.
