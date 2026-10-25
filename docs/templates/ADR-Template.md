# {{ADR_ID}}: {{DECISION_TITLE}}

> Template: record one consequential decision.
>
> Status values:
> - proposed: a current choice awaiting a decision.
> - accepted: the choice has evidenced agreement from the appropriate authority.
> - rejected: a proposal was explicitly declined.
> - superseded: a linked accepted decision replaces this choice.
> - unconfirmed: an intentional historical choice is evidenced, but its approval
>   is unknown. This status establishes no new active project constraint.
>
> Editorial and factual corrections may update an existing record.
> Substantive changes to an accepted decision require a successor with
> reciprocal links.
>
> Resolve an unconfirmed record through additional evidence or explicitly
> dated present-day adoption. Present-day approval does not establish
> historical approval.
>
> Remove this template guidance and unused conditional sections.

## Record — required

Status: {{ADR_STATUS}}
Recorded on: {{RECORD_DATE}}
Status basis: {{DECISION_SOURCE_REFERENCE_AND_SCOPE_OR_EXPLICIT_UNKNOWN}}

Use a retrievable source for the decision or review. An explicit user
instruction or approved plan can establish agreement within its actual scope.
Do not require a separate approval ceremony when agreement already exists.

## Context — required

{{PROBLEM_AND_RELEVANT_SITUATION}}

{{CONSTRAINTS_GOALS_AND_MATERIAL_ASSUMPTIONS}}

## Decision and rationale — required

{{PROPOSED_OR_RECORDED_DECISION_AND_SCOPE}}

{{RATIONALE_AND_SUPPORTING_EVIDENCE_OR_EXPLICIT_UNKNOWNS}}

Distinguish supported historical reasoning from present-day assessment.

## Consequences — required

- Benefits: {{EXPECTED_OR_OBSERVED_BENEFITS}}.
- Costs and risks: {{COSTS_RISKS_AND_RELEVANT_MITIGATIONS}}.
- Reconsider when: {{CONDITIONS_THAT_WOULD_CHANGE_THE_DECISION}}.

Label predictions separately from observed outcomes.

## Alternatives — conditional

{{REAL_ALTERNATIVES_AND_REASONS_FOR_THE_CHOICE}}

For retrospective records, list historical alternatives only when supported
by evidence. Label alternatives assessed now as present-day analysis.

## Historical provenance — conditional; required for retrospective records

Original decision date: {{KNOWN_DATE_OR_UNKNOWN}}
Evidence of the choice: {{HISTORICAL_SOURCE_LINKS}}
Unresolved history: {{MISSING_RATIONALE_APPROVAL_OR_OTHER_CONTEXT}}

The recording date is not the original decision date.
Implementation alone does not establish an intentional choice, its rationale,
or approval. Approval obtained now does not establish historical approval.

## Supporting analysis or view — conditional

{{RELEVANT_EXPERIMENT_ANALYSIS_OR_DIAGRAM_LINK}}

Distinguish actual evidence from proposed validation.

## Relationships — conditional

- Supersedes: [{{PREVIOUS_ADR_TITLE}}]({{PREVIOUS_ADR_LINK}}).
- Superseded by: [{{SUCCESSOR_ADR_TITLE}}]({{SUCCESSOR_ADR_LINK}}).
- Related requirements: [{{FEATURE_TITLE}}]({{FEATURE_LINK}}).
- Implementation or migration tracking: [Task]({{TASK_LINK}}).
