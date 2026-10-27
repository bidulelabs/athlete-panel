# Feature: Garmin Personal API imports

## Purpose and scope

Import the instance owner's Garmin activities and selected health records into private persistent storage. Manual training remains available independently of Garmin.

Outside scope: partner OAuth, refresh tokens, callbacks, other sports providers, Garmin write-back, workout export, FIT files and GPS tracks. This is a fresh-data application; historical Garmin import is not legacy Athlete Panel migration.

## Intended behavior

Specification status: approved product scope; transport and normalization choices below describe this implementation.

Requirement sources: the owner's approved scope recorded in the [execution record](../plans/mvp-execution.md#authority-and-scope), and the owner's subsequent request on 2026-10-24 to remove the history-start input and automatically import all available past data. Selected health data is sleep duration, deep/light/REM/awake stages and score; resting heart rate; overnight HRV; steps; stress; and Body Battery.

The owner supplies a Personal API key server-side. The plugin exchanges it using `Authorization: ApiKey` at Garmin's official token endpoint, caches the returned bearer token against credential generation and a key fingerprint, and reissues before expiry. The JWT expiration is only a cache hint, never an identity assertion. A 401 causes one reissue/retry; repeated rejection stops the request. No refresh token or partner secret exists. Long historical scans are paced, pausable and resumable; the Garmin page refreshes progress while they run. Completion means supported traversal finished, not that every metric exists for every day.

Initial sync verifies account identity, imports recent seven-day activity and health data, traverses all older activity pages, then traverses health windows backwards to an internal scan boundary. Connection requires only the Personal API key; there is no user-facing history-start input. Scheduled recent runs refresh the latest seven days about once per hour while the worker is running, Garmin is connected and imports are not paused. The interval is measured from creation of the latest recent-import job, not from a fixed clock hour. The worker checks scheduling approximately every 30 seconds between job steps; existing queued/running work and retry delays are preserved. The owner requested this hourly cadence on 2026-10-25. Each step returns normalized records, coverage and the next checkpoint. The host commits those records, the account binding and checkpoint in one transaction; an interrupted step is repeated. Imported records are upserted by stable provider identity. Empty health windows continue backwards; they do not establish that older data is absent. The internal health boundary is January 1, 2000, or an older existing legacy boundary. It is a conservative application policy predating Garmin's fitness products, not an API retention promise. Activity pagination remains unbounded by this date.

Garmin may not retain every selected metric across the requested period. Coverage distinguishes available, partial, no-data and forbidden streams. An unavailable stream does not fabricate zeros or stop unrelated health streams. Rate limits and transient failures preserve the current checkpoint for retry. Credential removal preserves imported history; history deletion is a separate deliberate host operation.

Automatic history imports ignore a former user-selected cutoff. An existing automatic job is expanded in place without resetting progress; a completed old job is followed by a new full traversal. In-flight responses cannot overwrite an expanded checkpoint. Retrying a failed historical import with the same date scope resumes its saved checkpoint. An explicit repair with both range dates remains a separate bounded traversal. A stale client may still send the former connection date or an untargeted start date; those fields no longer narrow automatic history. Failure coverage identifies the actual metric stream and bounded request dates; a successful retry replaces that window's failure rather than leaving it falsely marked failed.

## Acceptance scenarios

Automatic recovery uses completed per-stream scan intervals, including successful empty responses. Activity windows are confirmed only after an empty terminal page. Unscanned intervals remain visible separately from unavailable, failed and rejected data. Initial traversal checkpoints are preserved; pending traversal ranges are not duplicated by catch-up work. Missing periods older than the recent seven-day window receive bounded, resumable catch-up jobs.

After initial and catch-up work, historical reconciliation rotates across streams at most once every five minutes, with persisted timing and cursors. Health revisits stable 28-day buckets to the existing internal boundary; activity pagination has no lower date cutoff and freezes its upper bound until completion. Completed background slots are reused, while failed checkpoints remain inspectable until explicit retry. Forbidden historical streams wait for a successful recent probe. Provider backoff applies across Garmin job kinds; pause, disconnect, account binding and generation/lease fencing remain authoritative. Priority is recent imports, repairs/catch-up, initial history, then reconciliation. Scanned coverage describes requests performed, not Garmin retention or guaranteed completeness.

| Situation or input | Expected observable result | Verification |
| --- | --- | --- |
| Connect with only a key or request automatic history after a legacy cutoff | Queue full history with the internal boundary; preserve credentials, prior data and active progress | Automatic-history integration tests |
| Recent job is just under / exactly one hour old | No early enqueue; a completed prior job permits one new recent import at the boundary; concurrent checks and retrying work do not duplicate jobs | Hourly scheduler integration tests |
| Imports paused or credentials absent | Automatic scheduling remains disabled; resuming permits eligible work | Scheduler integration tests |
| Empty historical windows before the oldest activity | Continue scanning to the internal boundary, never infer an account start from activity dates | Traversal tests |
| New key or expired cached token | Official key exchange, bearer GETs, cache scoped to key generation | [Synthetic transport tests](../../tests/unit/garmin.test.ts) |
| Request returns 401 twice | Exactly one token reissue; sanitized credential error | Transport tests |
| 429, network failure or timeout | Retryable error; Retry-After honored by host job scheduling; no checkpoint advance | Transport/step tests and host integration |
| Different stable Garmin account ID | Reject before persisting records; no account merging | Identity and step tests |
| Numeric ID larger than JavaScript's safe integer | Preserve exact decimal string from JSON parsing onward | Lossless-ID test |
| Activity UTC date differs from provider local day | Calendar uses provider local date; UTC instant remains intact | Midnight/DST fixtures |
| Missing or negative sentinel metric; actual zero | Missing becomes null; zero stays known | Health normalization tests |
| Undated sleep DTO with no overnight identity, timestamps or measurements | Ignore only the explicit empty overnight shape; nap/sleep-need metadata does not provide a date; coverage remains missing | Sleep placeholder regression tests |
| Undated sleep DTO contains a measurement, identity, timestamp or unknown non-null field | Reject that record with sanitized diagnostics; import valid neighbours and advance the checkpoint | Record-validation regression tests |
| Empty old health window | Record no-data coverage and continue to the internal boundary (or explicit repair bound) | Historical traversal test |
| One health stream returns 403 | Mark unavailable, continue others, retry eligibility on a later run | Partial-stream test |
| Interrupted or replayed step | Same external identities and checkpoint; caller commits atomically | Step replay tests and host integration |
| Failed historical window retried with the same scope | Resume that checkpoint, retain prior records, and replace failed coverage when the window succeeds | Historical retry integration tests |
| Garmin is disconnected or down | Stored data remains readable and manual training works | Application integration/release check |

## Observed implementation

The [transport](../../plugins/garmin/transport.ts), [normalizers](../../plugins/garmin/normalize.ts) and [step engine](../../plugins/garmin/sync.ts) are implemented with injected HTTP, clock, sleep and token-cache interfaces. The public entry point is [the Garmin plugin index](../../plugins/garmin/index.ts). The host owns encrypted credentials/token persistence, jobs, transaction boundaries, UI and account binding storage.

The official Personal Swagger 1.0.0 schema embedded in Garmin's public documentation and the official Python reference client were inspected on 2026-10-24. Initial verification used synthetic fixtures. A subsequent owner-requested investigation confirmed that historical sleep responses can include explicitly empty overnight DTOs with `calendarDate: null`, null identity/timestamps/overnight metrics, and optional nap or sleep-need metadata. The normalizer excludes that narrow shape, keeps the days missing, and does not infer dates from unrelated metadata. Invalid dates and undated substantive overnight records still fail validation. Broader account permissions, historical completeness and device variants remain separate smoke-check gates. Individual execution results belong in the task record.

## Contracts and constraints

Normalized data uses [shared Activity and HealthRecord contracts](../../packages/contracts/src/index.ts). The plugin returns records without local IDs/revisions; the host allocates stable IDs and revisions through idempotent upserts. Activity `duration` is seconds, distance/elevation are meters. Missing provider local dates fall back to the athlete's configured timezone and are marked inferred. GPS, activity descriptions and provider profile fields are not copied into these contracts.

| Stream | Official Personal endpoint | Mapping and bounded request |
| --- | --- | --- |
| Activities | `/activitylist-service/activities/search/activities` | Lossless `activityId`; `ownerId` binding; `startTimeGMT` and `startTimeLocal`; actual page offset; request 99; finish on empty page |
| Sleep | `/sleep-service/sleep/dailySleepSummariesByDate` | Date, seconds/stages and `sleepScores.overall.value`; 28-day windows within documented 31-day maximum |
| Daily summaries | `/usersummary-service/v2/dailysummaries` | `data[].heartRate.restingValue`; 28-day windows within documented one-year maximum |
| HRV | `/hrv-service/hrv/daily/{from}/{to}` | `hrvSummaries[].lastNightAvg`; 28-day windows; 204 means no data |
| Steps | `/usersummary-service/stats/steps/daily/{from}/{to}` | `totalSteps`; 28-day documented maximum |
| Stress | `/usersummary-service/stats/stress/daily/{from}/{to}` | `values.overallStressLevel`; 28-day documented maximum |
| Body Battery | `/wellness-service/wellness/bodyBattery/reports/daily` | Latest valid reading by timestamp, using declared column descriptors; 28-day windows within documented 31-day maximum |

Body Battery is a daily latest-observed level, not a recovery recommendation. Numeric timestamps in its descriptor array have no unit specified in the inspected schema: they establish ordering, but `measuredAt` remains null rather than guessing seconds or milliseconds. HRV uses the overnight average, not a seven-day average. Sleep duration excludes naps. A missing daily record remains a coverage gap, not an invented all-null observation.

Account identity comes from documented numeric `ownerId` or `userProfilePk`/`userProfilePK`, never mutable display names or unverified JWT claims. Identity discovery probes the newest activity and then recent daily/HRV records. If none exposes an ID, importing stops with an explicit identity-unavailable error. Replacing credentials cannot change a previously bound account. The host must check credential generation again when committing a step so an in-flight job from a removed/replaced key cannot write.

The HTTP client permits only these read endpoints and the token exchange on a fixed HTTPS origin, refuses redirects, paces requests, propagates cancellation and bounds request time. Errors exclude raw responses, tokens and provider request details. Secret cache callbacks are server-only. A plugin is trusted application code; its manifest is not an isolation boundary.

## Verification and release details

Use synthetic fixtures and isolated storage for routine checks. The [development guide](../development.md) owns commands and operating procedures. A credentialed smoke check must separately confirm key onboarding, stable identity, available metric mappings, history traversal and revocation handling without recording secrets or raw health payloads in logs.

The host must upsert records, rejection diagnostics and the checkpoint atomically, respect lease ownership and credential generation, and preserve history on disconnect. Collection envelopes and all account identities are checked before accepting records; malformed envelopes or account violations remain fatal. Invalid individual records are rejected while valid neighbours import. Activity offsets use raw page length, including rejected rows; only an empty raw page ends pagination and repeated pages stop visibly. Retry-After is a duration returned to scheduling, not a long request-path sleep.

Coverage separates scan state from measurement quality. Rejected records make a window partial, never empty or complete, and expose a count plus at most 50 sanitized samples (range, position, safe identity/date, field paths and reason codes). Raw payloads are not stored. The rejected-record filter supports explicit stream/window repair; a completed replacement scan replaces prior diagnostics. Legacy activity pages without proof of exhaustion remain unconfirmed. The optional `stream` parameter on bounded full imports narrows repairs; omitted parameters retain existing behaviour.

Policy evidence: [Garmin's company history](https://www.garmin.com/en-US/company/history/) dates its entry into running/fitness to 2003. The earlier 2000 health scan boundary is a conservative implementation choice; the published Personal API provides no account-created date or authoritative health-history exhaustion marker. No such marker is inferred from an empty window.

Primary references: [Personal API setup](https://developer.garmin.com/gc-developer-program/personal/personal-api/), [Personal FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/), [Personal Swagger](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/), and [Garmin's official Python client](https://github.com/garmin/connect-personal-api-python).

The calendar presents existing normalized sleep values through [sleep cards and detail views](training-workspace.md#calendar-cards-and-detail-views). This display change adds no provider endpoint, credential access or historical reimport requirement. Stage totals are available when supplied by Garmin; no sleep-stage timeline or bedtime is inferred from them.

### Verification and progress feedback

Saving a key means credentials are stored, not that Garmin accepted them. Successful account-bound import records the verified credential generation; rotation returns the connection to waiting for verification. The owner sees paused/error states, retry timing, worker availability, current request windows and aggregate coverage counts. The paginated coverage view distinguishes missing measurements from unscanned periods. Existing credentials lacking verification metadata need a subsequent successful import; no live-provider claim is inferred from old UI status.

### Shared onboarding connection controls

The [authenticated welcome flow](first-time-onboarding.md) reuses key entry and the existing worker verification/import pipeline. Configuration accepts an optional idempotency UUID; repeating the same request returns its result without rotating the credential generation or queueing another import. Only a fingerprint and non-secret result are retained in idempotency storage. Status exposes sanitized error codes, current job/backoff, latest history-job state and coverage counts; no key/token is returned. Key drafts are cleared after acceptance and when the shared form unmounts, including cancellation.

## Connection and historical failure feedback

Owner-approved audit follow-up, 2026-10-25: verification and history coverage are separate facts. Onboarding and Garmin use the same status message. Persistent failed or unavailable windows continue to indicate that history needs attention even after a later successful request. Unavailable counts use the stored `unavailable` state. Empty coverage never implies zero measurements or complete provider retention.

The owner-only coverage operation validates a filter and offset, returns at most 50 windows, and supports all/unscanned/failed/unavailable/rejected-record views. Older failures remain discoverable beyond the workspace snapshot limit. Retrying a specific period uses duplicate-safe stream/window repair with active-job and pause guards; unavailable periods first explain permissions/device availability. Coverage read failures retain a labelled last-loaded result or show a reload action. Active import status is independent of the truncated recent-jobs list.

Acceptance: a failure older than 300 newer windows is still filterable and retryable; unavailable totals match persisted windows; stale connection verification cannot hide incomplete history. Synthetic integration/browser tests cover these states without real Garmin credentials.

Activate the additive coverage/scheduling migrations using the [coordinated upgrade procedure](../development.md#coordinated-upgrades-and-plugin-activation); rollback requires the matched pre-upgrade backup. Applied migrations and retained cursors remain immutable.
