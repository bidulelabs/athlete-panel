# Existing Project Guide

Use this flow when an implementation already exists, including projects with no
documentation, incomplete documentation, or stale documentation.

Supply this guide, the [shared framework guide](Framework-Guide.md), and its four
linked templates to the agent, or keep them accessible as reference files. Read
the [common conventions](Framework-Guide.md#common-conventions) first. Suggested
locations are in the [shared structure](Framework-Guide.md#suggested-structure).

Paste the prompts in order in the same task, reusing the inspection results.
If work continues elsewhere, provide a reference to that scope and its findings.
Setup here concerns documentation; application changes are a separate scope.

## Step 1 — Inspect and select coverage

```text
Inspect this existing repository for documentation setup. Read the common
conventions in the supplied Framework-Guide.md and use the supplied templates
as reference material. Do not modify files or execute application workflows yet.

Read applicable instructions, existing documentation, manifests, task definitions,
relevant configuration, and representative code/tests. Expand inspection to answer
concrete questions; use targeted history for decision evidence where useful.

Identify components, important workflows, command definitions, existing sources,
and material uncertainties. Separate documented intent from observed behavior.

Select a small, concrete documentation scope:
- A dedicated architecture overview for a multi-component project.
- Usually one to three named high-value feature specifications.
- Consequential decision candidates to assess for ADRs.
- The canonical development guide and documentation index.

Report:
Topic | Existing source | Destination | Reuse/extract/create | Known gaps

Reuse suitable documents and extract substantial mixed-purpose README content.
For a small utility, identify which clearly scoped README sections can contain
the required information. Do not invent missing requirements or historical rationale.
```

## Step 2 — Create core documentation and architecture

```text
Create or update only the core instructions, development guide, navigation,
and architecture destinations selected during inspection. Feature specifications
and decision assessments are handled in the following steps.

Use the supplied shared framework guide and relevant templates. Preserve template
reference copies and unrelated work. Customize active AGENTS.md before installing
it; keep its documentation-creation triggers and use actual context links.

Create or update the canonical development guide from existing command definitions.
Describe invocation context, prerequisites, side effects, and relevant checks.
Record unknown operational procedures as gaps, not invented commands.

Document the inspected architecture and material intended-versus-observed gaps.
Extract useful architecture detail from a mixed-purpose README when needed. Use a
view only when it answers a concrete question.

Keep README as the human entry point; add a separate index only if useful.
Link existing destinations and avoid links to documents not yet created.

Keep setup-only instructions and authorization commentary in the task record.
Replace active-document placeholders with verified facts or explicit unknowns.
Report created/updated documents and unresolved gaps.
```

## Step 3 — Document the selected features

```text
Create or update the named feature specifications selected during inspection,
using the supplied Feature-Template.md. Produce the actual documents.

Reuse known requirements from retrievable sources and distinguish their scope
from implementation evidence. Permission to document is not product intent.
If original intent is unavailable, write a useful draft of observations and
questions. Do not turn current code or test expectations into approved requirements.

Include acceptance scenarios for known intended behavior. Where implementation
adds an exception or conflicts with a requirement source, retain the discrepancy
explicitly rather than silently rewriting the requirement.

Move useful existing material into the canonical specification and replace
duplicated README detail with a summary/link. Keep command procedures in the
development guide and individual execution results in the task record.

Describe relevant migration or compatibility constraints and link operational
procedures when needed. Link each completed specification from the index.
Report selected coverage completed and remaining gaps.
```

## Step 4 — Assess historical and current decisions

```text
Assess the selected consequential decision candidates using ADR-Template.md and
its statuses and lifecycle. Create records only when preserving the choice and
its rationale is useful.

For a historical record, require evidence of an intentional choice. Code patterns
alone are insufficient. Preserve unknown dates, rationale, and approval explicitly;
separate historical evidence from present-day analysis.

For a current decision, cite its actual scoped agreement or leave the choice
proposed. A user-approved plan can establish the choices it actually contains.
Do not invent agreement or historical approval from implementation.

Preserve existing ADR history and follow the template for corrections, adoption,
and successors. Keep implementation progress elsewhere. Link useful records from
relevant feature or architecture documents.

Report which candidates produced ADRs and why others remain architecture notes
or were omitted. Do not create records merely to populate a directory.
```

## Step 5 — Validate and finish setup

```text
Apply the Validation section of the supplied Framework-Guide.md to the selected
documentation scope and its sources. Correct supported documentation problems
within scope; report application defects separately instead of silently expanding
this documentation task into implementation.

Use the scope selected in Step 1 to identify missing coverage. Preserve explicit
uncertainties where product intent or historical evidence remains unavailable.
Keep the validation report and actual check results in this task.

Report canonical document paths, completed coverage, remaining gaps, and checks
actually performed. Do not claim application behavior or deployment was verified
merely because the documentation checks passed.
```

The [shared validation prompt](Framework-Guide.md#validation) contains the checklist;
it is maintained there rather than repeated in this guide.

## After setup

Use the shared [normal development workflow](Framework-Guide.md#using-the-framework-during-normal-development).
Update the relevant specifications, architecture, decisions, and procedures as work
changes them. Revisit broad coverage only when a concrete gap or significant change
warrants it; do not rerun bootstrap for every task.
