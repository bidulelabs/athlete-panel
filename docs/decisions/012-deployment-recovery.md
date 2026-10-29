# 012: One tested release and one backup scheduler

## Record

Status: accepted
Recorded on: 2026-10-29
Status basis: the owner's explicit “PLEASE IMPLEMENT THIS PLAN” request approved the simplified deployment/recovery plan, including mandatory pre-deployment restore rehearsal and deferred monthly scheduling. The [execution record](../plans/deployment-recovery.md) preserves its scope; no durable conversation URL is available. Authorization covers code, documentation and isolated verification, not real publication, deployment or monitor activation.

## Context

The existing controller already owns locking, immutable image selection, encrypted backups and new-database recovery. Current CI separates quality, setup, database, desktop/mobile and three container rehearsals. Building the base image separately in every rehearsal wastes work and does not establish that the published image is the tested one. A rehearsal snapshot taken while normal writes continue cannot be the final deployment recovery point.

## Decision and rationale

Extend the existing workflow: build one Linux AMD64 image, transfer it with checksum/image ID/full commit metadata, run the existing gates and publish that same artifact only from a version tag after all prerequisites succeed. Preserve PR cancellation and serialize publication per version without cancelling active publication. Retain source fingerprints, old metadata readers and custom-image/source recovery.

Use one controller operation with durable intent/attempts/timings. Prepare and rehearse a backup against the candidate before maintenance, then create a separate final verified snapshot after closing writes. Update web, worker and backup as one release; retain PostgreSQL and stable Caddy ingress. Recheck live readiness on resume, including a fresh heartbeat from the selected worker. Recovery selects the authenticated matching release and creates a new database; it never deletes the failed database or guesses a down migration.

Keep the existing backup container as the only scheduler and observe its startup attempt after activation. Avoid an extra controller backup and immediate duplicate authentication of successful backup-tool output. Authenticate again after interruption and before restore. Add optional private bounded HTTPS signals, with an external missing-signal monitor. Expose manual restore testing through the same isolated runner; do not introduce a monthly scheduler, systemd timer or general service-diff engine.

## Consequences

- Expected benefits: shorter maintenance windows, explicit tested-image identity, fewer schedulers and fewer redundant archive reads.
- Costs and risks: two pre-deployment snapshots and an isolated database consume time/disk/memory on the VPS. The real-data rehearsal is deliberate and must complete before maintenance. Local rehearsals do not prove disaster recovery or remote storage durability; separately recoverable keys and a second-machine exercise remain necessary.
- Reconsider when: data volume makes a same-VPS rehearsal impractical, another supported CPU architecture is required, or operator evidence justifies automated periodic restore scheduling.

## Relationships

- Extends: [Release images and recovery](006-release-images.md); its identity/custom-source/recovery decision remains in force.
- Related requirements: [Hosted operations](../features/hosted-operations.md).
- Verification and limits: [Execution record](../plans/deployment-recovery.md).
