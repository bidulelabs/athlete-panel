# Feature: Guided local setup and startup

## Purpose and scope

Make a fresh local Athlete Panel installation usable with one chosen login password. Generate technical credentials, initialize PostgreSQL and run web/worker without manual environment loading or multiple terminals.

Outside scope: installing Node/pnpm/Docker, public-server provisioning, unattended application upgrades, password resets, data deletion, Garmin key entry and off-host backup configuration. After sign-in, the separate [authenticated welcome flow](first-time-onboarding.md) confirms preferences and optionally connects Garmin.

## Intended behavior

Specification status: approved. The owner explicitly requested implementation of the proposed `pnpm run setup` and `pnpm run local` flow on 2026-10-25 in this conversation; no durable conversation link is available. The owner subsequently requested visible password entry in setup on the same date, superseding the original hidden-input behavior. The implementation details below preserve the agreed existing-data and credential boundaries.

Setup validates prerequisites, generates independent administrator/runtime database passwords and an encryption key, constructs consistent loopback URLs, and saves a private Git-ignored configuration. Only the login password and its confirmation are requested. Both password entries are visible while typing and remain in terminal scrollback. The password is never included in arguments or configuration and is hashed through the existing owner service. The optional stdin workflow does not echo its input. Generated secrets are not printed.

Valid configuration and existing owner accounts are preserved. Interrupted fresh initialization is resumable. A database with an owner is verified without applying migrations or resetting credentials. Missing configuration with existing local storage, incompatible schema, unrecognized storage, or invalid configuration produces guidance instead of replacement/deletion. Console recovery and coordinated upgrades remain separate operations.

Local startup loads configuration automatically, ensures PostgreSQL is running, verifies the owner/schema/runtime role, and starts web/worker together. Runtime processes receive neither administrator credentials nor inherited test flags. Ctrl+C or a child failure stops both process groups; PostgreSQL and its data remain. Existing ports are not silently reassigned. To resolve the owner-reported localhost login failure, local HTTP accepts the `localhost` and `127.0.0.1` names on the configured port when secure cookies and trusted proxy mode are disabled. Hosted/HTTPS instances retain exact origin checks; missing, malformed, foreign-host and different-port origins remain rejected. Cookies remain scoped to the hostname used for login.

## Acceptance scenarios

| Situation | Expected observable result | Verification |
| --- | --- | --- |
| Fresh checkout | Independent generated secrets, private `.env`, initialized database, visible password and confirmation prompts, successful login | Configuration tests and isolated local rehearsal |
| Login via localhost or 127.0.0.1 | Both work on the configured local HTTP port; foreign origins still fail, and hosted checks stay exact | Origin unit tests and isolated local rehearsal |
| Interrupted password entry | Existing generated secrets reused; prompt resumes without replacing data | Isolated local rehearsal |
| Repeated setup | Existing password/hash and records unchanged; no new migrations | Isolated local rehearsal |
| `.env` absent with retained data | Clear recovery message; no replacement file or storage deletion | Isolated local rehearsal |
| Invalid/exposed/symlink configuration | Failure without printing secrets or replacing bytes | Unit tests |
| New application schema against existing owner | Refusal and upgrade guidance; no migration performed | Isolated local rehearsal |
| Port occupied or prerequisite unavailable | Actionable error before launching conflicting services | Unit tests and guarded prerequisite commands |
| Worker or web exits | Remaining process group stopped; launcher reports failure | Process lifecycle tests |
| Ctrl+C then restart | Web/worker descendants stop, database survives, saved workout persists | Process tests and isolated local rehearsal |

## Observed implementation

The [setup entry point](../../scripts/setup.ts) and [local launcher](../../scripts/local.ts) share protected configuration, command execution and database checks under `scripts/lib/`. Configuration is parsed as data, created exclusively/atomically, and never sourced as shell code. A checkout lock and setup database advisory lock serialize initialization. Existing host migration and owner-bootstrap services remain authoritative; no database migration or feature permission change is added.

Local startup uses the Next development server and a separate TypeScript worker. It is a checkout workflow, not the production container launcher. macOS/Linux are supported; Windows requires WSL2. Generated `.env` permissions restrict local filesystem access but do not encrypt the file. The same OS account and trusted source code still have access to it.

Evidence: [unit checks](../../tests/unit/local-setup.test.ts), [local rehearsal](../../scripts/rehearse-local.py), and the [execution record](../plans/mvp-execution.md). Individual results belong in the execution record. This workflow does not verify real Garmin data, public HTTPS or off-host recovery.

## Contracts and constraints

Local configuration uses `ATHLETE_PANEL_` for application-specific settings, the `athlete-panel-local` Compose project (or an explicitly selected suffix), database/admin identity `athlete_panel` and runtime role `athlete_panel_app`. Configuration validation rejects mismatched database identities without replacing credentials or storage.

The [development guide](../development.md#local-development) owns command syntax, prerequisites, supported local configuration and troubleshooting. The [runtime-access decision](../decisions/005-runtime-access.md) continues to require separate runtime and administrative privileges. Source/configuration and its encryption key must remain separately recoverable.

## Explicit maintenance and hosted configuration

Authority: on 2026-10-25 the owner requested implementation of the five priority audit fixes, documentation and isolated tests, without changing the running instance. No deployment is authorized by that request.

`configure:hosted` generates independent database/application secrets and a separate backup key for a fresh installation. It validates domain/release/destination, refuses an existing `.env`, rejects unsafe secret paths and preserves a safe key after interruption. It creates no database or services. The owner still selects DNS, off-host storage and the login password.

`local:ops` loads the existing private local configuration for maintenance, verified backups and explicit migrations. Active launcher/port checks prevent updating a running local server. Migrations require maintenance mode and an authenticated archive matching the installed migration journal; successful migration leaves maintenance enabled. It preserves owner credentials and performs no automatic source update. The development guide owns the exact update/recovery sequence. Recovery uses the existing authenticated restore service; a backup alone does not recover a missing application key.

Acceptance: hosted generation never overwrites credentials or prints keys; invalid/symlink paths fail; local migration refuses a running app, missing maintenance, a wrong key or mismatched archive; an explicit forward migration preserves owner data and leaves writes closed. Unit tests, the local rehearsal and operations tests provide isolated evidence; actual off-host durability remains an operator check.
