# Feature: Source plugins and external-agent development

## Purpose and scope

The owner extends their private Athlete Panel instance with trusted local source plugins. Installed features run without an agent or model service. The host supplies infrastructure and public extension points; athlete features and personal dashboards are composed through plugin manifests.

Outside scope: public marketplaces, arbitrary remote-code installation, runtime hot loading, process isolation, third-party sports providers, a built-in AI harness and embedded model orchestration.

## Intended behavior

Specification status: approved scope for a source-composed MVP, based on the owner's implementation instruction recorded in the [execution record](../plans/mvp-execution.md#authority-and-scope). The typed manifest/registry and adapter generation are implementation choices for that scope.

Each plugin declares identity, version, host API compatibility, required/optional dependencies, routes, client/server entry points, services, jobs, configuration, and owned schema/migrations when needed. A single instance composition pins local source paths and exact versions. The registry validates the complete composition before importing enabled entry points. Plugin pages consume public DTOs and UI primitives; ordinary extensions do not patch host internals or query other plugins' tables.

A new or changed plugin requires a build and restart. Disable stops feature routes and future work while retaining stored data. Foundations cannot be disabled while required by the instance; dependent plugins must stay compatible. Removing plugin source/composition is distinct from deleting its data. A manifest capability is a declaration for review, not an enforced sandbox: trusted in-process code has the process's effective authority.

Personal plugins live outside upstream-owned feature directories and remain pinned during core upgrades. Upgrades check contracts/dependencies, migrations and tests before activation. Removing runtime code/composition must preserve every applied migration file at its recorded path with version provenance; immutable migration artifacts are required for matched backup and future verification. Code rollback is safe only against a compatible schema; otherwise restore the matching pre-upgrade backup. The [development guide](../development.md) owns those procedures.

## Acceptance scenarios

| Situation | Expected observable result | Verification |
| --- | --- | --- |
| Plugins arrive in arbitrary manifest order | Dependencies precede their consumers | [SDK tests](../../tests/unit/plugins.test.ts) |
| Missing/disabled/incompatible dependency, cycle or duplicate route/ID | Composition rejected before enabled source evaluation | SDK tests |
| Required foundation is disabled | Validation rejects the composition | SDK tests |
| Optional plugin is absent | Consumer can load without it; enabled incompatible version is rejected | SDK tests |
| Agent scaffolds a personal feature | New valid plugin-local files; existing composition untouched; no overwrite | Scaffolder test |
| Canonical skill changes | Generated Claude adapter check reports drift until regenerated | Adapter test |
| Existing non-generated Claude skill conflicts | Synchronization refuses overwrite | Adapter test |
| Cycling/sleep plugin is enabled | Its registered page reads shared activity/health data and survives harness exit | [Example manifest](../../personal-plugins/cycling-sleep/manifest.json), browser release check |
| Plugin is disabled or an upgrade fails | Data remains recoverable; incompatible source/schema combination is not served | Host lifecycle/operations release checks |

## Observed implementation

Implemented public metadata validation is in [the plugin SDK](../../packages/plugin-sdk/src/index.ts). [Registry generation](../../scripts/registry.ts) composes the pinned [instance manifest](../../instance/composition.json) into separate client, server and metadata outputs. The plugin development [scaffolder](../../scripts/scaffold-plugin.ts) creates a read-only personal page and manifest without activating it. The initial template depends on `activity-records` and displays recorded cycling totals for the workspace's current date window; developers should change the dependency and behavior to match the requested feature.

Canonical repository skills cover [application plugin development](../../.agents/skills/athlete-panel-plugin-development/SKILL.md), [bounded training proposals](../../.agents/skills/athlete-panel-training-planning/SKILL.md), and the companion [coaching clarification workflow](../../.agents/skills/athlete-panel-training-coaching/SKILL.md). Training planning loads coaching guidance when creating programs or adapting workouts. [Adapter synchronization](../../scripts/sync-skills.ts) generates `.claude/skills/<name>/SKILL.md` from `.agents/skills/<name>/SKILL.md`, retains valid discovery frontmatter, and refuses to overwrite unrelated user-authored skills. Generated copies are not a second authority. Other harnesses can read the canonical skill directly; discovery compatibility must be checked for the particular installed harness.

Tests use synthetic manifests and temporary directories. They establish validation/tool behavior, not successful deployment, arbitrary plugin safety or tested compatibility with every external harness. The example page is a persistent app feature; no live model integration is required.

## Contracts and constraints

HTTP operations resolve only explicitly registered plugin entries and own, callable operation properties. Unknown, inherited and non-callable operations return a structured `404`; authentication, origin and enabled-plugin checks still apply. Missing worker handlers retain their explicit permanent-failure behavior.

Worker jobs retain checkpoints and retry deadlines across disable/re-enable; only one retained job per plugin/kind is activated behind any existing live job. Explicit pauses remain paused. Expired leases and unexpected handler failures count toward eight consecutive failures per checkpoint, with bounded exponential backoff; only committed progress resets the count. Failed jobs require explicit retry. Host API 1.2 adds generic job priority; each plugin owns its priority policy. Scheduler failures are isolated and reported as degraded worker status without preventing other schedulers or job claims. All settlements preserve lease fencing.

Optional `slots` metadata declares calendar, inspector, dashboard and authenticated workspace contributions. Workspace contributions mount once inside the workspace context outside the current page; they can render an owner dialog without a feature import in the shell. The client exports a `contributions` map keyed by slot ID; each component receives public workspace props and an optional selected entity. Generated registration and the generic `ExtensionSlot` renderer require no feature import in the host shell.

Uninstall removes executable/client source and composition entries while retaining the manifest/version record and applied migration files. Purging retained data is a separate owner operation requiring cross-schema reference checks and a verified backup; disabling a plugin never purges its data.

- Metadata authority: [SDK manifest schema and composition validation](../../packages/plugin-sdk/src/index.ts).
- Workspace/onboarding responses and bundled operation inputs/results are runtime-validated DTOs; arbitrary extension results remain `unknown` until validated. Data authority: [versioned shared runtime schemas/types](../../packages/contracts/src/index.ts). Never expose ORM tables as the extension contract.
- UI authority: [public UI exports](../../packages/ui/src/index.ts), including `PluginPageProps` with typed workspace data, refresh and authenticated plugin operation requests.
- Composition authority: `instance/composition.json` plus each plugin's `manifest.json`. Generated registry files are derived and must not be edited directly.
- Skill authority: `.agents/skills/`; generated Claude copies are checked for drift.

The integration owner coordinates SDK changes, shared DTO exports, migration ordering, registry generation and schema ownership. Individual plugin owners own their feature semantics, isolated source/tests, manifest and migration declarations. An ordinary read-only dashboard needs no migration and should not gain a backend capability merely because the template supports server entry points. Server/client boundaries must keep secrets out of browser imports. Host API 1.1 adds public-entry and onboarding-contribution metadata. Consumers of these new interfaces require provider 1.1; compatible 1.0 manifests remain accepted, including the bundled read-only examples. Manifest `public` entries name shared, client and server APIs; direct cross-plugin imports require a compatible mandatory dependency, including type-only imports. Shared/client graphs must remain browser-safe. Optional Garmin onboarding uses a typed `onboarding` contribution, omitted from disabled compositions; its busy callbacks preserve the setup flow. See [boundary decision](../decisions/008-public-plugin-boundaries.md).

## Development flow and release details

The owner describes a feature to their coding agent in a local checkout. The agent reads the skill, scaffolds or edits a plugin, uses public contracts and synthetic data, verifies a responsive preview and reports concrete files/checks. Activation is a separate instance composition/build/restart action under the owner's deployment authorization. A running feature is then independent of the harness.

Training proposals use the separate scoped CLI/API workflow: an agent can read permitted context and submit pending changes, while the owner reviews/applies the exact validated proposal in the app. Source-code access does not grant production database access or broaden the training grant.

Commands, prerequisites, preview and activation/rollback procedures are canonical in [development](../development.md). Documentation updates follow the [feature template](../templates/Feature-Template.md); code/behavior/deployment evidence must remain distinct.
