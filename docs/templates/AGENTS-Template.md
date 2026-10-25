# Working in {{PROJECT_NAME}}

> Template: customize before installing as active instructions.
> Remove this note and unused conditional sections.

## Find context — required

- Read applicable repository and directory-specific agent instructions before
  editing. Do not assume newly relevant subtree instructions were loaded.
- Setup, commands, shared rules, and verification:
  [Development guide]({{DEVELOPMENT_GUIDE_LINK}}).
- Architecture, features, and decisions:
  [Documentation index]({{DOC_INDEX_LINK}}).
- Retrieve only context relevant to the task. Use targeted inspection of
  code, configuration, and tests when documentation is incomplete.

## Work and authorization — required

- Continue authorized work through implementation and appropriate verification.
  Do not request authorization already provided.
- Ask when missing intent or authority would materially change the outcome.
  Continue independent work while awaiting an answer.
- Merging, publishing, deployment, destructive data changes, and external
  communications require authorization for that action. Respect additional
  project approval requirements linked from the development guide.
- Document status does not authorize operational actions.
- Preserve unrelated changes. Keep task progress in the issue or PR; persist
  a separate plan only when complexity, risk, or handoff warrants it.

## Create and maintain documentation — required

- For a new capability or material change to a public contract, persisted
  behavior, permission rule, or cross-component workflow, create or update
  its feature specification using
  [Feature template]({{FEATURE_TEMPLATE_LINK}}).
- Reuse an existing specification only if it covers the template's required
  information and is independently maintainable. A README summary alone
  does not replace a substantial feature specification.
- Update the architecture overview when responsibilities, boundaries,
  significant interactions, or data ownership change.
- Assess consequential design choices for an ADR. Preserve supported
  rationale; never infer historical approval from implementation.
- Cosmetic edits and fixes restoring already documented behavior do not
  automatically require new documents.
- Link canonical information instead of copying it. Distinguish intended
  requirements, implementation evidence, and unresolved discrepancies.
- Missing docs do not block bounded work, but necessary documentation remains
  part of completing a substantial change.
- Change persistent instructions for explicit or reviewed project agreements.
  Do not infer permanent rules from frustration or temporary preferences.

## Verify completion — required

- Use checks appropriate to the change and the project's required gates.
  Add or update meaningful regression coverage where practical.
- For substantial work, check that the affected specification and any relevant
  architecture or decision records are accurate and discoverable.
- Report what changed, documentation updated, checks actually performed,
  outcomes, and remaining gaps. Never claim unrun checks passed.

## Specialized guidance — conditional

{{LOCAL_CONSTRAINTS_AND_LINKS_TO_RELEVANT_SKILLS_OR_REFERENCES}}
