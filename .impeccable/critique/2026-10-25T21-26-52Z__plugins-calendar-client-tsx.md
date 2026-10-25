---
target: Calendar and workout inspector
total_score: 25
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
target_identity: "file:plugins/calendar/client.tsx"
target_fingerprint: "sha256:813e9cfbde9251dedbcb64e3ce56be9aedc02337480dbd55801e1c7d737dae25"
target_path: plugins/calendar/client.tsx
timestamp: 2026-10-25T21-26-52Z
slug: plugins-calendar-client-tsx
closed: true
---
Method: dual-agent (A: /root/design_review_a · B: /root/design_review_b)

# Calendar and workout inspector baseline

Design specificity: a coherent training notebook with a continuous week, explicit planned/recorded facts and restrained paired themes. Preserve this identity.

| Heuristic | Score / 4 | Finding |
| --- | --- | --- |
| System status | 3 | Week, selection and coverage are visible. |
| Familiar language | 3 | Training language fits; compact metric labels need clarification. |
| User control | 2 | Phone inspector does not respond to Escape. |
| Consistency | 2 | Apparent modal uses ordinary aside behavior. |
| Error prevention | 3 | Validation and confirmation safeguards exist; source reviewed. |
| Recognition | 2 | Prescribed interval targets require entering Edit. |
| Efficiency | 2 | Phone keyboard detail access crosses background controls. |
| Visual simplicity | 3 | Coherent identity; some essential labels are too small. |
| Error recovery | 3 | Forms retain drafts; failed saves require verification. |
| Contextual help | 2 | Compact summary semantics require interpretation. |
| Total | 25 / 40 | Acceptable; meaningful improvements needed. |

## Strengths

- Continuous weekly planning preserves context beside desktop details.
- Missing data, recorded-only elevation and planned versus actual are represented honestly.
- Both themes share a quiet visual system; native editor dialogs already support keyboard dismissal and focus return.

## Priority issues

1. **P1 — Dependable workout details.** The inspector omits work/recovery durations, targets and step notes. The phone overlay leaves focus behind it and ignores Escape. Show the complete read-only prescription and use a modal interaction model only at overlay widths. Commands: clarify, harden.
2. **P1 — Legible calendar facts and actions.** Browser evidence confirms 8–10px functional text, low-contrast light-theme/faint colors and 25–32px phone controls. Compact summaries lack a visible recorded/planned key and change ordering when expanded. Enlarge essential labels and hit areas, correct semantic colors including the destructive-button override, and align comparison grammar. Commands: typeset, adapt, polish.

## Cognitive load and journey

Moderate: the athlete must reconstruct prescriptions from Edit and decode compact summary ordering. Arrival and completion forms are calm and structured; the phone detail transition is the main loss of control. Fix reading and interaction without adding decorative dashboard structure.

## Persona concerns

- Power users need the prescription in read-only details.
- Keyboard users need focus entry, containment and dismissal at overlay widths.
- Phone users need comfortable navigation and close controls, readable qualifiers and a direct logging path.

## Detector synthesis

The CLI source scan returned zero findings. Five browser scans emitted 76–116 rule hits each, not unique defects: repeated weeks and hidden/background elements inflate counts. Concrete measurements confirm small text, contrast and the inspector focus failure. Established Inter/system typography and missing-value dashes are intentional; do not treat their detector warnings as defects. Expanded summary sections need a level-two heading. Overlay-induced overflow is diagnostic UI and not app overflow.

## Minor observations

Normalize Warm up/Cool down labels. Provide visible focus around the date-jump input and a selected state for completion choices. Broader shell typography remains outside the bounded calendar/inspector pass.

Questions skipped: two Priority Issues; the owner has already selected desktop planning, phone review/logging and the precise training-notebook direction.
