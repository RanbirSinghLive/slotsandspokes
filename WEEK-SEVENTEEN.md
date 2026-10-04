# airgame — Week seventeen (the first minute)

Handoff document. Week sixteen (bases, nights away, thin homes) lives in
`WEEK-SIXTEEN.md`.

**Status:** small fixes found by playing a new game in the browser from the
picker to the first route. No new system. The balance read doesn't apply:
nothing here touches `src/sim/`.

---

## The idea

A new player who skips the tutorial meets a running clock, a ring of
icon-only buttons, and no word on what to do first. These three changes
make the first minute safe and obvious.

## Fixes

1. **A new game starts paused.** Choosing a home no longer starts the
   clock at 1×, so cash isn't spent while the player reads the map. 1×
   or Space starts it.
2. **The alert strip says what to do first.** While the schedule is
   empty it reads "NO ROUTES · click BOS · Draw route · click a city · ✓
   · then press 1×" and opens the home airport. It clears itself when a
   route is flown, and can be dismissed.
3. **The tutorial's "Pick your home" step can't be skipped alone.** The
   later steps explain a game that doesn't exist until a home is chosen;
   skipping left them pointing at the picker. "Skip tutorial" still ends
   it.

## Not in this week

- Confirming a lease: the confirm windows on their own branch cover it,
  so it isn't done twice.
- The early valley (an unattended start busts from most homes) and the
  mid-game's direction after the ladder: both need the headless player's
  day-by-day log, not the browser.
- Labelled ring buttons: each already says what it does on hover, so the
  gap is smaller than first thought.
