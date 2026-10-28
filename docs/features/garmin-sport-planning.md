# Feature: Garmin sport planning and recorded detail

## Purpose and scope

Use Garmin groups and subgroups consistently across planning, imported history, activity selection and existing weekly summaries. Extend the same workout flow with rest days, planned elevation, strength prescriptions and separate completion notes.

Outside scope: automatic matching, per-set results, exercise libraries, inferred duration or load, planned TSS/IF and new trends pages.

## Intended behavior

Specification status: approved. Requirement source: the owner's request to implement Garmin group/subgroup planning and expanded workout prescriptions on 2026-10-28, in the implementation conversation. No durable conversation URL is available. This supersedes the two-sport planning limit and the proposed combined hike category in [issue 41](https://github.com/bidulelabs/athlete-panel/issues/41); rest and elevation address [issue 40](https://github.com/bidulelabs/athlete-panel/issues/40).

### Classification and linking

`sport` stores the Garmin root group key; optional `sportSubgroup` stores the specific descendant key. The pinned catalog holds type IDs, type keys and parent IDs. Root groups have parent ID 17; the “all” filter sentinel is not a sport. Labels never determine identity. Imported activities retain the exact original `garminActivityType` metadata and a resolved/unresolved marker. A missing or conflicting catalog identity remains unresolved with its raw key and IDs. Titles do not classify sports.

Hiking is Garmin group `hiking` (3). Mountaineering is `mountaineering` (37), under group `other` (4). They remain distinct in storage, controls, detail, filtering and summaries. Swimming, gym/strength, climbing, winter sports, rowing and paddling use the same catalog. Opening an editor makes no provider call.

A group-only workout accepts the same resolved group; a workout prescribing a subgroup also requires that exact subgroup. Garmin's verified `other` group can match its known descendants; legacy catch-all `other` records and unfamiliar identities cannot serve as wildcard matches. Existing running/cycling activities remain usable as group-only records. Old generic history is explicitly unresolved until activity reimport supplies authoritative identity. Linking, workspace validation and provider corrections share these rules.

Linking retains completed/partial status, RPE, reason and completion notes, including repeated links to the same activity. An unrecorded workout defaults to completed. Skipped workouts cannot link; one imported activity can belong to only one workout. Garmin supplies actual date, duration, distance and imported measurements. A conflicting provider correction rolls its transaction back and remains retryable for owner reconciliation.

### Prescriptions and narrative

Ordinary sessions may omit `kind`; rest uses `kind: rest`, null sport and no subgroup, volume, intervals, exercises, completion or imported link. Rest entries retain schedule, title, description and order. They appear in plans/calendar and are excluded from training-session and completion totals.

`plannedElevationGainMeters` is optional and nullable. Missing is unknown; zero is recorded zero. Display/edit follows profile meters/feet. Structured agent context includes this value even without narrative access.

Ordered exercises have a name, optional sets, free-text repetitions/hold target, optional numeric `weightKg`, descriptive load, rest seconds and instructions. Numeric loads display/edit in kg/lb. Bodyweight, equipment settings and ambiguous/per-hand prescriptions remain explicit descriptions. No duration or progression is inferred; completion remains session-level.

The workout's existing `notes` is labeled **Workout description**. Plan descriptions, workout descriptions, calendar-note bodies and completion reasons/notes accept 20,000 characters of multiline plain text. `completion.notes` is optional; historical `reason` stays visible for all statuses. Omitted fields preserve content; explicit empty text clears it. Agents still cannot edit recorded completion. Without notes access, descriptions, step notes, exercise instructions and completion narrative are redacted; structural prescriptions remain available. Replacing exercises with hidden instructions, and duplicating hidden narrative, require notes access.

### Recorded measurements and summaries

Activity-list `trainingStressScore`, `intensityFactor` and `normPower` map to optional nullable activity TSS, IF and normalized power in watts. IF is already a ratio and may exceed one. Zero is preserved; missing values are not calculated. Activity details and linked-workout review show all three.

Existing activity-only historical import enriches identity and metrics in place, retaining destination IDs and links. It preserves owner annotations and advances revisions on corrections. There is no extra per-activity provider call.

Existing running/cycling totals remain. Weekly details add group totals with subgroup rows for sessions, duration, distance and planned/recorded elevation. A group row includes its subgroup rows; the UI says so. Unknown measurements have coverage counts. Unresolved classifications are labeled separately, including old generic history. Rest is excluded. Manual actual elevation stays unknown.

## Acceptance scenarios

| Situation | Expected result | Verification |
| --- | --- | --- |
| Hiking and mountaineering import | Different group/subgroup identities and separate selections | `sport-planning.test.ts`, browser sport-planning scenarios |
| Unknown key or mismatched parent | Original metadata retained; unresolved, cannot link | Contract/domain fixtures |
| Group workout / exact subgroup | Same group accepted / different subgroup rejected | Domain and workspace-validation tests |
| Partial completion linked twice | Status, RPE and both narrative fields retained | Domain and PostgreSQL import tests |
| Provider correction | Stable activity ID, updated actuals, retained annotations; invalid sport change rolls back | PostgreSQL Garmin suite |
| Rest entry | Calendar-visible, excluded totals, completion and volume rejected | Domain and browser tests |
| Elevation zero versus absent | Zero remains zero; absent stays unknown | Summary fixtures |
| Strength in metric/imperial | Free-text targets and descriptive loads retained, numeric kg/lb displayed correctly | Domain and browser tests |
| Long text / hidden instructions | 20,000 accepted, excess rejected; no hidden narrative in agent context or unauthorized duplication | Contract/privacy tests |
| Old workout/audit | Missing optional fields remain readable; undo checks current revisions | Existing recovery and new domain tests |

## Observed implementation

The [shared catalog and helpers](../../packages/contracts/src/sports.ts), [contracts](../../packages/contracts/src/domain.ts), training engine/editor, Garmin normalizer, activity records and calendar summaries implement this capability. [Unit scenarios](../../tests/unit/sport-planning.test.ts) and [PostgreSQL reimport tests](../../tests/integration/garmin.test.ts) exercise persisted behavior. Individual results belong in the [execution record](../plans/garmin-sport-planning.md).

The provider field contract is documented in [Garmin Personal API Swagger](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/). The catalog is a pinned recorded Garmin response from [this source revision](https://github.com/pe-st/garmin-connect-export/blob/5f2e287af7abef2f70cc71e9da69d5be9b795378/json/activityTypes.json), retrieved 2026-10-28, not a new authenticated live-catalog request. Original IDs/parents are checked against it during import. Future catalog drift is surfaced as unresolved rather than guessed.

## Contracts and constraints

Contracts and affected training/history plugins advance to version 2. Optional fields are stored in existing JSON records and audit snapshots; there is no new SQL migration. Existing history is not rewritten on deployment: explicit historical activity reimport is the persisted transformation. Running/cycling workouts remain group-only until the owner selects a subgroup. Unknown provider identities remain recoverable.

Rollback after saving new sports/rest/fields may require the matching pre-upgrade backup: older validators may reject them.
