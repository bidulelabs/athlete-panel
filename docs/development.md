# Development and operations

This is the command authority for the repository. The executable definitions are [package scripts](../package.json), [production Compose](../compose.yml), [local database Compose](../compose.local.yml), [Dockerfile](../Dockerfile), and [operational scripts](../scripts/operations.ts). Read [architecture](architecture.md) and the relevant [feature specification](../README.md#documentation) before changing behavior. Verification results and deployment gates belong in the [execution record](plans/mvp-execution.md), not this runbook.

## Prerequisites and configuration

Use a currently patched Node.js 22 release (minimum compatible version 22.13), pnpm 11.28.8, and PostgreSQL 17. Backups/restores additionally need matching PostgreSQL 17 `pg_dump` and `pg_restore` binaries on `PATH`, or `PG_BIN_DIR` pointing to their directory. The production image includes these tools. Docker Engine with Compose v2 is required for the packaged installation. The application has no required model service, Garmin account, hosted database, or external authentication provider.

For a local installation, install dependencies with `pnpm install --frozen-lockfile`, then use `pnpm run setup` and `pnpm run local` as described below. Those commands load private configuration automatically. For a fresh private server, use the [guided VPS installer](#private-server-installation), which generates and manages technical credentials outside the checkout. `.env.example` is an advanced reference, not a second required setup step. Existing configurations and keys must be retained during upgrades. Standalone TypeScript scripts do not automatically load this file. For advanced host commands, export its values from your trusted local configuration using the following shell sequence; manual Compose loads `.env` itself.

```sh
set -a
. ./.env
set +a
```

| Variable | Meaning and requirements |
| --- | --- |
| `DATABASE_URL` | Restricted runtime PostgreSQL connection URL (`athlete_panel_app`). The persistent local container uses `127.0.0.1:55440/athlete_panel`. Production Compose constructs the container URL from its database settings; it does not expose a database port. |
| `ADMIN_DATABASE_URL` | Host console connection for migrations, owner bootstrap/recovery and restore. Never export it to web/worker. In Compose, only `admin` and `recovery` receive an administrative connection. |
| `POSTGRES_USER`, `APP_DATABASE_ROLE` | Saved administrative/runtime SQL identities, generated for new installations. Keep existing identities during upgrades. |
| `APP_DATABASE_PASSWORD` | Separate runtime password, 32–128 hexadecimal characters. `db:migrate` provisions the role and refreshes its grants when this is configured. Generate with `openssl rand -hex 32`. |
| `TRUST_PROXY_CLIENT_IP` | Local default `false`; production Compose forces `true` behind Caddy, which overwrites the client-address header. Never expose the raw web port with this enabled. |
| `ENCRYPTION_KEY` | Independent random 32-byte application key, base64 encoded. Encrypts provider credentials; retain it separately from backups and source. Changing it without re-encrypting credentials loses access to those credentials. |
| `APP_ORIGIN` | Canonical browser origin, including scheme and port. Local HTTP accepts `127.0.0.1` and `localhost` on the same port only when secure cookies and trusted proxy mode are disabled. Hosted/HTTPS origins remain exact. Production Compose derives HTTPS from the domain. |
| `COOKIE_SECURE` | `false` only for local HTTP; production Compose forces `true`. |
| `ATHLETE_PANEL_INSTANCE_PATH` | Registry-generation composition path. The packaged release and backup workflow use the canonical `instance/composition.json`; keep that path for deployed instances. |
| `ATHLETE_PANEL_DOMAIN` | Production DNS name pointing to the private server; Caddy terminates HTTPS. No scheme or path. |
| `ATHLETE_PANEL_RELEASE` | Local production image tag; use a distinct release identifier rather than overwriting an earlier image. Default `local` is for development. |
| `POSTGRES_PASSWORD` | Local-container and production database password. Generate a long random hexadecimal value so it is also URL safe; use the same value in `ADMIN_DATABASE_URL`, different from `APP_DATABASE_PASSWORD`. |
| `POSTGRES_DB` | Production database name, default `athlete_panel`. Recovery can select a newly created database while retaining the old one. |
| `BACKUP_KEY_FILE` | Path to a separate random 32-byte base64 backup key, mode 0600. The file must be outside source directories archived by the backup script. Compose mounts it as a secret. |
| `BACKUP_DESTINATION` | Host directory mounted at `/backups` in the backup service. For disaster recovery, this must be an independently mounted off-host storage target, not the server's database disk. |
| `BACKUP_HOUR_UTC` | Daily scheduled backup hour, 0–23, default 3 UTC. |
| `PG_BIN_DIR` | Optional directory containing matching PostgreSQL client binaries for host operations/tests. |
| `TEST_DATABASE_URL` | Explicit local database whose name ends in `_test`; operations tests never fall back to `DATABASE_URL`. The role needs permission to create/drop its isolated temporary test databases. |
| `PLAYWRIGHT_BASE_URL`, `E2E_PASSWORD` | Running loopback synthetic instance and its owner password for browser tests. |
| `ATHLETE_PANEL_AGENT_CONFIG` | Optional protected CLI configuration path; otherwise `~/.config/athlete-panel/agent.json`. |

Generate independent keys using Node's `crypto.randomBytes(32).toString('base64')`. A protected backup key file can be created without displaying its contents:

```sh
umask 077
mkdir -p .secrets
node -e 'require("node:fs").writeFileSync(".secrets/backup-key",require("node:crypto").randomBytes(32).toString("base64")+"\n",{flag:"wx",mode:0o600})'
```

Store another recovery copy of this key and of `ENCRYPTION_KEY` in your password manager or other separate protected location. Neither key belongs in Git, the backup destination, an agent grant, logs, or a support attachment. The backup key and application encryption key must be different. A backup cannot recover a lost application key.

### Source quality checks

Production source also passes `pnpm typecheck:strict` (`noUncheckedIndexedAccess`); scripts/tests retain the existing strict configuration. Run `pnpm format` after source edits; `pnpm format:check` and `pnpm lint` run in `pnpm check`. Complexity, function length and existing explicit `any` usage initially warn. Generated files, applied migrations and documentation history are excluded from formatting.

`pnpm boundaries:check` resolves imports through TypeScript, including browser roots, re-exports and aliases. Cross-plugin imports use declared public shared/client/server entries and required manifest dependencies; optional UI integrations use enabled contributions.

## Local development

Start Docker Desktop/Engine. From the repository root, run:

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm run local
```

Setup checks Node/pnpm/Docker, generates independent random database passwords and an application encryption key, and creates `.env` atomically with mode 0600. It starts the persistent PostgreSQL container and initializes a fresh database, then asks for your login password and confirmation, with both entries visible in the terminal. Use 12–256 characters without control characters or trailing whitespace. No Garmin or model credentials are required. It never prints generated secrets or stores the plaintext login password in configuration. Keep a separately recoverable private copy of `.env`; losing its application key prevents decrypting imported-provider credentials. Backup scheduling/storage is a separate operation.

Local uses PostgreSQL 17 on `127.0.0.1:55440`, database `athlete_panel`, runtime role `athlete_panel_app` and administrative role `athlete_panel`. The Docker volume `athlete-panel-local_database` retains records across restarts. Web and worker run on the host. Only the setup/migration/bootstrap process receives the admin connection. Both commands ignore ambient database/test/Compose overrides and parse `.env` as data rather than sourcing shell commands. The protected file is the configuration authority for these local commands.

`pnpm run local` starts the database if necessary, checks the installed composition/schema and owner, then runs the web development server and background worker together. Open `http://127.0.0.1:3000` or `http://localhost:3000`. Sessions belong to the hostname used for login. Ctrl+C stops both process groups (including descendants), allowing up to 40 seconds for graceful shutdown before termination. If either exits unexpectedly, the sibling stops and the launcher returns a failure. PostgreSQL remains running and no volumes are removed. Stop the local launcher before using database start/stop commands. `pnpm db:stop` stops the local database when desired; `pnpm db:start` starts it again. Normal subsequent sessions need only `pnpm run local`.

Setup preserves valid existing configuration and initialized owner accounts. An interrupted fresh setup resumes using the same secrets; an existing owner/database is checked without migrations or password changes. Code/schema mismatches require the [coordinated upgrade procedure](#coordinated-upgrades-and-plugin-activation). Neither command is an automatic update or password-recovery operation. Existing installations whose permissions predate the restricted runtime role need the documented permission transition first.

The local wizard supports macOS/Linux terminals. On Windows use WSL2 with Docker integration; native Windows process/permission behavior is not supported by these commands. Required host tools remain Node.js, pnpm and Docker Compose. Private-server deployment follows its own section below.

For noninteractive automation only, setup accepts a protected password-manager pipe or file via stdin:

```sh
pnpm run setup --password-stdin < /secure/owner-password.txt
```

No password argument or environment variable is supported. Omit the flag for the visible interactive prompt. The stdin option does not echo its input. Existing accounts are never reset by this command.

After first sign-in, the authenticated welcome dialog confirms preferences and offers optional Garmin connection. Closing defers it; Settings provides **Finish setup**. Existing owners after upgrade are not interrupted and can choose **Run welcome setup**. Console recovery preserves setup progress. See [onboarding behavior](features/first-time-onboarding.md).

### Advanced manual startup

The lower-level commands remain available for contributors and console administration. Prepare and explicitly load a trusted `.env` as described above, then for a fresh instance:

```sh
pnpm db:start
pnpm registry:generate
pnpm db:migrate
pnpm run owner bootstrap --password-stdin < /secure/owner-password.txt
unset ADMIN_DATABASE_URL POSTGRES_PASSWORD APP_DATABASE_PASSWORD
pnpm dev
```

The password file must be temporary and owner-readable; remove it after use. Bootstrap refuses to replace an existing owner. For separate manual worker operation, load the same configuration in a second terminal, unset the same administrative variables and run `pnpm worker`. The simplified launcher already performs this separation.

The disposable test database uses port 55439 and must never target persistent personal storage. Use synthetic data in development. Demo seeding requires an isolated local `_test` database, completed migrations, and explicit `ATHLETE_PANEL_DEMO=true`; it refuses ordinary database names. It is a one-time seed for an empty test workspace. Set `DEMO_PASSWORD` to control its synthetic owner password; the fallback is `AthletePanel-demo-only-2026`.

## Local setup troubleshooting

- **Docker is unavailable:** start Docker Desktop/Engine and enable Compose v2, then retry. A first startup may need network access to download PostgreSQL.
- **Request origin is not allowed:** local HTTP accepts both `localhost` and `127.0.0.1` on the configured port. Other hosts, ports or protocols must match the configured application address; hosted deployments keep exact origin checks. Follow the address in the error and restart older running code if needed.
- **A port is occupied:** stop the previous web/worker or database process using that port. Local startup refuses to silently switch to another browser origin.
- **Existing `.env` is incomplete or incompatible:** it is left unchanged. Compare the configuration table above; the wizard supports two different 32–128-character hexadecimal database passwords, matching loopback URLs and a 32-byte base64 application key. Use the existing-installation transition for old credentials/permissions. Never replace the encryption key of an existing instance casually.
- **`.env` permissions are too broad:** run `chmod 600 .env`. Symlinks and hard-linked configuration are refused.
- **Storage exists but `.env` is missing:** restore the original private configuration from your password manager/recovery copy. Setup does not invent new passwords for old storage. Removing a container alone does not remove its data volume.
- **Setup was interrupted:** run it again. Generated credentials and completed initialization are retained. If a hard crash left `.runtime/local-command.lock`, the command reports whether its process is gone; remove that file only after confirming no setup/local command is running.
- **Database schema differs from the checkout:** use the coordinated upgrade/backup procedure; neither setup nor local applies upgrades to an existing owner database.
- **Wrong saved database password:** changing `.env` alone does not rotate PostgreSQL passwords. Restore the matching configuration or perform deliberate console recovery.

Advanced isolated instances may set `ATHLETE_PANEL_LOCAL_PROJECT` (default `athlete-panel-local`, or a name beginning `athlete-panel-local-`), `ATHLETE_PANEL_LOCAL_DB_PORT` (55440) and `ATHLETE_PANEL_LOCAL_WEB_PORT` (3000) in `.env`; update both URLs and `APP_ORIGIN` consistently. The wizard does not offer multiple-instance creation automatically. If configuration is absent, any labelled local Athlete Panel data volume blocks fresh credential generation until that storage is accounted for.

## Command reference

Run these from the repository root. Setup/local load their own `.env`; advanced commands require the intended environment exported. Commands that connect to storage use that environment, so review the target first.

| Command | Purpose and side effects |
| --- | --- |
| `pnpm run setup` | Generates protected local configuration, initializes an empty database and prompts for an owner password; preserves existing installations. |
| `pnpm run local` | Loads protected configuration, starts PostgreSQL plus web/worker, and supervises shutdown; does not migrate or delete data. |
| `pnpm dev` | Generates the registry and starts the local Next development server. |
| `pnpm build` | Generates the registry, creates the web standalone build and bundles the worker into `dist/worker/index.js`. No database migration. |
| `pnpm start` | Starts the built local Next server on loopback. The production image uses the standalone server directly. |
| `pnpm worker` | Runs the worker from source; may import Garmin data only when configured and jobs are enabled. |
| `pnpm db:start` | Starts the persistent local PostgreSQL container on loopback port 55440 and waits for readiness. |
| `pnpm db:stop` | Stops the persistent local database container without removing stored data. |
| `pnpm db:migrate` | Verifies immutable applied migration checksums, applies pending enabled-plugin migrations and records the installed composition. Use maintenance for an existing instance. |
| `pnpm run owner bootstrap --password-stdin` | Creates the single owner from stdin. No public signup. |
| `pnpm run owner recover --password-stdin` | Replaces an existing owner's password and revokes all sessions and agent grants. Requires server/database control. |
| `pnpm registry:generate` | Validates pinned manifests/dependencies and rewrites derived client/server/metadata registries. |
| `pnpm registry:generate --check` | Rejects drift without writing registry files. |
| `pnpm plugins stage` | Writes validated desired enable/disable settings from the database into the source composition. It does not activate them. |
| `pnpm plugin:scaffold cycling-recovery "Cycling recovery"` | Creates a new personal source plugin; refuses overwrite and does not edit composition. |
| `pnpm skills:sync` | Generates Claude adapters from canonical `.agents/skills` instructions. |
| `pnpm skills:sync --check` | Checks adapter drift and refuses conflicting user-authored copies. |
| `pnpm contracts:generate` | Regenerates `docs/reference/contracts.json` from runtime schemas. Add `--check` for read-only drift validation. |
| `pnpm boundaries:check` | Checks host/personal-plugin/client import boundaries. This is a structural check, not a code sandbox. |
| `pnpm typecheck` | TypeScript validation. |
| `pnpm test:unit` | Synthetic contract, domain-engine, transport and plugin-tool tests; no provider credentials. |
| `pnpm test:integration` | Destructive isolated database tests; requires explicit loopback `_test` storage. Includes actual PostgreSQL dump/restore and failure cases. |
| `pnpm test:e2e` | Desktop/mobile Chromium checks against an already running synthetic loopback instance. |
| `pnpm test` | All Vitest tests, including integration prerequisites; not a database-free shortcut. |
| `pnpm docs:check` | Checks active document sections, placeholders and local file links. |
| `pnpm check` | Registry/contract/skill adapter drift, import boundaries, TypeScript, unit tests and documentation checks as defined in `package.json`. Run additional relevant integration/build/browser checks separately. |
| `pnpm test:db:start` | Creates the dedicated loopback test PostgreSQL service on port 55439 using `compose.test.yml`. |
| `pnpm test:db:stop` | Removes that test service and its disposable storage. Never substitute the production Compose file. |
| `ATHLETE_PANEL_DEMO=true pnpm demo:seed` | Creates synthetic owner/training/history in a local `_test` database. |
| `pnpm ops maintenance on` | Waits for in-flight domain mutations and blocks subsequent domain writes. |
| `pnpm ops maintenance off` | Checks installed composition/schema compatibility before reopening mutations. |
| `pnpm ops verify-schema` | Checks that the current release matches the installed composition/schema. |
| `pnpm backup` | Creates one encrypted matched database/source/configuration archive. |
| `pnpm backup --daily` | Creates an encrypted archive and applies seven-daily/four-weekly retention. |
| `pnpm backup:verify /backups/recovery.fgr` | Authenticates and checks an archive using the configured backup/application keys without modifying a database. |
| `pnpm ops backup-loop` | Immediate backup, then daily backups at the configured UTC hour. |
| `python3 scripts/hosted.py upgrade` | From a trusted bundle: prepare/rehearse, create final recovery point, migrate, verify and reopen. |
| `python3 scripts/hosted.py status` | Read current release, operation attempts/timings and sanitized backup/worker/notification status without taking the deployment lock. |
| `python3 scripts/hosted.py resume` | Reconcile and continue the pinned pending operation; after activation retry only backups. |
| `python3 scripts/hosted.py restore-test` | Restore the latest successful backup in disposable isolated containers; optional `--archive PATH` selects another. |
| `python3 scripts/hosted.py recover --archive PATH --confirm-recovery` | Explicit matched snapshot recovery into a new database, retaining the previous database. |
| `node --import tsx scripts/hosted-console.ts verify-data` | Console-only schema, retained-migration, owner and existing domain validation against configured storage. |
| `python3 scripts/release-ci.py export\|verify --commit FULL_COMMIT` | Export or verify the run-scoped AMD64 CI image artifact; never publish. |
| `pnpm restore /backups/recovery.fgr --confirm-replace --source-dir /recovery/new-source` | Authenticates a backup, restores the target database and extracts matching source into a new directory. Destructive; follow the recovery procedure below. |

### External-agent CLI

Run the connection command from the local checkout while Athlete Panel is running:

```sh
pnpm agent connect
```

The command opens the owner approval page. Sign in if necessary, compare its code with your terminal, choose the context dates, optional private notes and access duration, then approve. The CLI saves the credential automatically and reports success. No token is copied into the terminal or model conversation. Agent workspace → Connected agents shows access, expiration and Disconnect.

The instance defaults to the previously configured URL, then `APP_ORIGIN`, then `http://127.0.0.1:3000`. For a different instance or a terminal without a browser:

```sh
pnpm agent connect --url https://your-instance.example --label "Training assistant"
pnpm agent connect --no-open
```

`--no-open` prints the approval link for you to open. Approval requests expire after ten minutes; grants last the owner-selected one, four or 24 hours. Declining, timing out or cancelling leaves an existing saved configuration unchanged. Ctrl+C attempts to cancel the request and revoke any newly approved but unsaved grant; if the server is unreachable, disconnect it in the app when connectivity returns. Run the connection command again when access expires or is disconnected; there is no silent renewal.

Ask your agent to read the [training skill](../.agents/skills/athlete-panel-training-planning/SKILL.md) and describe the desired program or adjustment. Its linked [coaching workflow](../.agents/skills/athlete-panel-training-coaching/SKILL.md) reads context before asking only material clarification questions; sufficient context proceeds directly. After essential answers, the agent prepares the requested scope and refreshes context if clarification paused the task. Questions use the harness's available interface or ordinary chat; no special planning mode is required. The agent handles these commands and the intermediate files:

```sh
pnpm agent context --out /secure/training-context.json
pnpm agent propose --file /secure/proposal.json
```

Configuration defaults to `~/.config/athlete-panel/agent.json`; `ATHLETE_PANEL_AGENT_CONFIG` selects another path. Credentials and exported files are atomically saved with mode 0600 and are not encrypted on the local filesystem. Keep context/proposal files outside Git. Runtime command schemas are documented in the [generated reference](reference/contracts.json). The grant permits context reads and proposal submission only. The owner reviews/applies the exact proposal in the app; there is no CLI apply command or SQL grant.

Advanced compatibility: an owner-created manual grant can still be configured using `pnpm agent configure --url https://your-instance.example --token-stdin < /secure/agent-grant.txt`. This command refuses interactive terminal input and recommends browser connection instead. Remote connections require HTTPS, credentials are never put in browser URLs, and CLI HTTP requests do not follow redirects.

## Verification

After password-policy changes, run `pnpm exec tsx scripts/benchmark-passwords.ts` to record synthetic single/concurrent-check latency and peak process memory; it reads no owner data and is not a timing-sensitive CI gate. Scrypt uses N=65536, r=8, p=2 and a 96 MiB allocation limit, with two concurrent login checks per web process. Legacy hashes upgrade on successful login. The coordinated migration/permission-refresh procedure installs the restricted upgrade function; previous artifacts require matched-backup rollback after a hash upgrade.

The guided local workflow has its own isolated rehearsal:

```sh
python3 scripts/rehearse-local.py
```

Run it after installing dependencies. It needs Python 3, Docker and cached pnpm dependencies; it copies source into a temporary checkout, uses the actual credential generator with isolated ports/project, tests terminal password entry and application startup, and removes only its temporary services/storage afterward. It never loads the owner's `.env`. Unit tests separately cover default credential generation, private file handling, port conflicts and child-process failure cleanup. The CI verification job runs both.

Start the disposable test service and explicitly point tests at it:

```sh
pnpm test:db:start
export TEST_DATABASE_URL=postgres://athlete_panel_test:synthetic-test-only@127.0.0.1:55439/athlete_panel_test
pnpm check
pnpm test:integration
pnpm build
```

The operations suite creates and drops uniquely named databases under the test server, exercising encrypted backup/restore rather than mocking `pg_dump`. Do not grant this test role access to production storage. Set `PG_BIN_DIR` if another PostgreSQL major version is first on `PATH`. Build and unit success do not establish Docker deployment, HTTPS, off-host durability, Garmin account permissions, or visual correctness.

For browser checks, use a separate local `_test` database, run migrations and the explicit demo seed there, build/start the app, set `PLAYWRIGHT_BASE_URL` and `E2E_PASSWORD`, install Chromium with `pnpm exec playwright install chromium`, then run the browser command. The suite requires an explicit `PLAYWRIGHT_BASE_URL` and refuses to mutate a server unless its readiness endpoint confirms isolated synthetic storage. Start that server with `ATHLETE_PANEL_E2E=true` and a loopback `_test` database; the flag changes no authentication or permission checks. It refuses remote hosts and never starts a server with inherited production configuration. Set `E2E_DATABASE_URL` to the same explicitly isolated loopback `_test` database used by that browser server. The onboarding browser suite resets only synthetic setup/profile/connection fixtures there and refuses missing or non-test targets. Review desktop and mobile layouts, keyboard use, light/dark themes and failure states as well as assertions. [CI](../.github/workflows/verify.yml) records the repeatable automated sequence.

Garmin routine tests use injectable transport and synthetic fixtures. An owner-account smoke check is a separate authorized step: configure the Personal API key and timezone in the app; health-history bounds are selected internally; check recent data, historical coverage/progress, retry after interruption, daily metric availability and a provider correction without duplicating records. Never paste API keys or real provider payloads into test fixtures or logs.

## Private-server installation

The recommended VPS path uses **Linux, Python 3.10+ and Docker Engine with Compose v2**. Node, pnpm and PostgreSQL client tools run inside the image. The primary path uses a reviewed, digest-pinned deployment bundle and prebuilt Linux image, a persistent server disk, a DNS hostname pointing to that server, and ports 80/443 available to Caddy. Arrange a mounted off-host backup directory dedicated to this installation first; supported filesystem checks cover NFS, SMB/CIFS and SSHFS. Provisioning the server, DNS and remote storage remains outside the application.

The release workflow targets `ghcr.io/bidulelabs/athlete-panel` and matching GitHub Release assets. Implementing the workflow does not mean a version has already been published: obtain an available image and matching bundle through that trusted release channel; see [release bundle preparation](#preparing-a-release-image-and-bundle). Do not substitute an arbitrary public image. From the extracted bundle directory:

```sh
python3 scripts/hosted.py install --domain training.example.com --backup-directory /mnt/offsite/athlete_panel
```

Choose and confirm the owner login password when prompted. The prompt does not echo or save it. The controller registers the remote storage identity, pulls the bundle’s immutable image digest, generates independent database passwords/application/backup keys, starts PostgreSQL, applies migrations, creates the owner, starts web/worker/Caddy and verifies HTTPS, saved data and fresh worker readiness. It reopens writes, starts the daily backup service and waits for its first authenticated backup. A bundle contains the controller and isolated-rehearsal helper, a pinned image descriptor and brief instructions. Download/extract it for review; there is no download-and-execute installer. Python only coordinates Docker and private checkpoints; application tools run inside containers.

Private operator state lives in `~/.local/share/athlete-panel/hosted` with mode 0700 and private files. Use `--state /absolute/private/directory` **before** the subcommand to choose another location, consistently for all commands. State contains generated `.env`, `.secrets`, the installed image/database identity, private rendered Compose configuration and operation checkpoints. It is separate from source checkouts; the controller never reads the checkout's `.env`. Keep the state directory outside the repository and backup destination.

Save a separate protected recovery kit containing `.env`, `.secrets/backup-key`, `.secrets/backup-storage.json` and `installation.json`. Keep this kit in a password manager or independently encrypted private store, separate from `.fgr` archives. It contains credentials. Keep pending `operation.json` too when preserving an interrupted operation. The controller cannot replace lost encryption keys.

Repeating install never resets an installed owner or regenerates existing secrets. After interruption:

```sh
python3 scripts/hosted.py status
python3 scripts/hosted.py resume
```

A missing configuration with existing database storage fails closed. Setup does not adopt an existing manually deployed Compose project or a local `pnpm run setup` database. Those installations retain the advanced procedures below until deliberately transferred; running this installer is not a migration of their data.

If readiness fails, inspect the relevant service, correct DNS/firewall/port/storage problems and resume:

```sh
python3 scripts/hosted.py logs --service caddy
python3 scripts/hosted.py logs --service worker
python3 scripts/hosted.py logs --service backup
```

Pull, metadata and build failures occur before the upgrade maintenance window; details are retained in the private state directory’s `build.log`. A failed setup/upgrade never reports success merely because containers started. Public certificate issuance and renewal, remote retention and physical-server recovery must still be rehearsed on the intended infrastructure. Log in and save/reload a manual workout after installation.

### Advanced manual Compose installations

Existing manual deployments may continue using their protected `.env` and the checked-in Compose file. `pnpm configure:hosted` remains a configuration-only tool for fresh manual deployments; it does not start services or establish remote-storage protection. Its secrets are created exclusively and never overwrite an existing `.env` or backup key. This path requires host Node/pnpm for that generator. The managed controller above supplies those tools through its image instead.

```sh
docker compose --profile backup config --quiet
docker compose build web
docker compose up -d --wait db
docker compose run --rm --no-deps admin pnpm db:migrate
docker compose run --rm --no-deps -T admin pnpm run owner bootstrap --password-stdin < /secure/owner-password.txt
docker compose up -d --wait web worker caddy
docker compose --profile backup up -d backup
```

The password file is temporary and mode 0600; remove it after bootstrap. The image contains web/worker builds, source for matched backups, runtime dependencies and PostgreSQL 17 client tools. Manual backups without a registered storage policy remain explicitly labelled as having unverified off-host protection.

## Backup policy and monitoring

Backups contain a custom-format PostgreSQL dump, source/configuration including pinned plugins and personal plugin source, migration checksums and public deployment metadata. Managed image backups also authenticate the local image ID, portable registry digest when available, version and source fingerprint. A source snapshot that differs from the built image is refused. Existing archives without image identity remain readable. `.env` files, `.secrets`, dependency/build directories, Git history and existing backup archives are excluded. The source composition and applied migrations must match the installed database. Run backups from the current immutable release; staging a new composition into that checkout before backing it up will correctly fail this check.

The archive streams through gzip and AES-256-GCM with a fresh random nonce. An authenticated completion tag and per-file hashes protect integrity. The final destination is read back and authenticated before a partial archive is renamed to a successful `.fgr` file. Backup and application keys remain separate. The script coordinates with domain and migration locks while collecting the database/source snapshot; long backups can temporarily delay writes.

The scheduled sidecar runs immediately at startup and then at the configured UTC hour. After each successful daily backup it retains the newest archive for seven distinct days and four distinct ISO weeks; a single archive may satisfy both. Manual backups are not pruned. A failed run logs `backup_failed`, keeps previous completed archives and tries again at the next scheduled time. Monitor both the process and the age of the newest off-host archive; a running container alone does not demonstrate successful backup. Alert externally if no successful daily archive arrives within 26 hours. Store periodic recovery evidence outside the archived instance.

Retention cleanup has a separate outcome: a verified archive keeps `backupAttempt.state=succeeded` even when `backupAttempt.retention=failed`. The `backup_retention_failed` log and scheduled failure heartbeat still report the storage problem. Inspect remote permissions/free space and let the next daily backup retry cleanup. Deployment accepts the verified archive with a warning instead of repeatedly restarting backups. An intentional SIGINT/SIGTERM cancellation preserves local failed-attempt status and cleanup but sends no failure heartbeat; missing-success monitoring continues to detect prolonged downtime.

Optional monitoring uses a private file in the operator state, `.secrets/backup-heartbeat.json`, owned by the operator with mode 0600. Set `success` to the monitor's secret HTTPS success URL and optionally `failure` to its failure URL. Obtain these from your chosen monitor; never put real URLs in source, shell arguments or logs. The next backup-service start mounts this file read-only. Configure the external monitor for daily signals plus a suitable grace period (for example 26 hours). Its missing-signal alert also detects a stopped VPS when that deadline passes, not immediately. Backup success is sent only after authenticated read-back and retention succeed; delivery has three attempts, each with a five-second timeout and no redirects. Notification failure is logged as `backup_notification`/`failed` and saved in `host.settings.backupNotification`, without endpoints or response bodies. A notification outage does not invalidate a completed backup. No additional scheduler or host monitor is needed. Real monitor activation is an operator action.

For a managed installation, create or independently verify an archive with:

```sh
python3 scripts/hosted.py backup
python3 scripts/hosted.py verify-backup --archive /mnt/offsite/athlete-panel/recorded-archive.fgr
```

The hosted controller checks the registered remote filesystem and its identity marker. Scheduled backups repeat these checks inside the container, before and after writing. An absent mount/marker fails instead of creating a local replacement folder. Fresh installation refuses a directory containing another installation’s marker or archives, preventing accidental key replacement or cross-instance retention. A marker alone is insufficient: the filesystem type and source fingerprint must match the registered network mount. Deliberately replacing storage requires a reviewed re-registration; never copy the marker onto a local folder to suppress a failure. Read-back verifies archive integrity, not remote-provider durability, deletion resistance or successful recovery after losing the VPS.

Advanced manual installations can create a pre-upgrade backup using the installed image:

```sh
docker compose --profile backup run --rm --no-deps backup pnpm backup
# Substitute the archive basename returned above:
docker compose run --rm --no-deps recovery pnpm backup:verify /backups/recorded-archive.fgr
```

The returned archive name identifies the exact recovery point. Record it along with the old release image tag and key locations. Never print key contents while checking them.

## Updating a local checkout

This is for installations created with `pnpm run setup`, not production Compose. Normal setup/startup deliberately refuses a new schema. Keep the installed checkout and its `.env`; prepare candidate source in a **separate directory**. Never edit source while its development server is running.

1. In the installed terminal, press Ctrl+C and wait for web and worker to exit. PostgreSQL stays running. `local:ops` refuses an active launcher lock or occupied configured web port.
2. Create an independent backup key once using the exclusive-write command above. Install matching PostgreSQL 17 client tools for local maintenance, or set `PG_BIN_DIR` to their directory. Keep keys separately recoverable.
3. In the **installed checkout**, close writes and create an authenticated pre-upgrade archive:

```sh
pnpm local:ops maintenance on
pnpm local:ops backup --key-file /secure/athlete-panel-backup-key --destination /mounted/off-host/athlete_panel
```

The command verifies the encrypted archive before reporting success. Record its filename and verify its off-host copy. Do not run the backup from changed candidate source: it must match the installed migrations and composition.

4. Copy the existing protected `.env` to the reviewed candidate checkout (mode 0600), preserving the same project name, ports, database passwords and application key. Carry forward personal plugins and composition; do **not** copy `.runtime/local-command.lock`. In the candidate:

```sh
pnpm install --frozen-lockfile
pnpm registry:generate
pnpm check
pnpm build
pnpm local:ops migrate --backup /mounted/off-host/athlete-panel/recorded-archive.fgr --key-file /secure/athlete-panel-backup-key
pnpm run local
```

Migration requires stopped local processes, maintenance mode, a valid encrypted archive and matching installed migration checksums. It never resets the owner or regenerates keys. It leaves writes closed. Inspect login, calendar and operational state. The worker may report maintenance while writes are deliberately closed.

5. Stop the candidate launcher, explicitly reopen writes, and restart:

```sh
pnpm local:ops maintenance off
pnpm run local
```

If a candidate fails, keep maintenance enabled. Reuse old code only when both SQL **and persisted JSON contracts** remain compatible. Otherwise restore the recorded matched snapshot using the restore procedure; a code downgrade is not a database rollback. Host-side restore uses the saved administrative URL, matching application key and separate backup key. Recover into a fresh database/project where possible and retain the failed database until recovery is confirmed. The [isolated local rehearsal](../scripts/rehearse-local.py) exercises maintenance, backup verification, an actual forward migration and reopening writes separately; the operations tests and production rehearsal exercise snapshot restore.

Local maintenance automatically reads `.env` as data and passes only the appropriate runtime/admin credentials to each operation. It does not source shell code or provision off-host storage. A valid archive is not proof it includes recent changes: create it immediately after stopping the installed release and enabling maintenance.

## Coordinated upgrades and plugin activation

For an ordinary managed installation, extract the next trusted **deployment bundle** into a separate directory and run its controller using the same account and persistent state location:

```sh
python3 scripts/hosted.py upgrade
```

The bundle selects its pinned digest. To select an image explicitly instead, use `upgrade --image registry.example.com/athlete-panel:VERSION` (replace the illustrative registry/version with the maintainer’s real reference). Private registries require a prior `docker login`; credentials stay in Docker’s configuration, never in an image reference. Tags are resolved once to an immutable local ID plus portable registry digest. Resume never follows a subsequently moved tag. Unversioned references and `latest` are refused. `status` reports the selected version/digest; Compose uses the recorded local ID with pulling disabled. Database, configuration, keys and named volumes remain outside the application image.

Image metadata compatibility and installed-plugin checks run before maintenance. Only trusted images are supported: images and source plugins are executable code, and matching fingerprints are integrity checks, not publisher authentication. A stock image cannot carry arbitrary local edits. See the custom path below.

The command performs the complete deployment in this order:

1. Lock and reload private state; pull/inspect the pinned candidate (or build custom source), validate platform/configuration, retained migrations and installed plugins.
2. Create a verified preparation snapshot. Restore it to disposable containers with separate storage and an internal network, apply candidate migrations/grants, and check schema, saved data, application health and a paused worker. Normal use stays open during this work.
3. Enable maintenance and drain mutations, then create the **final verified recovery point**. This includes writes accepted during rehearsal; the earlier preparation snapshot is not substituted for it.
4. Stop web/worker/backup together, apply migrations and refresh runtime grants. PostgreSQL stays running. Caddy keeps its stable configuration mount; explicit ingress changes are reloaded.
5. Start the candidate web/worker, verify schema/data/HTTPS and a fresh heartbeat from that image, select the release and reopen normal use.
6. Start the backup service and observe its matching startup backup. There is no separate controller post-upgrade backup. A failure reports **application deployed, backup failed**; `resume` retries only the backup service while normal use remains open.

Old images/databases and manual recovery snapshots are retained. `status` remains readable while an operation holds the lock. Private `operation.json`, `completed-*.json` and `rehearsal-result-*.json` record phase intent, attempts, durations, image/commit identity and recovery references. After interruption use `status` and `resume`; lingering operation containers are reconciled, recorded archives are authenticated again, and current readiness is rechecked. A committed migration is not reapplied because its journal records it; an interrupted permission refresh is retried. Finish operations created by an older controller with that controller before switching versions.

Ingress changes are validated before the mounted Caddyfile is written. A durable pending-reload record makes resume retry even when that file already contains the candidate configuration; unchanged ingress is not reloaded. If the previous worker misses the drain heartbeat deadline, the controller stops it with a 30-second grace period and confirms it is no longer running before the final snapshot. A failed stop keeps maintenance enabled and blocks migration. These rules do not relax the new worker's fresh-readiness requirement.

CI publication failures report the failed operation, exit code when available and a sanitized category such as permissions, network, rate limit, storage or conflicting assets. Command arguments, private paths, URLs and arbitrary remote stderr are withheld from public logs.

SQL migrations run in one exclusive transaction. A failed SQL migration rolls back its data/schema/journal changes. Runtime-role provisioning runs afterward: its failure means **the migrations have committed**. The CLI distinguishes these failures. Correct the underlying candidate/administrative configuration before retrying; if the prepared image itself is defective, recover the recorded snapshot rather than editing deployed source. A worker paused for maintenance remains healthy but does not import or claim work. If a prepared candidate fails validation **before maintenance starts**, use `python3 scripts/hosted.py cancel`, fix the source and start a new upgrade. Cancel is refused as soon as maintenance may have started; use resume or recovery then.

This controller supports PostgreSQL **17** and rejects a candidate declaring a different database major. Application schema migrations do not upgrade PostgreSQL's storage format. Database major-version upgrades require a separately rehearsed procedure; never change the image major and reuse the volume blindly. There is no unattended updater, automatic down migration or automatic destructive rollback.

### Custom images and source upgrades

Keep local changes, `personal-plugins/`, composition version pins and **all applied migration files** in a separate maintained source checkout. Merge the new upstream release there, resolve conflicts and run relevant checks against isolated storage. Do not mount source folders into the running production image.

Build on a development/build machine, then transfer the image with Docker save/load or push it to your own trusted registry. On the VPS select one of:

```sh
# An image already built or loaded on this VPS (never pulled):
python3 scripts/hosted.py upgrade --local-image athlete-panel-custom:v2
# Alternatively build the reviewed checkout on this VPS:
python3 scripts/hosted.py upgrade --source /absolute/path/to/custom-release
```

Use the same selectors with `install` for a new custom instance. A registry-hosted custom image uses `--image` normally. Switching from a source/local/older managed build to a registry image, changing registry repository, or dropping/disabling an installed plugin requires explicit review and `--accept-custom-changes`. This acknowledges the intended change; it does not merge customizations, bypass retained-migration checks or delete retained plugin data. An unchanged plugin ID alone cannot prove custom code was retained: compare and test your custom source before building. Never use this acknowledgement merely to dismiss an unexplained failure.

No application SQL migration is introduced by this image workflow. Existing managed state is read in place and gains image metadata at the next successful upgrade. Older source-built installations can upgrade through `--source`/`--local-image`; switching deliberately to a stock registry image needs the acknowledgement above. Finish any pending operation with the controller that started it before changing controller versions. Older manual Compose and local installations are not automatically adopted: use their existing coordinated procedures below. A controller protocol change or PostgreSQL major upgrade requires a separately documented transition.

### Preparing a release image and bundle

The existing Verify application workflow builds a Linux AMD64 candidate once, with the full commit in OCI labels and `.athlete-panel-release.json`. Build-stage/runtime exclusion checks run there. A run-scoped artifact carries the image tar, checksum, local image ID and metadata; all three parallel container rehearsals verify and load that exact artifact. Quality, setup, integration, desktop/mobile and security checks retain their existing parallel jobs. The `verify` and `container-installation` aggregates reject failed, cancelled and unexpectedly skipped prerequisites. Ordinary feature-branch pushes do not run CI; superseded PR runs remain cancellable.

After an authorized version tag such as `v0.1.0` is pushed, or manual dispatch selects that existing tag, all gates run before publication. The tag must match the package version and verified commit. Only the publication job receives package/release write access. It serializes the same release, loads the tested artifact without rebuilding, publishes version and `sha-FULL_COMMIT` tags to `ghcr.io/bidulelabs/athlete-panel`, pulls the resolved digest and verifies image/metadata identity. GitHub Release assets include `athlete-panel-deploy.tgz`, its SHA-256 checksum, `release-record.json` and sanitized `verification.json` with rehearsal timings. A retry preserves existing matching assets and refuses different contents; use a new version for changed contents. An interrupted draft can be completed. Published incomplete/conflicting releases require explicit investigation, not overwrite.

Use temporary feature branches and versioned prereleases; a permanent `dev` branch is not required:

| Version tag | Source and publication behavior |
| --- | --- |
| `v0.2.0-beta.1` (also `-rc.1` or another supported suffix) | May identify a feature-branch or main commit. Published as a GitHub prerelease, explicitly excluded from Latest. |
| `v0.2.0` | Must identify a commit reachable from freshly fetched `origin/main`. Published as a normal stable release; GitHub selects Latest without forcing an older retry over a newer version. |

Create the feature branch from main containing this release tooling and open a PR. Commit the root `package.json` version as `0.2.0-beta.1` before tagging that exact commit. An authorized releaser can then publish the example beta with:

```sh
git tag -a v0.2.0-beta.1 -m "Beta 0.2.0-beta.1"
git push origin refs/tags/v0.2.0-beta.1
```

Pushing the tag starts the full CI pipeline and gated publication; do not manually publish an empty GitHub Release first. Install the resulting digest-pinned bundle only on an explicitly selected test instance with separate database, storage, keys and synthetic data. Each further beta needs a new committed package version and new tag, such as `0.2.0-beta.2`. When ready, change the package version to `0.2.0` in the reviewed PR, merge, and tag the resulting main commit `v0.2.0`. CI tests and publishes that stable commit independently. Publishing a beta or merging a PR does not deploy either instance automatically.

Both channels use identical gates, image identity checks and immutable bundles. Every stable publication attempt refreshes main, including retries; an unavailable remote or failed ancestry check blocks publication. The CI checkout retains full history. An interrupted draft receives the correct prerelease/latest flags when completed. A published release whose prerelease classification conflicts with its tag is preserved and requires explicit investigation.

Repository administrators must configure an active `v*` tag ruleset restricting creation, updates and deletion, with only authorized release maintainers/admins allowed to bypass it, and enable release immutability for future releases. The GitHub ruleset is the authorization boundary: the stable/main check is a mistake guard in versioned code and cannot authorize an untrusted workflow. Upload all assets to the draft before publication; immutable releases cannot have their tags or assets silently replaced. Keep registry digests available separately for recovery. Source files alone cannot activate these GitHub settings.

Source and custom plugins remain in the image for matched backups. No application secret belongs in the build context. AMD64 is the current CI release architecture; custom images must match their server. Version labels are descriptive; the digest identifies the artifact. Source-only and older metadata without commit identity remain readable. Custom image builders may pass `--build-arg ATHLETE_PANEL_COMMIT=FULL_COMMIT` when it accurately identifies their reviewed source; retain source fingerprints regardless.

After a **separately authorized** image publication to the chosen registry, capture its real immutable registry digest (not `docker image inspect`’s local image ID). Create the small bundle locally:

```sh
python3 scripts/package-release.py --image registry.example.com/athlete-panel@sha256:REPLACE_WITH_REAL_DIGEST --output athlete-panel-deploy.tgz
```

The example reference is intentionally nonfunctional. The command requires a real 64-hex digest, writes a deterministic bundle and adjacent SHA-256 checksum, refuses overwrites, and never pushes or publishes anything. Add `--commit FULL_COMMIT` for a known matching image. Review/distribute that custom bundle through its trusted release channel. A checksum detects damage; it does not establish publisher identity. The CI publication command is `python3 scripts/release-ci.py publish --commit FULL_COMMIT --repository bidulelabs/athlete-panel --tag vVERSION`; it requires the candidate artifact, successful rehearsal reports and authenticated registry/GitHub access. Do not run it as an ordinary deployment command.

CI rehearses both source recovery and registry installation with `python3 scripts/rehearse-hosted.py --image athlete-panel:release-check --registry`. The registry is a disposable container bound to loopback, not a public service. Keep old published image digests available for recovery; custom users should retain a saved image as well as source and backups. Registries/base images/dependency availability remain external recovery dependencies.

### Advanced manual upgrades and plugin activation

Rehearse the candidate release against a restored isolated backup first. Review public contract compatibility, personal plugin source and version pins, dependency ordering, migrations, unit/integration/build/browser checks, and the recovery path. Applied migration files are immutable and must remain at their recorded paths even if a plugin is disabled or its runtime is removed from composition. Retain its migration artifacts and version provenance with the source release; removing the entire directory would make a matched backup impossible. A disabled plugin's records and migration history remain stored; a later version must remain compatible or provide explicit forward migrations.

Compatibility includes persisted JSON contracts, not just migration checksums. The week-start preference adds an optional profile field; once saved, a binary predating that field rejects it under its strict schema. Use a matched pre-change snapshot for that rollback even though no SQL migration was added.

For an existing production instance, keep the old checkout/image and use this order:

1. Prepare a separate candidate checkout, retaining reviewed personal plugins, composition pins, migration artifacts and protected deployment configuration. Choose a new image tag. Stage intended plugin changes only through the explicit process below.
2. Build the candidate image before downtime; the image build generates its registry. Keep the installed image and checkout.
3. In the installed release, enable maintenance, create and verify a matched backup, confirm its off-host presence, then stop web, worker and scheduled backups. Caddy can remain running during downtime.
4. From the prepared candidate, run migrations and verify schema/composition before restarting application processes.
5. Start web/worker, check HTTPS and worker readiness in maintenance, then disable maintenance and restart scheduled backups. Perform a manual create/reload/undo check.

Canonical operational commands for that sequence are:

```sh
# Prepare the candidate checkout with a new release tag and copied instance configuration:
docker compose build web

# Installed release checkout/image:
docker compose run --rm --no-deps web pnpm ops maintenance on
docker compose --profile backup run --rm --no-deps backup pnpm backup
docker compose --profile backup stop web worker backup

# Return to the prepared candidate checkout:
docker compose run --rm --no-deps admin pnpm db:migrate
docker compose run --rm --no-deps web pnpm ops verify-schema
docker compose up -d --wait web worker
docker compose run --rm --no-deps web pnpm ops maintenance off
docker compose --profile backup up -d backup
```

Run `pnpm plugins stage` only when desired plugin changes exist and the candidate host environment can reach the intended database. With the database private inside Docker, use the following before registry generation, substituting the actual installed image tag for `previous-release`. This mounts only the candidate composition file and writes it as the checkout owner while the old image supplies its compatible registry and runtime:

```sh
ATHLETE_PANEL_RELEASE=previous-release docker compose run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  -v "$PWD/instance/composition.json:/app/instance/composition.json" \
  web pnpm plugins stage
```

Alternatively transfer a reviewed composition change manually. Staging is not necessary for an ordinary upgrade with unchanged composition. The prerequisite is a reviewed candidate file, not an exposed production database port.

If build or verification fails, keep maintenance enabled. A previous image can be restarted only when its composition and all applied migration semantics remain compatible; image rollback alone never reverses a database migration. If compatibility is uncertain or a migration changed data, use the matched backup recovery below. Do not remove a database volume to make an upgrade pass.

## Restore and owner recovery

### Test restoration without changing the live installation

Run on demand, for example after changing storage/keys or as a periodic operator exercise:

```sh
python3 scripts/hosted.py restore-test
# Or choose a specific completed archive:
python3 scripts/hosted.py restore-test --archive /mnt/offsite/athlete-panel/recorded-archive.fgr
```

The default is the installed database's most recent successful backup. The command authenticates it and selects its matching release, then uses the same isolated runner as upgrade preparation. It publishes no ports, uses an internal network and its own PostgreSQL volume, mounts only the selected archive/key, and leaves provider jobs paused. It validates schema, persisted data, app and worker. Cleanup verifies run-specific labels before removing resources. An interruption is resumable; `cancel` can discard an isolated test's temporary resources without altering live data. Ensure enough spare disk/memory for a second database/application and source extraction; resource contention can still affect the live VPS. No monthly scheduler is installed. Keep the resulting evidence, and separately exercise recovery on another machine with independently recovered keys to prove loss-of-VPS recovery.

### Managed recovery after a failed update

Use the recovery archive reported by `status` or the saved completed/failed operation record. Recovery deliberately returns data to that snapshot; changes made after it are absent from the recovered database. The current database is retained.

```sh
python3 scripts/hosted.py status
python3 scripts/hosted.py recover --archive /mnt/offsite/athlete-panel/recorded-archive.fgr --confirm-recovery
```

Recovery selects compatible tools and authenticates the archive before stopping services. It creates a uniquely named database and restores the snapshot and matching source into new locations. For image-aware archives it reuses the recorded local image or pulls the archived registry digest, verifies its source fingerprint/version, refreshes grants, checks HTTPS/worker readiness and another backup, then switches the application to the restored database. Recovery does not select the newest tag. The owner password and encrypted provider credentials survive; sessions and agent grants are revoked. Sign in again, confirm the saved workspace/history, and test a new save. The prior database is never automatically deleted.

If a custom image has no registry digest, load its saved image before recovery. If the matching image is unavailable, deliberately add `--rebuild-source` to rebuild authenticated archived source. The rebuilt source fingerprint must match; dependency/base-image availability is required. Older archives without image identity automatically use source rebuilds. If recovery tools themselves are unavailable, supply a compatible `--image`, `--local-image` or `--source`; this selects the tools, not permission to run mismatched application code against restored data.

Use `resume` for checkpointed steps. If a restore was interrupted after creating its source directory but before recording completion, the helper refuses to overwrite that ambiguous attempt: run `recover` again to allocate a new database/source location. Preserve the previous attempt for inspection. Restoring an old image alone is never presented as reversing a database migration.

### Managed recovery after losing the VPS

1. On the replacement Linux server, install Python 3 and Docker Compose and obtain a reviewed deployment bundle containing a compatible controller (or source release for advanced recovery). Mount the original remote backup directory at the recorded path and point the original domain at the replacement server. Public ports 80/443 must reach it.
2. Recover the protected operator kit into the chosen state location: `.env`, `.secrets/backup-key`, `.secrets/backup-storage.json` and `installation.json`. Use directories mode 0700, files mode 0600, owned by the account running the controller. Keep the recorded project/database identity. Do **not** run fresh installation or generate replacement keys.
3. Run the same `recover --archive ... --confirm-recovery` command above. It starts a fresh PostgreSQL cluster when absent; old checkout paths are not required. Missing registry images are pulled by recorded digest. For custom/legacy images, supply compatible recovery tools and either load a saved image or use the archived-source rebuild fallback.
4. Sign in, verify records and provider-credential availability, create a new record and verify a new backup. Confirm certificate renewal and retain independent recovery evidence. Only an actual second-server exercise establishes disaster recoverability.

The recovered kit must retain the original application encryption key **and** independent backup key. Archive authentication fails before a database replacement when either is missing/wrong. A changed remote-storage source fingerprint needs deliberate operator review, not bypassing the checks.

### Advanced manual restore and owner recovery

Restoration is a deliberate replacement operation. Obtain the selected `.fgr`, its backup key and its original application `ENCRYPTION_KEY` from their separate stores. Stop web, worker and backup before touching data. For an existing usable instance enable maintenance first. The restore command requires `--confirm-replace`, refuses administrative databases, requires an empty target or a recognized maintained instance with no extra tables, and always extracts source to a new directory.

Prefer recovery into a **new database** so the current state remains available for diagnosis. Against the running dedicated Compose database service, create a distinctly named database, then change `POSTGRES_DB` in the recovery checkout's protected `.env` to that name. Do not change the database password or key accidentally when selecting the target.

```sh
docker compose --profile backup stop web worker backup
docker compose exec db createdb -U athlete_panel athlete_panel_recovery_20261024
```

After selecting `POSTGRES_DB=athlete_panel_recovery_20261024`, make a protected host recovery directory and mount it into the one-off recovery service. Substitute the recorded archive basename:

```sh
umask 077
mkdir -p recovery
docker compose --profile backup run --rm --no-deps \
  -v "$PWD/recovery:/recovery" recovery \
  pnpm restore /backups/recorded-archive.fgr \
  --confirm-replace --source-dir /recovery/matched-source
```

The entire archive authenticates before source extraction or target database modification. A missing/wrong key, tampered archive, mismatched application key or migration checksum fails before replacement. `pg_restore` applies its work in one transaction. If a later verification fails, leave services stopped and investigate. The successful restore sets maintenance on, clears sessions and previous-machine worker/backup status, revokes agent grants and requeues interrupted jobs; the original owner password and encrypted provider credentials are retained.

Use the recovered `matched-source` as the release source. The one-off container runs as root to read the protected mounted backup key; recovery files can therefore be root-owned. Assign them to the intended deployment owner before using host development tooling, without relaxing secret file permissions. Recover `.env` and keys separately, retain the same Compose project name/volume mapping, select the recovered database, install pinned dependencies and build that source. Run `docker compose run --rm --no-deps admin pnpm db:migrate` from that matching source to restore runtime grants (dumps deliberately contain no ACLs). Verify composition/schema before serving it. Start web/worker, inspect HTTPS health and saved workspace/history in maintenance, then disable maintenance using the documented operation. Restart the backup sidecar with the recovered release. Keep the old database until the owner has verified the recovery; deleting it is a separate explicit action.

If only the owner password is lost, use `pnpm run owner recover --password-stdin` through the installed `admin` service with protected stdin, then log in again. This invalidates all sessions and grants but does not erase training data. If the application encryption key is lost, encrypted Garmin credentials cannot be recovered from the database alone; restore the matching key or deliberately reconfigure provider credentials through an authorized recovery process.

## Extension and documentation maintenance

Use [the plugin-development skill](../.agents/skills/athlete-panel-plugin-development/SKILL.md), public SDK/contracts/UI and the personal plugin directory. Source plugins are trusted application code, not a security sandbox. Review code and permissions before including it in a build; retain personal source, manifests and migration files across upgrades. The scaffold only creates files; activation follows the maintenance/build/migration procedure above.

Keep canonical skills under `.agents/skills`; regenerate and check Claude adapters after edits. Use the [feature template](templates/Feature-Template.md) for a new capability or changed persisted behavior/permission/contract, update [architecture](architecture.md) for boundary changes, and use an [ADR](templates/ADR-Template.md) for consequential decisions. Preserve the supplied framework/templates and legacy checkout. Follow [framework validation](Framework-Guide.md#validation), including semantic review beyond automated link checks. No command or passing test in this guide asserts that a real private server has already been deployed.

## Runtime database access and existing installations

Migrations and owner recovery require the administrative connection. Web/worker receive `athlete_panel_app`, which has schema usage and table read/write permissions, but cannot create roles, databases, schemas or temporary tables, truncate tables, or modify the owner password and migration journal. Grants are refreshed after every migration for new plugin tables. This is a dedicated single-application database: provisioning removes PUBLIC create/temporary privileges and must not be applied to a shared unrelated database.

For an existing installation, take a verified pre-change backup, stop application processes, add a new independent `APP_DATABASE_PASSWORD`, retain the current administrative password as `POSTGRES_PASSWORD`/`ADMIN_DATABASE_URL`, and change runtime `DATABASE_URL` to `athlete_panel_app`. Build the candidate image, run its migration command through `admin`, then start web/worker and verify login and a save. This changes permissions without migrating or deleting athlete records. The repository does not apply this transition to an already running owner instance automatically.

## Operational feedback and release rehearsal

The continuously running worker schedules a Garmin recent import about once per hour while connected and unpaused, refreshing the latest seven days. It checks eligibility approximately every 30 seconds between job steps. This is an interval from the latest recent job’s creation, not a fixed clock-hour appointment. Ongoing jobs, provider backoff and maintenance can delay execution. A scheduler code change requires restarting the local worker or rebuilding/redeploying the hosted image; no database migration is needed for an interval change.

Plugins → Instance status refreshes every 30 seconds; Settings also provides an Instance status and recovery section. A heartbeat older than 90 seconds is marked unavailable. A failed scheduling/job iteration persists a sanitized failure state and count; only a successful iteration clears it. Raw exception messages are not stored. Worker health checks fail for both stale and failed states. Backup status distinguishes not configured, in progress, failed, potentially stalled (over one hour), recent and overdue (over 26 hours). Failure status never includes keys, raw database errors or private paths. If the database itself is unavailable, status cannot be persisted; inspect container logs too. A recorded next-run time is the configured schedule, not proof the scheduler is still alive. An archive without verified registered remote storage is explicitly labelled as unverified off-host protection; it is not a green backup-protection result.

Garmin shows a saved key as waiting for verification until a successful account-bound import. Key replacement requires new verification. Import activity shows the current stream/date window and retry time; coverage reports totals across all windows. The Garmin page provides pages of 50 windows, filters for failed/unavailable periods, and a date-range retry action; the embedded workspace snapshot remains capped. A verified account with failed/unavailable history is explicitly marked as needing attention. The active job is selected independently of recent job-list limits. Missing days/measurements are explicit. It does not invent a percentage or guarantee Garmin retains all historical data.

Run `python3 scripts/rehearse-release.py` for an isolated container rehearsal. Python 3 and Docker are required. See [release checks](release-readiness.md) for its boundaries, secret scanning, final publication-tree review and actual off-host/server acceptance. Existing application data is not a test fixture.

## Hosted workflow rehearsal

```sh
python3 scripts/rehearse-hosted.py
```

The harness runs the actual controller in private temporary state with unique Compose projects/volumes, generated synthetic credentials and loopback HTTPS using Caddy’s local CA. It never loads the owner configuration. It exercises installation, repeat-install preservation, restart persistence, missing-storage rejection, a real forward migration, interruption immediately after commit and resume, old-artifact rejection, matched-source restoration with login/new saves/backups, and a replacement empty cluster with independently copied keys. Supply `--image <local-tag>` to reuse a built base image; it is retained. Synthetic storage is available only through the imported test harness, never a public CLI flag. The container guard also requires loopback origin and a `_test` database for that fixture. This is not an actual NFS/SMB/SSHFS or physical second-server test.

## Shared UI component maintenance

The web and UI workspaces carry `components.json` files. Source is owned by `packages/ui/src/components`, exported through `@athlete-panel/ui`, and scanned by `packages/ui/src/styles/shadcn.css`. The selected generator is shadcn **4.22.1**, `radix-nova`; runtime dependency versions are exact in the UI manifest and transitive dependencies are pinned by pnpm. Generate a component from the repository root with `pnpm dlx shadcn@4.22.1 add <component> --cwd apps/web`, review all generated changes, and retain the local theme, wrapper and focus adaptations. Do not overwrite existing source without reviewing the diff.

Use `pnpm install --frozen-lockfile` to reproduce dependencies. Run `pnpm check`, `pnpm build` and the existing isolated browser workflow after shared UI changes. The browser matrix covers both themes, six calendar widths, tooltips/popovers, nested overlays, native form behavior, agent approvals and Garmin fixtures. Maintain representative screenshots across plugin pages. This migration needs no SQL migration; rollback restores the previous source and lockfile and rebuilds/restarts through the normal local or authorized deployment procedure.

## Garmin sport contract upgrade

The [sport planning specification](features/garmin-sport-planning.md) introduces contracts/training/history version 2 without a new SQL migration: optional values remain in existing JSON records. Coordinate the pinned plugin composition, regenerate references/registry with the canonical commands above, then build and deploy with a verified matching backup. Older releases may reject newly saved types or prescriptions.

Activity-only historical reimport is the supported way to enrich existing imported records with Garmin groups/subgroups and TSS/IF/normalized power. It retains stable activity IDs and annotations. Resolve classification conflicts through the existing UI before retrying a failed import window; never bypass link validation or infer identity from a title.
