# Feature: {{FEATURE_NAME}}

> Template: use for a capability or behavior requiring a lasting specification.
> Maintain this as a coherent feature document, linked from the documentation
> index. Remove this note and unused conditional sections.

## Purpose and scope — required

{{USER_OR_SYSTEM_NEED_AND_FEATURE_SCOPE}}

Outside scope: {{IMPORTANT_EXCLUSIONS}}

## Intended behavior — required

Specification status: {{DRAFT_APPROVED_OR_RETIRED}}
Requirement source: {{REQUIREMENT_SOURCE_REFERENCE_AND_SCOPE_OR_EXPLICIT_UNKNOWN}}

{{REQUIREMENTS_SUPPORTED_BY_THE_SOURCE}}

An explicit request or approved plan establishes only the requirements it
actually contains. Label additional assumptions or proposed requirements;
the document's approved status does not approve those additions.

If intended behavior is unknown, say so and keep the specification draft.
Do not promote existing code or tests into approved requirements.

When implementation adds an exception or conflicts with a requirement source,
describe that behavior under Observed implementation and record the unresolved
discrepancy. Do not silently rewrite intended behavior to match the code.

## Acceptance scenarios — required when intended behavior is known

| Situation or input | Expected observable result | Verification approach or reference |
| --- | --- | --- |
| {{SCENARIO}} | {{EXPECTED_RESULT}} | {{TEST_LINK_OR_VALIDATION_APPROACH}} |

Cover meaningful success, failure, and boundary conditions.
Include permissions, side effects, ordering, and compatibility where relevant.
Identify proposed expectations awaiting agreement.

When intent is unknown, document observations and questions without converting
implementation behavior into acceptance requirements.

## Observed implementation — required

{{IMPLEMENTATION_STATE_AND_DESCRIPTION_OR_EXPLICIT_UNKNOWN}}

Evidence: {{CODE_CONFIGURATION_TEST_OR_RUNTIME_REFERENCES}}
Limits: {{INSPECTION_METHOD_AND_RELEVANT_VERSION_ENVIRONMENT_OR_UNCERTAINTY}}

Static inspection is not runtime validation.
Existing tests may encode incomplete or obsolete expectations.
Keep individual execution results in the task or PR record.

For an unimplemented feature, state that implementation has not started
rather than inventing code references or observed behavior.

## Discrepancies and open questions — conditional

- Expected behavior and source: {{REQUIREMENT_AND_SOURCE}}.
- Observed behavior and evidence: {{OBSERVATION_AND_EVIDENCE}}.
- Impact: {{IMPACT}}.
- Resolution: {{IN_SCOPE_CORRECTION_TASK_LINK_OR_DECISION_NEEDED}}.

## Contracts and constraints — conditional

- Contract or entry point: [Definition]({{CONTRACT_LINK}}).
- Architecture: [Relevant area]({{ARCHITECTURE_LINK}}).
- Rationale: [Decision]({{ADR_LINK}}).

{{APPLICABLE_SECURITY_PRIVACY_ACCESSIBILITY_PERFORMANCE_OR_RELIABILITY_REQUIREMENTS}}

Link shared requirements instead of copying them.

## Flow or state view — conditional

{{VIEW_THAT_CLARIFIES_OTHERWISE_AMBIGUOUS_BEHAVIOR}}

## Verification and release details — conditional

[Development and verification guide]({{DEVELOPMENT_GUIDE_LINK}})

{{FEATURE_SPECIFIC_FIXTURES_MANUAL_CHECKS_OR_RELEASE_CONSTRAINTS}}

When release requires migrations or coordinated component updates, identify
the relevant prerequisites, ordering, and compatibility constraints. Link the
canonical procedure in the development guide.

Keep commands in that guide and actual rollout progress/results in the task
or release record.

Implementation and rollout tracking:
[Task or release record]({{TRACKING_LINK}}).
