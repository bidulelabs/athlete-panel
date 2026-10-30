# 014: Explicit local and remote backup modes

## Record

Status: accepted
Recorded on: 2026-10-30
Status basis: the owner explicitly requested updating PR 58 to make off-VPS storage optional, default new installations to local, preserve existing remote configurations and retain encryption/recovery checks. The request authorizes implementation, synthetic verification and the PR update, not production deployment or publication. No durable conversation URL is available; the [execution record](../plans/compose-adoption.md) records this scope.

## Context

Mandatory network storage prevents otherwise supported small installations from using the automated controller. Local encrypted recovery points can protect against failed upgrades but cannot establish recovery after losing the server. Treating an unavailable remote mount as local would falsely weaken an existing installation's protection.

## Decision and rationale

Persist `backupMode` in the installation record. New installations default to `local`, using a private directory owned by the controller account. Existing records without a mode remain `remote`. Adoption infers and previews the existing mode from its configuration and remote policy, with an optional CLI assertion; it changes no services or configuration. Missing remote policy/identity is a blocker, never a fallback signal. Reconciliation cannot change storage mode, destination or policy.

Use the existing backup tool, scheduler, encrypted archive format, retention, verification and recovery algorithm for both modes. Pass the explicit mode to backup/recovery containers. Remote mode keeps its version-1 mount/marker policy, including when running an older release. Older images can still create and restore authenticated local archives through their existing unregistered-storage path; the controller validates local storage, while those images retain their original UI wording. Current images validate local permissions and publish an explicit local verification status.

Full pre-upgrade restore rehearsal, the final drained snapshot, authenticated restoration into a new database and separately recoverable keys remain mandatory. Status must distinguish a verified local archive from off-server protection. No new scheduler, remote-copy mechanism or mode-conversion command is introduced.

## Consequences

- Expected benefit: installation and adoption can use encrypted local backups without provisioning network storage.
- Costs and risks: local archives share the VPS failure domain; independent archive and key copies remain necessary for server-loss recovery. A same-server restore test cannot prove that recovery. Older image UIs retain less specific protection wording.
- Reconsider when: an operator requests a reviewed storage-conversion workflow or a supported off-server-copy backend.

## Relationships

- Extends: [Deployment and recovery](012-deployment-recovery.md); its full verification sequence is unchanged.
- Supersedes the remote-only adoption storage prerequisite in [Compose adoption and image identity](013-compose-adoption-and-image-identity.md); its other decisions remain in force.
- Related requirements: [Hosted operations](../features/hosted-operations.md).
- Evidence and limitations: [Execution record](../plans/compose-adoption.md).
