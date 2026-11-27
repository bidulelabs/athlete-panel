# Apple Health workout import execution

## Authority and scope

The owner authorized implementation of [issue #157](https://github.com/bidulelabs/athlete-panel/issues/157) on 2026-11-27. The approved plan uses immediate import, owner source exclusions, a return to planned after a linked deletion, and bounded GPS backfill with the published iPhone app. The accepted behavior is specified in [Apple Health workout import](../features/apple-health-import.md).

## Implementation

The bundled Apple Health plugin receives authenticated Sync for Health batches and exposes pairing, source settings and status. Shared activity and completion contracts support Apple records. Additive migrations retain the existing activity identities and store GPX files on the private instance.

## Verification

The production build and all 347 PostgreSQL integration tests passed with Node 22. Four Chromium scenarios passed across desktop and mobile in light and dark themes. They covered pairing, a synthetic phone upload, calendar details, GPX download and source exclusion.

Formatting, lint, generated-file, dependency-boundary, type and documentation checks passed. The standard `pnpm check` reached the existing Markdown recursion test’s 20-second timeout. All 841 unit tests passed with `pnpm test:unit --testTimeout=45000`.

The migration rehearsal applied the pre-Apple revision to a disposable database, seeded synthetic activity and health records, and applied the new migrations. The activity and daily health records matched their pre-upgrade fingerprint.

A real iPhone and Apple Watch run through the intended HTTPS deployment still needs verification.

## Activity source setup

The owner approved source selection during first sign-in and from Settings on 2026-11-27. The welcome step reuses the provider setup contributions. A saved Garmin key or Apple Health token makes that provider available in the sidebar after an upgrade. Explicit choices use the existing settings table. [Onboarding behavior](../features/first-time-onboarding.md)

A disposable upgrade from main at `ddb6680` preserved the Garmin credential, saved import cursor, job and activity and health records. The upgraded account opened its workspace with the Garmin shortcut. Adding Apple Health preserved the same Garmin data and checkpoint.

The production build, formatting, lint, generated-file, boundary, type and documentation checks passed. All 349 integration tests and all 841 unit tests passed. The unit run used a 45-second timeout. The 24 onboarding and Apple Health browser scenarios passed across desktop and mobile in both themes after rerunning the mobile sidebar check with the welcome dialog closed. Pairing used synthetic phone requests.

## UI alignment review

A Chromium review reproduced offset Copy buttons, a shrinking URL field when copy feedback appeared, inconsistent provider action positions, and Continue sitting below the pairing form on narrow screens. The activity details also showed a saving spinner before a workout was chosen.

Compared the built app before and after the fixes with the same synthetic fixtures at 1440 × 900, 390 × 700 and 320 × 620. The fields and Copy buttons shared the same top and bottom edges. Copy feedback kept the field width and button position stable. The 320-pixel setup kept Continue in view. Keyboard focus moved to the setup heading and the new token’s Copy button. Denied clipboard access selected the complete URL. The activity-link check confirmed the idle button state, Apple-specific wording and linked workout metrics.

The production build, formatting, lint, generated-file, boundary, strict type and documentation checks passed. All 13 focused onboarding and Apple Health integration tests and 24 desktop and mobile browser cases passed. Both themes and the 320-pixel pairing controls were exercised with synthetic data.
