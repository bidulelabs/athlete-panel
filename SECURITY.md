# Security policy

Athlete Panel holds private training and health data. Please report vulnerabilities privately, without sharing Garmin keys, passwords, agent credentials, database dumps or real athlete records.

## Reporting a vulnerability

Sign in to GitHub and use the [private vulnerability reporting form](https://github.com/bidulelabs/athlete-panel/security/advisories/new). Include the affected release or commit, steps to reproduce with synthetic data, the expected and actual behavior, and the likely impact. Keep exploit details out of public issues.

## Supported versions

Security fixes target `main`. Older releases have no guaranteed support window or backports. For a managed installation, check the [published releases](https://github.com/bidulelabs/athlete-panel/releases) for a version containing the fix and follow the [upgrade guide](docs/development.md#coordinated-upgrades-and-plugin-activation).

## Deployment boundaries

- The default installation serves HTTPS through Caddy. An [adopted Compose installation](docs/development.md#adopting-an-existing-compose-installation) can use its existing HTTPS proxy. With `TRUST_PROXY_CLIENT_IP=true`, only the trusted proxy may reach the web port. On every request it must overwrite `X-Athlete-Panel-Client-IP` with the client address it verified, even when the client supplied that header. Login limits use this value. Keep the worker and PostgreSQL private.
- Web and worker use the restricted `athlete_panel_app` database role. Migration, owner recovery and restore use a separate administrative connection. Do not supply administrative credentials to application containers.
- Login limits apply per source address (IPv6 /64). Users behind one shared address share a limit; console recovery clears attempts and revokes sessions and grants. This reduces account-wide lockout but is not protection against every distributed denial-of-service attack.
- Garmin keys and cached tokens are encrypted using the separately held application key. Database backups contain personal data and require their independent backup key. Losing either key can prevent recovery.
- An owner can grant history reads by date and category. Separately, planning access lets the agent read planning context and submit proposals for the approved period. Only the signed-in owner can apply or undo a proposal. External model providers may receive context when an agent uses them. A coding agent with filesystem/server credentials has whatever access those credentials grant; API grants are not a machine sandbox.
- Source plugins are trusted in-process code. Review them before building and activating them.

## Safe diagnostics

Use synthetic fixtures. Keep exports in the ignored `private-exports/` directory and redact diagnostic output before sharing it. Automated scanners do not prove that screenshots or arbitrary JSON contain no personal information. Review the exact publication tree and image contents using the [release checklist](docs/release-readiness.md).

If a secret was committed, revoke or rotate it first. Removing the latest file does not remove old Git objects or copies. Coordinate history remediation and affected-user communication privately; do not rewrite shared history automatically.
