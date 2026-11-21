# Feature: Race preparation

## Purpose and scope

The athlete keeps one plan per race: what they want from it, a briefing and the effort to hold on each section of the course. An external assistant can write the strategy; the owner reviews it before anything is saved. Settings keeps the nutrition products the athlete trains and races with, how much they can carry and their diet preferences, reused by every race.

Outside scope: aid stations and race-day nutrition in the race plan, a printable race card, scenarios, the post-race review, a list of past versions and watch export.

## Intended behavior

Specification status: draft. Covers the stored race plan, its commands, agent proposals and the Preparation tab of the Races page.

Requirement source: [issue #121](https://github.com/bidulelabs/athlete-panel/issues/121) and the decisions proposed on it on 2026-11-16 (one document per race with no version list, proposals stay immutable, assumptions and open questions travel with the proposal, one permission per race). Record: [decision 023](../decisions/023-race-plan-record.md).

- A race plan belongs to one race, an event of kind race, and a race has at most one plan. The race of a plan never changes.
- A plan holds a target of up to 120 characters such as "Finish comfortably", a briefing of up to 4000 characters, pacing, assumptions and open questions (up to 20 lines of 300 characters each).
- Pacing is a list of up to 200 sections in course order. Each section runs from one distance to a greater one, in meters from the start line, and carries an effort of up to 120 characters. Sections cannot overlap; one may start where the previous ends.
- Only the owner sets the target. An assistant writes the briefing, pacing, assumptions and open questions and leaves the target as it is.
- A plan remembers what its strategy was written for: the course it used and the target at that time. The owner changing the target alone leaves that memory untouched, so the plan can be shown as needing review; saving with a course named again refreshes it.
- Deleting a race deletes its plan in the same change, and one undo restores both. An event with a plan cannot become a goal or another kind.
- There is no command to delete a plan alone.
- **Races** shows two tabs for the selected race, **Course** and **Preparation**. Preparation edits the target, the briefing, one effort per section, assumptions and open questions (one per line), and works without an assistant: a plan can be saved with the target alone.
- Pacing rows are the planned sections plus the 5 km course sections no planned section covers. A row left blank is not saved. Without a course and without planned sections, the tab points to the Course tab.
- A plan with something written needs review when the course in use is no longer the one it was written for, or when the target changed since. Preparation then says so and offers **Mark as reviewed**, which changes nothing else. While the form has unsaved changes, it asks to save them first. Saving a change to the briefing, pacing, assumptions or open questions also records the course in use; saving the target alone does not.
- A save over a plan changed or created elsewhere is refused and offers **Reload saved data**. The draft stays open on the version it started from, and saving it again is refused until **Use saved plan** replaces it with the saved plan. The fields are read-only while a save and the reload after it are in progress.
- Under the form, **Weeks until race day** lists each week from the current one to race week, until race day, with its phase, its weekly duration target and the planned sessions. It is read-only and links to the calendar, where phases and workouts are edited.
- When Agent Bridge is enabled, the tab links to the Agent workspace, where a connection is limited to the race and proposals are reviewed. The tab shows no proposal status of its own.
- Assistants read and propose a race plan only through a planning connection limited to that race. Details in [Agent training](agent-training.md#race-plan-proposals).

### Nutrition in Settings

Requirement source: [issue #122](https://github.com/bidulelabs/athlete-panel/issues/122), first part.

- The athlete profile holds an optional `nutrition`: up to 50 products, a carry capacity in millilitres and diet preferences of up to 2000 characters. A profile saved before this has no `nutrition` and reads as before.
- A product has a name, a type (gel, drink, food or other), its carbohydrate, fluid, sodium and caffeine per serving, where the values come from (the label or the athlete's estimate) and the athlete's tolerance (comfortable, mild discomfort, poor or not tested). Each value may be unknown. Product ids are unique.
- **Settings** gains a **Nutrition** tab. Products are listed in a table; an unknown value reads "unknown", a zero reads "0". **Add product** and **Edit** open a dialog; saving it, or confirming **Remove**, saves the product list at once. **Save nutrition** saves the carry capacity and the preferences.
- A save over a profile changed elsewhere is refused and offers **Reload saved data**; the draft stays until **Load saved nutrition** replaces it. Saving **Profile & zones** leaves nutrition unchanged.
- An assistant reads the profile's nutrition only through a planning connection limited to a race, whether or not that connection includes private notes. Other planning connections and historical review receive the profile without the `nutrition` key, so their context digest does not depend on it. Saving nutrition still changes the profile revision, so like any profile change it asks a connection that already read its context to read it again (`409 stale_context`).

## Acceptance scenarios

| Situation | Expected result | Verification |
| --- | --- | --- |
| Owner creates a plan with the target alone | Stored with an empty strategy | [Race plan tests](../../tests/unit/race-plans.test.ts) |
| Second plan for a race / plan for a goal or a missing race | Refused | Race plan tests |
| Race with a plan turned into a goal | Refused | Race plan tests |
| Race deleted / undone | Its plan goes and comes back with it; another race keeps its plan | Race plan tests, [race plan integration](../../tests/integration/agent-race-plans.test.ts) |
| Assistant writes the strategy | Target kept, course and target remembered | Race plan tests, race plan integration |
| Owner changes the target alone / saves with the course named | Memory kept / refreshed | Race plan tests |
| Sections overlapping, out of order, empty, blank or more than 200 | Refused | Race plan tests |
| Owner writes a plan by hand, with and without a course | Saved and shown again after reload, by keyboard, light and dark, at 320 px | [Preparation browser flow](../../tests/e2e/race-preparation.spec.ts) |
| Course replaced / target changed after the strategy was written | Needs review shown, plan unchanged; **Mark as reviewed** clears it | Preparation browser flow, [form tests](../../tests/unit/race-plan-form.test.ts) |
| Save over a plan changed or created elsewhere | Refused; the draft stays after **Reload saved data**; **Use saved plan** shows the saved plan | Preparation browser flow |
| Nutrition with 50 products / 51, a repeated id, a blank name, a negative value, unknown values | Accepted / refused, refused, refused, refused, accepted | [Nutrition profile tests](../../tests/unit/nutrition-profile.test.ts) |
| Profile & zones saved after nutrition | Nutrition unchanged | Nutrition profile tests, [Settings nutrition browser flow](../../tests/e2e/settings-nutrition.spec.ts) |
| Owner adds, edits and removes a product, saves capacity and preferences | Saved; unknown values read "unknown"; by keyboard, light and dark, at 320 px | Settings nutrition browser flow |
| Nutrition save over a profile changed elsewhere | Refused; the draft stays after **Reload saved data**; **Load saved nutrition** shows the saved values | Settings nutrition browser flow |
| Planning connection without a race / limited to a race / historical review | No `nutrition` key / nutrition shared, then `stale_context` after it changes / no `nutrition` key | Nutrition profile tests, [nutrition integration](../../tests/integration/nutrition-profile.test.ts) |
| Weeks from today to a race, with and without a phase or planned sessions; race on a Monday; race day; the day after or later | One row per week with phase, target and planned volume; race week included, until race day; no row after | [Week tests](../../tests/unit/preparation-weeks.test.ts), Preparation browser flow |

## Observed implementation

Implementation status: implemented in the working tree.

Training stores race plans as records of kind `racePlan`, beside plans, workouts, notes, events and phases. The engine checks the race of each plan, keeps one plan per race and removes a plan with its race. The Preparation tab is `plugins/race-analysis/preparation.tsx`; which rows it shows, when a plan needs review and which command a save sends are in `plugins/race-analysis/race-plan-form.ts`. Race analysis exposes the course summary through `plugins/race-analysis/public/server.ts`; `instance/race-context.ts` hands it to Agent Bridge only when Race analysis is enabled. Agent Bridge adds the plan of the granted race to the planning context and checks each proposed race plan against the grant.

## Contracts and constraints

- `racePlan.create` and `racePlan.update` are owner commands and agent proposal commands; the agent form has no target and requires `courseId`.
- Modern planning scopes carry optional `raceId`. The planning context has a `racePlans` key only when it is set.
- No SQL migration. Upgrade and rollback: [race plan upgrade](../development.md#race-plan-upgrade).
- `profile.set` accepts `nutrition`, replaced as a whole. The Nutrition tab is `plugins/athlete/nutrition-settings.tsx`; Agent Bridge leaves `nutrition` out of the profile in `boundedContext` without `raceId` and always in the historical profile. No SQL migration. Upgrade and rollback: [nutrition profile upgrade](../development.md#nutrition-profile-upgrade).
