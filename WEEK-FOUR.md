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

## An aircraft ladder, and a demand-model retune

Raised directly after the PDEW/CAP work landed: with only the Beechcraft
1900D available, PDEW/CAP visibility mostly just confirmed how thin this
map's markets are — useful information, but not much of a *game* if
almost every market is a trap and there's nowhere to graduate to. Two
asks, resolved together: build out a real fleet of aircraft sizes to
grow into, and check whether the demand numbers underlying all of this
were actually reasonable.

### The ladder

Five types now, in `data/aircraft-types.json`, each real public spec-sheet
numbers (seats, cruise) same sourcing rule as the 1900D — costs and
range stay "deliberately crude, not fit to any real source," same as
`economy.ts`'s other constants:

| Type | Code | Seats | Cruise | Range |
|---|---|---|---|---|
| Beechcraft 1900D | `BEH1900D` | 19 | 280kt | 700nm |
| Dash 8-300 | `DH8300` | 50 | 270kt | 800nm |
| Dash 8-400 (Q400) | `DH8400` | 78 | 360kt | 1,000nm |
| Airbus A220-300 | `A220300` | 149 | 450kt | 2,500nm |
| Airbus A330-300 | `A330300` | 280 | 470kt | 6,000nm |

`DH8400`'s cost figures (`costPerBlockHour: 3400`, `costPerDeparture:
900`) are the *original* DH4 numbers from before the very first Fleet
Market pass swapped the starting type down to the 1900D — free reuse,
already "calibrated" in the sense that nothing about them was invented
fresh.

Two listings per type in `data/fleet-market.json` (12 total, all
available from day one — no unlock gating), buy price and lease rate
both escalating with size: 1900D $300K-$890K (unchanged) → Dash 8-300
~$2.1M-$4.2M → Q400 ~$6.8M-$13.5M → A220 ~$31M-$42M → widebody
~$19.5M-$34M. The widebody undercutting a new-ish A220 in price isn't a
mistake — a 24-year-old wide-body genuinely is worth less used than a
type still in production, and it's its own small piece of texture.

**Day one is deliberately just the Beechcraft, at the player's explicit
request.** With `STARTING_CASH` at $500,000: the cheapest 1900D
($300,000) is affordable, but two of them ($600,000) aren't, and the
cheapest non-1900D listing (Dash 8-300, $2.1M) is nowhere close.
Verified in-browser: bought the cheapest 1900D, cash dropped to
$200,000, and every remaining listing — including the *other* three
1900Ds — was correctly unaffordable. Leasing remains open for bigger
gauges from day one regardless (leasing has no upfront cost by design),
which is the intended release valve: a cash-strapped new entrant can
lease into more capacity early and accept the daily burn, or grow into
buying gradually. Whether that burn is survivable without matching
revenue is exactly the kind of judgment call positioning flights and
route range already ask the player to make elsewhere.

### The demand retune

Asked directly: what are `sim/demand.ts`'s market sizes actually sourced
from? Answer, precisely: the *populations* are real (StatsCan 2021
census CMA/CA, `data/airports.json`) and the *distances* are real
(great-circle, real coordinates) — but the constant that converts
"these two cities are this big and this far apart" into an actual daily
passenger count was never fit to any real O-D survey, just picked so the
biggest pair "looked about right." That's the knob that was making
things feel understated, and it was fair game to retune for
playability, which is what was asked for over strict realism.

Checked against all 45 city pairs before picking a number, not guessed:
under the original `SCALING_CONSTANT` (`1.6e-8`), **31 of 45 pairs**
worked out to under 10 passengers each-way with only a 19-seat plane
available — barely playable, since almost the whole map was a trap.
Tried softening `DISTANCE_EXPONENT` instead of scaling up; rejected it
immediately — it blows up the biggest pairs (the golden triangle:
Montréal-Toronto, Montréal-Ottawa, Toronto-Ottawa) far more than it
helps the thin ones, since it's a distance-shaped fix applied to what's
fundamentally a population-size problem at the thin end. Tripling
`SCALING_CONSTANT` (to `4.8e-8`) instead, a plain multiplier that
preserves the relative shape between pairs:

- 10 pairs land in the "one full 1900D flight" zone (10-19 each-way).
- 19 more are workable with a second frequency or a bigger gauge.
- 16 stay genuinely thin — still a real pitfall zone, just not
  swallowing the whole map the way it used to.

**The ladder creates a second trap to match the first.** The golden
triangle (776-2,334 each-way at the new scaling) is enormous even next
to an A220 (149 seats) — but the choice model's `scheduleFit` term
rewards frequency independently of raw seats, so 4-5 A220 frequencies
beat 1-2 widebody ones on the same market. A widebody buy is a real
strategic mistake on this map in most cases, not just an expensive
flex — the same kind of judgment call the thin-market trap asks for, at
the opposite end of the ladder.

Verified in-browser: YFC-YQM (a thin pair) read `PDEW: 5 CAP: 19` — down
from roughly 1.5 before the retune, matching the standalone calculation
exactly; YHZ-YQM (a "sweet spot" pair) read `PDEW: 20 CAP: 19`, just
over a full 1900D flight, exactly the zone the retune was aimed at
creating more of.

## Spacebar pause, and an on-time performance stat

Two small additions, both requested directly: a keyboard shortcut for
Pause, and a "star metric" next to Cash showing how punctual the
airline actually is.

**Spacebar pause** (`main.ts`) — a `keydown` listener toggles
`speedMultiplier` between 0 and whatever it was before pausing
(`speedBeforePause`, updated whenever a non-zero speed button is
clicked), so unpausing resumes at 4x if that's where the player was,
not always snapping back to 1x. Ignored while a real DOM input has
focus (`INPUT`/`TEXTAREA`/`SELECT`/`contentEditable`), so typing a
space into the schedule filters or a fare field doesn't yank the game
to a halt mid-keystroke. `event.preventDefault()` also stops the page
itself from scrolling on Space, which is the browser's own default for
that key.

**On-time performance %** — "on time or early" turned out to have a
real, non-trivial signal already in `step.ts`, not something that
needed inventing: a scheduled leg can never depart *before*
`dayStart + leg.departMinute` (the `minuteOfDay < leg.departMinute`
guard rules that out), but it also can't depart until its aircraft is
actually on the ground and past its turn time — so a flight whose
aircraft is still working off delay from an earlier leg genuinely
departs late, not just arrives late. "On time" collapses cleanly to
"departed at exactly its due minute."

Two new lifetime counters on `SimState`, `flightsDepartedTotal` and
`flightsOnTimeTotal` — lifetime, not daily, unlike `todayRevenue` and
its siblings, since a "running" performance stat that reset to blank
every midnight would defeat the point. Incremented right in the
scheduled-leg departure loop in `step.ts` (not the positioning-leg one
— repositioning moves aren't real service, same reasoning that already
excludes them from revenue). The HUD (`panels.ts`) reads
`Math.round((flightsOnTimeTotal / flightsDepartedTotal) * 100)` and
shows "—" until the first flight has actually departed, sitting right
under Cash in the sidebar — both are lifetime numbers, so they read
together naturally.

New required fields on `SimState` meant bumping `ui/save.ts`'s
`SAVE_KEY` to `airgame-save-v4`, per that file's own versioning
convention — an old save is simply not found again rather than loading
with `undefined` counters.

## Drag-to-retime the rotation board, and a map-to-board handoff

Traced directly back to the YHZ-YQM/YHZ-YSJ scheduling bug above: the
M10 route builder's depart-time suggestion only checks "does this
tail's chronologically-last leg land at this route's origin" — a
second route drawn from an airport the tail's day doesn't currently
*end* at falls through to a fixed 07:00 default regardless of what
else that tail is already flying that day. Two routes both starting
from the same base landed on the same time slot, and nothing stopped
the add — by design, per M10's own "let it through, warn afterward"
philosophy, same as an M8 schedule-table edit.

Two ways to fix this were on the table: make the suggestion heuristic
smarter (scan the tail's whole day for a real gap), or let the player
place the new leg by hand with real feedback. Went with the second —
a smarter heuristic can always be wrong in some *new* way and never
explains itself; direct manipulation just shows the conflict while
you're still deciding, and never needs to be smart to begin with.

**The rotation board (`ui/rotationBoard.ts`) is now draggable.** It was
deliberately left read-only through week three (creating/rescheduling
by drag was formally shelved as a second implementation of what the
map gesture already does — plane selection, range, positioning,
network gating). That reasoning still holds for *creating* a leg. It
doesn't hold for *retiming* one already created — that operation needs
none of the map gesture's machinery, just "does this tail's day still
chain if this leg moves," so building it isn't a duplicate of
anything.

Dragging a bar is confined to its own row (retime only, never a
cross-tail reassignment — that's still a schedule-table edit), snaps to
the nearest whole minute, and previews live against
`tailRotationProblems()` — a new export from `sim/schedule.ts`, the
same per-tail chain/turn-time/closure logic `validateSchedule()` already
ran per tail, pulled out so the drag preview can score one tail's
hypothetical placement without the whole-schedule stranded-aircraft
check (meaningless mid-drag) or another tail's unrelated problems
bleeding in. Red the instant the hypothetical breaks the chain, green
the instant it doesn't.

Nothing writes to the real `state.schedule` until the drop:
`step()` reads that array every simulated minute, including while the
board is open mid-drag, so a half-finished drag has no business being
visible to the running simulation. On drop, the leg's real object gets
its `departMinute` mutated in place and `validateSchedule()` re-runs —
and the schedule *table* needed a new `syncScheduleRowTime()` export
from `ui/panels.ts`, since its `<input type="time">` elements are only
ever patched by their own `change` handler; a drag commits through an
entirely different path, so nothing else would have told that row to
catch up.

**The other half: confirming a route on the map now jumps here.**
`ui/routeBuilder.ts`'s confirm handler calls a new `onRouteConfirmed`
callback (wired in `main.ts` to `switchToPanel('rotation', legIds)`)
instead of leaving the player looking at the map with a freshly-added,
possibly-conflicting leg they'd have to notice a warning about
separately. The new bar(s) get a brief amber glow
(`rotation-bar--new`) and the board scrolls to the first one — draw a
route, land straight on "here's what you just added, go place it."

Verified in-browser on the exact C-FQAB schedule the bug report came
from: dragged the three conflicting legs into a closed loop
(YQM→YHZ→YSJ→YHZ→YQM) by hand, warnings cleared; then drew a live
YHZ→YQB route on the map, watched it jump straight to the rotation
board with both new legs glowing (and, as expected, immediately
conflicting with the existing 07:00 departure — the same bug,
reproduced live), then dragged all six legs into a single closed
6-leg loop (YQM→YHZ→YQB→YHZ→YSJ→YHZ→YQM) with no warnings left.

## Two rotation-board legibility fixes

Both raised right after actually using the board above: a narrow bar's
own inline text (`YHZ → YQB`) gets clipped once its block time is short
relative to the full day, and the board had no way to tell two tails
apart except their tail number.

Added a `.rotation-row-type` column, left of the tail label, showing
`aircraft.typeCode` — the same raw code the Fleet panel's own Type
column already shows, so the two need no separate lookup to agree.
Widened `.rotation-axis-spacer` to match (72px → 140px), so the hour
ticks still line up with the track and not the row labels.

Replaced each bar's native `title` with a real custom tooltip
(`#rotation-bar-tooltip`, matching `#route-hover-tooltip`'s existing
"real DOM, follows the cursor" shape) — the native tooltip was slow,
unstyled, and showed the exact same clipped text the bar itself
already couldn't fit. The new tooltip's title is the route
specifically (`origin → destination`), since that's the thing a short
bar can't reliably show on its own; the leg ID and times sit below as
a subtitle. The same `showBarTooltip()` function drives both a plain
hover and a live drag — the drag's own mousemove handler feeds it the
tentative dragged-to time instead of the bar's resting one, so the
tooltip keeps reporting the new time as the bar moves, not just once
it stops.
