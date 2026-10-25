# Security policy

Athlete Panel holds private training and health data. Please report vulnerabilities privately, without sharing Garmin keys, passwords, agent credentials, database dumps or real athlete records.

## Reporting a vulnerability

Use this repository’s **Security → Report a vulnerability** form when private vulnerability reporting is enabled. Include the affected version, a synthetic reproduction, expected and actual behavior, and likely impact. Do not open a public issue containing exploit details or sensitive data.

If the private reporting form is unavailable, do not post the vulnerability publicly. Ask the maintainers to enable a private reporting channel without disclosing the issue. Maintainers must enable and verify GitHub private vulnerability reporting before the first public release. No email address or response-time guarantee is currently established.

## Supported versions

This project is pre-release. Security fixes target the current development branch; older snapshots do not have a promised support window. Use a reviewed release, run its verification checks, and follow the [upgrade and recovery procedure](docs/development.md#coordinated-upgrades-and-plugin-activation).

## Deployment boundaries

- Production exposes Caddy over HTTPS. Keep web, worker and PostgreSQL on the private Compose network. Do not expose the web port when `TRUST_PROXY_CLIENT_IP=true`: only Caddy may supply the client-address header used for login limits.
- Web and worker use the restricted `athlete_panel_app` database role. Migration, owner recovery and restore use a separate administrative connection. Do not supply administrative credentials to application containers.
- Login limits apply per source address (IPv6 /64). Users behind one shared address share a limit; console recovery clears attempts and revokes sessions and grants. This reduces account-wide lockout but is not protection against every distributed denial-of-service attack.
- Garmin keys and cached tokens are encrypted using the separately held application key. Database backups contain personal data and require their independent backup key. Losing either key can prevent recovery.
- Agent grants permit bounded context reads and proposal submission. Only the signed-in owner can apply or undo a proposal. External model providers may receive context when an agent uses them. A coding agent with filesystem/server credentials has whatever access those credentials grant; API grants are not a machine sandbox.
- Source plugins are trusted in-process code. Review them before building and activating them.

## Safe diagnostics

Use synthetic fixtures. Keep exports in the ignored `private-exports/` directory and redact diagnostic output before sharing it. Automated scanners do not prove that screenshots or arbitrary JSON contain no personal information. Review the exact publication tree and image contents using the [release checklist](docs/release-readiness.md).

If a secret was committed, revoke or rotate it first. Removing the latest file does not remove old Git objects or copies. Coordinate history remediation and affected-user communication privately; do not rewrite shared history automatically.
