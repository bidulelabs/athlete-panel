# 021: Match new Garmin imports only after complete activity scans

## Record

Status: accepted. Recorded on: 2026-11-10.

Status basis: the owner's explicit implementation request and policy selections, recorded in the [task authority](../plans/calendar-linking.md#authority-and-scope).

## Context

Completed and linked sessions are difficult to distinguish in the calendar. Manual reconciliation duplicates effort, but matching individual import pages can mistake one of two same-day sessions for a unique match. Import retries and manual unlinking must not silently recreate associations.

## Decision and rationale

Stage only newly inserted activity identities in Garmin-owned storage. Match after successful activity pagination without rejected records, processing one date per transaction through Training's public server service. Require uniqueness on both sides using normalized local dates and existing sport/subgroup compatibility. Use performed dates for manual logs and scheduled dates for pending workouts. Replace manual measurements while retaining status and annotations, as explicitly selected by the owner.

Use existing domain validation, locking and audit. Audit each automatic association separately from imported facts, expose server-controlled linking provenance, and consume candidates even when ambiguous. Existing rows and corrections are not enrolled. Check prior explicit associations before matching so an unlink during the scan is respected.

## Consequences

- Expected benefit: clearer recorded results with less manual reconciliation and no arbitrary tie-breaking.
- Costs: additive staging storage, a worker job and public Training service dependency; matching waits for scan completion. Existing history still requires explicit linking.
- Compatibility: old strict completion parsers cannot read new provenance. Upgrade matched artifacts and use backup-based rollback.
- Reconsider when the owner requests historical reconciliation, duration-based disambiguation or different matching preferences.

## Relationships

- Requirements: [training workspace](../features/training-workspace.md#calendar-state-clarity-and-automatic-garmin-linking).
- Import lifecycle: [Garmin import](../features/garmin-import.md#automatic-workout-linking).
- Evidence and verification: [execution record](../plans/calendar-linking.md).
