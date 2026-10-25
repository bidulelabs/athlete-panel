# ADR 007: Own Radix-backed shadcn components in the shared UI package

## Record

Status: accepted
Recorded on: 2026-10-26
Status basis: the owner's explicit approval to implement the complete “Shorter week summaries and full shadcn UI migration” plan in this conversation, recorded in the [execution record](../plans/mvp-execution.md#shared-shadcn-ui-and-shorter-week-summaries). Approval covers the component choice and local app-wide migration, not production deployment.

## Context

The application had shared presentation helpers but hand-styled native controls and custom dialog/inspector lifecycle code. The approved week header needs both tooltip and touch-popover behavior. A common accessible interaction foundation must preserve the existing visual identity, training semantics and plugin ownership.

## Decision and rationale

Adopt Radix-backed shadcn component source in `packages/ui`, following the [official monorepo model](https://ui.shadcn.com/docs/monorepo). Generate from CLI 4.22.1 using `radix-nova`; pin direct runtime dependencies and pnpm resolutions. Export the source through the existing public UI package and retain compatibility wrappers for existing consumers.

Use the [Tooltip pattern](https://ui.shadcn.com/docs/components/radix/tooltip) with one provider and separate Popover interaction for click/tap. Dialog, AlertDialog and Sheet own modal interaction. Map their visual tokens through prefixed `--ui-` variables to the current graphite/light palette. Domain calendar, prescription and chart layouts remain owned by plugins.

The owner's requested library choice establishes agreement; accessibility and visual outcomes still require browser verification. Actual evidence is tracked separately from this decision.

## Consequences

- Expected benefits: consistent keyboard, focus, dismissal and component interfaces; locally editable source and no design-system runtime service.
- Costs and risks: more shared source and Radix dependencies to maintain; generated updates can conflict with local styling and wrappers. Review upgrades, retain version provenance, and verify nested overlays, native forms and both themes.
- Reconsider when: supported React/Tailwind versions diverge, component maintenance becomes disproportionate, or the application requires interaction primitives this source cannot support.

## Alternatives

Present-day assessment: retaining native dialogs and custom controls would require continuing separate focus/popover implementations. Replacing the application's visual language with an unrelated styled framework would conflict with the approved identity. Neither is selected for this migration.

## Relationships

- Requirements: [Shared interface](../features/shared-ui.md) and [training workspace](../features/training-workspace.md).
- Ownership: [Architecture](../architecture.md).
- Verification and implementation tracking: [Execution record](../plans/mvp-execution.md#shared-shadcn-ui-and-shorter-week-summaries).
