# Feature: Shared shadcn interface

## Purpose and scope

Give the private application consistent, accessible controls while retaining its compact training notebook identity. This covers login, navigation, onboarding, all bundled plugin pages and editors, and the cycling/sleep extension. Orange accents, graphite/light themes, native date entry, compact desktop calendar and phone session lists remain.

Backend APIs, training rules, stored preferences, public training DTOs and database migrations are outside this change.

## Intended behavior

Specification status: approved.
Requirement source: the owner's 2026-10-26 instruction, “PLEASE IMPLEMENT THIS PLAN: Shorter week summaries and full shadcn UI migration,” including app-wide migration and the verification matrix. The approval is recorded in the [execution record](../plans/mvp-execution.md#shared-shadcn-ui-and-shorter-week-summaries); no durable conversation URL is available.

Radix-backed shadcn source belongs in `packages/ui`, exported through `@athlete-panel/ui`. Plugins compose it with domain layouts and retain training logic. Existing `Modal`, `Field`, `AddButton` and `SubmitButton` imports remain compatible. The app supplies one tooltip/confirmation provider. Semantic UI tokens use a `--ui-` prefix and map to the existing `data-theme` palette without redefining the domain accent or muted tokens.

Controls retain labels, validation, native form submission and pending/error states. Native Select and date inputs retain native behavior. Dialogs and mobile Sheets provide accessible titles, modal focus containment, one-layer Escape dismissal, outside dismissal where permitted, scroll locking and return focus. Onboarding can specify its step heading as the initial focus target. Destructive confirmations use AlertDialog and require an explicit action.

The workout inspector stays alongside the calendar above 1050px and becomes a Sheet at or below that width. Editor components live above the responsive panel mounting boundary. Mode changes wait while an editor is open, preserving draft, stale-save recovery and pending saves. Phone navigation uses a Sheet with a visible close action and returns focus to its opener.

The weekly summary's two independent disclosures and factual metrics are specified in [training workspace](training-workspace.md#richer-weekly-summaries).

## Acceptance scenarios

| Situation or input | Expected observable result | Verification approach or reference |
| --- | --- | --- |
| Any app page in either theme | Shared controls retain labels/actions and the existing palette; no horizontal page overflow | [Shared UI browser coverage](../../tests/e2e/shared-ui.spec.ts) and representative screenshots |
| Open dialog, nested editor or confirmation | Correct focus entry/return; Escape closes one layer; background cannot receive modal focus | [Inspector tests](../../tests/e2e/workout-inspector.spec.ts), shared UI and onboarding suites |
| Resize with a draft editor open | Draft remains; inspector mode changes after closing the editor | Inspector browser test |
| Failed or stale save | Draft remains recoverable; no duplicate mutation or overwrite | [Conflict tests](../../tests/e2e/edit-conflicts.spec.ts), calendar-card and workspace suites |
| Metric hover/focus/tap | Explanation appears independently; Escape/outside dismissal works; no training write | [Weekly tests](../../tests/e2e/weekly-summary.spec.ts) |
| 320, 390, 768, 1060, 1280, 1440px | All five metrics remain available; complete groups wrap; values remain readable | Weekly theme/width matrix including imperial values and open inspector |
| Agent proposal and Garmin forms | Scope acknowledgement, review, validation and fixture behavior remain intact | Existing full browser suite against isolated synthetic storage |

## Observed implementation

Source was generated with shadcn CLI **4.22.1**, `radix-nova`, then adapted in [shared component source](../../packages/ui/src/components), [theme mapping](../../packages/ui/src/styles/shadcn.css) and [compatibility wrappers](../../packages/ui/src/primitives.tsx). [Web configuration](../../apps/web/components.json), [UI configuration](../../packages/ui/components.json) and package exports establish monorepo ownership. Package versions and their transitive resolutions are recorded in the pnpm lockfile.

The [provider](../../packages/ui/src/provider.tsx) supplies tooltip timing and owner confirmation. Feature calculations and backend operations remain in their original plugins. Individual actual checks, screenshot review and release limits are maintained in the execution record; source inspection alone is not runtime evidence.

## Contracts and constraints

This extends the shared React component interface, without changing the runtime training contract or database schema. The [architecture](../architecture.md) defines ownership and [ADR 007](../decisions/007-shared-shadcn-ui.md) records the component-library choice. Generated UI source is locally maintained and updates require review rather than wholesale overwrite.

## Verification and release details

Follow [development and verification](../development.md). Rollback uses the preceding code and matching lockfile, followed by rebuild/restart; no database rollback is required for this UI migration. Deployment to a real private server remains separate from local verification.

Release images and matched-source backups include PRODUCT.md, DESIGN.md and the durable `.impeccable/design.json` sidecar. Local design-tool configuration is excluded from that explicit source allowlist.
