# 022: Keep race files and analysis in an optional plugin

## Record

Status: accepted for ownership and app-upload scope; detailed numerical estimation choices remain implementation assumptions requiring validation.
Recorded on: 2026-11-12.
Status basis: the owner requested implementation of [issue 113](https://github.com/bidulelabs/athlete-panel/issues/113) following its [design decisions](https://github.com/bidulelabs/athlete-panel/issues/113#issuecomment-6795362295) in this conversation. This authorizes local implementation and verification, not production activation.

## Context

Race events belong to Training; GPX courses and reference files need their own storage and processing. JSON proposal fields and the existing 256 KiB owner-operation limit are unsuitable for binary files. Garmin Personal API imports intentionally do not fetch GPS/FIT records. The broader preparation workspace has separate issues and must not become a prerequisite for course analysis.

## Decision and rationale

Race analysis owns original binary assets, immutable analysis projections, the active course pointer, terrain overrides and selected references. It reads race identity through Training's public server API and contributes a link via the generic inspector slot. Deleting a Training event makes its analysis unavailable; retained storage allows Training undo without cross-plugin deletion hooks.

Host API 1.4 adds a generic, bounded multipart upload extension, retaining owner session/origin checks and enabled-plugin dispatch. The host interprets no GPX/FIT, terrain or training rules. Race analysis validates its own metadata, limits and output, shares the domain write lock and idempotency service, and declares its schema/migration in the composition. Client code contains no parser/server imports. Original files stay in PostgreSQL so existing matched backup/restore includes them without a second object store.

The coordinated change is explicit in this task: Contracts 2.4, Training 2.4 public lookup, Calendar 2.2 inspector contribution point, host API 1.4, Race analysis 1.0, one new plugin migration and generated registry/reference outputs. No new agent access or provider integration is added. Model constants, thresholds and missing-data behavior are documented in the [feature specification](../features/race-analysis.md).

## Consequences

- Benefits: independent course-analysis delivery, coherent backup ownership, no coordinate requests to external map/elevation services, and preserved Training ownership.
- Costs: original files grow database backups; bounded retained storage eventually requires an operator-reviewed retention feature. Synchronous parsing is bounded by file/point limits. Heuristic finish ranges require validation and cannot promise a specific confidence level.
- Reconsider when: measured parsing/resource use exceeds interactive budgets, retained file volume calls for managed asset lifecycle/storage, or a separately scoped assistant capability needs reviewed access to asset identifiers.

## Alternatives

Embedding tracks in notes/proposals was rejected because it conflates files with narrative context and payload limits. Extending Garmin ingestion is outside the requested scope. Training-owned file parsing would mix course-specific analysis with general planning. External storage/tiles add operational dependencies without a requirement for this release.

## Relationships

- [Feature specification](../features/race-analysis.md).
- [Execution evidence](../plans/race-course-analysis.md).
- [Plugin boundaries](008-public-plugin-boundaries.md).
