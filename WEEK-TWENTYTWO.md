# airgame — Week twenty-two (the check ladder)

Handoff document. Week twenty (maintenance depth) built bases, bays and ratings;
this week adds the A and C check lanes on top. Plan and prerequisites:
`roadmap/check-ladder-prereqs.md` in the project files.

**Status:** a sim change in steps, each ending runnable. Steps 3 onward move
balance, so `npm run quick` is read against the reference and a new reference
is saved only when the owner accepts the read.

## Decisions (from the owner)

- Lanes A and C only. No B (airlines fold it into A). D later.
- C stays banked at night, with no flying lost, until spare aircraft exist.

## Slices

1. Usage clocks: flight hours and cycles since the last heavy check, shown on
   the Mtc cards. No change to play. **Built.**
2. Split in-house check cost out of the per-block-hour bundle. Needs an OK on
   the balance read.
3. The A-check lane at line bases.
4. The heavy check becomes C, with hours, cycles and calendar triggers;
   a hatched Gantt block for nights in a bay.
5. Planning: pick the night or bay, quiet-night hint, headless-player policy.

## Not in this week

- D checks and life-limited parts, spares and engine pools, spare aircraft.

How it works lives in HOW-IT-WORKS.md (Maintenance checks).
