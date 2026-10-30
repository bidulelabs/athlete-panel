# Compose adoption and portable image verification

## Authorized scope

On 2026-10-30 the owner requested implementation of the updated adoption/image-verification prompt on a new branch. Work began on `codex/adopt-existing-deployments`, from freshly fetched `origin/main` at `7d49dd242b3a2a758b2f90f66cdd367f28abd168`. The existing worktree was clean. No durable conversation link is available.

Implement safe one-time adoption, shared upgrades/recovery, portable image identity, meaningful synthetic verification and documentation. Real adoption/deployment, image publication, GitHub settings and external monitoring changes are excluded from this implementation authorization.

## Implementation

- Shared Python image identity helper: configuration/rootfs proof from Docker save; verified registry manifest/index relationship; portable identity distinct from local identifier. Used by CI export/load/publication, controller selection/resume, recovery and running-image verification.
- Backward-compatible image metadata capability and authenticated backup identity. Old image payloads remain unchanged; new bundle/artifact descriptors carry portable identity.
- Read-only Compose preview, explicit fingerprint confirmation, revalidation, private versioned profile and retained original image. Host daemon/project claim coordinates state directories; atomic record supports retry after interruption.
- Profile-driven deployment preserves service names, configuration, mounted storage, networks and operator-owned ingress. The existing full deployment sequence remains shared. Explicit reconciliation handles reviewed drift within the supported matrix.
- Synthetic unit coverage and an isolated real Docker rehearsal for bundled and external ingress, first-upgrade interruption, resume and recovery to the initial adopted release.

## Verification record

Verification completed locally on 2026-10-30. No GitHub Actions run, registry publication, production adoption/deployment or external service change was performed. The test image was built from this worktree as `athlete-panel:adoption-check`, with the base commit label and its own source fingerprint; it is a synthetic verification artifact, not a published release.

| Check | Evidence / result |
| --- | --- |
| Existing v0.1.0 registry identity | Passed on Docker Desktop containerd: published manifest linked to CI's configuration digest; no published artifact changed |
| Python security/controller tests | 76 passed, including legacy/new identities, stale previews, duplicate ownership/locks, interrupted atomic writes, drift/reconciliation, immutable initial-image selection and publication gating |
| Canonical `pnpm check` | Passed: formatting, lint, generated registries/contracts/skills, boundaries, both type checks, 199 unit tests and documentation validation |
| `pnpm test:db:start`, `pnpm test:integration` | Passed: 141 tests in 14 files against the explicitly isolated test database |
| `pnpm build` | Passed web/worker production build; generated `next-env.d.ts` path changes were reverted |
| Desktop/mobile `pnpm test:e2e` | 119 passed, 3 existing skips, 3.7 minutes; separate `athlete_panel_adoption_ui_test` database and loopback port 3117; server/database removed afterward |
| Release container rehearsal | Passed HTTPS, owner bootstrap, restricted roles, persisted state, encrypted recovery, missing-key and failed-candidate rejection |
| Existing managed hosted rehearsal | Passed install, custom plugin/migration, interruption/resume, ingress, backup-only retry, original-image/source recovery and empty replacement cluster |
| Registry/bundle hosted rehearsal | Passed the same sequence with real loopback registry pulls and source-free bundle; cold-cache fixture updated to make an image inspectable after its successful pull |
| Adoption with bundled Caddy | Passed preview/adoption, explicit mappings/overrides, drift/reconciliation, real migration, injected post-commit interruption/resume and recovery to the original release; 211.163 seconds including fixture setup/checks |
| Adoption with external ingress | Same checks passed; 267.991 seconds including fixture setup/checks; proxy remains outside the application project |
| Exact CI artifact export/load | Passed format-2 export/checksum/load/metadata/commit verification on the real containerd engine; configuration digest remains distinct from local index ID |
| Real cross-store image recovery | Passed containerd → classic overlay2 → containerd, including both legacy identifier forms; 32.814 seconds in an isolated Docker 29.9.2 guest |
| Publication candidate review | `publication-check.py --worktree`: 0 findings in 412 files; 5 existing media files were unchanged; this is a local scan, not publication approval |

The managed rehearsal recorded upgrade 210.354 s / maintenance 70.463 s, matched-source recovery 126.386 s / maintenance 104.320 s, and empty-cluster recovery 61.317 s. The registry rehearsal recorded upgrade 166.975 s / maintenance 76.254 s, exact-image recovery 57.564 s / maintenance 36.313 s, and empty-cluster recovery 65.409 s. Durable controller records and rehearsal output include individual preparation, backup, migration, readiness and recovery phase durations. These measurements include AMD64 emulation and concurrent synthetic verification; they are not VPS downtime predictions.

During implementation, real rehearsals found and corrected nondeterministic Docker mount ordering in preview fingerprints, synthetic ingress-network/certificate setup, a migration fixture that needed regenerated/compiled registries, and the cold-cache simulation's post-pull visibility. Final runs passed. The test assertions verify unchanged adoption container IDs, exact fixture-record equality, preserved configuration/key bytes, database/volume identity, plugin/source identity, retained PostgreSQL/Caddy containers and the continued existence of the previous database after recovery.

## Evidence boundaries

The live local preview and unrelated databases are not fixtures. Tests create their own projects, credentials, storage, data and loopback ingress. Cleanup targets those named test projects only.

Application/container rehearsals ran directly on Docker Desktop’s containerd store with Linux AMD64 images under emulation on an ARM64 Mac. Cross-store save/load and legacy identity verification also ran directly against classic overlay2 in an isolated Docker 29.9.2 daemon, pinned locally to `sha256:9e79b879b177fbd72c34376a3dd3d91747da5db49e1f560f76aea59561471977`. The host Docker configuration was not switched. Full application/database recovery on a classic host was not separately run locally; the cross-store test proves image transfer/identity, while descriptor mismatches, crash boundaries and ownership races also have synthetic unit coverage. Network-mount durability, actual off-host storage and loss of a physical server remain operator acceptance tasks; a synthetic policy is never exposed by the production CLI.

## Documentation validation

Behavior belongs to [hosted operations](../features/hosted-operations.md), commands to [development](../development.md), ownership to [architecture](../architecture.md), and the consequential decision to [ADR 013](../decisions/013-compose-adoption-and-image-identity.md). Framework validation checked local links, command ownership, the support matrix, observable acceptance scenarios, decision authority and the separation of implementation, synthetic verification and deployment. Documentation validation passed for 41 files.

## PR 58 review corrections

On 2026-10-30 the owner authorized fixing and pushing two reproduced findings on [PR 58](https://github.com/bidulelabs/athlete-panel/pull/58). The adoption guard previously rejected missing application containers before resume/recovery could recreate them. Database admission also depended on a `postgres:17` spelling and rejected digest-only references.

The guard now uses the durable operation kind/completed phases to allow only recreatable missing application roles. After reopening, only backup can be recreated and a fresh matching startup backup must pass, including when a prior backup verification was checkpointed. Preparation/restore-test remain strict; explicit recovery and upgrades past their final snapshot can recreate web/worker/backup. Existing container images/mounts, database/ingress IDs, PostgreSQL major/cluster identity, named volumes, networks, files/keys and off-host storage are still verified. Generated binds cannot create missing source directories.

PostgreSQL admission accepts official version-17 tags and digest references, checks `server_version_num`, matches the selected image against the actual database container on the same Docker daemon, and proves pinned digests using the shared image verifier. Operational Compose retains the recorded DB image. Existing profiles already contain this image; no profile-format migration is needed.

Verification completed: the Python suite passed 82 tests; `pnpm check` passed with 238 unit tests; `pnpm test:integration` passed 162 tests. The new release candidate built successfully, including the production web/worker build. Both real adoption scenarios passed: bundled Caddy in 254.293 seconds and external ingress in 262.192 seconds (complete synthetic scenarios, not downtime estimates). Each removed backup after reopening, verified a backup-only resume without replacing web/worker, removed web before recovery, restored the original release into a new database and preserved fixture records/configuration/key bytes and the previous database. The external-ingress scenario used `postgres@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27`; the Caddy scenario retained the tag form. Temporary scenario containers/storage and the candidate image were removed by the harness.

These runs used Docker Desktop/containerd with AMD64 application emulation; wrong database majors, mismatched images and forbidden state changes were exercised with synthetic unit fixtures. No additional classic-engine or physical-server-loss exercise was performed for these fixes. Publication scanning found 0 findings in 423 files; the five existing media files were unchanged. Documentation validation passed for 41 files; semantic review covered stage-specific repair, retained guards, supported image references and unchanged command ownership. No production data, installation or registry publication was involved.
