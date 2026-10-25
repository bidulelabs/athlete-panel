# Working in Athlete Panel

Read [the development guide](docs/development.md), [architecture](docs/architecture.md), and the relevant [feature specification](README.md) before changing behavior. Use pnpm. This is the new single-athlete private application; never modify the legacy checkout.

Use the canonical [plugin-development skill](.agents/skills/athlete-panel-plugin-development/SKILL.md) for extensions and [training-planning skill](.agents/skills/athlete-panel-training-planning/SKILL.md) for scoped proposals. Training planning uses the [training-coaching skill](.agents/skills/athlete-panel-training-coaching/SKILL.md) to clarify material gaps before creating programs or adapting workouts. Claude adapters are generated from those sources.

For UI work, read [product context](PRODUCT.md) and the [design system](DESIGN.md). Keep feature specifications authoritative for behavior; update the design record when shared visual conventions change. Verify the desktop planning and phone review/logging paths in both themes using synthetic data.

## Boundaries

- Preserve the framework guides, templates and design references.
- Feature code belongs in plugins. Public runtime schemas/types belong in `packages/contracts`; host services contain no training rules. Plugins are trusted code, not sandboxes.
- Keep client entry points free of server imports/secrets. Use domain services for training edits; no agent SQL workflow.
- Garmin is Personal API import only. Use synthetic fixtures for routine tests; never production credentials/data by default.
- Coordinate changes to manifests, contracts, registry and migrations with the integration owner. Do not rewrite applied migrations.

## Documentation and verification

- Create/update a feature spec for a new capability or changed persisted behavior, permission or public contract, following [the feature template](docs/templates/Feature-Template.md).
- Update architecture when ownership or interactions change. Record consequential decisions with [the ADR template](docs/templates/ADR-Template.md); acceptance requires evidence.
- Keep commands canonical in the development guide. Keep progress and individual results in the execution/task record.
- Run relevant type/build/domain/integration/browser checks. Distinguish implementation, actual verification and deployment. Apply [framework validation](docs/Framework-Guide.md#validation) to affected docs.
- Continue authorized implementation and reversible local verification. Deployment to a real private server, destructive data operations and external communications need authorization for that action.
