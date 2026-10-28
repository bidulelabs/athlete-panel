# 011: Preserve Garmin sport identity in planning and history

## Record

Status: accepted
Recorded on: 2026-10-28
Status basis: the owner's explicit implementation plan in the current conversation, recorded in the [feature specification](../features/garmin-sport-planning.md). This approval covers taxonomy, prescriptions, privacy and reuse of existing import/domain services; production deployment remains a separate operator action.

## Context

A two-sport planner and catch-all activity bucket lose distinctions needed for strength and mountain training. A custom hike category would collapse Garmin hiking and mountaineering. Existing imported history needs authoritative classification while preserving activity identity and owner annotations.

## Decision and rationale

Use a pinned Garmin catalog for group/subgroup controls and preserve original provider identifiers. Separate rest from the sport taxonomy. Unknown types stay unresolved. Match exact subgroups when prescribed, and require a resolved Garmin group for broader matches; catch-all history never grants wildcard matching. The documented Personal API parent model and the pinned response are linked in the specification. No title heuristics or live editor lookup is needed.

Store optional prescriptions and imported measurements in existing JSON contracts. Use the existing historical importer for in-place enrichment, retaining activity IDs, links and owner annotations.

## Consequences

- Expected benefits: hiking/mountaineering distinctions survive planning and import; one set of rules protects all links; editor operation remains independent of Garmin availability.
- Costs and risks: catalog updates require verification; unknown types need review. New saved fields can make an older release unable to read the database, requiring matched-backup rollback.
- Reconsider when: Garmin changes the hierarchy contract, verified identifiers change, or multiple providers require a separate planning taxonomy.
