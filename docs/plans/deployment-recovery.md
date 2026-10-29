# Deployment and recovery execution record

## Authorized scope and baseline

On 2026-10-29 the owner requested implementation of “Simplified deployment and recovery, aligned with current CI.” The approved plan adopts one backup scheduler with heartbeat alerts, application services updated together, removal of redundant backup work, and extension of existing CI. Full pre-deployment restore rehearsal remains mandatory; monthly scheduling stays deferred. Implementation, documentation and synthetic isolated verification are authorized. Actual image publication, private-server deployment and external monitor activation are separate operational actions. No durable conversation URL is available.

Read development, architecture, hosted-operations/plugin specifications, repository instructions and existing release/recovery tooling before implementation. Fetched `origin/main` at `220a68a`; the clean detached checkout at `32bdd13` had no local commits to replay. Created `codex/deployment-recovery` directly from fetched main. Preserve parallel CI jobs/required checks, PR cancellation, backup cancellation cleanup and sanitized migration diagnostics.

## Implementation

- CI builds one AMD64 image, exports its checksum/image ID/commit and shares it with the three rehearsals. Aggregates reject skipped prerequisites. Gated tag publication preserves existing contents and emits a digest-pinned bundle and sanitized evidence.
- Controller operation format 2 adds attempts, timings, progress, lock-time reload, optional commit identity, preparation snapshot/restored-candidate checks, final post-maintenance recovery point, fresh worker readiness and stable ingress. Application services update together; PostgreSQL remains running.
- The backup scheduler's immediate startup run is the new release backup. Post-activation failure resumes only that service. Archive read-back is trusted in the same uninterrupted call; recorded points authenticate on resume/restore. Creation and daily retention share a lock.
- Optional private heartbeat endpoints have bounded delivery and sanitized local status. Manual `restore-test` shares the labelled disposable runner with blocked external networking, no live database credentials and paused provider jobs. Keys and matched-image/source recovery remain separate.
- [Hosted specification](../features/hosted-operations.md), [runbook](../development.md), [architecture](../architecture.md), [release gates](../release-readiness.md) and [ADR 012](../decisions/012-deployment-recovery.md) define behavior and ownership. No database migration, public HTTP API or training rule is added.

## Verification results

Environment: Node 22.23.4, pnpm 11.28.8, Docker Desktop 28.1.1 on arm64 with AMD64 emulation. Python checks use Homebrew Python because the existing pyenv installation emits unrelated missing blake2 diagnostics.

| Check | Actual outcome |
| --- | --- |
| `pnpm check` | Passed: 194 unit tests, both typechecks, lint with existing advisories, generated-source/boundary checks and 39 documentation files. |
| Full integration suite | Passed: 126 tests across 14 files on dedicated `athlete_panel_deployment_1029_test` storage. Includes missing owner, invalid saved domain data, retained-migration corruption, encrypted recovery and cancellation cleanup. |
| Additional backup-concurrency regression | Operations suite passed all 16 tests after adding simultaneous daily backup/retention coverage. Two waiting attempts do not overwrite status or create staging/output before the coordination lock; completed retention leaves one daily point and no partial archive. |
| Python security/controller/publication checks | Passed: 39 tests, including lock reload/contention, durable interrupted boundaries, moved tags, backup-only resume, fresh worker heartbeat, cleanup labels, checksums/platform/image identity, successful publication retries and refusal of conflicting contents. Publication tests mock registry/GitHub writes. |
| Production build and browsers | Local web/worker build passed. Full Chromium suite: 119 passed, three existing platform skips; desktop/mobile and both themes. Separate synthetic browser database/port removed afterward. |
| Local setup rehearsal | Passed: setup, cancellation/resume, login, worker, persistence, maintenance, backup and explicit forward upgrade. |
| AMD64 build-stage/runtime packaging | Both images built and passed the shared private-file exclusion/required-source fixtures from a disposable source copy. |
| Exact image handoff | Export/save/checksum/load verification passed. All three final container reports identify the same image ID below. |
| Container release rehearsal | Passed in 96.092 seconds: HTTPS, restricted roles, restart persistence, encrypted restore and failed-candidate rejection. |
| Hosted source rehearsal | Passed in 626.386 seconds: install, isolated restore-test, custom plugin/schema upgrade, interruption after commit, stable PostgreSQL/Caddy, matched-source recovery and empty replacement cluster. |
| Hosted registry rehearsal | Passed in 558.023 seconds: source-free bundle, immutable registry pulls, custom-plugin guards, upgrade/resume, exact-image recovery and missing-local-image recovery on a replacement cluster. Registry was disposable and bound to loopback. |
| Additional post-activation failure rehearsal | Passed: deliberate backup failure leaves normal use open; resume rechecks deployed readiness and restarts only backup. Web, worker, PostgreSQL and Caddy container IDs stay unchanged. Matching source, restored login/encrypted fixture and replacement-cluster recovery also passed. |
| Publication tree/history/security scans | Current worktree: 401 files, zero pattern findings; existing media still require ordinary rights/privacy review. Gitleaks scanned 111 reachable commits (11.13 MB), no leaks. Pinned Trivy dependency and runtime-image scans found no HIGH/CRITICAL vulnerabilities. |

Final shared test image ID: `sha256:d821046c1cd94712815cedee66abb85aef58f3152e84f513db3987161437953c`. Its source fingerprint is `f46728427aa322eeefbebde526d8d90af535eb1859cbbdc16f8485f6df281ba4`. Commit metadata is deliberately synthetic (`a` repeated 40 times), not a release/commit publication claim. These are local Docker identities, not a published GHCR deployment digest. CI binds a real committed checkout to the released artifact.

Sanitized reports are retained locally under `.runtime/deployment-final-evidence/`; image export and identity are under `.runtime/deployment-final-candidate/`. Detailed command logs use `/tmp/athlete-panel-deployment-*`, `/tmp/athlete-panel-final-*` and `/tmp/athlete-panel-backup-retry.log`. The extra failure rehearsal recorded a 173.869-second upgrade with 36.700 seconds in maintenance, a 26.039-second manual restore test, and 48.037–61.343-second recoveries. The parallel CI-style runs recorded preparation rehearsals of 30.792–31.305 seconds, final backups of 9.585–9.823 seconds, migration/permission attempts of 3.190–3.708 seconds and restore phases of 7.205–11.260 seconds. These synthetic Mac/emulation timings are evidence of instrumentation, not target-VPS downtime estimates.

Failures investigated: the initial shared-default-database integration run had five conflicting-state/deadlock failures; all 125 then-existing tests passed when isolated to this task's database, followed by the 126-test run after adding data-verification coverage. The ARM test host initially pulled an AMD64 registry image without an explicit synthetic platform; the harness now consistently uses the selected base image's platform, including missing-image recovery. Production still rejects an incompatible server architecture. The first container history scan could not follow a host worktree Git pointer and scanned zero commits; that result was discarded and replaced with the successful scan of a disposable mirror containing all reachable history.

Framework validation covered required feature sections, acceptance scenarios, canonical commands, ownership/interaction changes, links and ADR 012's explicit approval basis. Existing schema migrations, contracts, framework templates and design references were preserved. Temporary rehearsal resources, source copies and this task's browser/integration databases were removed; shared owner/local databases and the shared test service were left untouched.

## Operational limits

No real publication, deployment, external heartbeat or owner-data access performed. Local container restore checks do not establish real NFS/SMB/SSHFS behavior, public DNS/CA renewal, remote retention, target VPS sizing or recovery after losing a physical server. Keep both application and backup encryption keys separately protected and perform a second-machine exercise. Actual GitHub permission/concurrency behavior and registry publication remain operational acceptance checks.
