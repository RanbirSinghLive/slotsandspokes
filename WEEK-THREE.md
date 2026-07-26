# airgame — Week three (playtest readiness)

This is a working document, same spirit as WEEK-TWO.md was. Different
goal, though: everything here is about making the game the last two
weeks built actually **sit-down-and-play-able**, not about adding new
economic depth. Week two's layers (demand, choice model, yield mix,
competition, pricing, weather) are all in — the question now is whether
there's anything in the way of actually playing a session with them.

Update this freely as we keep talking. Nothing here is committed until
it's built.

---

## What "playtest ready" means here

Specifically: **you**, sitting down to play a session of the current
game, not a stranger discovering it cold. That distinction matters —
it rules out onboarding/tutorial work (you already know the mechanics,
you built them with me) and rules *in* anything that would actually
stop or annoy you mid-session: an edit you can't make, progress you
can't keep, a pace you can't control.

## Confirmed gaps (checked against the code, not guessed)

### 1. No way to remove a route or frequency — done

Added a "×" button to each schedule-table row (`ui/panels.ts`'s
`removeScheduleLeg()`). Removes the leg from `state.schedule` and its
DOM row; if that was the *last* leg serving that market, also drops the
now-orphaned `RouteSettings` entry and the Commercial-panel row
(`ui/commercial.ts`'s new `removeCommercialRow()`) — otherwise a fare/
marketing lever would linger for a market with nothing left to fly.
Deliberately no confirmation dialog, matching M8/M10's existing
"allow-then-flag" philosophy: removal is immediate, and if it breaks a
tail's rotation, `validateSchedule()` logs it to the console the same
way a bad manual edit already does, rather than blocking the action.
An already-airborne flight on the removed leg is unaffected —
`ActiveFlight` carries its own copied data independent of
`state.schedule` (this was already true, verified rather than assumed).

Verified in-browser: removing one of two legs on the YQB-YSJ market
left the Commercial row in place (frequency still 1, not zero) and
correctly logged a broken-rotation error for C-FATL (`lands at YQB on
C-FATL-2 but C-FATL-4 departs from YSJ`) — exactly the M8-style
flag-don't-block behavior; removing the second leg too made both rows
disappear and resolved the rotation cleanly (`Schedule OK: 10 legs
across 3 aircraft, no broken rotations`).

### 2. No persistence — a reload loses everything

Confirmed: no `localStorage` usage anywhere in `src/`. CLAUDE.md already
flags this as "the right place for saves... this is a normal Vite app,
not a sandboxed artifact," so it's expected infrastructure, just not
built yet. Right now, closing the tab mid-session throws away every
schedule edit, fare change, and marketing dollar you've spent.

**Done.** Built as `src/ui/save.ts`: `loadSavedState()`/`saveState()`/
`clearSavedState()`, a thin wrapper around `localStorage`, versioned
under the key `airgame-save-v1` — bumped by hand whenever `SimState`'s
shape changes in a breaking way, so an old save is simply never found
again rather than crashing on a field that no longer matches (bare-bones
versioning, not a migration system). `main.ts` saves once per simulated
day *crossed* (tracked in the `tick()` loop, not every minute — 1440x
fewer writes than that would be) and loads on startup, falling back to
a fresh game if nothing was saved or the save didn't parse.
`SimState`'s existing JSON-round-trip requirement (CLAUDE.md, true
since M1) is what makes this close to free — the hard part was already
done by that constraint, not by this feature. Every localStorage call
is wrapped so a failure (private browsing, quota) degrades to "this one
save didn't happen," never a crash.

A "New Game" button (confirms first, since it's irreversible) clears
the save and reloads — the simplest way back to fresh, rather than
resetting every piece of in-memory state by hand.

Verified in-browser: playing for a couple of simulated days, forcing a
full page reload, and confirming the game resumed exactly where it left
off (same day, same cash, same schedule) rather than restarting; "New
Game" (with `window.confirm` stubbed for the test) cleared the save and
returned to a fresh Day 1, $0 game.

### 3. Every playthrough is currently identical — done, alongside item 2

`createInitialState()` still defaults `rngSeed` to a fixed `1` — correct
and unchanged for headless testing (`src/headless/run.ts` never passes
a seed, so it keeps relying on that same default and stays exactly as
reproducible as before). Only `main.ts`'s own call site changed, to pass
`Date.now()` whenever there's no existing save to resume — so every
*new* playthrough now gets its own weather/delay history, verified by
confirming a "New Game" reset produced visibly different starting
weather than the previous game had.

### 4. Ops mode's route lines never reflected your actual schedule — done

Not a missing feature — a real bug, raised because Ops mode's connector
lines kept showing routes regardless of adding or removing them.
`render/routes.ts` built its route list *once*, from `scheduleLegs` (the
static `data/schedule.json` template, imported at module load), not
from `state.schedule` (the live, per-game copy every edit actually
mutates). The M10 route builder and this week's route-removal button
were both invisible to it — Ops mode always drew the original 8 template
markets, forever, no matter what you actually did to the schedule.

Fixed by having `drawRoutes()` take `state` as a parameter and recompute
its distinct-market list fresh on every call, straight from
`state.schedule`, instead of caching it once at import time. Cheap: a
dozen-ish legs and a `Map`, well within what a call already made every
rendered frame can absorb.

**The same bug exists in two more places, not yet fixed**:
`render/demand.ts` (the "served" amber halo) and `render/competition.ts`
(which markets count as "yours" for the yours/theirs/both coloring, and
the frequency counts the hover tooltips show) both also import the
static `scheduleLegs` instead of reading `state.schedule`. Same root
cause, same fix shape — worth doing in the same pass rather than
leaving two views quietly showing a schedule that no longer exists.

Verified in-browser: removed both legs of the YQB-YSJ market via the
schedule table's "×" buttons while watching Ops mode — the line
disappeared from the map immediately, no reload required. Confirmed the
console's "Schedule OK: 10 legs" (12 minus the 2 removed) was the most
recent entry, not stale buffered history from earlier testing.

## Judgment calls, not yet decided

### Time navigation and pacing

Speed controls top out at 20×. A full simulated year (the weather
system's whole season cycle) at 20× is still real minutes of sitting
and watching, most of it with nothing happening. Worth a faster top
speed, a "skip to next event" (next departure/arrival/weather change),
or both — genuinely unsure which is more useful without playing a
session first. Leaning toward: try the game as-is for a session before
building either, since a real playtest is the right way to find out if
this is actually annoying or if 20× already reads fine in practice.

### Weather visibility outside Ops mode

Right now weather only shows up visually in Ops mode (the flash/
particle effects), and only if you happen to be looking at the right
airport at the right frame. There's no ambient signal — no HUD note,
no log — that a storm started or ended. Worth a small always-visible
indicator (e.g., a line in the sidebar: "Snowstorm: YHZ") so you don't
have to be staring at the map to notice a disruption exists, but this
is a legibility nice-to-have, not a blocker the way items 1-3 above are.

### Bankruptcy / a failure state

Cash can go arbitrarily negative with no consequence — nothing stops
the game, nothing warns you. That's fine for exploring the mechanics
(which is the point of a first playtest), but if a real "goal" or "loss
condition" matters to how you want to play, it's worth deciding now
rather than after a session already feels aimless. Not proposing an
answer here — genuinely your call whether this playtest is sandbox
exploration or needs a scoreboard.

## Explicitly out of scope for this document

Everything WEEK-ONE.md and WEEK-TWO.md already deferred stays deferred:
aircraft market, financing, maintenance, crew, multiple aircraft types,
fleet growth beyond 3 tails, connecting itineraries, reactive competitor
AI, diversions/ground stops (weather stayed at "worse delay odds," per
WEEK-TWO.md's "Weather" section). None of that is needed to playtest
what's already built, and pulling any of it in now would be solving a
problem a real session hasn't surfaced yet.

## Draft priority order (not committed)

1. **Remove a route/frequency** — done. The one item that could
   actively block a session (an unwanted edit with no way back).
2. **Persistence (localStorage save/load)** — done, including a "New
   Game" reset. The one item that could lose a whole session's progress
   outright.
3. **Non-fixed default seed** — done, alongside item 2 (a new game now
   seeds from `Date.now()`, headless stays on the fixed default).
4. Time navigation / weather visibility / failure-state — all worth
   revisiting once a real session has actually been played against
   items 1-3, not before.
