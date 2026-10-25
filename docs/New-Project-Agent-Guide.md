# New project: agent procedure

This is the detailed procedure for an agent. The user starts with the
[short user guide](New-Project-Guide.md).

## Inputs and execution scope

Read applicable repository instructions, the shared
[conventions](Framework-Guide.md#common-conventions), and the relevant
[templates](Framework-Guide.md#shared-templates). Reuse suitable existing files
and follow the [suggested structure](Framework-Guide.md#suggested-structure),
including its small-project exception.

Execute the phase the user requested:

- **Setup:** Steps 1 and 2 define the first useful slice and create documentation.
  Complete both within that request, then stop before application coding.
- **Implementation:** Steps 3 and 4 implement the documented slice, verify it,
  and reconcile documentation. Reconciliation is part of implementation, not
  a separate user-operated step.

Providing reference files alone does not authorize coding. An explicit request
may authorize both phases; do not require another approval for work already
within scope. Preserve template reference copies and unrelated work.

## Setup phase

### Step 1 — Define the first useful slice

Inspect any existing repository files and applicable instructions. Identify the
smallest outcome that delivers useful behavior to a user or caller. Separate
explicit requirements and constraints from assumptions and proposals. Identify
observable success and important failure or boundary cases.

Ask only about unknowns that materially change scope, behavior, architecture, or
verification. Resolve them before dependent work while continuing independent
analysis. Do not design speculative future features or treat a proposed technical
approach as an approved requirement or decision.

Identify minimal documentation destinations using the shared structure and
small-project exception. Keep the scope, sources, material questions, and any
implementation plan in the task record. Do not add a roadmap or persistent plan
unless complexity, risk, or handoff warrants it.

### Step 2 — Create and validate initial documentation

Preserve the reference templates and unrelated work. Customize AGENTS.md before
making it active, retaining its documentation-creation triggers and using real
context links. Create or reuse human navigation and the canonical development
guide. Document commands only when executable definitions and prerequisites
actually exist; otherwise state that tooling is not yet defined.

Describe the appropriate architecture, distinguishing proposed structure from any
scaffold already present. State explicitly where implementation has not started.
Use a dedicated architecture page for a multi-component project and a diagram
only when it answers a concrete question.

Create the selected feature specification from known intended behavior and its
sources. Include meaningful acceptance scenarios, label proposed expectations,
and describe observed implementation honestly, including its absence. Use the
ADR template and its lifecycle to assess consequential choices. A draft architecture
or an implementation pattern alone does not establish decision approval.

Apply the shared [validation procedure](Framework-Guide.md#validation) to the
produced documents and links. Correct supported problems and report document
locations, remaining gaps, and checks actually performed. Keep setup discussion
and individual results in the task record. Stop after documentation setup when
implementation has not been requested.

## Implementation phase

### Step 3 — Implement the requested slice

Retrieve the relevant specification and instructions. Work within the stated
requirements and existing authorization. Resolve material unknowns before dependent
work and keep additional assumptions visible.

Create the tooling and code needed for this slice and perform appropriate
verification. Maintain the affected specification, architecture, and consequential
decision records as implementation develops. Record actual command definitions and
prerequisites in the canonical development guide. Do not claim unrun checks passed.

Complete reconciliation in Step 4 as part of the implementation request; a separate
user prompt is not needed.

### Step 4 — Reconcile documentation with implementation

Replace proposed structure with supported observations where implementation now
exists, retaining intended transitions separately. Update command references and
verification guidance from actual definitions and evidence. Report discrepancies
between intended and observed behavior without silently redefining requirements.

Apply shared validation to the affected documents and links. Include release
constraints and procedures only where relevant. Report documentation coverage,
checks actually performed, remaining gaps, and any decisions still open.
Distinguish implementation in the working tree from verification and deployment
actually completed.

## After the first implementation

Use the shared [normal development workflow](Framework-Guide.md#using-the-framework-during-normal-development)
for subsequent changes. Update affected documentation as the project evolves;
do not repeat setup for every task or expand documentation to cover hypothetical
future work.
