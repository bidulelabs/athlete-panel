# Pin release images without bypassing database recovery

Status: accepted

Date: 2026-10-25

## Context

The owner requested image-based installation and upgrades, preserving migrations, backups, recovery and custom plugins. The existing controller already coordinates maintenance, verified snapshots and migration checkpoints. A public image registry has not been selected or published by this work.

## Decision

Use prebuilt, trusted images through the existing controller. A small deployment bundle pins a registry digest. Record both that portable reference and the selected local image ID before activation; resume never follows a moved tag. Build metadata fingerprints source and composition. Authenticated backups include this identity alongside their matching source.

Keep explicit local-image and source-build options for custom plugins/code. Check installed plugin preservation before maintenance. Recovery selects the archived image or deliberately rebuilds its authenticated source, restores into a new database and retains the previous database. Older archives without image metadata remain supported through source rebuilds.

## Consequences

Ordinary users need no application checkout or server-side build. Python and Docker remain prerequisites; no always-running updater, registry service or runtime database privilege is added. Image availability and publisher trust remain external dependencies. The digest is an integrity identifier, not a signature. Custom users must merge and test their own code; a stock image cannot preserve arbitrary source changes automatically. Database major upgrades and automatic adoption of manual installations remain separate work.

Commands and compatibility transitions belong in [development](../development.md#coordinated-upgrades-and-plugin-activation); individual verification outcomes belong in the [execution record](../plans/mvp-execution.md).
