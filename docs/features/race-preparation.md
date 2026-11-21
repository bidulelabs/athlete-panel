# Feature: Race preparation

## Purpose and scope

The athlete keeps one plan per race: what they want from it, a briefing and the effort to hold on each section of the course. An external assistant can write the strategy; the owner reviews it before anything is saved.

Outside scope: nutrition, what to carry between stations, drop bag contents, a printable race card, scenarios, the post-race review, a list of past versions and watch export.

## Intended behavior

Specification status: draft. Covers the stored race plan, its commands, agent proposals and the Preparation and Race day tabs of the Races page.

Requirement source: [issue #121](https://github.com/bidulelabs/athlete-panel/issues/121) and the decisions proposed on it on 2026-11-16 (one document per race with no version list, proposals stay immutable, assumptions and open questions travel with the proposal, one permission per race). Record: [decision 023](../decisions/023-race-plan-record.md).

- A race plan belongs to one race, an event of kind race, and a race has at most one plan. The race of a plan never changes.
- A plan holds a target of up to 120 characters such as "Finish comfortably", a briefing of up to 4000 characters, pacing, assumptions and open questions (up to 20 lines of 300 characters each).
- Pacing is a list of up to 200 sections in course order. Each section runs from one distance to a greater one, in meters from the start line, and carries an effort of up to 120 characters. Sections cannot overlap; one may start where the previous ends.
- Only the owner sets the target. An assistant writes the briefing, pacing, assumptions and open questions and leaves the target as it is.
- A plan remembers what its strategy was written for: the course it used and the target at that time. The owner changing the target alone leaves that memory untouched, so the plan can be shown as needing review; saving with a course named again refreshes it.
- Deleting a race deletes its plan in the same change, and one undo restores both. An event with a plan cannot become a goal or another kind.
- There is no command to delete a plan alone.
- A plan also holds race-day timing, set by the owner only: a start time (HH:MM), a finish cutoff and up to 60 aid stations. A cutoff is a number of days after race day (0 to 6) and an HH:MM time. Times are wall-clock times in the profile timezone; a race in another timezone and a clock change during the race are not handled. A plan without them has no start time, no finish cutoff and no station.
- An aid station has a name of up to 80 characters, a distance from the start line, an optional cutoff, a planned stop of up to 24 hours, water or not, food offered (up to 200 characters), a drop bag of up to 20 distinct products, each with 1 to 100 servings (empty means no drop bag), an action (up to 300 characters), where the information comes from (up to 120 characters) and whether it is confirmed. Stations run in course order, each farther than the one before, each with its own id.
- An update that leaves the start time, finish cutoff or stations out keeps them; the Preparation form never sends them and assistants cannot write them.
- `plugins/race-analysis/race-day.ts` computes arrivals from the plan and the course estimate; nothing it returns is stored. Each 5 km section's estimated time is spread along the section by distance; the planning range scales with the estimate's low and high ends. The margin is the cutoff minus the latest arrival. Elapsed reference times already include pauses, so planned stops sit inside the estimate: moving time is the estimate minus the planned stops of stations on the course, floored at zero and flagged when stops outlast the estimate. Each leg between stations has its distance, its climbing spread by distance (unknown when a section has no elevation) and its share of the moving time. A station beyond the course is flagged and has no arrival. Without an estimate only cutoffs and distances remain; without a start time arrivals are times from the start, with no clock time or margin.
- **Races** shows three tabs for the selected race, **Course**, **Preparation** and **Race day**. Preparation edits the target, the briefing, one effort per section, assumptions and open questions (one per line), and works without an assistant: a plan can be saved with the target alone.
- Pacing rows are the planned sections plus the 5 km course sections no planned section covers. A row left blank is not saved. Without a course and without planned sections, the tab points to the Course tab.
- A plan with something written needs review when the course in use is no longer the one it was written for, or when the target changed since. Preparation then says so and offers **Mark as reviewed**, which changes nothing else. While the form has unsaved changes, it asks to save them first. Saving a change to the briefing, pacing, assumptions or open questions also records the course in use; saving the target alone does not.
- **Race day** opens with `Start 07:00 → finish 13:15` (or `Finish 6h 15m after the start` without a start time), the planning range and `5h 57m moving, 18m stops`; planned stops sit inside the estimate. Then comes the finish cutoff with its margin (`Finish cutoff 15:00 · <time> after the latest finish`, or `Latest finish is <time> after the cutoff` in the danger color), or `No finish cutoff`. Without an estimate only the finish cutoff and the start time remain. It recomputes everything from the saved plan and the saved course estimate each time it is shown; an unsaved terrain draft on Course does not change it.
- **Change start time** opens **Start and finish cutoff**: a start time and a finish cutoff (day and time), each optional. A cutoff day without a time is not saved: the cutoff is cleared.
- **Aid stations** lists the stations in course order, each with its distance, water, food, the number of drop bag items, **Not confirmed** or **Confirmed · <source>**, the arrival range and aim, the cutoff and its margin (`<time> margin`, or `<time> after the cutoff` in the danger color), the planned stop and what to do. A leg row before each station, and one to the finish, gives its distance, its climbing when every section has elevation, and its moving time; a leg starting at 0 m starts at **Start**. Up to 900 px each station becomes a card, with **Edit** and **Remove** 44 px high and 8 px apart. A station beyond the course shows **Beyond the course** and **No arrival**.
- **Add station** and **Edit** open one window: name, distance in the profile's units, cutoff day and time, planned stop in minutes, what the station offers (water, food), what to do, and where this comes from (source, confirmed). Saving puts the station in its place by distance; a second station at the same distance is refused before saving with "Another aid station is already at this distance." Saving an edit starts from the station as saved now, so a reload keeps changes made elsewhere to its drop bag. The drop bag is kept as it is; it is not edited here. **Remove** asks to confirm with **Remove station**. The first station or start time creates the plan, written for the course in use.
- Race day states, with their exact text:
  - No station: **No aid stations yet**, "Add the stations from the race guide: distance, cutoff and what they offer. Nothing is filled in for you." and **Add the first station**.
  - No estimate: **Arrival times are unknown**, the course's reasons, "Cutoffs and stops still show." and **Add past efforts on Course**, which opens the Course tab.
  - No start time: "Set a start time to see arrival clock times and cutoff margins." Arrivals show as times after the start, with no margin.
  - Stops longer than the estimate: "Planned stops are longer than the whole estimate. Moving time is shown as 0."
  - Needs review: an alert titled **This plan needs review**, "The course or your target changed after this plan was written. Check that the stations still hold." and **Mark as reviewed**. Preparation shows the same alert with its own sentence. A plan with stations alone counts as written, so both tabs show it. Saving a station does not clear it.
  - Save failed: the window stays open with the draft, the server's message, "Use Reload saved data to review the saved version. Your draft will stay open." and **Reload saved data**. After the reload, saving applies the station to the saved plan.
- A save over a plan changed or created elsewhere is refused and offers **Reload saved data**. The draft stays open on the version it started from, and saving it again is refused until **Use saved plan** replaces it with the saved plan. The fields are read-only while a save and the reload after it are in progress.
- Under the form, **Weeks until race day** lists each week from the current one to race week, until race day, with its phase, its weekly duration target and the planned sessions. It is read-only and links to the calendar, where phases and workouts are edited.
- When Agent Bridge is enabled, the tab links to the Agent workspace, where a connection is limited to the race and proposals are reviewed. The tab shows no proposal status of its own.
- Assistants read and propose a race plan only through a planning connection limited to that race. Details in [Agent training](agent-training.md#race-plan-proposals).

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
| Owner sets start time, finish cutoff and stations / later update leaves them out / assistant updates the strategy | Stored / kept / kept | Race plan tests, race plan integration |
| Stations out of order, at one distance, sharing an id, blank, more than 60; time `24:00`; cutoff 7 days after | Refused on create and update | Race plan tests |
| Plan stored before race-day timing | Read with no start time, cutoff or station | Race plan tests, race plan integration |
| Arrivals with and without estimate, start time or course; next-day cutoff; arrival after midnight; station at 0 m, at the course end or beyond it; stops longer than the estimate | As described above | [Race day tests](../../tests/unit/race-day.test.ts) |
| Owner writes a plan by hand, with and without a course | Saved and shown again after reload, by keyboard, light and dark, at 320 px | [Preparation browser flow](../../tests/e2e/race-preparation.spec.ts) |
| Course replaced / target changed after the strategy was written | Needs review shown, plan unchanged; **Mark as reviewed** clears it | Preparation browser flow, [form tests](../../tests/unit/race-plan-form.test.ts) |
| Save over a plan changed or created elsewhere | Refused; the draft stays after **Reload saved data**; **Use saved plan** shows the saved plan | Preparation browser flow |
| Race day without course, estimate or station; with three past efforts; without and with a start time and finish cutoff | Each state's text above; clock times, margins and leg rows once timed; by keyboard, light and dark, at 320 px | [Race day browser flow](../../tests/e2e/race-day.spec.ts) |
| Stations added out of order / at the same distance / removed or kept on cancel | Shown in course order / refused in the window / removed or kept | Race day browser flow, [form tests](../../tests/unit/race-plan-form.test.ts) |
| Station beyond the course, cutoff missed at a station and at the finish, stops longer than the estimate | Beyond the course and No arrival; margins after the cutoff in the danger color; moving time 0 with its notice; leg to the finish from the last station on the course | Race day browser flow |
| Start and finish cutoff form: times filled / empty with a day chosen | Stored / both cleared | Form tests |
| Station form: new or edited, miles, cutoff time empty with a day chosen, next-day cutoff, unchecked boxes | Meters and seconds; id and drop bag kept; unchanged distance kept exact; no cutoff; day kept | Form tests |
| Plan with stations alone, course replaced / unchanged | Needs review in Race day and Preparation / not | Race day browser flow, form tests |
| Station saved over a plan changed elsewhere | Refused, draft kept; saved after **Reload saved data** | Race day browser flow |
| Weeks from today to a race, with and without a phase or planned sessions; race on a Monday; race day; the day after or later | One row per week with phase, target and planned volume; race week included, until race day; no row after | [Week tests](../../tests/unit/preparation-weeks.test.ts), Preparation browser flow |

## Observed implementation

Implementation status: implemented in the working tree.

Training stores race plans as records of kind `racePlan`, beside plans, workouts, notes, events and phases. The engine checks the race of each plan, keeps one plan per race and removes a plan with its race. The Preparation tab is `plugins/race-analysis/preparation.tsx` and the Race day tab is `plugins/race-analysis/race-day-tab.tsx` with its windows in `race-day-dialogs.tsx`; which rows it shows, when a plan needs review, how a station form is read and which command a save sends are in `plugins/race-analysis/race-plan-form.ts`; arrivals, margins, legs and moving time are in `plugins/race-analysis/race-day.ts`. Race analysis exposes the course summary through `plugins/race-analysis/public/server.ts`; `instance/race-context.ts` hands it to Agent Bridge only when Race analysis is enabled. Agent Bridge adds the plan of the granted race to the planning context and checks each proposed race plan against the grant.

## Contracts and constraints

- `racePlan.create` and `racePlan.update` are owner commands and agent proposal commands; the agent form has no target and requires `courseId`.
- `startTime`, `finishCutoff` and `stations` are owner command fields only; the agent forms refuse them. Record: [decision 024](../decisions/024-race-day-in-race-plan.md).
- Modern planning scopes carry optional `raceId`. The planning context has a `racePlans` key only when it is set.
- No SQL migration. Upgrade and rollback: [race plan upgrade](../development.md#race-plan-upgrade) and [race day upgrade](../development.md#race-day-upgrade).
