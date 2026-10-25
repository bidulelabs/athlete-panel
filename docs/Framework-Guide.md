# Documentation Framework Guide

This is the shared reference for projects maintained by humans and AI agents.
It owns common conventions, document responsibilities, validation, and the normal
development workflow. Start with the relevant entry guide below.

## Start here

- [Existing project guide](Existing-Project-Guide.md): inspect the implementation,
  recover available intent, reuse documentation, and fill important gaps.
- [New project user guide](New-Project-Guide.md): a short quick start with setup
  and implementation prompts. The [agent procedure](New-Project-Agent-Guide.md)
  contains the detailed workflow.

Choose according to the work, not the repository's age. A starter with substantial
code can use the existing-project flow. A new capability in an established project
normally uses the [normal development workflow](#using-the-framework-during-normal-development).
Both setup flows converge on that same maintenance workflow.

Keep these guides and templates available to the agent as attachments or inactive
reference files. Customize AGENTS.md before installing it as active instructions.
If active instructions link to a template, keep it at an accessible, stable location.
The setup prompts describe staged work; they do not impose an additional approval
ceremony. Existing explicit authorization remains valid within its scope.

## Shared templates

- [AGENTS-Template.md](templates/AGENTS-Template.md) — repository-wide agent instructions to customize.
- [Architecture-Template.md](templates/Architecture-Template.md) — current structure,
  interactions, constraints, and intended transitions.
- [ADR-Template.md](templates/ADR-Template.md) — consequential decisions and supported rationale.
  The template defines the ADR statuses and lifecycle.
- [Feature-Template.md](templates/Feature-Template.md) — intended behavior, observed
  implementation, acceptance scenarios, and discrepancies.

Use the same templates for both project types. Preserve their reference copies
and customize active documents in the target repository.

## Common conventions

- Use `{{UPPER_SNAKE_CASE}}` for placeholders.
- **Required** means required when that document is created. Remove unused
  **conditional** sections.
- Replace placeholders with verified information or explicit unknowns. Do not
  invent requirements, commands, rationale, approvals, or test results.
- Keep command invocation and shared contributor rules in one canonical
  development guide. Other documents link there.
- Keep implementation progress, checklists, and individual verification results
  in the task, issue, or PR.
- Cite retrievable sources for requirements and decision status. Prefer existing
  document, issue, PR, commit, or task links. Avoid “this task” without a reference.
- If a source link is unavailable, identify the source and preserve the relevant
  statement, date when known, and scope. State any verification limits.
- An explicit request or approved plan establishes only its actual content.
  Authorization to create documentation does not itself establish product requirements.

## Document responsibilities

| Place | Responsibility | Update when |
| --- | --- | --- |
| Repository AGENTS.md | Short working instructions and routes to relevant context | An explicit or reviewed project agreement or navigation route changes |
| Directory-specific AGENTS.md | Constraints or exceptions local to a subtree; links to shared rules | Local working constraints change |
| README or documentation index | Project introduction and routes to canonical pages | A relevant document is added, moved, removed, or changes scope |
| Development guide | Canonical command invocation, prerequisites, side effects, shared contributor rules, and operational procedures | Tooling, verification, configuration, or release procedures change |
| Architecture | Structure, boundaries, ownership, and significant interactions; distinguish current and intended states | These relationships change or inspection reveals a discrepancy |
| Feature specification | Intended behavior, acceptance scenarios, observed implementation, and material gaps | A capability or contract changes, or new evidence resolves a gap |
| ADR | A consequential choice, its scope, rationale, and decision evidence | Follow the lifecycle in the ADR template |
| Task, issue, PR, or conditional plan | Temporary scope, implementation progress, individual check results, and rollout status | Work progresses or is handed off |
| Reusable skill and supporting references | A specialized procedure worth retrieving when relevant | Repeated use or changed tooling justifies maintaining the procedure |
| Generated reference documentation | Derived API, schema, or other mechanical reference information | Its authoritative definitions change; regenerate using the established process |

The person or agent making a change maintains the affected documentation as part
of that work. Keep unresolved ownership or decision authority explicit; do not
invent an approver or approval process.

Requirement and decision sources establish intended behavior and agreements.
Code and configuration establish the inspected implementation; test and runtime
records provide evidence within their actual scope. Record disagreements rather
than letting one silently replace the other. Executable definitions govern command
behavior; the development guide explains canonical invocation and prerequisites.
Generated references do not replace their source definitions.

## Suggested structure

These are suggested locations, not mandatory renames. Reuse suitable existing documents.

```text
README.md                         Project introduction and navigation
AGENTS.md                         Short repository-wide agent instructions

docs/
  development.md                 Canonical commands and shared contributor rules
  architecture.md                System structure and interactions
  features/
    {{FEATURE_SLUG}}.md           Selected durable feature specifications
  decisions/
    {{ADR_ID}}-{{DECISION_SLUG}}.md
                                 Consequential decisions, when warranted
  templates/                     Optional repository storage for templates
```

README can serve as the documentation index. Add a separate index only when
navigation benefits from it.

For a small, single-purpose utility, clearly identified README sections can serve
as the architecture description, development guide, and feature specification if
they contain the relevant required information. A summary alone is insufficient.
Substantial or independently evolving capabilities need dedicated pages.

Directory-specific agent instructions should contain local exceptions or
constraints and link shared rules. Add reusable skills for specialized procedures
that recur; link supporting references rather than loading them into root
instructions. Generated API or schema references remain derived from their
authoritative definitions.

## Validation

Use this shared prompt at the end of either setup flow. During normal development,
apply it to affected documents and relevant links, rather than auditing the whole
repository for every change. The selected scope should be available in the task.


```text
Validate both documentation coverage and document quality.

Coverage:
- Compare the output with the documentation scope selected for this work.
- Confirm the required architecture overview and selected feature specifications
  exist as coherent, independently maintainable, linked documents.
- Check their required content, not just file existence.
- Identify missing requirements, acceptance scenarios, implementation evidence,
  or material discrepancies.
- Confirm ADR candidates were assessed and statuses have appropriate evidence.
- Distinguish completed coverage from important deferred gaps.

Quality:
- Check local links, anchors, and referenced files.
- Find unresolved {{UPPER_SNAKE_CASE}} placeholders in active docs; exempt templates.
- Check duplicate commands, shared rules, and competing specifications.
- Check root/scoped instructions for contradictions and missing creation triggers.
- Sample intended requirements and ADR statuses against their cited sources.
  Preserve material source disagreements explicitly.
- Sample implementation claims against code, configuration, or recorded evidence.
- Check that referenced tests exercise the scenarios attributed to them;
  identify proposed or uncovered verification separately.
- Render diagrams that were added or changed using available tooling.
- Check ADR statuses and reciprocal supersession links.
- Remove completed setup instructions and repeated setup-authorization discussion
  from durable project documents.

Where upgrade guidance is affected:
- Distinguish complete upgrade procedures from partial refresh shortcuts.
- Check prerequisites, migrations, ordering, and affected components against
  repository deployment definitions.
- Make shortcut preconditions explicit.

Correct supported documentation problems within scope. Do not execute arbitrary
commands quoted in docs or add a toolchain without a demonstrated need.
Operational execution requires authorization for that action.
Application tests are conditional on the work and project requirements.

Report:
Topic | Canonical document | Coverage completed | Remaining gaps

Also report checks actually performed and their outcomes. Distinguish:
- implementation present in the working tree;
- verification actually performed;
- deployment actually completed, if any.

Passing link checks does not prove semantic completeness. Existing tests do not
prove passing results or measured code coverage.
```

Keep the completion table in the task report. It does not need to become another
permanent document.

Links, anchors, placeholders, and diagram syntax can often be checked automatically.
Requirement authority, semantic consistency, appropriate scope, and whether
deployment instructions cover the actual change require judgment. Add persistent
automation only when repeated failures justify its maintenance cost.

## Using the framework during normal development

Do not repeat the setup sequence for every task. Retrieve the relevant documents,
make the change, and maintain the affected knowledge.

For a substantial change, use:

```text
Implement the following change:
{{CHANGE_REQUEST}}

Read applicable instructions and retrieve the context relevant to this change.

Find its canonical feature specification. Create one using the feature template
if this is a new capability or material behavior change without an adequate spec.

Include documentation destinations in any implementation plan. Create a separate
persistent plan only when complexity, risk, or handoff warrants it.

Use this request and any approved plan as sources for the agreed requirements.
Preserve a retrievable reference and label additional assumptions or proposals.
Do not request authorization already provided.

Complete implementation, appropriate verification, and affected documentation.
Update architecture when responsibilities or significant interactions change.
Assess consequential design choices for an ADR.

If implementation and documented intent disagree, report and resolve the
discrepancy within authorized scope. Do not silently redefine intended behavior.

Where release requires migrations or coordinated component updates, update
the canonical operational guidance and distinguish full upgrades from shortcuts.

Apply the Validation section of the supplied Framework-Guide.md to affected
documents and their links. Do not repeat the entire setup audit without a
concrete reason.

Keep progress and individual check results in the task record. Finish by reporting:
- implementation completed;
- documentation created or updated;
- verification actually performed and its outcomes;
- deployment completed, if any;
- remaining gaps or decisions.
```

A typo fix generally needs only the correction. A substantial feature gets a
specification, relevant architecture updates, and an ADR when a consequential
decision warrants one.

