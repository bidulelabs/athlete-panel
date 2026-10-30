# ADR 013: Explicit Compose adoption and portable image identity

## Record

Status: accepted.
Recorded on: 2026-10-30.
Status basis: the owner approved implementation of the updated Compose adoption/image-verification prompt and requested a new branch in this conversation. The scope is code, documentation and isolated synthetic verification; publication, real adoption/deployment and external service changes need separate authorization. No durable conversation URL is available; the [execution record](../plans/compose-adoption.md) preserves that scope.

## Context

The original controller assumes service names, generated configuration and topology it owns. A manual Compose installation can have different names and paths without needing a different deployment algorithm. Arbitrary Compose configurations, however, can invalidate database, ingress or backup assumptions.

Docker's local image identifier is not a portable configuration digest. The published v0.1.0 image has manifest digest `95d771cf8512079b8d6d4cb48be589c6e19df54cc89567ee210d82b8483bf866`, referencing configuration digest `02274ad78ba1b07203b0aacc679905927c399b8c7229d2d1cfce159e4c27cd95`. Containerd on the development machine reports the former as its local ID; CI recorded the latter. Raw equality incorrectly rejects that relationship.

## Decision and rationale

Adoption is an explicit administrative transition, with a read-only preview, fingerprint confirmation, revalidation, local daemon/project ownership claim and atomic private installation record. It preserves the current Compose topology and records references/fingerprints for configuration and secrets. It retains a portable image archive for the original release. It does not migrate, restart, bootstrap, rotate keys, rewrite Compose files or register weaker backup storage.

Version-2 installation state carries a bounded profile. Service roles map to actual names; the existing upgrade/recovery algorithm consumes that profile. PostgreSQL and ingress remain unchanged during ordinary upgrades. Adopted ingress stays operator-owned, including bundled Caddy routing; changes are reviewed through reconciliation. The existing managed installation format remains readable.

The shared image helper separates local ID, configuration digest, platform manifest and optional index. It reads Docker's saved configuration and rootfs identity, then verifies the descriptor chain for a registry image. CI artifact/release descriptors use format 2; format 1 remains readable. Images declaring image-identity version 1 accept the new optional authenticated backup identity. Older images receive their original payload; readers prove legacy IDs against available content relationships instead of guessing their meaning. Explicit authenticated-source rebuild remains a distinct recovery choice.

## Consequences

- Expected benefit: supported manual installations use the same full rehearsal, two-snapshot upgrade and explicit recovery path as managed installations.
- Cost: confirmation saves a full image archive and inspection may export an image temporarily. Operators need sufficient private disk space and must retain referenced files/keys separately.
- Limits: one local Docker host, one PostgreSQL 17 cluster, explicit service mappings and file-backed secrets. Remote Docker, replicas, arbitrary wrappers/source mounts and PostgreSQL major upgrades remain unsupported.
- A host-level ownership record prevents two state directories/accounts from independently claiming a project. It is an operational guard, not a security boundary against Docker/root administrators. Protect it with the recovery kit.
- Reconsider when another concrete topology is required and can receive equivalent upgrade/recovery evidence. Do not broaden the matrix by silently dropping checks.

## Relationships

- Extends [release images](006-release-images.md) and [deployment/recovery](012-deployment-recovery.md).
- Requirements: [hosted operations](../features/hosted-operations.md).
- Verification and limits: [execution record](../plans/compose-adoption.md).
