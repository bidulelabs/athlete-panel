---
name: Athlete Panel
description: A precise training notebook for one athlete, with paired light and dark themes.
colors:
  accent-dark: "#ff751f"
  accent-light: "#e85a0c"
  accent-ink-dark: "#ff751f"
  accent-ink-light: "#b74200"
  faint-dark: "#8b949e"
  faint-light: "#66717b"
  on-danger-dark: "#211111"
  on-danger-light: "#ffffff"
  background-dark: "#111315"
  background-light: "#fbfbfa"
  surface-dark: "#1a1d20"
  surface-light: "#ffffff"
  raised-dark: "#202428"
  raised-light: "#f3f4f2"
  text-dark: "#f4f3ef"
  text-light: "#172028"
  muted-dark: "#939ba5"
  muted-light: "#59636e"
  line-dark: "#2b3035"
  line-light: "#e2e5e3"
  success-dark: "#8eaa8e"
  success-light: "#356c40"
  danger-dark: "#f29187"
  danger-light: "#bc443a"
typography:
  headline:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "34px"
    fontWeight: 620
    lineHeight: 1.15
  title:
    fontSize: "19px"
    fontWeight: 600
  body:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  plan-title:
    fontSize: "16px"
    fontWeight: 600
  phone-dialog-title:
    fontSize: "20px"
    fontWeight: 600
  inspector-title:
    fontSize: "26px"
    fontWeight: 600
  phone-headline:
    fontSize: "29px"
  section-label:
    fontSize: "15px"
    fontWeight: 600
  compact-body:
    fontSize: "13px"
    lineHeight: 1.7
  metadata:
    fontSize: "11px"
  control:
    fontSize: "12px"
    fontWeight: 500
rounded:
  sheet-top: "12px"
  workout: "5px"
  card: "6px"
  control: "7px"
spacing:
  compact: "8px"
  control: "12px"
  group: "16px"
  section: "24px"
  workspace: "32px"
components:
  button-primary-dark:
    backgroundColor: "{colors.accent-dark}"
    textColor: "#141515"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-primary-light:
    backgroundColor: "{colors.accent-light}"
    textColor: "#141515"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  field:
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

# Design System: Athlete Panel

## Overview

**Creative North Star: "Precise training notebook"**

The owner confirmed this direction on 2026-10-25: compact, restrained, orange accents and flat graphite/light surfaces. The interface serves repeated planning and review. Dates, session titles, measured values and actions establish hierarchy; decorative treatments should not compete with them.

This record captures the existing visual system and is maintained with refinements. [PRODUCT.md](PRODUCT.md) owns audience and product principles; [feature specifications](README.md#documentation) own behavior. The [original mockups](docs/design/mockups/) remain preserved references. The [execution record](docs/plans/mvp-execution.md) owns individual results and verification.

**Key Characteristics:**
- Compact weekly structure with a clear date rhythm.
- Orange reserved for primary actions, current selection and the current day.
- Flat surfaces distinguished by restrained borders and tonal changes.
- Equivalent light and dark themes with consistent semantic meaning.
- Familiar controls, explicit labels, and factual measurements.

## Colors

The palette combines orange with graphite or near-white neutral surfaces. Frontmatter records paired values; runtime custom properties in [global CSS](apps/web/app/globals.css) select the theme through `data-theme`.

### Primary

The `accent-dark` and `accent-light` tokens identify the same orange role. Use the existing `--accent`, `--accent-hover`, `--accent-soft` and `--accent-line` properties in application CSS. Keep a distinction between an orange action and a recorded training outcome.

### Neutral

Use `--bg`, `--sidebar`, `--surface`, `--surface-raised`, `--hover`, `--text`, `--muted`, `--faint` and `--line` according to their existing roles. Essential labels require readable contrast; faint styling is not a substitute for hierarchy.

### Semantic facts

Recorded activities use restrained green; sleep uses violet; notes use olive; events use amber; injury context uses rose. [Calendar card CSS](plugins/calendar/cards.css) defines both theme variants. Icons and words carry the same meaning so color is supplementary. Destructive buttons pair `--danger` with `--on-danger`; small orange text uses `--accent-ink`, which darkens in the light theme independently of orange button fills. Above-plan volume is not automatically a success state.

## Typography

Use the existing Inter/system sans-serif stack. Inter is a preference in the stack, not a bundled font asset; the platform fallback is expected when it is absent. Keep the same family for headings, measurements and controls.

The page heading is 34px, reducing to 29px on phones; section titles are 19px, and the body base is 14px. Calendar titles and key values use 12–13px; supporting summary labels use 11–12px. Prescription text uses 13px. Assess density at the actual viewport and preserve readable wrapping. Use stronger weight and position to distinguish primary recorded values from supporting planned values.

Weekly comparisons use tabular numerals. Units remain adjacent to their values, with missing values represented explicitly. Long workout names wrap in cards and detail views; truncated session previews retain an accessible full name.

## Layout

The desktop shell has a fixed 218px sidebar, 32px workspace padding and a seven-column calendar. The sidebar reduces to 190px below 1250px. The phone shell replaces it with a sticky navigation bar below 760px; calendar days become a vertical list with a date rail.

The workout inspector sits beside the calendar at wide widths and becomes a shared Radix modal Sheet at 1050px and below. Calendar detail dialogs become bottom sheets below 600px. Weekly headers use container queries so they respond to the available calendar width, including when the inspector is open.

The calendar's combined toolbar uses a 29px title, an add action and date navigation with a single range label. Desktop always uses the compact seven-column planner with its adjacent inspector; there is no layout selector. Phones use a day list with add controls in the 44px date rail, leaving the rest of the row for readable cards. Feature composition belongs in [calendar layout CSS](plugins/calendar/layout.css).

Keep related labels, values and actions close. Separate weeks and detail sections with space or a single restrained boundary. Preserve compact planning density while making essential text and phone actions usable. The recurring spacing values in the frontmatter are observed conventions, not an exhaustive enforced scale.

## Elevation & Depth

Workspace surfaces and calendar cards are flat at rest. Tonal layers and borders establish their relationship. The existing broad shadow is reserved for dialogs and the overlay inspector; the exact paired values are recorded in the Impeccable sidecar. Focus indicators identify interaction, not decorative elevation.

## Shapes

The frontmatter is a compact role-based subset of existing values, not an exhaustive ban on other established sizes or radii. Calendar fact tints and sleep-stage colors remain defined in their linked feature stylesheet.

Calendar workout cards use 5px corners, fact cards and icon controls use 6px, and general buttons/fields use 7px. These compact proportions belong to this established application. Preserve them during refinement. Circular shapes identify the current day and avatar; a phone detail sheet uses rounded top corners.

## Components

### Buttons and inputs

Workspace content begins with each page's own heading and controls, without a repeated workspace label or divider above it. The phone navigation bar retains its brand, navigation and theme controls. Reload controls appear with errors when recovery is needed. Provider import actions live on their feature page; Garmin pairs primary **Sync latest data** with secondary **Refresh date range**.

Save recovery uses a secondary **Reload saved data** button within the form's error message, including inside dialogs. Keep it reachable with a 44px minimum height, disable it during the read, and show the reload result nearby. Preserve the draft and dialog while refreshing stored data; reserve **Try again** for the existing workspace-load error action.

Primary actions use orange with a contrasting dark foreground. Secondary actions use a neutral surface and border. Destructive actions must remain legible in both themes. Every icon-only action has an accessible name and a visible focus treatment. Phone calendar navigation, day creation, detail controls and logging actions have at least 44px hit areas. Inputs use the shared label, hint and error patterns from [UI primitives](packages/ui/src/primitives.tsx).

### Calendar cards

Cards present sport/type, title, then essential duration or context. Selection is separate from completion. Imported facts and planned workouts retain their distinct meanings. Full details remain one action away. Empty days offer an identifiable creation control.

### Weekly summary

The compact header stays attached to its week. Keep dates/This week, five icon/value metric groups and a separate 44px toggle. Target 44–48px where the available calendar width permits; wrap whole groups on smaller screens, preserving all metrics. Recorded values precede planned values. Explain labels, units, ordering and coverage through hover/focus tooltips and tap/click popovers. Use a small missing-data indicator beside affected values. The first disclosure shows eight flat metric cells, session counts and the comparison legend. A second “Show details” disclosure contains the comparison table, statuses, coverage and session links, and resets when the week closes. Warnings about possible duplicates remain visible. Follow [the training specification](docs/features/training-workspace.md).

### Workout inspector and dialogs

The inspector retains the selected session context and makes the next action easy to locate. Date, sport and prescribed totals lead to a prominent logging action. Read-only session steps retain repeat groups, time/distance lengths, targets and notes. On phones, detail content scrolls while close and logging controls remain reachable. Modal dialogs use a title, close action, Escape dismissal and focus restoration; overlay behavior must preserve coherent keyboard navigation.

### Training plan review

Use compact, full-width plan rows for discovery, with bounded description previews and wrapping metadata. A shared dialog contains the complete plan: a distinct action toolbar, rendered Markdown at 14px/1.7 with a 70ch maximum measure, and flat week/day groups. Week bands use the raised surface; dates occupy a small desktop rail and move above sessions on phones. Workout titles lead, factual summaries support, and Edit stays separate from inspection. Phone plan dialogs use a scrollable bottom sheet with a fixed title/close region and 44px controls. The existing workout Sheet can layer over a plan at every viewport; calendar inspector behavior remains responsive as before.

Recent changes is a secondary header action. Use the shared right-side Sheet, full width on phones, with a persistent title/close region and a scrolling flat list. Each entry leads with its action and item name, followed by timestamp and count. Details expand in place; Undo sits separately and requires confirmation. Controls keep 44px touch targets and use the paired surface, text and border tokens.

### Operational feedback

A recent verified local backup is a healthy supported state. Keep its off-server limitation visible as plain supporting text, without warning styling or an alert role. Use the existing status/warning treatment for failed, missing, stalled, overdue or unverified backups. [Hosted operations](docs/features/hosted-operations.md) owns these state definitions.

### Navigation and motion

Navigation combines Lucide icons and text, with orange for the active route. Use the same icon family throughout. State transitions remain short; the weekly reveal uses 180ms. Honor reduced motion while keeping the state change understandable.

## Do's and Don'ts

### Do

- Do preserve the paired themes and semantic color roles.
- Do prioritize legible dates, session names, recorded values and actions.
- Do verify desktop planning and phone review/logging with realistic synthetic data.
- Do use shared primitives for shared interaction patterns and plugin-local styles for feature-specific composition.
- Do distinguish missing measurements from zero and planned training from recorded facts.

### Don't

- Don't replace the compact calendar with decorative dashboard tiles.
- Don't use color alone to communicate completion, injury or missing data.
- Don't hide essential phone actions behind hover.
- Don't add arbitrary scores, unsupported capabilities or factual claims as decoration.
- Don't let a CSS override make a destructive action or focus indicator unreadable.

### Shared controls

Use Radix-backed shadcn source exported by `@athlete-panel/ui`. `packages/ui` owns control styles and `--ui-` semantic mappings; `data-theme` remains the theme switch. Use shared Dialog/AlertDialog/Sheet for modal interaction, Native Select and native date fields for those form behaviors, and one shared Tooltip provider. Preserve the orange/graphite palette, compact spacing and restrained dividers. Plugin CSS owns domain layout, prescriptions and charts. Do not add global button/input styles that override shared components. See [shared UI](docs/features/shared-ui.md).

### Markdown content

Supported narrative fields use shared read-only Markdown typography at 14px/1.7 and a 70ch maximum measure. Content headings stay below page/dialog and field headings, with restrained 16/15/14px sizes. Lists retain visible markers, links use underlined accent ink with focus rings, and quotes use a thin divider. Code and tables scroll within their own keyboard-focusable regions. Footnotes and disabled task-list checkboxes remain legible in both themes. Plugin prose selectors target their own direct children so they do not override shared Markdown.

Editors retain the existing textarea and Save actions with a “Markdown supported” hint; no toolbar or preview button is added. Compact clickable cards show plain-text excerpts. Full descriptions and additional injury notes remain separate readable sections. [Training behavior](docs/features/training-workspace.md#markdown-descriptions-and-notes) owns field scope, storage and safety rules.

Markdown that cannot be processed safely falls back to the source in the same typography, with preserved line breaks and wrapping long text. Keep surrounding edit/delete actions available; do not replace the page with an error or show the source as an unwrapped code block.
