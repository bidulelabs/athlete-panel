# 019: Review training proposals against the agent’s planning read

## Record

Status: accepted

Recorded on: 2026-11-04

Status basis: the owner requested implementation of [issue #68](https://github.com/bidulelabs/athlete-panel/issues/68) with the scope summarized in the [execution record](../plans/planning-read-baseline.md).

## Context

An in-window run arriving just before submission forced the agent to reread its data. The same run arriving just after submission could already be shown to the owner for review.

## Decision and rationale

Keep each distinct planning snapshot under its grant and digest. Validate a pending draft against current data. Accept changes since the read only to the activities and health collections. Carry the read baseline into the proposal so the owner sees new facts before deciding whether the proposed edits still fit. Reuse the existing transactional apply check for changes after review.

## Consequences

Reads now write one temporary snapshot per distinct digest and grant. They contain the same bounded, redacted data used to compute the digest, including the daily health records underlying weekly averages. Grant expiry bounds their retention while the worker is running. Proposal storage and expiry stay independent. Reassess storage cost if repeated planning reads under annual grants become expensive.

## Relationships

Extends [ADR 009](009-durable-proposal-review.md). The [feature specification](../features/agent-training.md#activity-and-health-imports-during-planning) defines the boundary and acceptance cases.
