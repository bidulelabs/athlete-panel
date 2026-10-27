# ADR 008: Resolved public plugin boundaries

## Record

Status: accepted. Recorded on: 2026-10-27.
Status basis: the owner explicitly requested implementation of the A1–A4 plan in this chat; [execution record](../plans/mvp-execution.md) records verification.

## Context

Filename/regex checks missed indirect browser imports and undeclared bundled-plugin coupling. Plugins remain trusted code; this is an architectural guard, not a sandbox.

## Decision and rationale

Resolve source imports with the installed TypeScript compiler. Public shared/client/server entries and compatible mandatory dependencies govern cross-plugin imports; optional UI integrations use enabled contributions. Training depends on contracts/composition services; Athlete and Activity Records consume its public API. The existing required foundation set remains mandatory.

## Consequences

Expected benefit: earlier detection of server leakage and incompatible source composition. Cost: public interfaces and compiler-resolution fixtures need maintenance. Reconsider if plugin distribution or compiler resolution changes. Applied SQL migrations remain immutable; composition changes use the existing coordinated upgrade procedure.
