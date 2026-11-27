# Feature: Apple Health workout import

## Purpose and scope

Bring Apple Watch workouts into the same private calendar, activity history and weekly totals as Garmin rides. Sync for Health sends workout summaries and optional GPS routes to the athlete’s own instance. Issue #157 tracks daily health metrics and TCX export as follow-ups. [Issue #157](https://github.com/bidulelabs/athlete-panel/issues/157)

## Intended behavior

The owner approved implementation of the issue plan on 2026-11-27. The plan starts counting workouts on arrival, returns linked sessions to planned when Apple deletes their recordings, and accepts historical GPS uploads within the configured limits.

### Connect the iPhone

1. Select **Add Apple Health** during welcome setup or in **Settings → Activity sources**. Select **Create upload token** and copy the upload URL and token. The URL comes from the instance’s configured HTTPS origin. Apple Health appears in the sidebar after it is chosen or paired.
2. Install Sync for Health on an iPhone with iOS 26 or later. Enter the URL and token in the app’s settings, enable **Workouts**, and run **Test connection**. Athlete Panel displays the connection test and last workout upload separately. [Sync for Health](https://apps.apple.com/app/sync-for-health/id6819742018)
3. Run **Sync now** with GPS workout routes off for the initial history upload. Enable GPS workout routes afterward to import routes for new workouts. The iPhone schedules background delivery and can retry after it unlocks.

The phone can resume from its last acknowledged batch. Use **Sync now** to retry, or **Resend all history** to recover earlier workouts or add older routes. If a GPS history upload exceeds 32 MiB, turn GPS routes off and resend the summaries. The received date range describes the workouts that arrived. **Rotate upload token** replaces the credential. **Disconnect** revokes it and keeps imported history.

Each Copy button lines up with its field. Creating or rotating a token moves keyboard focus to **Copy token**. Copy feedback appears below the field. If clipboard access fails, the field is focused and its full value is selected for manual copying.

### Review and link workouts

Activities record their source, sport, date, duration, distance, recorded ascent and available average and peak heart rate. Workout timezone metadata supplies the local date when present. The profile timezone supplies an inferred date otherwise. Missing facts stay unavailable and measured zero stays visible.

Workouts arrive immediately. Under **Recording sources**, exclude a source to remove its Apple Health copies from the calendar and totals. Including it again lets the phone restore prior workouts on a history resend. Link a workout through the existing planned-session picker. The owner confirms Apple links because the phone confirms individual batches. A linked pair counts once.

Apple deletions and source exclusions return affected linked sessions to planned. **Training plans → Recent changes** retains the owner’s notes and effort. Compatible corrections preserve links and their annotations. A changed sport that conflicts with a link appears in the import issues with instructions to unlink and resend.

**Download GPX** appears in activity details when a route is available. It preserves coordinates, timestamps and available point elevations for use in Race Analysis. The activity detail labels smoothed climbing as an estimate. Weekly elevation totals use the watch’s recorded ascent.

## Acceptance scenarios

| Situation | Expected result | Verification |
| --- | --- | --- |
| Connect, retry or rotate a token | The connection test stays distinct from data arrival, retries are safe, and old credentials are rejected | [Import integration tests](../../tests/integration/apple-health.test.ts) |
| Import mixed workouts and exclude a duplicate source | Dates, source labels and weekly totals reflect the visible records. Resend restores stable IDs | [Import integration tests](../../tests/integration/apple-health.test.ts) |
| Link, correct or delete a workout | The link counts once, corrections preserve owner annotations, and deletion restores the plan with an audited change | [Import integration tests](../../tests/integration/apple-health.test.ts) |
| Import optional GPS | Summary-only workouts remain visible. Valid routes round-trip through Race Analysis with elevation and time | [Wire and route tests](../../tests/unit/apple-health.test.ts) |
| Pair and view a workout from the browser | Setup, source labels, source exclusion and GPX download work on desktop and phone in both themes | [Browser tests](../../tests/e2e/apple-health.spec.ts) |

## Observed implementation

The [Apple Health plugin](../../plugins/apple-health) owns connection and upload state. [Activity Records](../../plugins/activity-records) owns the normalized records and private GPX files. Training supplies the linked completion update and audit. The implementation is based on Sync for Health v1 and synthetic fixtures. A credentialed iPhone check is tracked separately. [Execution record](../plans/apple-health-workout-import.md)

## Contracts and rollout

`POST /api/apple-health/workouts` accepts a bearer-authenticated JSON or gzip upload, with a 32 MiB limit on wire and decoded data. The response acknowledges a batch after the database transaction commits. Format errors leave the batch retryable. Rejected workout rows have bounded, sanitized reasons. The endpoint acknowledges diagnostic envelopes and discards their contents. See the [upstream protocol](https://github.com/vcnngr/sync-for-health/blob/main/docs/PROTOCOL.md) and [decision 025](../decisions/025-apple-health-workout-ingestion.md).

Enable the matching release composition, run the additive migrations, and refresh runtime schema grants through the [coordinated upgrade procedure](../development.md#coordinated-upgrades-and-plugin-activation). Keep the matched pre-upgrade backup and artifact together for rollback.
