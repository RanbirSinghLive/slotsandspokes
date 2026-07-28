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

**Where it shows up:**
- **Done** — in the New Route confirmation form, right under Block time,
  live as the return-leg checkbox is toggled (verified: unchecking it
  doubled the reading, from `PDEW: 626 CAP: 19` to `PDEW: 1251 CAP: 19`
  on YOW↔YUL — exactly halving/doubling the frequency it's divided by).
  Turns amber (`.thin-market`) when PDEW falls under CAP — verified on
  YFC↔YSJ, a genuinely thin market: `PDEW: 3 CAP: 19`, flagged. Shown
  even when the route is otherwise blocked (network gating, out of
  range) — still useful context for a market you might come back and
  draw differently.
- **Done** — a live hover readout while a route is *armed* (before
  confirming), for whichever airport the cursor is currently snapped to
  as a candidate destination, so the number is visible before the
  second click, not only after (`ui/routeBuilder.ts`'s
  `showRouteHoverTooltip()`, a real-DOM tooltip positioned via mousemove,
  same shape as `ui/competitionTooltip.ts`'s). Also flags a candidate
  that's beyond the selected plane's range (`.out-of-range`, red) — a
  case the confirmation form catches too, but here it's visible before
  even clicking the second airport. Verified in-browser: armed YOW,
  hovered YUL → `PDEW: 626 CAP: 19` (matching the form's own number
  exactly); hovered YYT → `PDEW: 3 CAP: 19 — out of range (954 nm)` in
  red; canvas `mouseleave` hides the tooltip without cancelling the
  armed gesture (re-hovering brought it right back).

## Design: layers, not modes — done

The bigger structural question. `main.ts`'s `View` type used to treat
Ops, Demand, and Competition as mutually exclusive — switching to Demand
to check a market's size meant leaving Ops mode, and losing the ability
to draw a route at all while looking at it.

**Built as designed:** Demand and Competition stopped being alternate
*modes* and became toggleable *overlays* on top of one persistent Map
panel:

- The Map panel (basemap, terminator, your own routes, aircraft,
  airports, weather effects, the route-builder gesture) is now the only
  canvas panel — `main.ts`'s `PanelView` is just `'map' | 'rotation' |
  'commercial' | 'fleet-market'`. Route creation always lives here, so
  it's never something you switch away from to get context.
- `demandOverlayOn`/`competitionOverlayOn` (plain booleans in `main.ts`,
  toggled by two buttons in the Maps dropdown that now say "Demand" and
  "Competition" without being exclusive-view buttons) control whether
  `render()` layers `drawDemandLayer()` and/or `drawCompetitionLayer()`
  on top of the base map. Competition *replaces* the plain route drawing
  rather than adding to it (it already draws your own routes, just
  recolored) — Demand draws underneath everything else, as background
  arcs your own network then draws over.
- Both `render/demand.ts` and `render/competition.ts` stopped drawing
  airports themselves — back when each was a full-screen exclusive view
  they had to; now the base Map panel draws them once, always, and
  either former "mode" would have doubled them up.
- Toggling either overlay while on a different panel (Rotation,
  Commercial, Fleet) switches back to the Map panel — flipping one only
  means something while looking at the map.
- Rotation and Commercial are unaffected — they're real DOM panels, not
  canvas layers, and this rework didn't touch them.

**The two hover-tooltip systems are unified**, not just layered:
Competition mode used to have its own hover system
(`findCompetitionHover`, `showCompetitionTooltip`) that only existed in
that one exclusive mode; the M10 route builder's own PDEW/CAP tooltip
(built earlier this week) only showed while armed. Now there's one
hover system, active on the Map panel at all times, with a clear
priority: if a route is armed, the route builder's own PDEW/CAP/range
tooltip wins (the general one is explicitly suppressed to avoid
stacking two tooltips); otherwise, hovering an airport or market arc
shows who flies it — your own operator always, competitors too only if
the Competition overlay is on. `findCompetitionHover()` and
`showCompetitionTooltip()` both gained an `includeCompetitors` parameter
for this: when Competition is off, competitor-only arcs aren't even
hoverable (they're not drawn either — hovering something invisible
would be a bug, not a feature), and the tooltip's operator legend
filters down to just the player's own entry.

Verified in-browser: bought a plane, drew YOW↔YUL. Turned Demand on —
all 45 city-pair arcs appeared as a background layer, own route still
visible on top, no double-drawn airports. Turned Competition on instead
— "All competitors" filter reappeared, competitor-only markets (e.g.
YOW–YQB) drew in red. Hovered YOW with Competition on: tooltip showed
`TA Trillium Air — 50%`, `FA Fundy Air — 33%`, `CW Capital Wings — 17%`
(all three). Turned Competition off, hovered the same airport: legend
correctly filtered to just `FA Fundy Air — 100%`. Hovered along the
YOW–YQB competitor-only arc with Competition off: no tooltip at all,
confirming it's genuinely un-hoverable, not just visually hidden.
Selected the tail, armed YOW, hovered YUL: the route builder's PDEW
tooltip showed (`PDEW: 313 CAP: 19`) and the general operator tooltip
stayed hidden, confirming the priority order. Switched to Rotation and
back to Map: canvas visibility toggled correctly, and both overlay
toggle states persisted across the switch, exactly as intended.

## Proposed build order (not committed)

1. **PDEW/CAP in the New Route form** — done. Small, self-contained,
   immediately useful even before anything about layers changes. No
   architecture change — just a new readout using numbers the sim
   already computes.
2. **Live PDEW/CAP on hover while armed** — done. Turned out not to need
   Competition mode's arc-hit-testing technique — the route builder
   already snaps to the nearest airport for its own preview arc
   (`candidate`), so the tooltip just reads off that existing value
   rather than re-detecting hover itself.
3. **Demand and Competition as toggleable overlays** — done, replacing
   the exclusive-mode dropdown. The large structural piece; unified the
   two separate hover-tooltip systems into one along the way, per its own
   section above.

All three items in this milestone are now built. Ordering turned out to
matter as expected: 1 and 2 stayed useful on their own, and building them
first meant 3's hover unification had real working pieces (the route
builder's own PDEW tooltip, Competition's operator hit-testing) to unify
instead of designing all three from scratch at once.
