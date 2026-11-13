# Feature: GPX race course analysis

## Purpose and scope

Help the owner understand an existing race's route, elevation, terrain and likely elapsed finish time using selected past efforts. Race analysis is an optional source plugin linked to Training-owned race events; it does not own another calendar or race record.

Outside scope: AI preparation, training-plan generation, nutrition, aid stations, race cards, scenario comparison and post-race learning (issues 121–124), base maps, live navigation, watch export and automatic Garmin GPS/FIT ingestion.

## Intended behavior

Specification status: approved for the course-analysis scope. Requirement source: [issue 113](https://github.com/bidulelabs/athlete-panel/issues/113), its [mockups and design decisions](https://github.com/bidulelabs/athlete-panel/issues/113#issuecomment-6795362295), and the owner's 2026-11-12 request to implement that scope in this development conversation. Numerical limits and estimation constants below are implementation assumptions, not validated physiological prescriptions or separately approved scientific models.

The owner opens Races or follows **View course analysis** from a calendar race. One active course is uploaded through the app and may be replaced. Invalid or stale replacement attempts preserve the saved course. Training continues to own the event title/date and its deletion/undo. A deleted or non-race event cannot be used to read or mutate retained analysis.

The compact overview shows finish estimate/range, measured distance, smoothed climbing and terrain difficulty. Draw the route without a base map; the five-band elevation profile and route share a selection controlled by pointer, touch or keyboard slider. Colour is accompanied by named slope bands. Expand section and reference evidence progressively. Preserve the shared controls, typography, selected units and paired themes.

Reference efforts are explicit owner uploads of GPX or FIT files. The owner supplies or corrects their elapsed time and terrain, including missing timestamps. Evidence is selected for this race, not inferred from all training history. Predicted-versus-actual checks must not fit an effort to its own result. Explain insufficient evidence, partial elevation and extrapolation without inventing certainty.

Global terrain and section overrides preview their effects before saving. Failed/stale saves retain the draft and its original revision through reload; a retry cannot silently overwrite another tab's changes. Use saved terrain/effort explicitly resets an edit to the current values. Upload drafts require explicit selection of the newly reviewed saved version before retrying. A successful course replacement resets section-specific overrides but retains the overall terrain and reference efforts. The illustrative terrain effect remains explained even without an estimate.

## Acceptance scenarios

| Situation | Expected result | Verification |
| --- | --- | --- |
| No race / no course | Existing calendar workflow or GPX upload is offered | [Browser course tests](../../tests/e2e/race-analysis.spec.ts) |
| Valid course upload | Original retained, one active course and bounded display geometry; Training race unchanged | [Integration tests](../../tests/integration/race-analysis.test.ts) |
| Invalid, ambiguous, oversized or entity-bearing XML / damaged FIT | Clear rejection; saved course unchanged | [Parser/upload tests](../../tests/unit/race-analysis.test.ts), [upload transport tests](../../tests/unit/uploads.test.ts) |
| Missing elevation or track discontinuity | Route still available; affected totals or finish estimate withheld with explanation | Parser and browser tests |
| Fewer than three usable references | No personal estimate; number of additional efforts needed is shown | Model tests |
| Four usable references | Each reference prediction uses the other efforts; model/range assumptions visible | Model and integration tests |
| Pointer/keyboard selection | Same course position highlighted in route and profile | Browser course tests |
| Terrain edits or replacement | Preview before saving; stale writes rejected; replacement resets section overrides only | Integration and browser tests |
| Owner session absent, foreign origin, agent caller or disabled plugin | Upload/read rejected through existing access boundaries | Browser transport, integration and [upload route tests](../../tests/unit/upload-route.test.ts) |
| Retry after uncertain upload response | Same request key/content returns the prior result; no duplicate asset | Integration tests |

Browser evidence and actual command results are recorded in [the execution record](../plans/race-course-analysis.md). Test presence alone does not establish a passing run.

## Observed implementation

[Race analysis](../../plugins/race-analysis) owns parsing, measurements, fitting, UI, original files and saved settings. [Shared contracts](../../packages/contracts/src/race-analysis.ts) define the owner DTOs and upload metadata. Training exposes a minimal [race lookup](../../plugins/training/race-events.ts) through its public server entry. The calendar mounts the existing generic inspector slot for context details; the enabled plugin supplies the link.

The generic upload adapter authenticates the owner and checks origin/enabled registration before bounded multipart reading. Uploads use one binary file plus JSON metadata, not large strings in training proposals. File content stays local; neither parsing nor diagrams make third-party requests. The agent bridge grants no access to these files or operations.

Implementation bounds: 10 MiB/file, 100,000 points, 100 GPX segments, 100 m–1,000 km track distance, 20 active references/race and 512 MiB total original-file storage. GPX must contain one track or route in UTF-8. XML depth is checked with a forward-only scan before parsing; numeric/time tokens are bounded to 40 characters before pattern matching. FIT references use the official Garmin decoder with integrity checks and require an outdoor GPS track; multisport sessions are rejected and files exceeding 300,000 messages receive a specific limit error. Missing times can be entered manually. Unknown elevation stays unknown. Disconnected segments are not joined into the distance; segments separated by more than 1 m or individual GPS steps over 5 km suppress estimates.

Measurements use haversine surface distance, 25 m elevation resampling and a five-point median. Raw and smoothed climbing are disclosed. Display geometry is reduced to at most 2,000 points after calculations. Sections are consecutive 5 km intervals, ending at the finish; ascent/descent are allocated by overlap so section totals reconcile.

The initial model requires three complete, timed references. Reference uploads/edits reject times implying faster than 2:00/km, with a prompt to check elapsed minutes; existing such references stay visible but are excluded. This is a model applicability bound for comparable running/hiking efforts, not a universal physiological claim. A bounded two-coefficient relative-error fit estimates flat pace and climbing cost; duration weighting and loss denominators have a one-hour floor so short efforts cannot dominate. Slowdown is selected from 0/2/4/6% per hour. Base time includes the configured terrain multiplier; elapsed time is `base + slowdown × base² / 7200`. A provisional 3.5% per terrain level is explicit. Similar climbing-per-distance ratios cannot identify climbing cost independently: the model discloses a 60 s/100 m assumption and widens the range. These constants are product heuristics requiring future real-world validation.

Independent comparisons require three *other* efforts. The planning range uses at least ±15%, increases with held-out errors, sparse evidence and extrapolation, and is capped at ±50%. Extrapolation adds ten percentage points when distance, climbing per kilometre or estimated elapsed time is below 75% of the reference minimum or above 125% of its maximum; affected dimensions are named. It is explicitly not a calibrated probability interval; ordinary reference pauses are included, with no separate stop budget. The original source, settings revision and reference inputs remain available on the server. No automatic model training or provider record mutation occurs.

## Contracts and constraints

- [SDK](../../packages/plugin-sdk/src/index.ts): host API 1.4 adds optional bounded owner-upload handlers. Existing JSON operation limits remain unchanged.
- [Public operations](../../packages/contracts/src/operations.ts): analysis, terrain settings, reference edit/remove; upload metadata/result are also included in generated contract references.
- [Migration](../../plugins/race-analysis/migrations/001-initial.sql): plugin-owned immutable assets, one current course row/race and selected reference rows. Writes share the existing domain lock/maintenance and idempotency mechanisms, with an expected analysis revision.
- Course changes do not alter Training revisions or agent proposal contexts. A course's original and replaced sources are retained; reference removal only removes its selection. There is no athlete-facing purge or export-original action in this release. Backups include the plugin schema/files as database content. Storage-limit recovery requires a separately reviewed operator retention procedure; do not delete rows manually as routine maintenance.
- Ownership/coordination rationale: [ADR 022](../decisions/022-race-course-analysis.md).

Follow-up design work should pair an athlete-owned reusable reference library with explicit per-race selection and deduplicated assets, and define a reviewed retention/purge workflow with storage visibility and recovery. This would change persisted ownership and deletion behavior and needs a separate specification and additive migration; it is not silently added to this initial course-analysis PR.

## Verification and release details

Use the [canonical development/verification and upgrade guide](../development.md#verification). Enable the optional plugin in the exact instance composition, build the matching web/worker artifacts, apply its additive migration and refresh runtime schema grants under the normal coordinated upgrade procedure, then restart and reload browser tabs. Training 2.4 adds the read API; Calendar 2.2 mounts the inspector contribution; Contracts 2.4 adds DTOs; host API 1.4 adds generic uploads. No applied migration or existing training record is rewritten.

Disabling Race analysis hides routes/contributions while retaining stored files/settings. Previous releases do not know this schema/composition: use the matching pre-upgrade backup for rollback rather than pretending a code-only downgrade is verified. Deployment and private-data validation remain separate from local checks.
