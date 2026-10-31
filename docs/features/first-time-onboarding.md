# Feature: First time onboarding

## Purpose and scope

Help a newly created owner confirm three preferences, optionally connect Garmin, and open the calendar. Use one welcoming dialog with three short steps. The calendar remains usable without Garmin and before historical imports finish.

Password creation belongs to the terminal setup described in [guided local setup](local-setup.md). This flow starts only inside the authenticated application; it does not create accounts, ask for the login password again, or configure infrastructure.

Outside scope: HR zones, FTP, goals, availability, agent grants, backup setup, a product tour and new sports functionality.

## Intended behavior

Specification status: **approved and implemented**.

Requirement source: the owner's request on 2026-10-25 for a minimal three-step flow after `pnpm run setup` and first sign-in. No durable conversation link is available. The owner subsequently requested implementation of this specification on 2026-10-25, accepting the flow, dismissal policy, upgrade behavior and implementation scope.

### Dialog and navigation

Show a centered dialog on desktop and a near-full-height dialog on small screens. Use the existing light/dark styles. Its persistent heading is **Welcome to Athlete Panel**, with the introduction: “Make this workspace yours. Confirm a few preferences and connect Garmin if you use it.”

Show a simple non-interactive indicator: **1 Preferences · 2 Garmin · 3 Ready**, plus accessible text such as “Step 1 of 3 — Your preferences.” Do not add a separate welcome screen.

The top-right close control has the accessible name **Finish setup later**. Escape has the same behavior; tapping outside does not dismiss the dialog. A short footer explains: “Saved steps are kept. You can finish later in Settings.” Closing preserves saved progress, discards unsaved field edits and clears any API key from the mounted form. It never disconnects Garmin or cancels an import.

**Back** returns to the preceding step without undoing saved preferences or connection changes. Step 1 has no Back button. Only the Garmin step has a Skip button. Normal navigation controls are disabled during their own short save request, with a visible busy label; the close control remains available. Closing during a request does not promise to cancel a server operation. On resume, reload its authoritative result.

### Step 1 — Your preferences

Suggested copy: “Choose how dates and distances appear. You can change these anytime in Settings.”

| Field | Choices and suggested default | Help text |
| --- | --- | --- |
| Timezone | Native timezone selector with IANA values and readable labels, for example Paris — Europe/Paris. Preserve a saved value; otherwise suggest the browser's valid timezone. Fall back to UTC when detection fails. | “Suggested from this device. Check that it matches where you train.” For fallback: “We couldn't detect your timezone. Choose one, or keep UTC.” |
| Measurement units | Metric — kilometers and meters; Imperial — miles and feet. Preserve a saved value; otherwise select Metric, matching the existing default. | “Used for distances and elevation.” |
| First day of the week | Automatic — Monday/Sunday, resolved through the existing browser-locale helper; Monday; Sunday. Preserve a saved choice; otherwise Automatic. | “Automatic follows this browser's region. Choose a day to keep the same layout on every device.” |

All three fields are required, with valid defaults. Include UTC and any valid saved/detected timezone in the selector. Do not request geolocation. Do not silently use the contract's current Europe/Paris fallback for an undetected timezone.

Below the fields: “Heart-rate zones, FTP and other training settings can wait.” Do not request a display name; a new profile can use the existing “Athlete” default. Preserve all existing detailed profile fields.

Primary button: **Save and continue**; busy text: **Saving preferences…**. Validate through the existing profile schemas and save before advancing. On failure, keep the draft and show “Your preferences couldn't be saved. Please try again.” Show a specific field error where available. For a revision conflict, say “Your settings changed elsewhere. Review the latest values before saving,” with **Review latest settings**. Never silently overwrite another tab's changes.

### Step 2 — Connect Garmin — optional

Suggested copy:

> Bring in your recorded activities, sleep duration and stages, sleep score, resting heart rate, HRV, steps, stress and Body Battery. Availability depends on your Garmin devices and history. Athlete Panel reads your data; it does not upload training to Garmin.

Below it: “Recent data is imported first. Older history follows in the background while your instance is running. You can start using the calendar right away.” Do not ask for a history-start date or promise every past record is available. The existing importer traverses activity pages and scans health history back to its internal boundary, currently January 1, 2000; that policy is not a Garmin retention guarantee. See [import behavior](garmin-import.md).

Provide **Get a Garmin Personal API key**, opening [Garmin's official instructions](https://developer.garmin.com/gc-developer-program/personal/personal-api/) in a new tab with that behavior announced. Suggested compact instructions: “Sign in to Garmin Connect, open Personal API Key, create a key, accept Garmin's terms and choose its expiry. Copy the key when Garmin displays it; you cannot view it again later.” These steps are documented by Garmin and were checked on 2026-10-25. This is Garmin's documented Personal API; do not describe it as an unofficial login integration or imply Garmin endorses Athlete Panel.

Field: **Garmin Personal API key**. Use a masked password input, permit paste, disable spelling/autocapitalization, and never autofill the owner's login password. An accessible **Show key / Hide key** toggle may reveal only the current unsaved entry. Helper: “Your key is sent to your instance, stored encrypted, and used by the server to connect to Garmin. Athlete Panel never asks for your Garmin password.”

Initial buttons: **Back**, **Skip for now**, **Connect Garmin**. The last button requires a nonempty key and uses existing server validation; while saving, show **Saving key…**. The save response must not be presented as verified connection success.

After the server accepts the key, clear the input and show **Checking your Garmin connection…**. Verification is the existing worker's account-identity phase, followed by recent import and historical traversal. Do not add a separate provider authentication implementation. Show **Continue** immediately after acceptance, even if verification is pending. Its helper is “We'll keep checking in the background.” The owner can watch verification or proceed to step 3.

If a key is already stored, show its current state instead of requesting it again. Offer **Replace API key** only as an explicit action. Saving a replacement uses the existing account-binding protection. Never resubmit a key merely because the owner returns with Back or refreshes.

| State | Suggested message and action |
| --- | --- |
| No key saved | “Garmin isn't connected. You can connect later from Garmin in the sidebar.” **Skip for now** advances without provider calls. |
| Verification queued, worker unavailable | “Your key is saved. Connection checking will start when the background worker is available.” **Continue**; link to **Plugins → Instance status**. |
| Account verified, import queued/running | “Garmin connected. Your data is importing in the background.” **Continue**; optionally show the current phase/date range, not an invented percentage. |
| Temporary network/provider error | “Garmin is temporarily unavailable.” Show an actual scheduled retry time when known; **Retry connection** only when no active attempt/backoff prevents it. **Continue** remains available. |
| Rate limited | “Garmin asked us to wait. We'll retry at [time].” Respect the existing retry schedule; no button bypasses it. |
| Key rejected, expired or revoked | “Garmin couldn't accept this key. Create or check your Personal API key, then try again.” **Replace API key** and **Continue**. Do not repeatedly retry a rejected key automatically. |
| Account identity cannot be established | “We couldn't verify which Garmin account this key belongs to. No data has been imported from this attempt.” **Retry connection**, or **Continue** and inspect details on Garmin. Do not invent an account binding. |
| Key belongs to a different bound account | “This instance is already linked to another Garmin account. Use a key for the same account.” No merge, reset or history deletion from onboarding. |
| Account verified, some history failed/unavailable | “Garmin connected. Some history needs attention.” **Continue**; link to Garmin for the affected ranges. Do not report a failed connection solely because a later health window failed. |
| Status cannot be refreshed | “We couldn't refresh Garmin status. Your import may still be running.” **Refresh status**, retaining the last known state with its timestamp. |

Before a key is accepted, a failed save retains it only in the current form's memory so the owner can retry. Refreshing, closing, skipping or leaving that form clears it. After acceptance, retry uses the encrypted server credential, never a key read back into the browser. A lost save response must be resolved by reloading status and safely replaying the same request ID before claiming success or creating another credential generation.

**Skip for now** is available only before a key is saved. Once credentials exist, use **Continue** rather than suggesting they will be removed. A paused connection stays paused unless the owner explicitly resumes it. If the Garmin plugin is disabled, explain “Garmin is disabled. You can enable it later in Plugins,” and allow skipping without activating anything.

### Step 3 — Ready to start

Heading: **Ready to start**. Copy: “Your workspace is ready. You can plan training now, even while Garmin is importing.”

Show a compact summary of saved values, for example:

- Timezone: Europe/Paris
- Units: Metric — kilometers and meters
- Week starts on: Automatic — Monday on this device
- Garmin: Not connected / Key saved, verification pending / Connected, importing history / Paused / Needs attention / Latest history scan finished

Derive Garmin wording from current verification, job and coverage state. “Latest history scan finished” does not mean every historical record exists. If status is stale or unavailable, say so. Never show the API key, its suffix or an account identifier.

Below the summary: “Change preferences and training settings in Settings. Check your connection and import progress from Garmin in the sidebar.” Use the actual route destinations `/settings` and `/garmin`.

Buttons: **Back** and primary **Open my calendar**. The primary action saves onboarding completion, then navigates to `/calendar`. It does not wait for Garmin. If completion cannot be saved, retain the summary and offer **Try again**; closing still permits ordinary calendar access. Completed onboarding remains completed even if Garmin later fails or disconnects.

### Appearance, saving and resuming

| Situation | Behavior |
| --- | --- |
| Newly bootstrapped owner signs in | Open step 1 after the authenticated workspace and saved state load. Never flash the dialog before authentication. |
| Refresh, browser closure or session expiry without deliberate dismissal | Resume the last saved step after sign-in. Saved values win over device defaults. Unsaved fields are not promised to survive. |
| Back or successful step advance | Persist the current step. Saving preferences and their step transition is atomic. |
| Close / Escape / follow a destination link out of the dialog | Persist “deferred” and the current step, then close. Show an unobtrusive **Finish setup** action in Settings; do not automatically reopen on the next visit. |
| Dismissal cannot be saved | Close the dialog, but show “Couldn't save your setup progress. Setup may reopen after refresh.” Offer retry from the workspace; don't trap the owner. |
| Explicit resume from Settings | Set active and open the saved step. Re-read preferences and Garmin status. |
| Open my calendar succeeds | Persist completed status and completion time. Never automatically show version 1 again. |
| Owner existed before this feature's migration | Mark “existing owner”; no automatic dialog, even if the profile is empty. Settings offers **Run welcome setup**. Opening it uses current values. |
| Password recovery, setup rerun or application upgrade | Preserve progress/completion; these are not new owners. |
| Sign-in returns to an agent-approval deep link | Complete that requested action first. Defer automatic onboarding until a normal workspace visit; do not obscure or consume the approval link. |

State is per owner in PostgreSQL, not a browser-local completion flag. Use a versioned record containing `version`, `status` (`pending`, `active`, `deferred`, `completed`, `existing-owner`), `step`, `revision`, `updatedAt` and nullable `completedAt`. Store no credentials or duplicated preference/import values there. Step 3 plus the actual connection state is sufficient to resume; no separate copied Garmin status is needed.

An additive migration classifies existing owners; new owner bootstrap initializes pending state transactionally. Missing state must not be interpreted as a new owner solely from an empty profile. Updates use revisions and idempotency so multiple tabs, delayed responses and retries cannot revert completed/deferred state or duplicate connection jobs. A progress conflict reloads the current state; advancing an older tab never resets another tab's completed setup.

## Contracts and required changes

| Area | Reuse | New development |
| --- | --- | --- |
| Preferences | [Profile contracts](../../packages/contracts/src/index.ts), [profile editor](../../plugins/athlete/client.tsx), [week-start helper](../../packages/ui/src/calendar-dates.ts), profile revisions and domain validation | Extract the three shared controls; add the timezone selector and onboarding presentation. `profile.set` changes only the fields it sends: save the three selected fields with an expected revision. Preserve goals, name, zones, FTP and availability. |
| Dialog and shell | [Modal/error primitives](../../packages/ui/src/primitives.tsx), [authenticated workspace](../../packages/ui/src/workspace.tsx), existing navigation/theme | Add the stepper, focus/close behavior and authenticated onboarding contribution. Prefer one generic workspace-level contribution slot registered by the athlete plugin; the current slot contract only supports calendar, inspector and dashboard. Update SDK/registry generation for that additive slot; keep feature content out of the host shell. |
| Progress and API | Host settings storage, transactions, authenticated [plugin operation dispatcher](../../apps/web/app/api/plugins/[id]/[operation]/route.ts) | Owner-only operations for saving preferences/step, Back, defer, resume and complete; shared schemas and safe onboarding state in `/api/workspace`. Keep generic lifecycle metadata in host storage, preference rules in the athlete/domain services. An application coordinator commits profile changes, audit and progress together. Agent grants cannot call these operations. |
| Eligibility | [Owner bootstrap/recovery](../../packages/host/src/auth.ts), migration coordinator | Add immutable migration and new-owner initialization. Recovery must leave existing progress untouched. No new terminal question. |
| Garmin | [Connection/configuration and sync services](../../plugins/garmin/service.ts), [connection UI](../../plugins/garmin/client.tsx), encryption, account binding, durable jobs and retries | Extract a reusable key-entry/status component; add safe configure-request idempotency. Provide structured, sanitized status/error codes and a current history-job summary rather than parsing English errors or relying on the workspace's latest-50-job list. Reuse `sync`/`pause` for eligible retries/resume; do not add browser-to-Garmin calls. |
| Status refresh | Existing polling and worker-health projection | Poll the minimal status projection about every 10 seconds while the dialog is visible, including the first step so another tab’s progress is detected; stop on close/hidden tab and refresh on return. Preserve provider backoff. No new scheduler or historical-import algorithm. |
| Documentation | [Setup](local-setup.md), [training](training-workspace.md), [Garmin](garmin-import.md), [architecture](../architecture.md) | On implementation, document the terminal/sign-in/dialog boundary, Settings resume action and new contracts; preserve command authority in the development guide. |

Avoid nested transactions when reusing profile changes: extract a transaction-scoped domain entry point rather than calling the existing transaction-opening mutation service from another transaction. Preference audit remains separate from navigation metadata; domain undo must not replay a wizard step or reopen completed onboarding. Configure idempotency stores only a request fingerprint and non-secret result, never the submitted key or request body.

### Privacy and accessibility

Only an authenticated owner can read or change onboarding state, preferences or Garmin configuration. Keep the existing session and origin protections. Use HTTPS for remotely hosted instances; the existing local loopback development exception remains local. Keys and tokens stay out of URLs, browser storage, status responses, logs, analytics and agent context. Discarding an input removes application references; do not promise guaranteed erasure from browser memory.

Reuse server encryption with the instance key outside the database. Creating a connection and starting its imports requires the explicit **Connect Garmin** action; opening onboarding, following the help link or skipping does not initiate a connection. Previously configured background imports continue independently.

Provide labelled controls and associated help/errors, keyboard navigation, trapped modal focus and focus restoration. On each step, focus its heading; on invalid submission, focus the first invalid field. Announce step changes and connection results through a restrained live region, without repeating announcements at every poll. Loading, success and failure must use text, not color alone.

Support both themes, reduced motion, 200% zoom and a 320px-wide viewport without horizontal overflow. Keep actions reachable above a mobile keyboard, allow internal scrolling, and target touch controls of at least 44px. The close action must remain reachable. Do not auto-advance when Garmin verifies; let the owner read the result and choose Continue.

## Acceptance scenarios

The following acceptance scenarios are covered by the linked suites; individual execution results are recorded in the execution record.

| Scenario | Observable acceptance | Relevant verification |
| --- | --- | --- |
| Fresh owner; no Garmin key | Sign-in opens step 1; save preferences, skip Garmin, open calendar; no provider call | [Onboarding browser suite](../../tests/e2e/onboarding.spec.ts) using isolated synthetic owner state |
| Browser defaults / saved values | Correct timezone suggestion, UTC fallback, Metric default, locale-resolved Automatic; saved choices take precedence | Contract/component tests; extend [week-start tests](../../tests/unit/calendar-dates.test.ts) |
| Existing detailed profile | Only the three preference fields change; stale revision rejects the whole save and step advance | Extend [domain integration tests](../../tests/integration/domain.test.ts) |
| Refresh/interruption/close/Back | Saved step survives; drafts/key do not persist; deliberate dismissal stops automatic presentation; Settings resumes | Browser tests across reload and reauthentication |
| Existing owner / recovery / upgrade | No forced dialog; manual welcome action preserves settings; recovery never resets completion | [Onboarding integration suite](../../tests/integration/onboarding.test.ts) |
| Key accepted but worker stopped | Show saved/pending, not verified; Continue and calendar work; later worker execution resumes | Extend [Garmin integration](../../tests/integration/garmin.test.ts) and [browser tests](../../tests/e2e/garmin.spec.ts) with synthetic responses |
| Valid key / history still running | Verification succeeds independently of history completion; leaving onboarding does not cancel the job | Synthetic worker integration plus browser status fixtures |
| Invalid key / 429 / outage / identity mismatch / partial history | Appropriate messages and permitted retry action; no account merge, backoff bypass or fabricated completeness | Transport/status projection and integration fixtures |
| Lost response / double click / multiple tabs | Same configure request applies once; saved preferences/progress are atomic; completion is not rolled back | Transaction and idempotency integration tests |
| Privacy and authorization | Submitted key cleared from the form after acceptance; no persisted browser key or secret in responses/logs/idempotency records; owner session/origin required; agent grant rejected | Security/API tests with a synthetic sentinel key |
| Agent approval return link | Onboarding does not cover or lose the approval request | Extend [agent connection browser tests](../../tests/e2e/agent-connect.spec.ts) |
| Keyboard, mobile and themes | Usable stepper, announced errors/status, focus management, Escape, zoom and narrow layout | Playwright plus manual screen-reader/mobile-keyboard review |

Use synthetic Garmin fixtures and explicitly isolated test databases as required by [development and verification guidance](../development.md). A real Garmin account check is a separate opt-in smoke check, not a prerequisite for routine onboarding tests. No test should reuse or alter the owner's live records.

## Observed implementation

The [athlete onboarding contribution](../../plugins/athlete/onboarding-client.tsx) implements the three steps and Settings resume action through the generic `workspace` slot. [Shared preference controls](../../plugins/athlete/preferences.tsx) are used by both onboarding and Settings. [Shared Garmin controls](../../plugins/garmin/connection-client.tsx) clear the key on acceptance/unmount and distinguish stored credentials from verified account/import status.

[Shared progress contracts](../../packages/contracts/src/onboarding.ts), [host lifecycle storage](../../packages/host/src/onboarding.ts) and the [application coordinator](../../instance/onboarding.ts) implement server-saved revisions, idempotency, atomic preference/audit/progress changes and terminal completion. The additive [athlete migration](../../plugins/athlete/migrations/003-onboarding.sql) marks upgraded owners as existing; owner bootstrap initializes new progress and password recovery preserves it. No browser password-creation step was added.

The owner-only `POST /api/plugins/athlete/onboarding` accepts typed actions. `GET /api/onboarding` returns progress, safe Garmin status and worker heartbeat without loading training records or coverage detail. The full workspace response also includes progress. Garmin's existing worker performs verification/imports; configure retries use request fingerprints, and the safe status projection includes structured error codes and a dedicated current-job query. The original import scheduler/traversal remains unchanged.

Verification uses [transaction tests](../../tests/integration/onboarding.test.ts), [status/contract tests](../../tests/unit/onboarding.test.ts), [browser flows](../../tests/e2e/onboarding.spec.ts) and the existing Garmin/week-start suites. Browser fixtures run against an explicitly isolated database; demo seeding deliberately identifies its already-populated owner as existing. The migration must be applied through the coordinated upgrade procedure before serving this build on an existing instance. Real Garmin credentials, native screen-reader behavior and a physical mobile keyboard require separate manual verification.

## Recommended minimum scope and deferred enhancements

Ship the three-step dialog, three shared preference controls, optional shared Garmin connection/status UI, truthful background-import feedback, server-saved progress, deliberate dismissal/resume, existing-owner protection and the essential authorization/reliability/accessibility tests. Keep the existing import engine and authentication workflow.

Defer profile personalization, HR zones/FTP and goals, training-plan recommendations, agent onboarding, backup configuration, tutorial tours, notification/email prompts, import percentage/ETA estimation, and additional provider connections. None is required to make the first calendar visit useful.
