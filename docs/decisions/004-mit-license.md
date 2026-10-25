# ADR 004: MIT project license

## Record

Status: accepted
Recorded on: 2026-10-25
Status basis: the owner explicitly requested “add an MIT licence” after discussing MIT, Apache 2.0 and AGPL 3.0 in this conversation. No durable conversation URL is available; this dated statement records the decision and its scope.

## Context

Athlete Panel is being prepared for a public GitHub release. The owner wants the application to be available at no charge and open to use, self-hosting, modification and contributions. The repository previously declared no project license.

## Decision and rationale

Adopt the standard [MIT License](../../LICENSE) for the project's original code and documentation. Declare the SPDX identifier `MIT` in the root and workspace package manifests and link the license from the [README](../../README.md#license-and-acknowledgments).

MIT provides broad reuse permissions with a short license and a requirement to preserve the copyright and permission notice. It permits commercial use and closed-source derivatives; it does not require downstream changes to be shared. This matches the owner's selection following the comparison of permissive and copyleft licensing. The license text is the authority for its terms.

The copyright notice identifies the authors collectively as `Athlete Panel contributors`, following the owner's request on 2026-10-25 to avoid personal attribution. Third-party dependencies and separately licensed materials retain their own licenses. Adopting MIT does not establish ownership of third-party assets or complete the publication audit's provenance and attribution review.

## Consequences

- Expected benefits: straightforward permission to use, modify and redistribute Athlete Panel, including commercial reuse.
- Costs and risks: downstream versions may be proprietary or sold; required notices must be preserved, and third-party rights still need review before publication.
- Reconsider when: the owner proposes a different licensing model. Any future decision must account for existing license grants and contributor rights.

## Alternatives

The preceding discussion considered Apache 2.0 for an explicit contributor patent grant and AGPL 3.0 for source-sharing requirements, including modified hosted versions. The owner selected MIT.
