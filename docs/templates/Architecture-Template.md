# Architecture: {{PROJECT_NAME}}

> Template: describe current structure and distinguish intended changes.
> For a multi-component project, use a dedicated architecture page.
> Remove this note and unused conditional sections.

## Purpose and boundary — required

{{SYSTEM_PURPOSE_AND_PRIMARY_USERS_OR_CALLERS}}

Responsibilities: {{SYSTEM_RESPONSIBILITIES}}
Outside this boundary: {{EXTERNAL_RESPONSIBILITIES_OR_SYSTEMS}}

## Current structure — required

Evidence and inspection limits: {{SOURCE_LINKS_AND_LIMITS}}

| Component or area | Responsibility | Code or entry point |
| --- | --- | --- |
| {{COMPONENT}} | {{RESPONSIBILITY}} | [Source]({{SOURCE_LINK}}) |

Main interactions:
{{IMPORTANT_CONTROL_AND_DATA_FLOWS}}

Describe the inspected implementation. Identify the environment and version
when making deployment-specific claims.

If implementation has not started, say so. Keep proposed structure clearly
identified as intended state rather than presenting it as existing code.

## Significant interfaces and constraints — conditional

Include contracts, data ownership, or constraints important to safe change.

| Interface or constraint | Meaning | Authoritative source |
| --- | --- | --- |
| {{NAME}} | {{MEANING}} | [Definition or decision]({{AUTHORITY_LINK}}) |

Distinguish observed dependencies from approved dependency rules.

## Explanatory view — conditional

{{DIAGRAM_OR_OTHER_VIEW_WITH_SCOPE_CAPTION_AND_SOURCE_LINKS}}

Use a view only when it clarifies a concrete question.
Choose appropriate abstractions: services, modules, functions, data,
events, states, deployment units, or selected types.

## Behavior and decisions — conditional

- [{{FEATURE_TITLE}}]({{FEATURE_LINK}}): {{RELEVANCE}}.
- [{{ADR_TITLE}}]({{ADR_LINK}}): {{RELEVANCE}}.

Link existing canonical descriptions rather than repeating them.

## Gaps and transitions — conditional

- Intended state and source: {{INTENT_AND_AUTHORITY}}.
- Observed state and evidence: {{OBSERVATION_AND_EVIDENCE}}.
- Impact: {{WHY_THE_DIFFERENCE_MATTERS}}.
- Follow-up: {{TASK_LINK_OWNER_OR_OPEN_QUESTION}}.
