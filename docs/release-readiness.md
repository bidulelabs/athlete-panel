# Public release checks

This is a reproducible release gate, not evidence that a release has already passed. Record actual outcomes against the exact commit and image digest in the release/task record. Checks use synthetic data. The workflow publishes only for a version-tag push/manual dispatch on that tag after all gates succeed; ordinary checks do not publish.

## Before committing or publishing

1. Review changed files, commit identity/email, screenshots and third-party asset rights. Pseudonyms and private commit email addresses are supported. Remove personal home-directory paths from public documents.
2. Keep `.env`, keys, database dumps, agent credentials and exports outside Git. Use `private-exports/` for context/proposals. The image copies declared source roots only, and Docker exclusions also block conventional private filenames.
3. Inspect the current candidates with `python3 scripts/publication-check.py --worktree --inventory .runtime/publication-candidates.json`. After deliberately staging your chosen files, run `python3 scripts/publication-check.py --staged`. After committing, run `python3 scripts/publication-check.py --ref HEAD`. The last two read exact Git bytes, not newer working copies. The inventory contains paths/hashes and flags media for manual review; it contains no file contents.
4. Run the history scanner from [CI](../.github/workflows/verify.yml) against all reachable history with fully redacted output. An unborn repository has no committed history to scan. Ignoring a file does not remove an already staged or committed copy. Pattern scanners cannot recognize every health export or identifying image.
5. Enable GitHub private vulnerability reporting and verify that **Security → Report a vulnerability** works. Configure branch protection to require `verify`, `publication-security` and `container-installation`. Restrict `v*` tag creation, updates and deletion to authorized releasers, and enable release immutability for future releases. These repository settings require owner action on GitHub and are not activated by source files.

## Local and CI verification

The `container-build` job exports one AMD64 runtime image with its archive checksum, image ID and full commit metadata. All three container rehearsals download and verify that artifact; the runtime vulnerability scanner inspects the same tar. `verify` and `container-installation` reject failed, cancelled or skipped prerequisites. Version publication also requires publication-security, and is serialized per version without cancelling active publication. The publication helper refuses mismatched commit, version, image or evidence and never rebuilds. It verifies the pushed digest by pulling it before creating the deployment bundle and release reports. Existing version/commit tags and published assets cannot silently change on retries; a matching interrupted draft may be completed. Review actual CI results and release reports, not just the existence of a tag. The [execution record](plans/deployment-recovery.md) distinguishes local validation from real GitHub/GHCR publication.

Beta/rc tags use that same pipeline from feature branches and publish as prereleases excluded from Latest. Stable tags require membership in freshly fetched main. Verify both initial publication and interrupted-draft completion flags, published-classification conflicts, and rejection of a feature-only stable commit or stale main reference. Local Git repositories and mocked remote writes exercise these boundaries in the Python security suite. Follow the canonical [release procedure](development.md#preparing-a-release-image-and-bundle); passing synthetic checks is not evidence of a real GitHub/GHCR publication.

Run the checks described in [development](development.md#verification), including integration and browser tests against disposable storage. For the packaged application:

```sh
python3 scripts/rehearse-release.py
```

Requires Python 3, Docker Engine/Desktop and Compose v2. It builds a unique image, creates an isolated Compose project and random credentials, binds HTTPS to a temporary loopback port, and cleans up only its own containers/volumes/files. It never reads your `.env`. An already-built candidate can be supplied with `--image <local-tag>`; that image is retained.

The rehearsal checks production pnpm execution, migrations, console owner bootstrap, TLS certificate verification using Caddy’s local CA, secure session cookies, authenticated workout creation, restricted runtime roles, restart persistence, worker health, encrypted backup and restore into a separate database, missing-key rejection and refusal of a changed applied migration. Integration tests cover transactional failed migrations and other restore protections. `python3 scripts/rehearse-hosted.py` additionally exercises the managed VPS controller, a real schema upgrade interrupted after commit, recovery through a rebuilt matching application with login/saves/new backups, and a fresh replacement cluster. `python3 scripts/rehearse-hosted.py --image <local-tag> --registry` additionally exercises a source-free bundle, a disposable loopback registry, immutable pulls, custom/plugin guards and recovery without source compilation. Release bundle packaging is allowlisted and digest-only; only the gated version-tag publication job writes to GHCR/GitHub Releases. Its explicitly synthetic storage does not prove an actual remote filesystem or physical-server recovery.

CI additionally scans reachable Git history with Gitleaks, locked dependencies and the built container with Trivy. Scanner versions/images and GitHub actions are pinned. Scans execute on the runner; vulnerability databases are downloaded. Private source and health data are not submitted to an external scanning service. The production runtime uses a pinned Node Alpine image, PostgreSQL client tools only, production dependencies and pnpm 11.28.8. npm/Yarn and build/test packages are absent from the installed runtime dependency tree. High/critical vulnerabilities fail CI even if no fix exists; investigate and document any narrowly scoped, time-limited exception instead of disabling the checks or adding blanket ignores. Scan databases and upstream images change, so a previous pass is not permanent assurance.

The [Gitleaks configuration](../.gitleaks.toml) retains every built-in detection rule. Its generic API-key rule excludes only seven verified public Garmin sport identifiers, requiring both the exact catalog path and a complete matching `typeKey` line. Other fields, values, files and provider-specific rules remain scanned. Changes to this exception require review and negative-control scans with the pinned scanner, including credential-like values in the catalog and matching text outside the allowed context. This exception addresses public taxonomy false positives, not accepted credential exposure.

## Operator acceptance on the intended server

The local rehearsal cannot verify these external conditions. Complete and record them before treating a real deployment as production-ready:

- DNS and public HTTPS certificate validation on the actual domain, including renewal/restart behavior.
- Reachability only through the intended ingress; database and raw web ports are private.
- Successful scheduled archive on the real off-host destination, with keys separately recoverable.
- Restore on another machine using the archive and separately recovered keys, followed by owner login, saved records, imports and a new successful backup.
- Confirm the release bundle’s pinned digest matches the tested image, supported architectures and trusted publisher. Preserve previous release digests and custom-image/source recovery options.
- Candidate upgrade against a restored copy; demonstrate compatible code rollback or matched snapshot recovery, with the old image/source retained.
- Owner-authorized Garmin verification for the actual account, selected metrics, corrections, retry behavior and historical gaps. Never attach real provider payloads to public test evidence.

A local restore into a second database demonstrates the restore mechanism, not off-host durability or recovery after losing the server.

## Publication and image follow-up

The 2026-10-25 audit findings concern exact source/index/image bytes, not all future releases. The owner reconciled the previously flagged staged documents before the priority-fix implementation began: all 229 indexed files passed the pattern check. Re-run both staged and committed scans after applying this candidate; no source publication or GitHub setting change has been performed.

The priority-fix runtime removes the PostgreSQL server/gosu and Debian utility dependency surface from application processes, prunes development packages, removes bundled npm/Yarn and updates the pinned pnpm release to remove its vulnerable undici copy. The database service remains a separate PostgreSQL 17 service; application-image changes do not upgrade an existing database. The esbuild override keeps the existing build toolchain on one pinned version. Functional container and backup/restore rehearsals remain mandatory after base-image or tooling changes. No blanket vulnerability exclusions are introduced.

Screenshots and mockups remain review items: synthetic calendar screenshots and design references must not be represented as proof of asset ownership or Garmin endorsement. Confirm mockup/avatar provenance and redistribution rights before publication. Pattern scans cannot establish those rights or identify every personal fact. GitHub private reporting, branch protection, public TLS, off-host delivery, second-machine recovery and owner-authorized Garmin checks remain external acceptance steps.
