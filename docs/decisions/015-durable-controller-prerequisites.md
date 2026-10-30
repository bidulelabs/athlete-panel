# ADR 015: Durable controller ownership and disk-backed image verification

## Record

Status: accepted.
Recorded on: 2026-10-30.
Status basis: the owner requested implementation of all three findings in the [PR 58 review](https://github.com/bidulelabs/athlete-panel/pull/58#pullrequestreview-5713491351), after discussing their operational impact. The authorized scope is code, documentation, isolated verification and the existing PR update; production and release publication remain separate.

## Context

An ownership record stored in `/var/tmp` can be aged out between upgrades. Exporting a complete image into default temporary storage can exhaust a small VPS's memory-backed `/tmp`. An unconditional Buildx check also blocks unrelated recovery paths and reports a generic Docker failure.

## Decision and rationale

Store daemon/project claims under `/var/lib/athlete-panel/controllers`. Its root-owned mode-1777 parent provides a shared namespace across controller accounts; each claim remains private, locked and account-owned. A non-root installation needs administrator preparation of this parent once. Migrate a matching legacy claim under both locks, retain the original, atomically persist permanent ownership and refresh the installation's recovery reference. Reject conflicting or missing ownership rather than guessing. Retire older controller bundles after migration.

Keep the existing archive-based identity verifier and all its cryptographic checks. Temporary exports use private directories under disk-backed `/var/tmp`, or an explicitly selected `ATHLETE_PANEL_IMAGE_TMPDIR`, independently of `TMPDIR`. Reject Linux memory filesystems and obviously insufficient free space, clean exports after success/failure/handled interruption, and explain export errors without exposing private command output. Supplied archives require no extra export. Streaming is deferred: disk-backed exports retain the already tested classic/OCI parser and bounded member validation.

Check Buildx at registry descriptor inspection and source building, with an explicit missing-plugin message. Docker/Compose readiness remains universal. Local recovery does not require Buildx unless the selected path actually needs registry verification or rebuilding.

## Consequences

- Expected benefit: normal temporary cleanup and small RAM filesystems no longer prevent supported adoption, upgrades or recovery.
- Costs and risks: non-root adoption needs one administrator-owned shared directory; temporary full-image exports still consume disk space and time. Concurrent writes or multi-platform archives may exceed the size estimate. Abrupt process termination that bypasses Python cleanup can leave scratch files for normal temporary cleanup; they contain image exports, not application databases or backup keys.
- Compatibility: profile/image/archive formats stay unchanged. Existing claims migrate only when their original ownership can be verified. Missing recovery records remain an explicit operator repair.
- Reconsider when image-export overhead justifies a separately tested streaming verifier or another supported operating-system storage model is required.

## Relationships

- Refines [Compose adoption and image identity](013-compose-adoption-and-image-identity.md), retaining its shared ownership and content-verification guarantees.
- Requirements: [Hosted operations](../features/hosted-operations.md).
- Canonical setup and troubleshooting: [Development](../development.md#adopting-an-existing-compose-installation).
- Verification: [Execution record](../plans/compose-adoption.md).
