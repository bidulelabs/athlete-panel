# Contributing to Athlete Panel

Contributions that make private training easier to plan, understand and maintain are welcome: bug reports, documentation, accessibility improvements, tests and focused features.

## Start here

Read the [README](README.md), [development guide](docs/development.md), [architecture](docs/architecture.md) and [working instructions](AGENTS.md). The development guide is the command authority. Use Node.js 22.13 or newer in the Node 22 line, pnpm 11.28.8, Docker Compose v2 and isolated PostgreSQL 17 test storage. No Garmin key or model subscription is needed for normal development or CI.

Discuss a substantial feature in an issue before implementing it. Explain the user problem and a small first version. Use synthetic athletes and measurements; never attach real health exports, credentials or an unredacted `.env` file. Report vulnerabilities through [SECURITY.md](SECURITY.md), not ordinary issues.

## Making a change

1. Create a focused branch. Keep existing local data and private instance configuration out of the change.
2. Put domain behavior in its owning plugin. Use the public contracts and SDK for extensions. Applied migrations are immutable; add a new migration when necessary.
3. Update the relevant feature specification when behavior, stored data or permissions change. Record consequential architecture decisions separately.
4. Run the relevant checks from the development guide. Use the disposable test database, not your daily instance. UI changes should include synthetic screenshots in both themes and a narrow viewport.
5. Review the exact staged publication scan and diff. Open a pull request explaining the problem, the behavior after the change, verification performed and any limits.

Do not claim a Garmin live check, deployment or recovery test unless it actually ran. CI uses synthetic data and cannot establish a particular Garmin account’s historical coverage.

## License and attribution

Contributions are provided under the project’s [MIT license](LICENSE). Only contribute code, text and assets you have the right to redistribute. Identify copied third-party material and its license in the pull request; keep required notices. Pseudonymous contributions are welcome. Configure your Git identity and a private/noreply commit email before committing if you want to keep your personal identity private.
