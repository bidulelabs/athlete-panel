# Feature: Guided VPS operations

## Purpose and scope

Give a single owner a predictable installation, update and recovery workflow without host Node/pnpm, manual database URLs or knowledge of migration commands. Reuse Docker Compose, private PostgreSQL, Caddy and existing backup/domain protections.

Outside scope: provisioning a VPS/DNS/remote storage, publishing images, unattended upgrades, automatic deletion of old data, PostgreSQL major-version upgrades, and automatic adoption of existing local/manual deployments.

## Intended behavior

Specification status: approved within the request's scope.
Requirement source: the owner requested implementation of the five VPS installation/upgrade/backup/recovery improvements on 2026-10-25, including documentation and isolated tests, without publication or changes to the running instance. The owner subsequently requested image-based installation/upgrades with migrations, backups, recovery and custom plugins preserved. No durable conversation link is available; the [execution record](../plans/mvp-execution.md) preserves that statement.

- Installation generates separate technical secrets, prompts for the owner password, starts the production topology and verifies TLS, worker readiness and a backup. Existing credentials/data are preserved.
- Operator state stays private and outside source. Commands use a lock and durable checkpoints, not an always-running privileged updater. Image pulls/builds, plugin-preservation checks and retained-migration validation precede maintenance. A source-free release bundle pins a registry digest; source/local images remain supported for custom code.
- Upgrade pauses writes, verifies a fresh installed-release recovery point, stops processes, runs candidate migrations/permissions and verifies the candidate before reopening. A failed phase remains visible and resumable. SQL rollback and post-commit permission failures have distinct messages.
- Backups authenticate a read-back before becoming completed archives. Managed storage requires the expected network filesystem and identity marker; a missing mount cannot silently become a local directory. Off-host recovery is not claimed merely from an archive or marker.
- Recovery authenticates before changing the target, restores into a new database and source directory, selects the matching image or explicitly rebuilds authenticated source, restores grants and checks the restored application. The prior database is retained. Lost-server recovery uses separately recovered operator keys/state and the remote archive.
- Resuming does not replay committed migrations or reset an existing owner. Ambiguous interrupted restore targets remain preserved and require a new recovery attempt rather than destructive guessing.

## Acceptance scenarios

| Situation or input | Expected observable result | Verification |
| --- | --- | --- |
| Fresh install with a registered destination | Generated private configuration, HTTPS login, persisted record, verified backup | [Hosted rehearsal](../../scripts/rehearse-hosted.py) |
| Repeated installation or interrupted owner creation | No secret rotation/account reset; resume existing state | Hosted rehearsal; [controller checks](../../tests/security/test_hosted.py) |
| Missing remote mount/marker | Fail before archive creation; previous successful backup retained | [Storage checks](../../tests/unit/backup-storage.test.ts); hosted rehearsal |
| New declared migration | Existing data retained, new schema usable, old artifact rejected | Hosted rehearsal; [lifecycle checks](../../tests/integration/lifecycle.test.ts) |
| Interruption immediately after migration commit | Resume safely; insert/DDL effects occur once | Hosted rehearsal |
| Wrong keys/corrupt archive | Refuse before database replacement | [Operations checks](../../tests/integration/operations.test.ts); hosted rehearsal |
| Recovery following an upgrade | Matched source/application restored; login, saves, encrypted fixture and new backup work; prior database remains | Hosted rehearsal |
| Release bundle with a pinned registry digest | Install and recover without a checkout/build; image digest included in authenticated backup | Hosted registry rehearsal |
| Custom build / absent installed plugin | Refuse silent replacement before maintenance; explicit reviewed acknowledgement available | Controller checks; hosted registry rehearsal |
| Changed source or mismatched recovery image | Reject inconsistent source identity; preserve current/failed data | Operations checks; controller checks |
| Empty replacement cluster | Separately recovered operator keys and archive establish a working instance | Hosted rehearsal; physical-server acceptance remains separate |
| Maintenance during readiness checks | Worker stays healthy and paused, without claiming imports | Hosted rehearsal; [status checks](../../tests/unit/release-feedback.test.ts) |

## Observed implementation

The [controller](../../scripts/hosted.py) uses Python's standard library and Docker CLI. It reuses the [configuration generator](../../scripts/configure-hosted.ts), existing owner/migration commands, [backup](../../scripts/backup.ts) and [restore](../../scripts/restore.ts). The [storage guard](../../scripts/lib/backup-storage.ts) checks Linux mount information and a registered marker; the [verification CLI](../../scripts/verify-backup.ts) authenticates archives without modifying a database. Runtime application permissions remain restricted. No new database table or migration is required by this tooling.

Image installation resolves a version/digest once and records the local ID and portable registry digest before activation. Source installation still builds an immutable local image. Resume uses the pinned identity, not a moved tag. Build-time metadata owns the source fingerprint and composition; backups authenticate that identity and reject source drift. Local source-only backups are also supported; recovering them builds their authenticated source and requires valid image metadata before activation. Rendered Compose state is private. Existing manual deployments retain their advanced runbooks; managed setup does not attach to them or migrate their data automatically. The user must include reviewed personal-plugin source and retained migration files in a custom candidate image. Changing a custom/older build to a registry image, changing repository, or dropping enabled plugins needs explicit acknowledgement before maintenance. The acknowledgement never bypasses retained migrations.

## Constraints and verification limits

New image builds and matching source archives exclude private environment/key files, exports, backups and generated state recursively, including inside plugins. Exact `.env.example` files and required source remain included. Publication, archive and build-stage/runtime image tests share synthetic path fixtures; archive formats and existing artifacts are unchanged.

Owner passwords use versioned scrypt parameters (N=65536, r=8, p=2; 16-byte salt, 64-byte derived key). Legacy hashes upgrade only after successful login, atomically with session creation. Two concurrent web checks bound memory; console recovery takes precedence over stale login verification. Runtime cannot directly edit the owner table; its one-time upgrade permission is defined in [ADR 010](../decisions/010-runtime-password-upgrade.md). Credential encryption accepts only canonical three-part base64 envelopes with 12-byte IVs and 16-byte GCM tags; existing valid ciphertext remains readable. Upgrade refreshes runtime permissions, and rollback requires the matched pre-upgrade backup.

Hosted images must declare application `athlete-panel` and hosted protocol 1 in `.athlete-panel-release.json`. Missing or unrelated metadata is rejected before activation. Backup storage uses `.athlete-panel-storage-id`; archives use the `ATHLETE-PANEL-BACKUP-1` envelope, and unsupported envelopes fail verification before any database restore. Daily retention only prunes recognized `athlete-panel-daily-` archives.

The primary hosted environment is Linux with Docker Compose and Python 3.10+. Remote filesystem verification supports NFS/NFS4, CIFS/SMB3 and SSHFS. An explicit synthetic policy is available to the imported rehearsal only and is additionally restricted by a loopback origin and `_test` database in the container guard. There is no public CLI bypass for hosted remote-storage verification.

Public DNS/CA renewal, actual remote filesystem behavior, remote retention and restore after losing a physical server require operator acceptance. Source rebuilds still depend on available base images/package registries; retained local images and registry digests reduce rebuild dependence but do not replace a disaster rehearsal. No official registry/bundle is published by this implementation. Finish pending older-controller operations with their original controller before upgrading tooling. PostgreSQL major upgrades and automatic data cleanup are excluded.

Commands are canonical in [development](../development.md#private-server-installation). Individual checks, failures and outcomes belong in the [execution record](../plans/mvp-execution.md), separately from real deployment.
