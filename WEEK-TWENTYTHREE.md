# airgame — Week twenty-three (ladder rework)

Handoff document. Design: `review/exec-missions/ladder-rework-spec.md` in the project files.

**Status:** a sim and UI change to the ladder (Goals). It must not move the
balance reference: the first three tiers' gates, thresholds and the rival
checks are untouched, so `npm run quick` reads as before.

## Decisions (from the owner)

- Rework the ladder itself, not optional badges on top.
- Keep the first three tiers' gates (rivals judge them); add teaching
  milestones there as extras that never gate.
- Rebuild the tiers rivals never see: International gains two gates; new
  Operator, Established carrier and Flagship tiers sit before Global.
- Every tier is visible from day 0, greyed until reached.

## Slices

1. `sim/ladder.ts`: `extra` and `applies` on a milestone, `gateMilestones()`,
   `tierNeeded()`, `tierCounts()`, `tierComplete()`; five tiers become eight.
2. `lastAogDay` in state, set by `sim/aog.ts`.
3. Goals view: Next up strip and every tier as a row.
4. Not done: second executive tiers and new chairs (a follow-up), cargo
   terminals and aircraft finance milestones (greyed with the features, when built).

## Notes

- A save that had climbed Global before this change drops back to International
  until Operator, Established carrier and Flagship are climbed. Milestones met
  stay met; adopted innovations keep working.
- Spoilage IV–V now open with Flagship, not Global.
