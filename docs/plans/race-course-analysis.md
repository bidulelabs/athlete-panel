# Race course analysis — issue 113

## Scope and authority

The owner requested implementation on 2026-11-12, following [issue 113](https://github.com/bidulelabs/athlete-panel/issues/113) and its [design decisions/mockups](https://github.com/bidulelabs/athlete-panel/issues/113#issuecomment-6795362295). AI preparation, nutrition/stations, scenarios and post-race learning remain in issues 121–124. This authorizes source changes and isolated local verification, not deployment or private athlete-data operations.

## Implementation plan

1. Add coordinated contracts and a generic bounded owner-upload interface; keep file interpretation and persistence in an optional Race analysis plugin.
2. Parse course GPX and GPX/FIT reference efforts, retain originals, smooth elevation and calculate bounded, explained estimates.
3. Build the course overview, synchronized route/profile, section terrain and reference-effort review using existing controls and both themes.
4. Verify parsing/calculations, persistence/concurrency/access, and desktop/phone flows with synthetic data; document actual results here.

The same implementation task owns the coordinated SDK, contract, manifest, migration and generated registry changes. No applied migration will be modified.

## Design intent

Visual thesis: a compact training notebook with a prominent finish estimate and quiet, flat course diagrams.
Content: race selection/upload; estimate and route; elevation; terrain; progressively disclosed sections and reference evidence.
Interaction: synchronized route/profile selection, short disclosure transitions and visible upload/save feedback, respecting reduced motion. Use the existing shared controls and typography; no new shared visual convention is planned.

## Progress and verification

- Read the issue, product/design records, plugin skill, development/architecture guides and relevant workspace/plugin contracts; inspected the original light course mockup.
- Implemented the optional Race analysis plugin, Training-owned race lookup, bounded owner-upload extension, runtime contracts, immutable source storage and matching generated composition. Existing calendar race details link into the analysis. Calendar remains first in navigation.
- Implemented app GPX replacement, GPX/FIT reference imports, factual/smoothed measurements, explained estimates and independent predicted-versus-actual comparisons. Route/profile selection supports mouse, phone tap and a keyboard slider; section terrain previews before save. Missing data, loading, rejected uploads and stale drafts have explicit recovery.
- Added the feature specification, ownership/upload ADR, architecture and plugin contract notes, README index and Unreleased upgrade entry. Applied framework validation to authority, scope, assumptions, local links and operational guidance. Shared visual conventions remain unchanged.

### Actual verification (2026-11-12)

- `pnpm check`: passed format/lint (warnings, no errors), generated registry/contracts/skill consistency, browser/server dependency boundaries, ordinary and strict TypeScript, **405 unit tests in 50 files**, and documentation/link checks.
- `pnpm test:integration`: **277 tests in 20 files passed**, including eight new race-analysis persistence tests. Checked original retention, failed and stale replacement, idempotent retries, section resets, reference edits/removal, duplicate-file rejection, owner/deleted-race access and maintenance writes.
- `pnpm build`: web and worker production builds passed. TypeScript was also rechecked after the final explicit phone-tap handler.
- `pnpm exec playwright test tests/e2e/race-analysis.spec.ts tests/e2e/calendar-cards.spec.ts`: **22 tests passed** across desktop Chromium and Pixel 7. Course overview/editing was checked in light and dark themes, with a 320px overflow check. Verified real multipart uploads and persistence, slider/tap synchronization, reference editing, missing elevation, invalid replacement preserving the saved course, loading/retry/no-race states, anonymous/foreign-origin rejection, stale terrain recovery and the calendar link. Generic dispatch unit tests additionally verify disabled-plugin rejection before reading a body.
- Visually inspected desktop and phone screenshots in both themes. Synthetic evidence is under `.runtime/race-analysis/` (`overview-*`, `evidence-*`, upload errors and empty states); screenshots are local verification artifacts, not committed user data. The test fixture uses Alpine Trail 42 and four explicitly synthetic reference outings.
- `git diff --check`: passed. No existing migration was edited and no private credentials or athlete records were used.
- Final chart review added a visible outline for completely flat profiles. The 12 course browser checks were rerun successfully after adding profile-to-route tap/click checks and 320px screenshots; the final flat-profile rendering was inspected separately. Build, TypeScript, changed-file lint and formatting were checked again for these small visual changes.

The standard disposable database port was already occupied by another checkout. Instead of stopping it, verification created separate `athlete_panel_race113_20261112_test` and `athlete_panel_race113_browser_20261112_test` databases on that local synthetic PostgreSQL service. Integration and browser mutations stayed in those databases. The localhost preview runs on port 3113 with `ATHLETE_PANEL_E2E=true`.

Initial checks caught a synchronous owner-guard rejection, FIT fixture typing, and browser selectors that did not match the shared controls/reference ordering; these were corrected and the affected checks rerun successfully. There are no outstanding test failures.

### Release and remaining limits

Implementation and local verification are complete; no production deployment or private-data validation was performed. Activation uses the matching composition/build, additive migration and refreshed runtime grants in the existing coordinated upgrade procedure. Disabling the plugin retains its data; rollback uses a matched pre-upgrade backup.

Numerical fitting constants, minimum reference count, smoothing and uncertainty margins are documented implementation assumptions. Synthetic verification establishes software behavior, not real-world prediction calibration or exhaustive compatibility with every exporter. Retained originals count toward the documented 512 MiB cap; athlete-facing retention/purge tooling is not included. The assistant, nutrition/stations, scenarios and post-race learning remain outside this issue.

### Owner-requested local demo (2026-11-12)

The owner subsequently requested a local app to test this implementation. Started a separate demo at `http://127.0.0.1:3114/races?race=11300000-0000-4000-8000-000000000001` with a fresh synthetic database, a restricted runtime database role, a copied standalone web build and its matching background worker. It contains one Alpine Trail 42 race, its GPX course and four reference efforts. Original/replacement/missing-elevation sample files are available under `.runtime/race-preview/sample-files/`.

Verified readiness, owner login, the populated course page (6h 12m initial estimate), four references and zero browser exceptions. The worker reports healthy with zero consecutive failures. Web and worker remain running for owner testing; stopping them retains demo edits. Restart from this checkout with `pnpm exec tsx .runtime/race-preview/start.ts` while the existing local synthetic PostgreSQL service is running. The documented synthetic login password is `AthletePanel-demo-only-2026`. This local demo does not activate the feature in a private owner database or on a remote server.

### Owner-requested pull request (2026-11-12)

The owner requested a pull request for the implementation. Rebased the implementation onto `main` at `8ffdfe3`, preserving automatic activity matching, the updated calendar and the current plugin composition. Coordinated versions are Host API 1.4, contracts 2.4, Training 2.4 and Calendar 2.2. The race-analysis decision is ADR 022; existing applied migrations remain unchanged.

Verification on the rebased implementation supersedes the earlier counts above:

- `pnpm check`: passed, including **426 unit tests in 53 files**, formatting/lint (warnings only), generated-file consistency, dependency boundaries, both TypeScript checks and documentation validation.
- `pnpm test:integration`: **284 tests in 20 files passed** in the isolated synthetic test database.
- `pnpm build`: production web and worker builds passed.
- `pnpm exec playwright test tests/e2e/race-analysis.spec.ts tests/e2e/calendar-cards.spec.ts --max-failures=2`: **22 tests passed** on the rebased build using a separate synthetic browser database and port 3115. The owner's copied demo on port 3114 remains independent.
- Reviewed the committed [desktop light](../images/race-analysis/desktop-light.png), [desktop dark](../images/race-analysis/desktop-dark.png), [320px phone light](../images/race-analysis/phone-light-320.png) and [320px phone dark](../images/race-analysis/phone-dark-320.png) screenshots. All names, courses and reference efforts are synthetic. Phone captures show the expanded reference evidence after an edit, so their saved version and estimate differ from the desktop overview.
- Publication checks on the implementation's staged candidate and the pinned Gitleaks scan of reachable history passed with no findings. Final publication checks are repeated after adding these screenshots and notes.

This authorizes publishing the implementation branch and PR. It does not authorize merging or deploying to a private server. Hosted CI and deployment rehearsals are separate from the local checks recorded here.

### PR review assessment and fixes (2026-11-13)

Reviewed all 24 inline comments in [PR 128](https://github.com/bidulelabs/athlete-panel/pull/128). The processing-time, prediction and stale-draft findings warrant fixes before merge even though the final review summary called its remarks non-blocking. The changes keep issue 113 focused on course analysis.

| Review topic | Disposition |
| --- | --- |
| XML depth regex and long numeric/time regex inputs | Replaced the depth matcher with a forward-only, quote-aware scan and bounded scalar tokens before pattern matching. A child-process regression has a hard timeout, so a recurrence cannot hang the test runner. |
| Implausible duration and excessive short-effort weight | Reject new/imported times faster than the model's 2:00/km applicability bound; exclude existing such references with an explanation. Cap duration weights and loss denominators at one hour. |
| Stale terrain/reference drafts after reload | Preserve the draft's base revision. A second save still fails until the owner explicitly starts from saved values. Course-upload retries also require explicit acknowledgement of the newly loaded version. |
| Climbing/duration extrapolation | Widen the planning range for either dimension as well as distance, and name the extrapolated dimensions. |
| Transactional preservation tests | Compare complete before/after analysis, including course identity and reference evidence, on stale/rejected uploads. Inject a database failure after asset insertion and verify that assets and idempotency receipts also roll back. |
| Missing parser/model coverage | Added regression cases for limited climbing, sparse evidence, extrapolation, the 20-day limit, effective section terrain, short-effort influence, invalid elevation, point count, multisport FIT, absent FIT GPS and long scalar/XML inputs. |
| Read operation through the shared requester | Keep the dedicated read for now: `WorkspaceApp`'s requester unconditionally reports a saved change and reloads the workspace after every successful operation. A shared read transport should first distinguish queries from mutations. Boundary output validation remains intentional. |
| Shared error/reload control | Export and reuse the existing `ReloadableRequestError`/`ErrorMessage` recovery UI, with the reload callback bound to course analysis rather than only the workspace. Keep local busy state for these multi-step forms; wholesale `useAction` conversion is optional cleanup. |
| Retained-file storage and reusable references | Record as separate follow-up design work in the feature specification. A reusable athlete library, per-race selection, asset deduplication and reviewed retention/purge would change ownership/deletion behavior and need a dedicated specification and additive migration. No ad hoc SQL deletion is introduced. |
| Shared mutation wrapper/repository writes | Defer the structural refactor: existing transactions, domain locking and idempotency are explicit and now have stronger rollback coverage. Consolidation can be evaluated independently of these correctness fixes. |
| Raw references and redundant comparison field | Repository reads now return only source facts; predictions are computed afterward. Keep the published `comparison` field in the response contract for compatibility rather than removing it for this cleanup. |
| Loading reference geometry just to fit/count | Select only distance, climbing and gap measurements; count references in SQL on reference uploads. Course uploads no longer read reference details. |
| Elevation formatter duplication | Align the locale with `en-GB`; defer moving all elevation formatters into the shared UI to a dedicated cross-feature cleanup. Do not import a private Charts helper. |
| Duplicated phone control sizing and custom notices | Remove the redundant 44px override and use shared control sizing. Retain feature notice layout and status semantics; shared error alerts now handle failed actions. |
| Navigation icon matching and route order | Match the declared `flag` icon exactly, avoiding accidental matches such as `trace`. Retain the existing curated route-order mechanism; changing navigation ordering is separate host design work. |
| Pointer rendering and screen-reader announcements | Memoize route segments, gradient stops, height data and estimate previews. Disable live announcements on the pointer-driven output; keyboard slider value text remains available. |
| Section button accessible name | Include the visible distance range and section number in the accessible name, with a screen-reader-only action prefix. |
| Harder terrain when overall terrain is 5 | Check the effective terrain of each section; return a delta when any section can still become harder. |
| Owner-only handler guard | Keep the explicit guard: the SDK context permits agent actors, and course files remain owner-only even if a later caller bypasses today's owner routes. This complements session/origin enforcement. |
| FIT record-limit diagnostic | Preserve the record-count error after the decoder catches the listener exception; test against an actual synthetic encoded FIT. |
| Multipart overhead in displayed size limit | Keep the internal allowance but display the actual file limit on both declared-length and streamed overflow paths. |
| Terrain explanation without an estimate | Always show the illustrative per-level effect; add estimated minutes when available. |

No review replies, thread resolutions, follow-up issues, merge or production deployment were requested or performed as part of this assessment.

Actual verification of the review fixes:

- `pnpm check`: passed, including **441 unit tests in 54 files**, both TypeScript checks, formatting/lint (warnings only), generated output/boundary consistency and documentation checks.
- `pnpm test:integration`: **287 tests in 20 files passed** in the same isolated synthetic database. The first run found an unrelated flaky export assertion: random encrypted review-token text happened to contain `gps`. The assertion now checks exported records, preserving the intended exclusion check without inspecting ciphertext; the entire suite then passed.
- `pnpm build`: web and worker production builds passed. No database migration changed.
- `pnpm exec playwright test tests/e2e/race-analysis.spec.ts tests/e2e/calendar-cards.spec.ts --max-failures=2`: **30 tests passed** across desktop and Pixel 7, including both themes, 320px layout and stale-save retries after reload for terrain, reference edits and uploads. An initial new assertion used an exact label-text locator for a wrapped native select; using its accessible combobox role/name corrected the test, and the complete browser set passed.
- Refreshed and visually reviewed the four committed synthetic desktop/phone screenshots in both themes. The owner's independent demo on port 3114 was not restarted or modified.
- Final documentation links, changed-test formatting and `git diff --check` passed. Publication checks and the pinned history secret scan run before the follow-up commit is pushed; hosted CI remains a separate result.
