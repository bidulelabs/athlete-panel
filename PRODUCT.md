# Product: Athlete Panel

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One athlete owns and uses each private instance. The owner confirmed on 2026-10-25 that the primary operating pattern is planning the week on desktop, then reviewing and logging sessions on a phone. Broader sport and experience-level ambitions are described in the [README](README.md); the structured workout editor now supports Garmin groups/subgroups, rest entries, planned elevation, intervals and ordered strength prescriptions.

## Product Purpose

Bring training plans, recorded activity and day-to-day context into one private workspace. The athlete should be able to plan a week, understand what actually happened, and adjust upcoming sessions without losing the distinction between a prescription and a recorded fact.

## Positioning

One self-hosted workspace with source plugins and optional external agents. There is no required author-operated backend or embedded model service. The owner reviews exact agent proposals before applying training changes. Garmin supplies imported facts through its Personal API.

## Operating Context

Desktop week planning needs scanable dates, planned versus recorded values, accessible workout details and efficient edits. Phone use prioritizes finding the relevant day, inspecting a session and recording completion with clear, reachable actions. Both light and dark themes are supported.

The athlete can combine workouts with notes, events and injury constraints, review factual weekly summaries, and explicitly link an imported activity. Preserve drafts on failed or stale saves. See the [training workspace specification](docs/features/training-workspace.md).

## Capabilities and Constraints

- One owner account per instance; no public signup, team account model or billing.
- Training edits use the domain services and reviewed proposal workflow. Recorded facts, permissions and provider connections retain their existing ownership.
- Missing measurements remain unknown, and known zero remains distinct. Planned volume, recorded volume, session status and data coverage are separate facts.
- Calendar dates, athlete timezone, selected week boundary and units follow the existing public contracts. Do not invent recovery scores or infer missing metrics.
- Feature behavior belongs in plugins; shared UI primitives belong in the UI package. Preserve client/server separation, immutable migrations and generated registry ownership.
- Use synthetic fixtures in isolated local previews. Production deployment and private athlete-data operations are separate actions.
- Current deferred capabilities and supported sports remain governed by the README and feature specifications, not by visual mockups.

## Brand Commitments

The product name is Athlete Panel. The owner selected a precise training notebook: compact, restrained, orange accents, and flat graphite/light surfaces. The current work refines the existing interface and its two themes. The existing design references remain preserved; descriptive visual rules belong in [DESIGN.md](DESIGN.md).

## Evidence on Hand

- [README](README.md): product scope, supported capabilities and limits.
- [Architecture](docs/architecture.md) and [development guide](docs/development.md): ownership and canonical operating procedures.
- [Feature specifications](README.md#documentation): behavioral authority.
- [Committed dark screenshot](docs/images/calendar-dark.png) and [light screenshot](docs/images/calendar-light.png): synthetic calendar examples.
- Original design mockups in `docs/design/mockups/`: visual references, not implemented capability claims.
- [Browser tests](tests/e2e): synthetic interaction scenarios; their presence alone does not establish a passing run.

## Product Principles

1. Make the planned week and recorded training understandable together.
2. Preserve the meaning and provenance of training and health facts.
3. Keep the owner in control of changes and access.
4. Make frequent desktop and phone tasks efficient and recoverable.
5. Keep extensions coherent with the shared product while preserving plugin ownership.

## Accessibility & Inclusion

Provide keyboard-operable controls, visible focus, named dialogs, readable text in both themes and reduced-motion support. Phone controls need usable touch areas and layouts that accommodate long content. Color supplements labels, icons and status text. Check empty, partial, unknown and failed-request states as part of normal UI verification.

No formal accessibility conformance certification is claimed. See the [execution record](docs/plans/mvp-execution.md) for actual verification evidence.
