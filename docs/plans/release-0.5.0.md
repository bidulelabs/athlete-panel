# Release 0.5.0

## Scope

The owner requested a version bump for a new release on 2026-11-13. The previous stable release is v0.4.0. Version 0.5.0 includes the merged plan phases, phase-aware agent planning, calendar navigation/accessibility improvements and Docker worker process-reaping fix. This preparation changes only release metadata and documentation.

The root package version is 0.5.0. Existing Unreleased notes and upgrade guidance now appear under the dated v0.5.0 heading, with absolute links to the tagged documentation and release. Unreleased remains available for subsequent changes. Plugin versions, contracts, migrations and dependencies are unchanged by this preparation.

## Verification

- Release-tag security suite: all 10 tests passed, covering stable-main ancestry, prerelease classification, version matching and changelog extraction. The publisher's parser also accepted the working-tree v0.5.0 entry with its date, upgrade subsection and tagged links; exact committed extraction remains a publication gate.
- `pnpm check`: passed formatting, lint with no errors (187 existing warnings), generated-file freshness, import boundaries, both TypeScript checks, all 471 unit tests in 56 files and documentation validation. The initial sandboxed attempt stopped because tsx could not create its local IPC socket; the completed run permitted that local process access.
- `pnpm test:integration`: all 288 tests in 21 files passed against a separate synthetic PostgreSQL 17 database. The usual port was occupied by another preview, so this run used an isolated Compose project on loopback port 55451 with the repository's test configuration. Its container and network were removed afterward.
- `pnpm build`: passed the production web and worker build. Generated Next.js environment-file changes were reverted to keep the release diff scoped.
- Working-candidate and staged publication scans: passed with zero findings; no media files changed. The pinned Gitleaks scanner checked all 188 reachable commits with fully redacted output and found no leaks. Previously released changelog entries remain byte-for-byte unchanged, and the final diff passes whitespace checks. Exact committed scans remain a publication gate and must be repeated for the release commit.
- Browser, container and hosted security gates were not run locally for this metadata-only preparation. The required GitHub workflow must pass before merge and again before tag publication; these local results do not establish publication or deployment.

## Documentation validation

Scope: the changelog and this execution record. The release entry retains existing feature and upgrade guidance, has one dated version heading and uses tagged absolute links suitable for the generated GitHub release notes. Existing architecture and feature specifications remain authoritative; no new ADR or diagram is needed. Commands remain canonical in the [development guide](../development.md#preparing-a-release-image-and-bundle).

| Topic | Canonical document | Coverage completed | Remaining gaps |
| --- | --- | --- | --- |
| Version and release notes | Root package manifest and [changelog](../changelog.md#v050-2026-11-13) | Matching 0.5.0 version, dated notes, retained upgrade guidance, tagged links and passing local checks | Hosted publication evidence follows the tag workflow |
| Publication | [Release procedure](../development.md#preparing-a-release-image-and-bundle) | Stable release must identify the merged main commit and pass all publication gates | PR merge, tag push and gated publication pending |

## Release status

Prepared on `codex/release-0.5.0` from main commit `de97086` for pull request review. No release tag, GitHub Release publication or private-server deployment has been performed.
