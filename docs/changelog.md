# Changelog

Use the documentation link for the version you installed. Each release page includes its deployment bundle and verification report.

## Unreleased

- Charts adds six templates: Training hours, Training by sport, Workout heart rate, Weekly climbing, Resting heart rate and HRV, and Estimated training load. Training hours, Training by sport and Weekly climbing support selected sports grouped by day, week or month. Planned and recorded hours use the same filter; empty results identify the sport selection, and partial periods and missing measurements remain labelled. Sport bars remain visible in long daily views on phones. Activate Charts with the matching web/worker build through the [coordinated upgrade procedure](development.md#coordinated-upgrades-and-plugin-activation), then reload open browser tabs; no SQL migration or athlete-data conversion is required.

- Health opens on the last 30 days. You can choose 7, 30 or 90 days and browse earlier dates without moving your planning calendar.
- Activities labels duration and distance totals as partial when measurements are missing. Each total shows how many activities lack that measurement.
- Garmin activity imports preserve elevation loss, maximum heart rate and time in five heart-rate zones when Garmin supplies them.
- Agent workspace lists pending proposals first and keeps applied and rejected proposals in a collapsible history.
- If only activity or health records change while an agent prepares a training proposal, you can review those changes alongside the proposal. You must acknowledge the differences before applying it.
- GitHub release pages show what changed and how to upgrade before the fresh install instructions.
- A workout interval can end when you press the lap button instead of after a time or a distance, for example an open warm-up. Workout details show it as “Until lap button”, and agents can propose it. Steps saved this way cannot be read by an older release, so roll back with the matching pre-upgrade backup.

### Upgrade steps

If an agent read planning context before the upgrade and still has an unsubmitted draft, have it read the context again before submitting.

## v0.3.0 (2026-11-02)

- Managed upgrades check public HTTPS access before entering maintenance. Deployment health requests identify themselves to proxies such as Cloudflare and explain HTTP 403 rejections.
- Owners can grant agents up to five calendar years of history reads and a separate planning period of up to one calendar year. Training changes still require owner review.
- Agent planning context includes daily health data for the latest seven days and weekly averages with measurement counts for earlier days in the approved period.
- Garmin continues scheduling recent imports after a failure and clears the retry status after a successful recent import.
- Editing a profile preserves fields you leave out. Editing a workout preserves its duration when you leave that field untouched.

[Release and downloads](https://github.com/bidulelabs/athlete-panel/releases/tag/v0.3.0) · [Documentation for v0.3.0](https://github.com/bidulelabs/athlete-panel/tree/v0.3.0/docs)

## v0.2.0 (2026-10-30)

- Supported existing Compose installations can adopt the managed upgrade and recovery workflow.
- Training descriptions and notes support Markdown. Proposed training changes are grouped by week for review.
- Garmin import separates syncing recent data from refreshing a selected date range.

[Release and downloads](https://github.com/bidulelabs/athlete-panel/releases/tag/v0.2.0) · [Documentation for v0.2.0](https://github.com/bidulelabs/athlete-panel/tree/v0.2.0/docs)

## v0.1.0 (2026-10-29)

- First public release of the single-athlete training workspace, with a calendar, workout logging, Garmin imports and owner-reviewed agent proposals.
- The Linux AMD64 deployment bundle installs the tested container image and includes tools for backup, upgrade and recovery.

[Release and downloads](https://github.com/bidulelabs/athlete-panel/releases/tag/v0.1.0) · [Documentation for v0.1.0](https://github.com/bidulelabs/athlete-panel/tree/v0.1.0/docs)
