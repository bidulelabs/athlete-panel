# Worker process reaping — issue #118

## Scope and authority

The owner requested implementation, upgrade instructions, health-check regression tests and a PR for [issue #118](https://github.com/bidulelabs/athlete-panel/issues/118) on 2026-11-12. Production deployment is outside this task. The issue reports 12,311 zombies and 12,329 tasks against a limit of 12,334, with Docker unhealthy while the application heartbeat remained healthy.

## Implementation

- Production Compose enables `init: true` for the worker only. The worker/probe commands, grace periods, health-check settings and process limits are unchanged.
- The [canonical upgrade guide](../development.md#worker-process-reaping) distinguishes ordinary managed controls, saved adopted profiles and manual Compose configurations. Adopted profiles need preview/confirmed reconciliation followed by the full coordinated upgrade; generated/private state is not hand-edited.
- The Docker rehearsal uses the packaged probe and real Docker timeouts against synthetic PostgreSQL views. It samples zombies and cgroup task counts, includes a no-init diagnostic control, and is required by the existing release rehearsal job. Its Node parent is an idle fixture; it does not claim to exercise provider jobs or long-term production load.
- Controller tests check init/limit/probe preservation and reconciliation through candidate/recovery selection. No public contract, manifest, registry or migration changes are needed.

## Verification

Local verification on 2026-11-12 used synthetic data only:

| Check | Actual result |
| --- | --- |
| Standard quality checks | `pnpm check` passed: 49 unit files / 406 tests, type checks, boundaries, generated-file freshness and docs; existing lint warnings remain |
| Integration | All 19 files / 276 tests passed against a separate disposable PostgreSQL 17 container |
| Python operational/security suite | 121 tests completed successfully, with two Linux-only tests skipped on macOS; includes managed rendering and adopted reconciliation preservation |
| Build | Host production build and local Docker runtime-image build passed |
| Production-image rehearsal | Passed real worker startup, HTTPS with certificate validation, owner bootstrap, restricted roles, restart persistence, encrypted restore, session revocation and failed-candidate rejection |
| Process regression | 20 successful, 20 failed and 20 Docker-timed-out probes with init: zero persistent zombies, 15 tasks at baseline and after settling, sampled peak at most 49 against the fixture limit of 256 |
| No-init diagnostic control | Six observed successful probes left seven orphaned zombies (`sh` and `esbuild`) under Node PID 1, despite Docker health remaining healthy |
| Documentation and publication checks | Formatting, local links/content and staged publication scan passed; zero publication findings in the exact staged tree; no media changed |

The unchanged health-check subprocess chain is sufficient to reproduce orphan accumulation in the tested image. The control has an idle Node parent and no other application work; this identifies a source, without claiming every zombie in the original server incident came from it. Init runs as PID 1 in the fixed cases. Short checks use a one-second interval, one failure threshold, no startup grace and a two-second timeout only for the deliberately blocked query; normal probes retain the production timeout.

The first synthetic fixture used a PostgreSQL timestamp with a UTC offset that the application's strict timestamp schema correctly rejected; the fixture now emits the application's canonical UTC format. The standard test-database port was occupied by another preview, so integration used separate temporary storage on port 55497 and removed it afterward. Initial sandbox socket restrictions were resolved by running local checks with the required socket access. Generated build-only `next-env.d.ts` changes were discarded.

CI is wired to require the process regression in the release container job; local success is not a claim of hosted CI completion. Production deployment, long-term process-count monitoring and private-server acceptance remain outstanding. There are no UI changes requiring desktop/mobile theme review.

## Documentation validation

Scope: hosted operations specification, architecture process ownership, development upgrade/verification instructions, changelog and this record. This is a small process-supervision correction within the existing Compose/adoption architecture; no new ADR is needed. No UI changes or diagrams are introduced.

| Topic | Canonical document | Coverage completed | Remaining gaps |
| --- | --- | --- | --- |
| Process ownership and behavior | [Architecture](../architecture.md), [hosted operations](../features/hosted-operations.md) | Init ownership, separate Docker/application health, acceptance scenarios tied to actual tests | Long-term server observation |
| Upgrade and recovery | [Development](../development.md#worker-process-reaping) | Managed candidate controls, explicit adopted reconciliation, manual configuration-only recreation, unchanged full image-upgrade procedure, post-replacement inspection | Operator execution on the private server |
| Verification and release communication | [Development verification](../development.md#verification), [Unreleased](../changelog.md#unreleased) | Canonical test command, synthetic boundaries, required upgrade action, no SQL migration for this fix | Hosted CI results after PR creation |
