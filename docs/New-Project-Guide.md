# New project: user guide

Use this guide when implementation has not started or only a small scaffold exists.
You provide the project brief and answer important questions. The agent creates
and validates the documentation, then implements when you request it.

## Quick start

1. Create or open the folder where the project should live.
2. Provide this guide, the [agent procedure](New-Project-Agent-Guide.md), the
   [shared framework guide](Framework-Guide.md), and its four linked templates.
   Attach the files or give the agent access to the framework folder.
3. Fill in the setup prompt below and send it. Write “undecided” for unknowns.
4. Answer questions that materially affect the project; the agent handles the files.

You do not need to customize templates manually or operate the detailed steps.
Keep the unfilled AGENTS.md template with the reference files, outside the project
root. The agent creates or updates the customized project version during setup.

## Prepare the project documentation

“First useful outcome” means one concrete thing the initial version should let a
user accomplish. Mention required technology or integrations under constraints.

```text
Read New-Project-Agent-Guide.md and Framework-Guide.md. Follow the Setup phase
only, using the four templates as reference material.

Project brief:
- Purpose: {{PROJECT_PURPOSE}}
- Users: {{PROJECT_USERS}}
- First useful outcome: {{FIRST_USEFUL_OUTCOME}}
- Known constraints: {{KNOWN_CONSTRAINTS_OR_UNDECIDED}}

Define the first useful slice and create its minimal initial documentation.
Customize and install AGENTS.md with real project links, preserve reference
copies and unrelated work, and validate the documentation using the shared guide.

Ask only about missing information that materially affects the design.
Continue independent work while awaiting answers.
Do not implement application code yet.
Report document locations, checks performed, and unresolved decisions.
```

Expect customized agent instructions, navigation, the first feature specification,
an appropriate architecture description, and development guidance. A small utility
may use README sections for several roles. ADRs are conditional. Undefined commands
and other unknowns remain explicit. This phase stops before application coding.

## Start implementation

When ready, send this prompt in the same task. If starting another task, provide
access to the project, its documentation, and the framework references.

```text
Read New-Project-Agent-Guide.md and follow the Implementation phase for the
first useful slice described in the project documentation.
Perform appropriate verification and update the documentation to reflect
what was actually implemented.
Report what changed, checks actually performed, remaining gaps, and any
deployment actually completed.
```

For later changes, use the shared
[normal development workflow](Framework-Guide.md#using-the-framework-during-normal-development).
You do not need to repeat setup for every feature.
