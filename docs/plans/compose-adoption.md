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

## Optional off-VPS backup storage

On 2026-10-30 the owner requested this change directly in PR 58, authorizing implementation, synthetic verification and the PR update while excluding production changes and release publication. [ADR 014](../decisions/014-optional-remote-backups.md) records the change from the former remote-only prerequisite.

- Persist `backupMode` as local or remote in controller installation state; older records remain remote. New installs default local and create a private controller-owned directory. Explicit remote installs retain the existing policy, filesystem fingerprint and marker checks.
- Adopt existing private local backup binds without creating storage, changing credentials or restarting containers. Preview displays the mode; optional `--backup-mode` asserts it. Retain existing remote policy files exactly. Reject missing remote configuration, contradictory modes and reconciliation that changes the mode, destination or policy.
- Pass the stored mode through the shared install/upgrade/recovery path and existing backup scheduler. Encryption, authenticated read-back, daily retention, heartbeat handling, final pre-upgrade snapshots and isolated restore rehearsals remain intact. Older images retain their encrypted unregistered local path; no compatibility path strips remote protection.
- Display explicit verified-local/off-server-not-configured versus registered-remote protection in controller status and current image UI. Old image/running pre-adoption UI wording can persist until the normal upgrade; controller status reports the recorded protection. No new scheduler or automatic storage conversion was introduced.
- Extend fixtures for both modes, legacy profiles, policy/mount loss, private-directory permissions, mode reconciliation, data/key/configuration preservation and responsive status copy in both themes. The managed rehearsal exercises local mode; the registry variant keeps remote mode. Adoption exercises remote/Caddy and local/external ingress, each with upgrade interruption, missing-container repair, manual restore testing and initial-release recovery.

Remaining boundaries: network-mount durability and physical-server loss require operator exercises. Local archives cannot survive VPS loss without an independently preserved copy. Keys still need a separately protected recovery copy. Named backup volumes, automatic mode conversion and an off-server copy service are not introduced. No production credentials or athlete data were used.

Verification completed locally for this follow-up:

| Check | Result |
| --- | --- |
| Python controller/security suite | 91 passed, including legacy remote records, remote failure without fallback, local permissions, adoption preservation and reconciliation mode guards |
| Canonical `pnpm check` | Passed; 240 unit tests, both type checks, formatting/lint/generated-file/boundary checks and documentation validation |
| Isolated database integration suite | 163 passed; encrypted local archive authentication, unavailable remote policy rejection, unchanged last successful backup, retention and cancellation cleanup included |
| `pnpm build` and AMD64 runtime image build | Passed; generated Next.js declaration changes restored to their original contents |
| Full desktop/mobile browser suite | 149 passed, 3 existing skips; synthetic loopback server/database removed afterward |
| Status screenshots | 8 focused cases passed again to save local/remote, desktop/mobile and light/dark evidence under ignored `.runtime/backup-mode-screens`; local and remote views visually reviewed across both sizes/themes |
| Managed local container rehearsal | Passed install, upgrade, mandatory and manual restore rehearsals, migration/ingress interruptions, backup-only resume, matched-source recovery and recovery into an empty replacement cluster |
| Remote adoption / bundled Caddy | Passed in 335.022 seconds, including initial-release recovery and manual restore testing |
| Local adoption / external ingress | Passed in 330.239 seconds against the older `athlete-panel:adoption-check` image, including upgrade to the current candidate and recovery to that older image |
| Publication candidate scan | 0 findings in 425 files; five existing media files unchanged |

The managed run recorded installation 53.631 s, restore test 31.809 s, upgrade 231.237 s (76.650 s maintenance), deliberate matched-source rebuild/recovery 164.274 s (140.710 s maintenance), and empty-cluster recovery 59.056 s. Complete phase evidence is in ignored `.runtime/backup-modes-hosted.json` and `.runtime/backup-modes-adoption.json`. These are synthetic Docker Desktop/containerd runs with AMD64 emulation and concurrent verification, not VPS performance predictions. The registry variant and classic-engine transfer were not rerun for this storage-only follow-up; their prior evidence remains recorded above. Remote-mount disappearance uses synthetic mount facts/policies; no real NFS/SMB/SSHFS service was provisioned.

Documentation validation passed for 42 files; semantic review checked persistent-mode defaults, administrative adoption, legacy behavior, identical recovery requirements, protection wording and lost-server limitations. No production deployment or release publication occurred. The only external update is the authorized PR branch/description.

## Healthy local backup feedback

On 2026-10-30 the owner accepted the PR 58 review recommendation to make a healthy verified local backup informational. The shared operational status now suppresses its generic troubleshooting warning while retaining “Local backup verified; off-server copy not configured” and plain supporting text about server loss and restore rehearsals. Failed, missing, stalled, overdue and unverified states retain the existing warning; an active backup remains informational. This changes presentation only, with no storage, scheduler, controller or recovery changes.

Verification: `pnpm check` passed with 247 unit tests, both type checks, formatting/lint/generated-file/boundary checks and documentation validation. The isolated integration suite passed all 163 tests, and the production build passed. All 26 selected desktop/mobile browser tests passed, covering both backup modes and themes, a new failure after a healthy backup, existing operational warnings, planning, proposal review and workout logging. Eight status screenshots were visually reviewed across both themes and sizes, saved under ignored `.runtime/local-backup-info-screens`; the synthetic browser server/database were removed afterward. The UI guidance detector reported no findings.

The hosted-operations specification owns the status behavior; the development guide and design record now describe the information/warning distinction consistently. Framework validation checked these claims against the implementation and tests. No new architecture interaction or consequential storage decision required another ADR. Python/controller and container recovery rehearsals were not repeated for this presentation-only change; their prior evidence remains above. No production deployment or release publication was performed.

## PR 58: durable ownership, disk scratch and Buildx prerequisites

On 2026-10-30 the owner requested all three fixes from the [review](https://github.com/bidulelabs/athlete-panel/pull/58#pullrequestreview-5713491351). [ADR 015](../decisions/015-durable-controller-prerequisites.md) records their scope and operational tradeoffs.

- Permanent root-owned shared ownership storage replaces temporary claims. Non-root adoption has one documented administrator setup command. Matching legacy claims migrate under both locks; conflicts, missing records and duplicate owners still fail. The saved recovery reference updates only after the permanent record is durable, and interrupted migration can retry.
- Image exports use private disk-backed scratch directories, independent of `TMPDIR`, with a size estimate/free-space check, memory-filesystem rejection and sanitized export errors. Existing archives avoid another export. Configuration/rootfs, platform, manifest/index and legacy identity verification remain intact.
- Buildx is checked only at registry verification/source build entry points. Missing-plugin errors name the prerequisite, and image comparison preserves prerequisite errors rather than reporting a content mismatch. Universal Docker/Compose checks remain.

Verification completed: the Python suite passed 106 tests with two Linux-only skips on macOS. Both skipped OS tests passed in an isolated Debian 13 container as root and non-root, using real `systemd-tmpfiles` cleanup and 8 MiB memory filesystems for `/tmp` and `/dev/shm`; a 16 MiB synthetic image export used disk successfully. Ten identity tests also passed there. The Linux exercise additionally verified the real root-owned mode-1777 registry, refusal of a second Unix account's claim, and migration without allowing a competing account to reserve the permanent target first. Docker commands inside those small-filesystem identity fixtures are synthetic; the full container rehearsals exercise actual image exports on Docker Desktop/containerd.

Canonical checks passed: `pnpm check` (247 unit tests, type checks, formatting/lint/generated-file/boundary checks), 163 database integration tests and production build. The registry rehearsal passed immutable-image installation, restore testing, plugin guards, interrupted migration/activation, backup-only resume, exact-image recovery and recovery into an empty replacement cluster. Recorded totals include install 62.401 s, upgrade 145.664 s (65.080 s maintenance), restore test 23.750 s and recoveries 67.513/64.475 s. Evidence is under ignored `.runtime/review-fixes-registry.json`; timings describe synthetic local runs, not VPS performance.

Both full adoption scenarios passed: registered remote backups/bundled Caddy in 279.565 s, and local backups/external ingress in 311.309 s. Each verified unchanged container IDs during adoption, configuration/key/record preservation, a real forward migration, interrupted resume, missing-backup repair, manual restore testing and recovery to the initially adopted release while retaining the previous database. The external-ingress case retained digest-pinned PostgreSQL. Evidence is under ignored `.runtime/review-fixes-adoption.json`.

Initial Caddy fixture runs exposed Docker Desktop reporting an auto-created file bind through its internal `/host_mnt` path. Targeted diagnostics isolated the mismatch to that fixture's Caddyfile source. Its existing file bind now explicitly disables host-path creation, matching the controller's deployment behavior; repeated preview passed with strict mount equality afterward. The full scenarios above passed without relaxing production guards. Temporary diagnostic probes, including one deliberately missing the migration fixture, are not counted as acceptance runs.

Documentation validation passed for 43 files; framework review covered durable ownership, legacy migration, prerequisite messages, canonical commands and evidence limits. Synthetic services, databases, volumes and private fixture state were removed. UI/browser tests were not repeated because this follow-up changes only controller tooling and documentation; classic-store application recovery and physical-server loss remain outside this run's evidence. No production deployment or release publication was performed.
