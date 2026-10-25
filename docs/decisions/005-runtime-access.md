# Restrict runtime database access and isolate login limits

Status: accepted

Date: 2026-10-25

## Context

The release audit found shared administrative/runtime database credentials and a global failed-login counter that could lock out the owner. The owner requested implementation of the release fixes.

## Decision

Provision a dedicated runtime database role after migrations. Keep migration, owner recovery and restore credentials in console-only services. The trusted Caddy ingress overwrites the client identity used for per-source login limits; do not accept arbitrary forwarded headers on a publicly exposed web port. Hash identities for short-lived storage, aggregate IPv6 /64 addresses, and bound asynchronous password verification.

## Consequences

Installation requires two independent database passwords. Existing instances need a deliberate permission transition and restart, without changing athlete records. Shared-address users share a rate limit, and distributed denial of service remains possible. Plugin code is still trusted and is not sandboxed. No existing migration is rewritten.

See [development and recovery](../development.md) for commands and [security policy](../../SECURITY.md) for trust boundaries. Actual verification outcomes belong in the execution record.
