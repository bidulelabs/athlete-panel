# 010: Restricted runtime password upgrades

## Record

Status: accepted. Recorded on: 2026-10-27. Basis: the owner's approved S1/S2/A7/S4 implementation plan, tracked in the [execution record](../plans/mvp-execution.md#s1-s2-a7-and-s4-security-boundaries--2026-10-27).

## Context

Existing passwords use unversioned scrypt hashes. Successful login should upgrade them without granting direct runtime writes to the owner table.

## Decision and rationale

Keep verification and new hashing in trusted application code. Grant the runtime role execution of one protected database function: compare the exact legacy hash and replace it with the supported versioned format once. The function uses a fixed search path, denies public execution and cannot replace a versioned hash. Session creation and replacement share a transaction and the console-recovery lock; hashing stays outside that lock.

## Consequences

Existing passwords remain usable. The runtime gains limited indirect credential-write authority; this does not sandbox trusted plugins or prove password equivalence inside PostgreSQL. Direct owner writes remain denied. Older artifacts cannot read upgraded hashes, so rollback uses the matched backup. Reconsider the function and format when the password policy changes.

Evidence: [restricted-role and race tests](../../tests/integration/password-upgrade.test.ts). Deployment sizing remains separate.
