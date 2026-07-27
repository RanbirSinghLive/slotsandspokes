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

**The same bug existed in two more places — also fixed, found by the
player noticing "feels like stale code" after New Game**: `render/demand.ts`
(the "served" amber halo) and `render/competition.ts` (which markets count
as "yours" for the yours/theirs/both coloring, and the frequency counts
the hover tooltips show) both also imported the static `scheduleLegs`
instead of reading `state.schedule`. Both now recompute their "own routes"
data fresh from `state.schedule` on every call, the same shape as the
`routes.ts` fix above — `demand.ts`'s `servedPairsFrom(state)` and
`competition.ts`'s `ownRoutesFrom(state)`, threaded through
`drawDemandLayer()`, `drawCompetitionLayer()`, `findCompetitionHover()`,
`operatorsForMarket()`, and `operatorsForAirport()`. Verified in-browser:
hovering YQB in Competition mode showed "FA Fundy Air — 4/day" (all four
of C-FATL's legs touching YQB), then dropped to "3/day" immediately after
removing one of those legs from the schedule table — no reload.

Verified in-browser: removed both legs of the YQB-YSJ market via the
schedule table's "×" buttons while watching Ops mode — the line
disappeared from the map immediately, no reload required. Confirmed the
console's "Schedule OK: 10 legs" (12 minus the 2 removed) was the most
recent entry, not stale buffered history from earlier testing.

### 5. Adding a route could strand a tail with no way back — done

Found by actually playing: deleted C-GVIA's preset rotation, added a
single new leg (YYG → YHZ) by hand, and the aircraft never flew it again.
Revenue/cost stopped posting silently — no error explaining why. Root
cause was two compounding gaps:

1. `validateSchedule()` only checked a tail's legs *against each other*
   (does leg N's destination match leg N+1's origin) — it never checked
   that the *last* leg of a tail's day lands back where the *first* leg
   departs from. A schedule that isn't a closed loop looks fine on the day
   it's edited and then silently jams starting the next day, since
   `step.ts`'s departure check requires the aircraft to physically be at
   `leg.origin`, and nothing ever gets it back there.
2. The M10 route builder only ever created the one leg you drew — adding
   A→B never implied B→A, even though that's what the overwhelming
   majority of routes actually are: a round trip, not a one-way trip.
   Drawing a single-direction leg was the one gesture most likely to
   produce exactly the stranded-tail bug above.

Two fixes, addressing both:

- `validateSchedule()` (`sim/schedule.ts`) now also checks, per tail, that
  the chronologically last leg's destination equals the first leg's
  origin — "the rotation doesn't close" is now its own reported error,
  distinct from a broken link between two specific legs, and points
  directly at which airport needs a leg back to.
- The M10 route builder (`ui/routeBuilder.ts`) now creates the return leg
  automatically by default whenever you add a route — a checkbox ("Add
  return leg too", checked by default) is the escape hatch for the actual
  exception: an extra one-way frequency on a market that already has a
  return, or a deliberate one-off repositioning move. The return leg's
  depart time is auto-computed (`defaultReturnDepartMinute()`: land, then
  the same block time back, plus a 45-minute turn buffer) and shown live
  in the form ("Return: YQM → YYZ at 14:54") before you confirm, and it's
  independently checked for an exact-time collision the same way the
  outbound leg already was.

This doesn't add a separate "positioning flight" concept (a one-time,
non-revenue repositioning move, distinct from the repeating schedule) —
that idea came up in discussion but the default-bidirectional fix removes
most of the actual need for it, since the common case now closes the loop
by construction. Worth revisiting only if a real playtest surfaces a case
neither fix covers (e.g. redeploying a tail to a genuinely new base with
no round trip involved).

Verified in-browser: recreated the exact stranding scenario (a single
YYG→YHZ leg for a tail sitting at YOW) and confirmed the new closed-loop
check reports it clearly; separately, drew a fresh YYZ↔YQM route and
confirmed both legs appear from one confirm, with the return leg's
auto-computed time shown in the form before submitting.

### 6. Schedule warnings were console-only — done

Found immediately after item 5, by hitting the exact case its default
tail selection doesn't protect against: drawing a route while the fleet's
first aircraft (whatever the Tail dropdown defaults to) is already flying
its own separate rotation elsewhere. The new legs get tacked onto that
same tail, `validateSchedule()` correctly flags it — but only to
`console.error`, which no one but a developer with devtools open would
ever see. From the player's chair this just looks like "I added a route
and it's not registering," with zero indication why.

`validateSchedule()` (`sim/schedule.ts`) now returns its list of problems
(still logs them too, unchanged) instead of only logging them, and every
call site (`main.ts`'s startup check, `ui/panels.ts`'s remove/edit
handlers, `ui/routeBuilder.ts`'s Add Route) routes that return value
through a new `renderScheduleWarnings()` in `ui/panels.ts`, which shows
the list directly above the Schedule table — right where the player's
attention already is after an edit. Empty list hides the box entirely.

Verified in-browser: reproduced the exact scenario (drew YHZ↔YYT without
changing the Tail dropdown off its default, so it landed on a tail
already mid-rotation elsewhere) and confirmed both the broken-link and
non-closing-loop errors appear immediately in the Schedule panel, in
plain language, no devtools required.

### 7. The closed-loop check alone still missed one case

Found right after shipping item 6, by the same player hitting a *third*
variant: delete every other leg for a tail, add a single YHZ↔YYT round
trip for it, and it *still* never flies — with the Schedule panel showing
no warning at all, since the two-leg schedule is perfectly
self-consistent on its own terms (YHZ→YYT→YHZ chains, and the loop
closes). What neither existing check could see: the tail's own recorded
*physical position* (`state.aircraft`, e.g. still sitting at YOW from
before all its other legs were deleted) was never anywhere in that
two-leg loop to begin with. A schedule can be internally perfect and
still never fly, if the plane assigned to it isn't standing on any of its
own airports.

`validateSchedule()` (`sim/schedule.ts`) now takes the fleet
(`state.aircraft`) as a second argument and checks, per tail: if the
aircraft is currently grounded, is its airport the origin of *any* of that
tail's own legs? If not, that tail is stranded, and the message says
exactly where it needs to get to. All four call sites (`main.ts`'s
startup check, `ui/panels.ts`'s remove/edit handlers, `ui/routeBuilder.ts`'s
Add Route) now pass `state.aircraft` through.

Verified in-browser against the reporter's own scenario: after deleting
every leg except a hand-added YHZ↔YYT round trip for C-GVIA (a tail
sitting at YOW, never touched by that round trip), the Schedule panel
immediately showed: "C-GVIA is sitting at YOW, but none of its scheduled
legs ever depart from there -- it will never fly again until a leg (or a
positioning move) gets it to one of: YHZ, YYT."

### 8. Positioning was a warning to work around, not a game mechanic

Every fix above (items 4-7) made the game correctly *tell you* a tail was
stranded — none of them stopped it from happening. Told directly: the
point of positioning flights was always to let the player describe the
network they want and have the game work out how to get a plane there,
*with a real cost*, not to force a manual routing puzzle (find a free
tail, or hand-draw a bridging leg) before every new route. Treating that
as a constraint on the player rather than infrastructure the game handles
was exactly backwards.

`PositioningLeg` (`sim/schedule.ts`) is a new, distinct concept from
`ScheduleLeg`: a one-time repositioning move (`state.positioningLegs`,
alongside the existing `state.schedule`) rather than a recurring daily
leg — it has no market, earns no revenue, and is discarded the instant it
departs, since it never repeats. `step()` flies it through the same
gates as a real leg (ground/turn-time check, weather, delay roll) and
charges its real fuel/departure cost on arrival
(`sim/economy.ts`'s `legCost()`) with zero passengers.

`ui/routeBuilder.ts`'s Add Route now checks the chosen tail's actual (or
soon-to-be, if it's airborne) position via a new `currentOrUpcomingAirport()`
helper, and if it doesn't match the route's origin, queues a positioning
leg automatically — no extra click, no separate gesture. The form shows
what's about to happen before you confirm: "Positioning: C-GVIA will fly
YOW → YHZ first (106 min, cost only, no passengers) before this route
starts." The Tail dropdown now updates this preview live when changed,
too, closing the loop on the original bug report: the form no longer
lets a tail choice go unnoticed.

`validateSchedule()`'s "stranded" check (item 7) also takes
`state.positioningLegs` now, so it stops warning about a tail that's
*already being fixed* — a queued positioning leg headed toward one of the
tail's own schedule origins means the situation is in progress, not
broken.

Verified in-browser: drew a fresh YHZ↔YYT route with the default tail
(C-GVIA, sitting at YOW) selected. The form showed the positioning
preview before confirming; after Add Route, the Fleet panel showed
C-GVIA airborne YOW → YHZ (with a real weather-rolled delay — 18 min
late), landing, then immediately departing again on the new YHZ → YYT
route on its own, cost charged and no revenue on the positioning leg,
full fare/passenger economics on the real route after.

### 9. The Fleet Market: buy or lease, starting from nothing

The other half of the same reframing as item 8: positioning flights mean
a route can always find its way to a plane, but a new game still handed
the player three aircraft, fully formed, flying an existing network from
minute zero. That's the opposite of "build your own airline" — every
aircraft in the game should be one the player chose to acquire.

A new game (`sim/state.ts`'s `createNewGameState()`) now starts with
**zero aircraft, zero schedule, zero routes**, and `STARTING_CASH`
($500,000) to work with. The old `createInitialState()` — full 3-tail,
12-leg template — still exists, untouched, purely so `src/headless/run.ts`
(M7's balance-tuning tool) keeps simulating its known test network; the
two are now separate entry points on purpose, not one function branching
on its arguments.

**The Fleet Market** (`sim/fleetMarket.ts` + `ui/fleetMarket.ts`, a new
Reports-menu view) is a small, hand-authored list of individual airframes
— registration, age, buy price, daily lease price — of the game's one
aircraft type (see below). Buying deducts the price from cash outright;
leasing costs nothing up front and instead charges `leasePricePerDay`
every day at rollover, the same flat-daily-cost shape marketing spend
already has (`step.ts`). **Acquisition-only for this pass** — no sell-back,
no early lease-end — matching CLAUDE.md's aircraft-trading being
deferred, while still granting the specific thing that was actually
asked for: a way to *get into* a plane, not out of one.

The panel has one shared "Base new aircraft at" selector (any of the 10
airports) that applies to whichever listing you buy or lease next —
deliberately doubling as the "pick a home airport" step from the earlier
design discussion, rather than adding a separate one: wherever your first
purchase gets based *is* your starting base, with no extra ceremony.
Buying removes the listing and immediately refreshes the M10 route
builder's Tail dropdown (`ui/routeBuilder.ts`'s new `refreshTailOptions()`)
so the new tail is selectable right away. Drawing a route with zero
aircraft owned is explicitly blocked in the form ("Buy or lease an
aircraft first — see Fleet Market under the Reports menu") rather than
left to silently do nothing.

**The aircraft type itself changed too**, at the player's request: the
Dash 8-400 (78 seats) became a Beechcraft 1900D (19 seats, `data/
aircraft-types.json`'s `costPerBlockHour`/`costPerDeparture` scaled down
proportionally). See "A balance gap this opened," below — the demand/fare
model hasn't been re-tuned for a plane this much smaller yet.

Verified in-browser: a fresh game showed $500,000 cash and empty Fleet/
Schedule panels; buying C-FQAC ($650,000) based at YHZ dropped cash to
-$150,000 and added it to the Fleet panel immediately; the route builder's
Tail dropdown showed C-FQAC without a reload; drawing YHZ↔YQB for it
worked with no positioning needed (already at the right airport), and
running the clock forward showed it actually flying the route and posting
real (if currently loss-making — see below) economics.

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
4. **Ops mode's route lines reflecting the live schedule** — done.
5. **Closed-loop schedule validation + default-bidirectional route
   creation** — done. The one item found by actually playtesting rather
   than by reading the code — a stranded tail with silently-zero revenue.
6. **Schedule warnings visible in the UI, not just the console** — done.
   Found by playtesting again: adding a route defaults its Tail dropdown to
   the fleet's first aircraft, which may already have its own separate
   rotation elsewhere — the new route silently never flies, and until now
   the only sign was a `console.error` no one but a developer would see.
7. **Validate the schedule against physical position, not just itself** —
   done. Found immediately after item 6, by hitting the case the
   closed-loop check alone can't catch: delete *every* leg that used to
   route a tail through some airport, and its remaining schedule can be
   perfectly self-consistent (chains fine, loop closes) while the aircraft
   physically sits somewhere that schedule never visits at all.
8. **Automatic positioning flights** — done. Reframes items 4-7 from "the
   game correctly tells you your plane is stranded" to "the game doesn't
   let your plane get stranded in the first place." A route assigned to a
   tail that isn't standing at its origin now gets a real, costed
   positioning leg automatically — the point was never to make players
   solve a routing puzzle before every new route.
9. **The Fleet Market: start with 0 fleet, buy or lease into existence** —
   done. The other half of item 8's reframing: not just *automatic*
   positioning once you have a plane, but starting with none at all, so
   every aircraft in the game is one the player deliberately acquired.
10. Time navigation / weather visibility / failure-state — all worth
    revisiting once a real session has actually been played against
    items 1-9, not before.

## A balance gap this opened, not yet addressed

Swapping the aircraft type from the Dash 8-400 (78 seats) to the
Beechcraft 1900D (19 seats) — done as part of item 9, at the player's
request — means every existing demand/fare number in `sim/demand.ts` and
`sim/schedule.ts`'s `recommendedFare()` is still tuned for a plane four
times the size. A quick headless run (`npm run headless -- 5`) already
shows small net losses that weren't there before. Worth a proper
headless-tuned pass (per CLAUDE.md, that's what the headless runner is
*for*) before treating the economy as balanced again — not done here
since it wasn't what was asked, but flagging it before it's mistaken for
"the game is just hard now."
