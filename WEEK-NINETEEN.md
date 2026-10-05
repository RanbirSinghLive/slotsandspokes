# airgame — Week nineteen (maintenance depth)

Handoff document. Week eighteen (the map you can read and watch) lives in
`WEEK-EIGHTEEN.md`.

**Status:** a sim change, from the roadmap in the project files
(`roadmap/airline-roadmap.md`), items 2, 4 and 8 of its maintenance list.
It moves balance, so `npm run quick` is read against the reference and a
new reference is saved only when the owner accepts the read.

## The idea

Maintenance was one abstract "maintenance base" that did every check at any
size. It becomes capacity you build, in three parts.

1. **Line bases and hangars are separate**, each with a level. A line base's
   level is planes checked a night; a hangar's is bays for heavy checks at
   once. Home starts with both at level 3. A line-only station is cheap
   and never does a heavy check.
2. **Hangar bays are scarce.** Only the planes nearest due, up to the bay
   count, bank heavy-check hours on a night.
3. **Mechanics are rated by aircraft class.** A plane of an unrated class
   is treated like one at an outstation, so a mixed fleet costs more.

How it works lives in HOW-IT-WORKS.md (Bases, Maintenance checks).

## Slices

One slice: sim (`src/sim/bases.ts`, `mxChecks.ts`), the Mtc tab (levels,
ratings, bays), the headless player's `keepMaintenance()`, docs.

## Not in this week

- The Create base modal that picks crew or maintenance first: a separate
  thread.
- A, C and D checks, spares pools and engine shop visits (roadmap items
  1, 3 and 5).
