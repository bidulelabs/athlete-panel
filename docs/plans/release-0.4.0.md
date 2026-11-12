# Release 0.4.0

## Scope

The owner requested a version bump and a new release tag on 2026-11-12. The previous stable release is v0.3.0. Version 0.4.0 includes the features already merged into main; this preparation changes only release metadata and documentation.

The root package version is 0.4.0. Existing Unreleased notes and upgrade guidance now appear under the dated v0.4.0 heading, with absolute links to the tagged documentation and release. Unreleased remains available for subsequent changes. Plugin versions, contracts, migrations and dependencies are unchanged.

## Verification

- Release-tag security suite: all 10 tests passed, covering stable-main ancestry, prerelease classification, version matching and changelog extraction.
- `pnpm check`: passed formatting, lint with no errors, generated-file freshness, import boundaries, both TypeScript checks, all 406 unit tests in 49 files and documentation validation. The initial sandboxed attempt stopped because tsx could not create its local IPC socket; the completed run removed that restriction.
- `pnpm build`: passed the production web and worker build.
- Publication candidate scan: passed after removing a generated local pnpm cache from the working candidates. Exact staged/committed scans and committed changelog extraction are required before tag creation.
- Database, browser, container and history-security gates will run in the required GitHub workflow before merge and again before tag publication. No new application behavior is introduced by this release preparation.

## Documentation validation

Scope: the changelog and this execution record. The release entry retains existing feature and upgrade guidance, has one dated version heading and uses tagged absolute links suitable for the generated GitHub release notes. The existing architecture and feature specifications remain authoritative; no new ADR or diagram is needed. Commands remain canonical in the [development guide](../development.md#preparing-a-release-image-and-bundle).

| Topic | Canonical document | Coverage completed | Remaining gaps |
| --- | --- | --- | --- |
| Version and release notes | Root package manifest and [changelog](../changelog.md#v040-2026-11-12) | Matching 0.4.0 version, dated notes, retained upgrade guidance, tagged links and passing local checks | Hosted publication evidence follows the tag workflow |
| Publication | [Release procedure](../development.md#preparing-a-release-image-and-bundle) | Stable release must identify the merged main commit and pass all publication gates | PR merge, tag push and gated publication pending |

## Release status

Prepared on `codex/release-0.4.0` from main commit `f216bc4b2e200793797fd8d5f6bf970d28eeede0`. A pull request and successful required checks precede merge and creation of the annotated v0.4.0 tag. No private-server deployment is part of this request.
