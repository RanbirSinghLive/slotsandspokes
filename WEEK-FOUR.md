# airgame — Week four (informed route placement)

Same working-document spirit as WEEK-TWO.md and WEEK-THREE.md: nothing
here is committed until it's built, update freely as we keep talking.
Different goal again, though. Week three was about removing anything
that could stop or annoy a session in progress (an edit you couldn't
make, progress you couldn't keep, a plane you couldn't place). Everything
in week three's own "Draft priority order" got built. This one starts
from a sharper complaint about the thing that's left: **placing a route
is still a blind guess.** You connect two nodes on the map with no sense
of whether the market between them is worth flying at all, and no
visibility into competitor or demand context while you're doing it.

---

## Ported from WEEK-THREE.md — still genuinely open

Everything else in WEEK-THREE.md's numbered list got built. These four
did not, and stay open:

### Time navigation and pacing

Speed controls top out at 20×. A full simulated year (the weather
system's whole season cycle) at 20× is still real minutes of sitting and
watching, most of it with nothing happening. Worth a faster top speed, a
"skip to next event" (next departure/arrival/weather change), or both —
genuinely unsure which is more useful without playing a real session
first.

### Weather visibility outside Ops mode

Weather only shows up visually in Ops mode (the flash/particle effects),
and only if you happen to be looking at the right airport at the right
frame. No ambient signal (HUD note, log) that a storm started or ended.
A legibility nice-to-have, not a blocker.

### Bankruptcy / a failure state

Cash can go arbitrarily negative with no consequence. Fine for exploring
mechanics; worth deciding deliberately if a real goal/loss condition
matters to how you want to play this. Not proposing an answer — your
call whether this stays sandbox exploration or gets a scoreboard.

### The demand/fare model is untuned for the Beechcraft 1900D

Week three swapped the aircraft type from the Dash 8-400 (78 seats) to
the Beechcraft 1900D (19 seats), at the player's request. Every existing
demand/fare number in `sim/demand.ts` and `sim/schedule.ts`'s
`recommendedFare()` is still tuned for a plane four times the size — a
quick headless run already showed small net losses that weren't there
before. This week's actual subject (PDEW/CAP visibility, below) is going
to make this mismatch a lot more *visible*, which is exactly the point,
but the retune itself isn't done yet.

---

## What's actually being asked

Two complaints, one underlying cause: **the game shows you almost
nothing about a market until after you've already committed to flying
it.**

1. Connecting two airports on the Ops map is currently blind — no
   passenger-demand signal, no competitor signal, nothing about whether
   the market can support another frequency, until the route already
   exists and you can read it off the Commercial panel days later.
2. The Ops/Demand/Competition map modes are mutually exclusive — you
   have to *leave* the map you're drawing routes on to go check the
   Demand or Competition view, then come back and redraw from memory.

## Design: the PDEW/CAP metric

**PDEW = Passengers Daily Each Way.** The un-minmaxed ceiling for a
route being drawn, computed the same way `sim/economy.ts`'s
`flightResult()` already splits demand across frequency — but stopping
one step earlier, before the booking-share/yield/competition model
trims it down to a realized number:

```
PDEW = round(dailyDemand(origin, dest) / newFrequency)
CAP  = selected aircraft type's seats
```

`dailyDemand()` (`sim/demand.ts`) already returns the gravity-model
total for the pair, in both directions combined; `newFrequency` is
`legsServingMarket(origin, dest, state.schedule)` *after* this route's
legs would be added (1 for one-way, 2 if the return checkbox is on) —
the same denominator `flightResult()` already divides by, just read
before committing rather than after. No new simulation logic: every
ingredient already exists, this is a UI read of numbers the sim already
computes, which is the only way it can never drift from what actually
happens once the route is flying (same reasoning as `ui/commercial.ts`'s
`summarizeMarket()` never reimplementing `flightResult()`).

`CAP` is the plane's raw seat count (19 for the Beechcraft 1900D right
now) — deliberately *not* `seats * LOAD_FACTOR` (the economy model's own
soft ceiling). The point of showing PDEW next to raw CAP is exactly
"before any of the knobs get turned": load factor, fare, yield
segmentation, marketing spend, and competitor response all still apply
afterward and are what the Commercial panel is for. `PDEW: 16 CAP: 19`
reads as "this market can plausibly fill most of one flight a day, worth
trying" without needing to understand any of those five other
mechanisms first, and `PDEW: 3 CAP: 19` reads as "thin market, don't
expect a full plane" just as quickly.

**Where it shows up** — proposed, not yet built:
- In the New Route confirmation form, alongside the existing block-time/
  positioning/return previews — updates live as the return-leg checkbox
  is toggled, since that changes `newFrequency`.
- As a live hover readout while a route is *armed* (before confirming),
  for whichever airport the cursor is currently snapped to as a
  candidate destination — so the number is visible before you even
  commit to a second click, not only after.

## Design: layers, not modes

The bigger structural question. Right now `main.ts`'s `View` type treats
Ops, Demand, and Competition as mutually exclusive — switching to Demand
to check a market's size means leaving Ops mode, and losing the ability
to draw a route at all while looking at it.

**Proposed direction:** stop treating Demand and Competition as
alternate *modes* and start treating them as toggleable *overlays* on
top of the one persistent Ops base layer:

- Ops (basemap, terminator, your own routes, aircraft, airports, weather
  effects, the route-builder gesture) stays the permanent base — this is
  also where all route creation already lives, so it should never be
  something you have to switch away from to get context.
- Demand becomes a toggle (checkbox/icon button, not a dropdown item)
  that draws the existing demand arcs *underneath or alongside* your own
  route lines, on the same canvas, at the same time — so "where's unmet
  demand" and "where do I already fly" are visible together instead of
  sequentially.
- Competition becomes the same kind of toggle, layered on top the same
  way, so a contested market is visible while you're literally drawing
  a route into it.
- Rotation and Commercial are unaffected — they're real DOM panels, not
  canvas layers, and this rework doesn't touch them.

This also implies unifying the hover-tooltip story: Competition mode
currently has its own separate hover system (`findCompetitionHover`,
`showCompetitionTooltip`) that only exists in that one mode; Ops mode's
route builder has no hover-info at all today, just the arm/preview
gesture. Under the overlay model, one hover system in Ops mode should
show whatever's relevant given which overlays are on — your own
operators always, competitor operators if the Competition overlay is on,
PDEW/CAP for the market if the Demand overlay is on or a route is
currently armed.

This is a real architecture change, not a small patch — it touches
`main.ts`'s view-switching machinery, the HUD's dropdown structure, and
however the hover systems get unified. Worth being explicit about scope
before starting rather than discovering it mid-build.

## Proposed build order (not committed)

1. **PDEW/CAP in the New Route form.** Small, self-contained, immediately
   useful even before anything about layers changes. No architecture
   change — just a new readout using numbers the sim already computes.
2. **Live PDEW/CAP on hover while armed.** Reuses Competition mode's
   arc/airport hit-testing technique, generalized to Ops mode.
3. **Demand and Competition as toggleable overlays**, replacing the
   exclusive-mode dropdown — the large structural piece. Unifies the two
   separate hover-tooltip systems into one along the way.

Ordering is deliberate: 1 and 2 are useful on their own even if 3 never
happens, and building them first means 3's hover unification has real
working pieces to unify instead of building all three at once.
