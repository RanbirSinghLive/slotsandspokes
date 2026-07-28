# How airgame works

A running reference for the mechanics as they actually exist right now — as
opposed to CLAUDE.md (conventions for writing new code) or WEEK-ONE.md (the
original milestone plan, now a historical record). This file should get a
short update whenever a milestone changes how something works; if it drifts
out of sync with the code, the code is right and this needs fixing, not the
other way around.

Status: M1–M6 complete (scaffold through economy/panel). Phase 2 — M7
(headless runner), M8 (schedule editor), and M9 (turn times/delays) all
done — that's every milestone WEEK-ONE.md's "Then, in order" names. Phase 3
(see WEEK-TWO.md) is underway: M10 (route creation map gesture) done; the
demand/choice-model/competition/pricing layers it'll eventually plug into
are still brainstorm-stage, not built.

---

## Time

Everything in `src/sim/` measures time as `simMinute`: an integer count of
minutes since the start of day 0, UTC. There is no `Date` object anywhere in
the simulation. `Math.floor(simMinute / 1440)` is the day number (0-based
internally, displayed as 1-based); `simMinute % 1440` is the minute of that
day, which is what the daily-repeating schedule is authored against.

The browser compresses time: 125ms of real time = 1 simulated minute at 1×
speed (`MS_PER_SIM_MINUTE` in `main.ts`). The speed buttons (Pause/1×/4×/20×)
just multiply how fast an accumulator fills up; `step()` itself always
advances by exactly one minute per call regardless of speed.

Daylight saving is out of scope — each airport has one fixed
`utcOffsetMinutes` (see Data files below), and nothing in the sim adjusts it
seasonally.

## Data files (`data/`)

- **`airports.json`** — 10 airports across eastern Canada. Each has `iata`,
  `name`, `lat`/`lon`, `utcOffsetMinutes` (winter/standard time, fixed,
  not DST-aware), and `population` (catchment CMA/CA population, StatsCan
  2021 census — see `sim/demand.ts`, below). Coordinates verified against
  OurAirports.
- **`aircraft-types.json`** — five types now (week four's aircraft
  ladder, at the player's request — multiple types were explicitly
  deferred until then): Beechcraft 1900D (`BEH1900D`, 19 seats), Dash
  8-300 (`DH8300`, 50), Dash 8-400/Q400 (`DH8400`, 78), Airbus A220-300
  (`A220300`, 149), Airbus A330-300 (`A330300`, 280) — real public
  spec-sheet seats/cruise per type, same sourcing rule as before; costs
  and `rangeNm` stay "deliberately crude, not fit to any real source,"
  same spirit as `economy.ts`'s other constants. `DH8400`'s cost figures
  are the *original* DH4 numbers from before the very first Fleet Market
  pass swapped the starting type down to the 1900D. `createInitialState()`
  (the headless runner's own entry point, untouched by any of this) still
  grabs index `[0]` of this array, which stays `BEH1900D` — array order
  matters there, not just the code. See the Fleet Market section, below,
  for the full ladder and its pricing.
- **`fleet-market.json`** (week three, expanded week four) — a small,
  hand-authored list of individual airframes available to buy or lease in
  a new game: `registration`, `typeCode`, `ageYears`, `buyPrice`,
  `leasePricePerDay`. Two listings per type now, 12 total, all available
  from day one. See the Fleet Market section, below.
- **`schedule.json`** — the daily-repeating schedule *template*: 12 legs
  across 3 tails (`C-GVIA`, `C-FATL`, `C-GMAR`), each a hand-authored
  rotation that returns to its own overnight base by end of day. Each entry
  has `legId`, `tail`, `origin`, `dest`, `departMinute` (minute-of-day) —
  `blockMinutes` is *not* stored here, it's computed at load time (see
  below). No longer what an actual new game starts from (week three's
  Fleet Market starts empty instead — see below); this file's only
  remaining consumer is `src/headless/run.ts`'s `createInitialState()`
  call, M7's balance-tuning tool, which still wants a known, fully-formed
  network to simulate against. `sim/schedule.ts`'s `loadSchedule()` hands
  it its own fresh, independent copy each time, never mutating this file
  itself.

## The simulation state (`src/sim/state.ts`)

`SimState` is the entire truth of where the world is — plain data, no class
instances, no `Map`/`Set`, no functions, and it survives
`JSON.parse(JSON.stringify(state))` unchanged (that's what makes save/load
"free" whenever it gets built, and what makes the headless runner and
in-browser sim behave identically).

```
simMinute        — current time, see above
cash             — running total, persists across days
aircraft[]       — { tail, typeCode, status: 'ground'|'airborne', atAirport,
                      activeLegId, groundSinceMinute }
activeFlights[]  — { legId, tail, origin, dest, departMinute, arriveMinute,
                      scheduledArriveMinute }
schedule[]       — this game's own editable copy of the daily schedule (see M8, below)
completedToday[] — legIds finished since the last day rollover
todayRevenue/Cost/Margin — reset to 0 at day rollover; cash is not reset
rngSeed          — seeded RNG state (see Randomness) — used by M9's delay rolls
```

`groundSinceMinute` (added M9) is when an aircraft last landed, used to
enforce a minimum turnaround. `scheduledArriveMinute` (added M9) is what an
`ActiveFlight`'s arrival would have been with a fully on-time departure and
zero delay — comparing it to the real `arriveMinute` is how lateness gets
explained without redoing day-boundary math outside step.ts.

`createInitialState(tails, rngSeed?)` builds this at `simMinute = 0`. Only
the tails you pass become `Aircraft` records — a schedule leg for any other
tail simply never matches an aircraft in `step()` and is silently ignored.
That's how M4 ran one aircraft out of the full three-tail schedule with zero
special-case code, and how M5 turned the rest on by passing more tails.

## The tick (`src/sim/step.ts`)

`step(state)` advances the world by exactly one minute, mutating `state` in
place, deterministically (same state in → same state out, always — no
`Math.random()`, no reading the clock). Each call does three things in
order:

1. **Day rollover** — if this is minute 0 of a new day,
   `completedToday`/`todayRevenue`/`todayCost`/`todayMargin` reset to zero,
   the day's total marketing spend is charged (see "The Commercial panel"),
   and `sim/weather.ts`'s `rollDailyWeather()` expires/spreads/originates
   storms (see "Weather," below) — all *before* anything else this call
   does. `cash` does not reset. The reset happens at the start of the new
   day rather than the end of the old one specifically so that right up
   until this call, those fields still hold the just-finished day's real
   totals — readable from outside step() (the M7 headless runner, for
   instance) between calls.
2. **Depart** — any leg in `state.schedule` whose `departMinute` has arrived
   ("at or after," not only the exact minute — see below), not already
   flown or in the air today, flown by an aircraft that's on the ground at
   the right airport *and* past its minimum turnaround
   (`groundSinceMinute + MIN_TURN_MINUTES`), takes off: the aircraft flips
   to `airborne` and an `ActiveFlight` is created with `blockMinutes`
   (computed once at schedule load time from great-circle distance ÷ cruise
   speed) plus a randomly rolled delay (M9, see below — worse odds if the
   origin has active weather) added to the departure minute. Reading from
   `state.schedule` rather than a fixed constant is what lets the M8
   schedule editor's edits actually change what the sim does.
3. **Position** (week three) — the same depart gate as step 2, but against
   `state.positioningLegs` instead: one-time repositioning moves
   `ui/routeBuilder.ts` queues automatically when a route gets assigned to
   a tail that isn't standing at its origin (see "Route builder," below).
   Removed from the queue the instant it departs, since a positioning move
   is absolute-time and never recurs.
4. **Arrive** — any `ActiveFlight` whose `arriveMinute` has been reached
   lands: the aircraft flips back to `ground` at the destination and
   records `groundSinceMinute` (for the *next* leg's turnaround check).
   `sim/economy.ts`'s `flightResult()` is applied for a normal leg (see
   Economy below); a positioning flight instead pays only its real
   fuel/departure cost (`legCost()`) with zero passengers or revenue,
   since it isn't serving any market.

**Why "at or after" instead of an exact match (M9):** once delays exist, an
aircraft can still be mid-flight or mid-turnaround at the exact minute its
next leg was scheduled to leave. Matching only the exact minute would just
silently skip that leg for the rest of the day the moment it missed its
slot. "Has the time passed, and haven't we flown this leg yet today"
instead means a late aircraft departs the moment it's actually ready — the
whole mechanism that lets one delay push a later one back rather than the
schedule quietly giving up on that leg.

**Delay rolling** (`step.ts`'s `rollDelayMinutes()`): a fixed, non-tunable
distribution — 65% of flights are exactly on time; the rest get a delay of
1–45 minutes, skewed toward the short end (rolled as `severity²` so small
delays are far more common than the maximum). Two draws from `sim/rng.ts`'s
`nextRandom()` per roll (one for "delayed at all," one for "how much" when
it is), threading `state.rngSeed` forward each time — same reasoning as
always: a delay has to be reproducible from `state` alone.

One concrete traced example (seed 3, single aircraft): a leg rolled a
27-minute arrival delay, landing at minute 6401 against a scheduled 6374.
Its next leg was due to depart at 6420, but `6401 + 30 (MIN_TURN_MINUTES) =
6431` came out later than that — so it departed at 6431, 11 minutes late,
gated by the turnaround rule rather than the original schedule. That's the
cascade mechanic, confirmed by hand arithmetic against the actual output.

A full-year run (3 aircraft, several seeds) never produced a "stranded"
aircraft — a tail sitting at the wrong airport for its next scheduled
leg — because the schedule's turn buffers (46–59 minutes) comfortably
absorb the maximum single-leg delay (45 minutes) in practice.

## Economy (`src/sim/economy.ts`)

Deliberately crude, per WEEK-ONE.md — same load factor, regardless of
route or day — but since week two, capped by whether the route's market
can actually support that many passengers, and priced at the route
(market) level rather than one flat rate for everyone:

```
LOAD_FACTOR = 0.75
demandPerFlight = dailyDemand(origin, dest) / legsServingMarket
bookedDemand    = demandPerFlight * bookingShare(fare, legsServingMarket, origin, dest, marketingSpend)
pax     = min(round(seats * LOAD_FACTOR), round(bookedDemand))
revenue = pax * fare
cost    = (blockMinutes / 60) * costPerBlockHour + costPerDeparture
margin  = revenue - cost
```

`fare` and `marketingSpend` come from `state.routeSettings[marketKey(origin, dest)]`
(sim/state.ts's `RouteSettings`), not from the leg — see "Pricing" and
"The Commercial panel," below, for why fare lives at the market level.

`legsServingMarket` (`sim/schedule.ts`) counts every currently-scheduled
leg between this pair, either direction — the route's total daily demand
(`sim/demand.ts`) is split evenly across all of them, so a second daily
frequency on an already-thin market doesn't conjure new passengers, it
just gives the same ones a second flight to spread across.

`bookingShare()` (`sim/choiceModel.ts`, week two's "connective piece") is
new: of that per-flight slice, only some fraction actually books — the
rest choose a competitor, or not to travel at all. It's a real
multinomial logit: your flight, every static competitor serving the same
market (`data/competitors.json`), and a fixed "stay home" option all get
scored, and softmax turns those scores into shares. A market with zero
competitors collapses this to the plain logistic sigmoid of your own
utility — algebraically identical to what this looked like before
competitor data existed, so adding competitors changed nothing for a
market that doesn't have one. `pax` is whichever is smaller: the old
flat load-factor figure (still the ceiling on a market with demand to
spare), or this flight's actual booked count.

`bookingShare()` itself blends three travel-purpose segments (business/
leisure/VFR, week two's "yield mix" layer), each with its own price and
schedule-frequency sensitivity — a fixed 20/50/30 split of every market's
demand pool, not varied by route yet. Business travel barely reacts to
fare but responds strongly to frequency; leisure is the opposite; VFR
sits in between. `economy.ts` still only sees the single blended number
`bookingShare()` returns — it applies one flat fare to everyone, since no
fare-by-segment lever exists yet, so the segments differ only in how they
each react to that same fare and frequency, not in what they pay.

Verified via the headless runner: the Ottawa-Montréal-Toronto corridor
still fills to the old 59-pax ceiling regardless (plenty of demand there
to absorb any of this), while every Atlantic Canada leg the fleet flies
today is demand-starved *and* trimmed further by booking share — YQM-YYG
down to 3 pax, YYG-YFC to a single passenger, on a 78-seat aircraft.
Total daily revenue is $51,430 (down slightly from $51,615's single-
segment v1, $128,760 before any of week two's layers existed), and some
days still finish with a negative margin. Confirmed to match exactly
between the headless runner and a live browser run at the same simulated
moment. Segmenting demand this way also made the *aggregate* price
sensitivity much sharper than the single-segment version — bookingShare
at a hypothetical $300 fare drops to ~0.57 now versus ~0.73 before, since
half of all demand (leisure) is genuinely price-sensitive — which is
exactly the lever the pricing loop (below) now lets the player actually
pull. Frequency's effect (from the previous milestone) is unchanged:
adding a daily frequency to a market still measurably raises its booking
share today, no pricing lever required to see it.

**Static competitors** (`data/competitors.json`, week two's "Competition"
layer) exist on four markets so far — three on the busy Ottawa-Montréal-
Toronto triangle (one of which, YYZ-YOW, the player's fleet doesn't even
fly yet) and one on the smaller Québec-Halifax route — fixed schedules
and fares, authored once, never reacting to anything the player does
(fictional airline names, not real carriers, per CLAUDE.md's public-
sources-only rule). Verified via the headless runner: the two big,
seat-capped Ontario/Quebec legs are unaffected (booking share drops to
roughly half against Trillium Air, but there was so much spare demand
there that 59 seats still fill regardless) — but Québec-Halifax, which
was merely demand-starved before, now also loses real share to Bluenose
Regional and drops from 8 pax to 4. Total daily revenue fell to $49,950,
and **the fleet's current schedule now runs a net loss over any 5-day
stretch** ($-4,623 cash after 5 days, versus a small profit the
milestone before) — confirmed to match exactly between the headless
runner and a live browser run, cash/revenue/cost/margin all identical at
the same simulated day. This is the first point where week two's layers
have made the schedule the WEEK-ONE.md milestones authored — sensible
under a flat economy with no competition — genuinely not a viable
business anymore — which is exactly the problem the pricing loop below
finally lets the player respond to.

**Pricing** (`sim/schedule.ts`'s `recommendedFare()`, week two's "Pricing"
loop) replaced that flat $185 for everyone with a distance-based default,
the same shape `costPerDeparture`/`costPerBlockHour` already has — a
fixed component plus a per-nm rate:

```
BASE_FARE = 125    PER_NM_RATE = 0.3
recommendedFare = round(BASE_FARE + PER_NM_RATE * distanceNm)
```

Fare is set at the **route (market) level, not per leg** — a market
with two daily frequencies has exactly one fare, a deliberate choice to
keep the game's decision space manageable as more levers get added (see
"The Commercial panel," below). Every market gets a `RouteSettings`
entry (`sim/state.ts`) the moment its first leg exists — at game
creation for the template schedule, or when the M10 route builder
creates a leg on a market that doesn't have one yet — seeded with
`recommendedFare()`'s default. It's only ever a *default*: decision 3 in
WEEK-TWO.md is explicit that fare has to be a player-overridable lever,
not a fixed number, so the new Commercial panel has a Fare control per
market — a range slider bounded to 50%-150% of that market's recommended
fare, in $5 steps, with a live $ readout (not a free-text field, which
the decision explicitly rules out). Dragging it mutates
`state.routeSettings[key].fare` directly; the new fare takes effect on
that market's very next departure (`ActiveFlight` locks in the fare —
and marketing spend — it departed with, so a change mid-flight doesn't
retroactively alter one already in the air).

`routeSettings.fare` feeds both halves of the yield-management tension
at once: it's `bookingShare()`'s price term (a higher fare loses
bookings to competitors or "stay home") *and* the multiplier on
`revenue` directly. Verified via the headless runner and a live browser
test: raising a fare has a completely different effect depending on
whether the market is seat-capped or demand-capped. Ottawa-Montréal
(recommended $150, seat-capped at 59 pax regardless of fare) gained
roughly $4,425 of pure margin over two days from manually dragging its
fare to $225 — the market has so much spare demand that losing booking
share cost it nothing, since 59 seats still filled either way. A
demand-capped market wouldn't behave the same way — raising its fare
would genuinely lose it passengers it can't make up elsewhere, since
there's no seat-cap slack to absorb the drop. Distance-based defaults
also gently recalibrated every route's fare relative to the old flat
$185 (short Atlantic hops now default cheaper, the longest leg —
Québec-Halifax, already the one with a competitor — now defaults *more*
expensive), landing total daily revenue at $47,962 (down slightly from
$49,950) with the schedule's net loss over 5 days deepening slightly to
$-14,563 — the pricing lever existing doesn't fix profitability by
itself; a player actually has to use it, e.g. by noticing (as above)
that raising fares on the two big seat-capped corridors is free money
at today's demand levels.

Applied on **arrival**, not departure — a flight in the air hasn't earned or
spent anything yet. `margin` is added to `state.cash`; `revenue`/`cost`/
`margin` are each added to the day's running totals.

`blockMinutes` here is `arriveMinute - departMinute` on the actual
`ActiveFlight` — since M9, that includes any rolled delay, so a delayed
flight genuinely costs more (more block hours burned) with no separate
code path needed. `revenue` is unaffected (pax count doesn't depend on
delay), so this is also why the economy no longer produces the same
margin every day — see Headless runner, below.

## O-D demand (`src/sim/demand.ts`) — week two, layer 1

`dailyDemand(originIata, destIata)` estimates how many people want to
travel between two airports on an average day — a gravity model, the
standard tool for exactly this problem:

```
demand(A, B) = round(pop(A) * pop(B) / distance(A, B)^k * C)
```

`pop` is each airport's `population` field (its catchment CMA/CA
population); `distance` is the same great-circle distance
`sim/geo.ts` already computes for route arcs and block time. Both of
those inputs are real. `k = 1` and the scaling constant `C` are not —
they're hand-picked, crude parameters in the same spirit as
`economy.ts`'s `LOAD_FACTOR`/`AVG_FARE`, converting a real population/
distance pair into a passenger count with nothing calibrated against
an actual O-D survey.

`C` was `1.6e-8` through week three, then tripled to `4.8e-8` in week
four at the player's request, once the aircraft ladder (below) made it
obvious the original number was too conservative to play: with only
the 19-seat Beechcraft 1900D available, 31 of this map's 45 city pairs
worked out to under 10 passengers each way, most of the map was a trap
rather than a market. Tripling `C` (checked against all 45 pairs before
picking the number) gets 10 pairs into the "one full 1900D flight"
zone (10-19 each way), 19 more workable with a second frequency or a
bigger gauge, and leaves 16 genuinely thin — real pitfalls still exist,
they just don't swallow the whole map. Softening `k` instead (so
distance decays less sharply) was tried and rejected: it blows up the
biggest pairs (the Montréal-Toronto-Ottawa "golden triangle") far more
than it helps the smallest ones, since that's a distance-shaped fix
applied to what's fundamentally a population-size problem at the thin
end.

This is a pure function of static data (population never changes at
runtime, distance is fixed per airport pair), so nothing caches a
matrix — it's cheap enough to call directly whenever a number is
needed. It's visible in the map's Demand view (see "Rendering," below)
and, as of this same milestone, caps `economy.ts`'s pax count too (see
"Economy," above) — a route whose demand can't fill the plane now
genuinely flies half-empty instead of always reporting the same flat
load factor. What's still missing is a real choice model: today every
flight on a market just gets an even split of that market's demand,
with no fare sensitivity and no competitor share, since neither exists
yet (see WEEK-TWO.md's "Layers").

## Headless runner (`src/headless/run.ts`)

`npm run headless` (optionally `-- 30` for a shorter run than the 365-day
default) imports `createInitialState`/`step` directly and calls `step()` in
a plain loop — no canvas, no `requestAnimationFrame`, no waiting for real
time to pass. It writes one CSV row per day (`headless-output.csv`, git-
ignored — it's a report, not source) with that day's cash, revenue, cost,
margin, and legs flown, reading `state.todayRevenue` etc. right after the
day's last minute is processed but before the next day's first minute would
reset them (see the note on reset timing under "The tick" above).

Before M9, margin was *exactly* $84,423 on every one of 365 days — expected
at the time (nothing varied day to day yet), but a real limitation: there
was no way for a bad day to happen at all. Since M9's delays feed into cost
(see Economy, above), margin now genuinely varies day to day — a 30-day run
ranged roughly $77,000–$84,000 depending on how much delay-driven cost each
day happened to roll.

## Rendering (`src/render/`, plus `main.ts`'s loop)

Canvas draws the map; everything else (clock, speed buttons, sidebar) is
real DOM, per CLAUDE.md's rule against hand-rolled canvas widgets.
`main.ts`'s `panelView` (`'map' | 'rotation' | 'commercial' |
'fleet-market'`) picks which *panel* is showing — only one of the four —
and, when it's `'map'`, two independent booleans (`demandOverlayOn`,
`competitionOverlayOn`) pick which extra layers `render()` draws on top
of the base map that frame. `basemap.ts` is the one layer always drawn
first, every time the map panel is visible.

**This is a week-four rework.** Demand and Competition used to be two
more entries in an exclusive `View` enum alongside Ops — full-screen
modes you had to leave the map to check, losing the ability to draw a
route while looking at either. They're overlays now: independent on/off
toggles (two buttons in the Maps dropdown, no longer exclusive-view
buttons) that layer on top of the one persistent map panel instead of
replacing it.

**The map panel** — draw order back to front, every frame:

1. `basemap.ts` — land/coastlines from Natural Earth 110m TopoJSON.
2. `terminator.ts` — the night hemisphere: a 90°-radius `d3.geoCircle`
   centered on the antisolar point, computed from `simMinute` (declination
   from day-of-year, subsolar longitude from minute-of-day). Semi-
   transparent dark navy, so land and ocean still show through it.
3. `demand.ts`'s `drawDemandLayer()`, **only if `demandOverlayOn`** — one
   geodesic arc for every one of the 10 airports' 45 distinct pairs,
   width and opacity scaled to that pair's `sim/demand.ts` figure
   relative to the single busiest pair, so the big markets read as the
   thickest, brightest lines. A pair that already has scheduled service
   (same bidirectional "served" definition `routes.ts` uses) gets an
   amber halo drawn behind its arc. Drawn *before* the route layer below
   on purpose — this is background context your own network then draws
   on top of, not the other way around. No longer draws its own
   airports (see below).
4. Your own network — **either** `routes.ts` (plain gray, one thin arc
   per distinct city pair, if `competitionOverlayOn` is off) **or**
   `competition.ts`'s `drawCompetitionLayer()` (if it's on). These are
   mutually exclusive, not layered: `drawCompetitionLayer()` already
   draws every one of your own routes too, just recolored by whether a
   competitor also flies it, so drawing both would double every
   own-route line. `drawCompetitionLayer()` draws every market that
   falls into exactly one of three states relative to a second piece of
   state (`selectedCompetitorAirline`, driven by a filter dropdown shown
   only while this overlay is on — `null` means "any competitor," a
   specific name means just that one carrier):
   - **Yours only** — default color. The competitor set doesn't serve
     this market at all.
   - **Theirs only** — red, at full visibility (not dimmed): exactly
     what the overlay exists to surface — e.g. Trillium Air's YYZ-YOW,
     which the player has no route on at all.
   - **Both** — amber, reusing the same "already exists/served" meaning
     amber carries elsewhere (`ui/routeBuilder.ts`'s new-route
     highlight, Demand's served-halo).

   The same three-way logic drives both the aggregate view and a single
   airline's — `selectedAirline === null` just swaps in the union of
   every competitor's markets as "the competitor set." `sim/choiceModel.ts`'s
   exported `competitors` data and `CompetitorOffering` type are reused
   directly, no new data model.
5. `aircraft.ts` — one triangle per active flight. Position comes from
   `d3.geoInterpolate(origin, dest)(t)` at the *current fractional* simulated
   minute — not interpolated tick-to-tick, recomputed fresh every frame, so
   it stays smooth at any speed and freezes exactly when paused. Heading
   comes from `sim/geo.ts`'s `bearing()`, converted to a canvas rotation
   (valid specifically because Mercator always draws north-up/east-right).
   Since M9, a flight running late (`arriveMinute > scheduledArriveMinute`)
   is tinted red instead of the usual yellow — the point being to make a
   cascading delay watchable on the map itself, not just readable as text.
6. `airports.ts` — a dot + IATA label per airport, **drawn exactly once,
   always**, regardless of which overlays are on. Both `demand.ts` and
   `competition.ts` used to draw their own airports (population-sized
   circles for Demand, a plain call to the same `drawAirports()` for
   Competition) back when each was a full-screen exclusive view with
   nothing else on screen to share airports with; layering them
   simultaneously would have doubled every airport dot, so both stopped
   drawing airports themselves in the week-four rework.
7. `weather.ts`'s `drawWeatherEffects()` — flash/particle effects at
   airports with active weather (see "Weather," below).
8. The route-builder's own preview (below).

**One unified hover system**, not two. Competition used to have its own
separate hover system (`findCompetitionHover`, `showCompetitionTooltip`)
that only ran in that one exclusive mode; the route builder's own
PDEW/CAP tooltip (see "Route builder," below) only ran while a route was
armed. Now one `mousemove` handler runs whenever `panelView === 'map'`,
with a clear priority: if the route builder reports it handled the move
(a route is armed), its own PDEW/CAP/range tooltip wins, and the general
one is explicitly hidden to avoid stacking two tooltips over the same
cursor. Otherwise, hovering an airport or market arc shows every airline
touching it as a pie chart sliced by daily frequency, plus a `CODE Name
— percent% (frequency/day)` legend line per airline — but only your own
entry unless `competitionOverlayOn` is also true, in which case
competitors show too. That's the point of the overlay: turning it on is
the act of revealing competitive intel, so the hover tooltip has to
respect the same on/off switch the route coloring does, not leak
competitor data regardless of it.

This changes *what counts as hoverable*, not just what the tooltip
shows: `findCompetitionHover()` takes an `includeCompetitors` flag now,
and when it's false, only `ownRoutes` count as hoverable market arcs —
competitor-only arcs aren't drawn on screen in that state at all (see
step 4 above), so testing hit-distance against them would let you hover
something invisible. Airports stay hoverable either way, since they're
always drawn and your own operator info is always fair game. Every
airline still has a two-letter code — `sim/airline.ts`'s
`PLAYER_AIRLINE` (`Fundy Air`, `FA`) and each competitor's `code` field
in `data/competitors.json` (Capital Wings `CW`, Trillium Air `TA`,
Bluenose Regional `BR`) — and `operatorsForMarket()`/
`operatorsForAirport()` still always return the *complete* breakdown
regardless of the airline filter; the `includeCompetitors` filtering
happens one layer up, in `ui/competitionTooltip.ts`, not in those two
functions themselves.

Hit-testing a route needed a technique since `d3.geoPath` has no
"distance from a point to this path" query: `findCompetitionHover()`
samples 24 points along the geodesic (the same `geoInterpolate()`
technique `aircraft.ts` uses to position a flight) and finds the closest
sampled segment. Airports reuse the simpler nearest-projected-point test
`ui/routeBuilder.ts`'s arming gesture already established, and take
priority when both are within range — a point is a smaller, more precise
target than a line. The tooltip itself is real DOM (a hand-built inline
SVG pie plus an HTML legend), per CLAUDE.md's rule against hand-rolled
canvas widgets; it hides on mouseleave, on leaving the map panel, or on
changing the airline filter, so it never shows stale content or a stale
position.

Switching away from the map panel cancels any in-progress route-creation
gesture (`ui/routeBuilder.ts`'s `cancelPendingRoute()`), and the
route-builder's own mouse handlers only run at all when
`panelView === 'map'` — arming a route by clicking an airport wouldn't
mean anything on a different panel. Panning and zooming (below) stay
live regardless of which overlays are on, since seeing a market more
clearly is just as useful as seeing operations more clearly.

`projection.ts` owns the single shared `d3.geoMercator()` instance, fitted to
an eastern-Canada bounding box and clipped to the canvas's own pixel bounds.
Pan drags `projection.translate()`; scroll zooms `projection.scale()` toward
the cursor, clamped to 0.5×–20× of the fitted scale.

The accumulator loop (`main.ts`) turns real frame time into whole simulated
minutes (`step()` calls) plus a continuous fractional minute for rendering,
per the pattern in CLAUDE.md's "Time" section.

## Panel (`src/ui/panels.ts`)

A real HTML sidebar, 280px wide (canvas width = `window.innerWidth - 280`,
kept in sync via `PANEL_WIDTH_PX`). Shows cash, today's revenue/cost/margin,
a fleet table (tail, type, status, and either the current airport or
`origin → dest (N min)` while airborne — with `, N min late` appended when
`arriveMinute > scheduledArriveMinute`, M9), and the schedule table below.
The econ/fleet parts are rebuilt from `state` every render — a pure read,
same rule as the canvas layers.

## Schedule editor (M8)

The schedule table is *not* rebuilt every render like the fleet table is —
`setupScheduleEditor()` builds its rows once at startup instead. Rebuilding
it 60 times a second the way the fleet table is would tear out and recreate
every `<input>` continuously, which steals keyboard focus and closes the
browser's native time-picker mid-edit. Nothing needs it rebuilt anyway:
`state.schedule` only ever changes through these same inputs, so there's
nothing external for a repeated render to pick up.

Each row has a real `<input type="time">` bound to one leg's `departMinute`
(converted between "HH:MM" and minutes-of-day). Its `change` handler does
two things: mutates that leg object in `state.schedule` directly — which
`step()` reads from, so the very next simulated minute that reaches that
slot uses the new time — and re-runs `validateSchedule()` on the whole
schedule, logging to the console exactly like the M3 startup check does if
the edit leaves an aircraft departing before it could plausibly have landed
and turned around.

**Closing the loop (week three):** `validateSchedule()` also checks, per
tail, that the chronologically *last* leg's destination equals the *first*
leg's origin — not just that consecutive legs chain into each other.
`state.schedule` is supposed to be the same rotation repeating every day
(per CLAUDE.md), so a tail whose day doesn't loop back to its own start
looks fine on the day it's edited and then silently jams on day two: the
aircraft simply isn't where the first leg needs it to be, and `step()`'s
departure check (physical position must match `leg.origin`) blocks it
forever with no error, since nothing about that check is itself broken.
Found by playtesting, not by reading the code — a hand-added one-way leg
stranded a tail for good with revenue silently going to zero.

**Validated against reality, not just itself (week three):**
`validateSchedule()` also takes `state.aircraft` as a second argument and
checks, per tail, whether its actual current airport (when grounded) is
the origin of *any* of its own scheduled legs. The closed-loop check above
only looks at the schedule's own shape — it can't see that a tail is
stranded if every leg that used to route it through some airport gets
deleted, leaving a perfectly self-consistent two-leg loop (say, YHZ↔YYT)
that the aircraft, still sitting wherever its old rotation last left it,
never actually touches. Found immediately after the closed-loop fix
shipped, by the same player hitting exactly this case. The message names
the tail, where it actually is, and which airports its own schedule would
accept it at.

**Warnings are visible in the UI, not just the console (week three):**
`validateSchedule()` returns its problem list (still logs it too) instead
of only logging it, and every call site — the startup check here, the
remove/edit handlers below, and the M10 route builder's Add Route — routes
that return value through `ui/panels.ts`'s `renderScheduleWarnings()`,
which renders the list directly above the Schedule table. A
`console.error` nobody has devtools open to see is functionally the same
as no error at all from the player's chair; this puts it exactly where
their attention already is right after the edit that caused it.

Editing is departure time, plus removal (week three) — reassigning a
leg's origin, destination, or tail (which would also mean recomputing
`blockMinutes` and touching `render/routes.ts`'s route list) is out of
scope for this pass. Fare briefly lived here as a per-leg column during
the Pricing loop's first pass, then moved to the route (market) level —
see "The Commercial panel," below — once it became clear fare needed to
be a route-level decision, not one independently adjustable per
frequency.

**Removing a leg** (week three's playtest-readiness fix): a small "×"
button per row calls `removeScheduleLeg()`, which splices the leg out of
`state.schedule` and its row out of the DOM. If that was the last leg on
its market, the now-orphaned `RouteSettings` entry and Commercial-panel
row are dropped too (`ui/commercial.ts`'s `removeCommercialRow()`) — a
market with no flights left shouldn't keep a lingering fare/marketing
lever. No confirmation dialog: this matches M8/M10's existing
allow-then-flag philosophy exactly — removal is immediate, and
`validateSchedule()` logs a broken rotation to the console the same way
a bad manual time edit already does, rather than blocking the action. An
already-airborne flight on the removed leg is unaffected, since
`ActiveFlight` (sim/state.ts) already carried its own copied data
independent of `state.schedule`.

**Column filters:** a second header row holds one text input per column
(Tail/Route/Depart). `applyScheduleFilters()` re-checks all three on every
keystroke in any of them — case-insensitive substring match, ANDed across
fields — and just toggles each row's `display`, not a rebuild, so it can't
interfere with the "build once" rule above. Depart matches against the
row's live `<input type="time">` value rather than text content, since
that cell holds an input, not a text node; editing a row's time re-applies
the filters too, in case the new value no longer matches.

The exported `filterScheduleToRoute(origin, dest)` is called from
`showForm()` — the moment the confirmation popup opens, not the moment
"Add Route" is clicked. It clears the Tail/Depart filters (so a stale one
can't hide anything) and sets the Route filter to the pending route's
exact text, so the table narrows to that market's existing frequencies
*while the player is still choosing a tail and time* — useful context for
the decision itself, not just tidying up afterward. Filtering only on
confirm was tried first and didn't feel like it worked: by the time the
filter took effect, the popup had already closed and attention had moved
on, so the narrowing was easy to miss entirely. Since the Route filter is
already set to the right market by the time "Add Route" runs, the newly
added leg satisfies it automatically — no separate re-filter step needed
after adding.

The confirmation form also resets its own depart-time input to a fixed
default (`DEFAULT_DEPART_TIME`, `showForm()`) every time it opens, rather
than leaving whatever time a *previous* route's form was left at — without
this, a leftover time from an unrelated earlier route could silently
collide with an existing leg on a new market and block Add with no
obvious reason why (this happened for real: creating a second YSJ-YQB
frequency after leaving the input at 13:00 from an unrelated route).

## Route builder (`src/ui/routeBuilder.ts`) — M10

Creating a *new* route is a map gesture, not a form: **pick a plane from
the Fleet panel first** (week three — see below), click an airport to
arm it, move the mouse (no need to hold the button — release and the arm
state persists) to draw a live preview arc toward the cursor, and click a
second airport to confirm. The preview is built the same way as a real
route — a 2-point `LineString` run through the same `d3.geoPath` machinery
`render/routes.ts` uses — so it curves exactly like the route would once
created, snapping onto the nearest airport's exact coordinates once the
cursor is within `HIT_RADIUS_PX`. Escape, re-clicking the armed origin, or
clicking anywhere that isn't a valid airport all cancel back to idle.

This is a small state machine (`idle` / `armed` / `confirming`) living
entirely in this module — not in `SimState`, since it's transient UI
interaction, not simulated-world state. `main.ts`'s existing canvas
`mousedown` handler gives this module first refusal on every click
(`handleRouteBuilderMouseDown`); only if it says "not mine" does the
existing M2 pan gesture start, so the two don't fight over the same event.

**Pick the plane first, not last (week three):** Add Route used to open
a form with a Tail dropdown *after* both endpoints were already chosen —
so you could draw a whole route before the game ever asked which plane
it was for, and the dropdown just defaulted to `state.aircraft[0]`. Now
`ui/panels.ts`'s Fleet rows are clickable (a second click deselects),
tracked in a new tiny module, `ui/fleetSelection.ts`, purely to avoid a
circular import (`panels.ts` and `routeBuilder.ts` already import from
each other the other way). `handleRouteBuilderMouseDown()` refuses to
arm anything at all — same silent no-op as clicking empty water — unless
a tail is already selected, and captures it into the `armed`/`confirming`
state so the whole gesture stays locked to that one plane. If the Fleet
selection changes mid-gesture, `cancelIfTailChanged()` (checked on every
mousedown and every `drawRoutePreview()` call) cancels the pending route
rather than let it finish for a different, or no, aircraft. Buying or
leasing (`ui/fleetMarket.ts`) auto-selects the new tail, so a purchase
flows straight into drawing its first route. The Tail dropdown in the
confirmation form is gone — the plane is shown read-only
(`#new-route-tail-label`), since it was decided before the form ever
opened.

**A real range ring, not a decorative one (week three):** the moment an
origin is armed, `drawRoutePreview()` draws a geodesic circle —
`d3.geoCircle()`, a true constant-great-circle-distance ring, not a flat
pixel one — sized to the selected plane's real range
(`data/aircraft-types.json`'s new `rangeNm` field ÷ 60, since 60nm per
degree of arc is the literal definition of a nautical mile). A flat
pixel circle would lie about reachability here specifically because
Mercator distorts distance by latitude, and this map sits far enough
north for that distortion to matter. Range is enforced, not advisory:
`updateFormValidation()` blocks Add Route with a plain message ("YYT is
954 nm from YOW — beyond the Beechcraft 1900D's 700 nm range with a full
load") whenever the destination falls outside it, with a matching
defensive re-check in the confirm handler. 700nm is the type's realistic
full-payload range from published specs (its empty ferry range is closer
to 1,439nm) — checked against all 45 of this map's city pairs before
picking it: only 5 fall outside 700nm, nearly all of them reaching
Newfoundland (YYT) from the mainland, which tracks with the real
geography rather than fragmenting the map.

Confirming opens a real DOM form (per CLAUDE.md's panel rule) for
departure time (tail is already fixed — see above). "Add Route" does
nothing clever beyond that: it appends a new `ScheduleLeg` to
`state.schedule` (the same array `step()` reads from) and re-runs
`validateSchedule()` — exactly the mechanism M8's time-editing already
uses. There's no new rotation-fitting solver; a leg added somewhere the
chosen tail isn't actually going to be gets caught by the same console
error a bad manual edit would produce, and nothing prevents adding it
anyway, for consistency with M8.

**PDEW/CAP (week four):** the form also shows the market's un-minmaxed
demand-vs-capacity ceiling — "PDEW: 626 CAP: 19" — right under Block
time, turning amber when demand can't fill the plane. `PDEW` (Passengers
Daily Each Way) is `round(dailyDemand(origin, dest) / newFrequency)`:
`sim/demand.ts`'s existing gravity-model total, divided by the market's
frequency *after* this confirm would add its leg(s) — the same
denominator `sim/economy.ts`'s `flightResult()` already divides by, read
before committing instead of after, so it can never drift from what the
flight actually carries once it's flying. `CAP` is the plane's raw seat
count, deliberately not the load-factor-adjusted ceiling — the point is
showing the number *before* fare, yield segmentation, marketing spend,
or competitor response apply, all of which are what the Commercial
panel is for. Recomputes live when the return checkbox toggles (it
changes `newFrequency`), and stays visible even when the route itself is
blocked (network gating, out of range) — still useful context for a
market worth trying differently.

**The same reading, on hover, before you even confirm (week four):**
while a route is *armed* (one airport clicked, cursor moving toward the
second), a real-DOM tooltip (`ui/routeBuilder.ts`'s
`showRouteHoverTooltip()`, positioned via mousemove the same way
`ui/competitionTooltip.ts`'s already is) shows PDEW/CAP for whichever
airport `candidate` — the same nearest-airport snap the preview arc
already uses — currently points to. No new hit-testing needed:
Competition mode's arc-distance technique turned out to be unnecessary
here, since the route builder already tracks the hover target for its
own preview line. A candidate beyond the selected plane's range shows
"— out of range (954 nm)" in place of the thin-market amber, catching
the same case the confirmation form's hard block does, just one click
earlier. Hidden on canvas `mouseleave` without cancelling the armed
gesture itself — moving the mouse to the sidebar to glance at the Fleet
panel shouldn't lose an in-progress route.

**A suggested depart time, not just a fixed one (week three):**
`suggestedDepartTime()` replaces what used to be an unconditional
`12:00` default. If the selected tail already has legs and the
chronologically *last* one lands right at this route's origin, it
suggests landing-time-plus-turn-buffer — reusing
`defaultReturnDepartMinute()`'s exact formula, just applied to the
tail's actual last leg instead of the leg being drawn — so a route that
continues a tail's day slots in behind its last flight instead of
defaulting to an unrelated fixed hour. Otherwise (no legs yet, or an
origin that doesn't match where the day currently ends — which needs a
positioning leg regardless) it falls back to a new `MORNING_DEPART_TIME`
(07:00), matching `data/schedule.json`'s own convention for how a day
actually starts. Always just a suggestion: the field stays a plain,
editable `<input type="time">`.

**The return leg (week three):** confirming adds *two* legs by default,
not one — the one you drew, plus its reverse, auto-timed via
`defaultReturnDepartMinute()` (land, then the same block time back, plus a
45-minute turn buffer) and shown live in the form ("Return: YQM → YYZ at
14:54") before you confirm. This came from an actual playtest bug: adding
a single one-way leg is exactly the gesture that strands a tail with no
way back into its rotation, since nothing else in the schedule ever
returns it to where that leg needs it to start. A checkbox ("Add return
leg too", checked by default) opts back out for the genuine exception — an
extra one-way frequency on a market that already has a return, or a
deliberate one-off repositioning move. The return leg gets its own
exact-time-collision check, independent of the outbound leg's, since
either one colliding should block the whole submission.

**Automatic positioning flights (week three):** every fix up to this point
(closed-loop validation, the physical-position check) made the game
correctly *report* a stranded tail — none of them stopped it from
happening. That was backwards: the point of positioning flights is to let
the player describe the network they want and have the game work out how
to get a plane there, at a real cost, not to force a routing puzzle before
every new route. So Add Route now checks the chosen tail's current (or,
if it's airborne, soon-to-be — see `currentOrUpcomingAirport()`) position
against the route's origin, and if they don't match, queues a one-time
`PositioningLeg` (`sim/schedule.ts`) automatically — no extra click. The
form previews it before you confirm: "Positioning: C-GVIA will fly
YOW → YHZ first (106 min, cost only, no passengers) before this route
starts."

A `PositioningLeg` is a genuinely different kind of thing from a
`ScheduleLeg`: it lives in its own `state.positioningLegs` array, its
`departMinute` is an absolute `simMinute` rather than a repeating minute-
of-day (it never recurs), and `step()` flies it through the same gates as
a real leg (turn time, weather, delay) but charges only its real
fuel/departure cost on arrival (`sim/economy.ts`'s `legCost()`) — no
market, no passengers, no revenue, since there's nothing to sell seats on.
It's removed from the queue the instant it departs. `validateSchedule()`'s
stranded-tail check also takes `state.positioningLegs` now, so it stops
warning about a tail that already has a positioning leg headed toward one
of its schedule's own origins — "in progress," not "broken."

`currentOrUpcomingAirport()` returns `null` for one more case beyond "tail
not found": a Fleet Market purchase that's never flown, sitting
unassigned (see the Fleet Market section above). That's handled as its
own branch, not a positioning leg — there's no real "current location" to
fly it in from, so Add Route just sets `aircraft.atAirport` to the new
route's origin directly, for free, right when you confirm.

**Growing the network one airport at a time (week three):** a new
route's *origin* has to already be somewhere the player flies —
`sim/schedule.ts`'s `networkAirports()` returns every airport touched by
`state.schedule` (both origins and destinations), and Add Route blocks
the form (disabled button, plain error: "YSJ isn't in your network
yet...") whenever the chosen origin isn't in that set and the set isn't
empty. The *destination* is unrestricted — reaching a brand-new airport
as a destination is exactly how it joins the network for the next route
to start from. An empty network (the very first route of the game) is
exempt, since nothing could be "already in" a network that doesn't exist
yet. This was designed and agreed on in an earlier conversation but never
actually wired up until a player caught two disconnected routes (YFC↔YYG,
then YSJ↔YHZ) going through with no gate at all. It's a route-creation-
time check, not a schedule-wide invariant — it doesn't feed into
`validateSchedule()`'s returned problems, so an already-disconnected
route from before this fix isn't retroactively flagged, only prevented
going forward.

Editing/removing an *existing* route stays table-driven (M8) rather than
gaining a second, harder gesture — hit-testing a click against an
arbitrary curve is a meaningfully bigger problem than hit-testing a point,
and the table already does the job.

**Market vs. frequency, and the one thing that's hard-blocked:** the form's
heading reads "New Frequency" instead of "New Route" when the chosen
origin/destination already has service — checked bidirectionally
(`isExistingMarket()`), the same definition `render/routes.ts` uses to
decide what counts as the same route for drawing. Separately, adding a leg
at the exact same origin, destination, *and* departure minute as one that
already exists is hard-blocked in the form itself (an inline error,
disabled Add button, live as the depart time changes) rather than allowed-
through-then-flagged the way M8/M9's rotation checks are — two departures
at the identical minute on the identical route has no legitimate
interpretation in this model, unlike a temporarily awkward rotation, which
is still meaningful to leave in place while iterating. That collision
check is same-direction only (opposite-direction departures at the same
clock time is an ordinary synchronized schedule bank, not a conflict).

## Rotation board (`src/ui/rotationBoard.ts`) — M11

A second view of the same `state`, for when the schedule table stops being
legible — a Gantt-style diagram, one row per tail, bars from
`departMinute` to `departMinute + blockMinutes` against a shared 24-hour
axis. Everything that isn't a bar *is* the answer to "where's the white
space" — no separate free-time indicator is drawn, since the gaps between
bars already show it.

`#map`, `#rotation-board`, `#commercial-panel`, and `#fleet-market-panel`
are CSS siblings sized identically; the HUD's panel toggle swaps which
one is visible via the `hidden` attribute rather than absolute
positioning. The panels are grouped into two icon-triggered dropdowns
rather than a flat row of buttons — **Maps** (a folded-map SVG icon;
Map, plus the Demand/Competition overlay toggles — see "Rendering,"
above, for why those stopped being panel-switch buttons in week four)
and **Reports** (a bar-chart SVG icon; Rotation, Commercial, Fleet) —
each group's trigger shows only the icon, not a text label, and opens a
small popup on click. Clicking a panel button, or clicking anywhere
outside an open dropdown, closes it; the trigger for whichever group the
active panel belongs to stays visually active even while its dropdown
is closed, so it's visible at a glance which one you're on without
opening anything. Hit the same `[hidden]`-vs-class-selector specificity
gotcha CLAUDE.md documents for `#map`/`#rotation-board` —
`.view-dropdown[hidden] { display: none }` has to be explicit, or the
dropdown's own `display: flex` rule silently wins and it never actually
hides. `main.ts`'s `render()` still updates the clock and sidebar panel
every frame regardless of which panel is showing, but skips all canvas
drawing while a DOM panel is up (`if (panelView !== 'map') return;`) —
there's no point paying for it while hidden.

The board is read-only, permanently now rather than "for now" (phase 1
of what was originally a longer plan — see WEEK-TWO.md's "rotation
board" section). Phases 2–3 (create/reschedule by dragging a bar) were
formally shelved in week three: they would have been a second
implementation of what the M10 map gesture already does, duplicating
intelligence (plane selection, range, positioning, network gating) the
map gesture has since accumulated and a from-scratch Gantt interaction
would have to rebuild from nothing. The board stays exactly what phase 1
already made it: a genuinely useful, read-only "where's the white
space" diagnostic. Unlike the schedule table or the route-builder form, it has no
live `<input>` elements to lose focus on, so `updateRotationBoard()`
simply clears and rebuilds every row from `state` on each call, rather
than patching in place the way M8/M10 have to. It's called once when the
Rotation view is selected (in case the schedule changed while it was
hidden) and not on every tick, since nothing else currently mutates the
schedule while the board itself is open.

Switching away from the Ops view calls `cancelPendingRoute()` (M10's
route builder, exported for this purpose) — an armed or half-confirmed
route gesture doesn't mean anything once the canvas it was being drawn
on is no longer on screen.

## The Commercial panel (`src/ui/commercial.ts`)

A fourth view, one row per market, that makes route-level revenue
management legible and *editable* — where the rotation board and demand
map both started read-only, this one didn't, since the whole point is
levers to pull. Raised the same way the rotation board was: not on the
original layers/loops list, but a real gap once the Pricing loop's
per-leg fare slider made clear that fare (and future levers) needed a
route-level home instead.

Each row: market, frequency, pax/day, load factor, **market share**,
revenue, cost, margin, a Seat-capped/Demand-capped status, and two
levers — Fare (see "Pricing," above) and Marketing spend. Market share
(`sim/choiceModel.ts`'s `trafficShare()`) answers a different question
than `bookingShare()` does: it excludes "stay home" from the softmax
denominator, so it's "of the people who fly this market, what fraction
fly you" rather than "what fraction of the whole addressable population
books at all." Any market with no direct competitor is trivially 100%.
Direct-competitor-only for now — connecting itineraries aren't modeled
(WEEK-TWO.md decision 1), so a rival reachable only by connecting
through a third city can't pull share away here yet. Every number comes
from calling
`sim/economy.ts`'s real `flightResult()` once per leg serving that
market and summing the results — never a reimplementation of the pax/
revenue/cost formula, so this panel can't quietly drift from what the
simulation actually does. `routeSettings` is passed into that call
directly rather than read from `state`, so a slider mid-drag shows the
*hypothetical* result of a value not committed yet, live.

**Seat-capped vs. demand-capped** is the single most useful thing this
panel adds: a market is seat-capped when every one of its flights is
pinned at the 78-seat aircraft's load-factor ceiling (there's more
demand than the fleet can carry, so raising fare trades away spare
demand nobody could fly anyway — free margin); anything short of that
ceiling is demand-capped (every passenger is real, so raising fare costs
real pax). Previously the only way to know which case a market was in
was to run the headless script and read the numbers by hand.

**Marketing spend** (`sim/choiceModel.ts`'s `marketingBonus()`) is the
first lever added *because* `RouteSettings` was already a record, not a
single `fare` field — a per-market daily dollar amount, log-scaled for
diminishing returns, added only to *your* own utility term (competitors
are unaffected by what you spend). Charged once per day per market at
day-rollover (`step.ts`), not per flight, since it's a market-level
decision that doesn't scale with how many flights happen to land that
day. Bounded $0–$1,000 in $50 steps. More levers can join this same
record later without changing its shape again.

Same live-input build discipline as the schedule table: sliders are
built once per market (`setupCommercialPanel()` at startup,
`addCommercialRow()` when the M10 route builder creates a genuinely new
market) and never rebuilt, only their numeric sibling cells
(`refreshRow()`) — called on every slider `input` event for that row,
and for every row when the Commercial view is selected, in case a
frequency changed while it wasn't open.

**The same layout bug as the schedule table's Fare column repeated
itself** at a larger scale: automatic table layout let two
`<input type="range">`s per row push the table's content width past its
container (951px of table in a 687px panel), silently overflowing off
the right edge of the screen with no visual sign anything was wrong.
Same fix, this time across ten columns: `table-layout: fixed` with
explicit per-column percentages, and each lever's slider/readout stacked
vertically instead of side by side.

Verified in-browser: dragging Québec-Halifax's fare down from $230 to
$120 (a demand-capped market) doubled its pax from 6 to 12 and revenue
recomputed correctly live; adding $500/day of marketing spend on top of
that raised pax further to 14 *and* correctly added the $500 into that
market's displayed cost — the panel doesn't let marketing spend look
free just because it's charged elsewhere in the simulation.

## Randomness (`src/sim/rng.ts`)

A seeded PRNG (mulberry32); `state.rngSeed` carries its entire internal
state. Used by M9's delay rolls in `step.ts` (see "The tick," above). The
seed lives in `state`, not a module-level variable, specifically so a delay
roll stays reproducible: same state in, same state out, and a saved/
reloaded or headlessly-rerun game produces the identical sequence of
"random" delays. Verified: identical seed → identical 60-day outcome;
different seed → diverges.

## Weather (`src/sim/weather.ts`, `src/render/weather.ts`)

Week two's "random events" layer — seasonal thunderstorms and
snowstorms, bare-bones by design: no ground stops, no diversions, no
cancellations. Weather at an airport just makes M9's `rollDelayMinutes()`
(see "The tick," above) roll against worse odds for a leg departing from
there (`ON_TIME_PROBABILITY` 0.65→0.2, `MAX_DELAY_MINUTES` 45→90) — the
same delay mechanism a flight already uses, just fed harsher parameters,
rather than a new aircraft state.

`state.weatherByAirport: Record<iata, WeatherEvent>` (a plain object,
JSON-safe) holds at most one active event per airport. `rollDailyWeather()`
runs once per simulated day, from `step.ts`'s existing day-rollover
check (alongside the marketing-spend charge), not per minute:

1. **Expire** anything whose `endsAtMinute` has passed.
2. **Spread**: every airport with an active event rolls a 25% chance,
   independently, for each of its "adjacent" airports (within 200nm —
   `sim/geo.ts`'s great-circle distance, no new data) to catch the same
   `kind`, with its own fresh 2-6 hour duration. That 200nm threshold
   happens to split the map into exactly two clusters — Ontario/Québec
   (YUL/YOW/YQB/YYZ) and the Maritimes (YHZ/YSJ/YFC/YQM/YYG) — with YYT
   isolated from both, matching how separate it actually is.
3. **Originate**: season is a day-of-year lookup (the same formula
   `terminator.ts` uses for the day/night line) — summer (day 152-243)
   only ever rolls thunderstorms, winter (day 335-59, wrapping the year
   boundary) only ever rolls snowstorms. Every airport with nothing
   active gets an 8%/day chance.

Every roll goes through `state.rngSeed` (`sim/rng.ts`), so weather is
exactly as reproducible as M9's delays: same seed, same weather history.

**Visuals are the one place this deliberately breaks determinism**:
`render/weather.ts`'s `drawWeatherEffects()` (drawn on the map panel
only, after `drawAirports()`) gives a thunderstorm airport an occasional bright
flash (`Math.random()`, ~5% chance per rendered frame) and a snowstorm
airport a handful of small drifting particles, driven by a plain frame
counter. CLAUDE.md's determinism rule is about `step()`, not rendering —
nothing needs a flash to look identical on replay, only "a thunderstorm
was active here" does, and that part *is* in `state`.

**Performance**: verified via the headless runner over a full simulated
year (525,600 calls to `step()`) at 0.57 real CPU seconds — no
measurable change from the pre-weather baseline. At most 10 plain
objects, a handful of comparisons once a day; nowhere close to
mattering next to everything else `step()` already does every minute.

Verified via the headless runner across a full year: snowstorms only on
winter-window days, thunderstorms only on summer-window days (54/50
storm-days out of 365 respectively); a plausible spread chain (Québec
City thunderstorm on day 152, then Ottawa — its nearest neighbor — on
day 154); never more than 4 storms active across the whole map at once.
Verified in-browser: snow particles render and drift at an airport with
an active snowstorm, no console errors.

## Persistence (`src/ui/save.ts`)

Week three's playtest-readiness fix (see WEEK-THREE.md): before this,
closing the tab threw away every schedule edit, fare change, and
marketing dollar spent, since nothing was ever written to
`localStorage`. `loadSavedState()`/`saveState()`/`clearSavedState()` are
a thin wrapper around it, keyed by `airgame-save-v3` at last count —
bumped by hand whenever `SimState`'s shape changes in a breaking way
(most recently for the Fleet Market's `fleetMarket` field and `Aircraft`'s
new `ownership`/`leaseCostPerDay`), so an old save under a retired key is
simply never found again rather than crashing on a field the current
code doesn't expect (bare-bones versioning, not a migration system).

This only works because `SimState` is already required to survive
`JSON.parse(JSON.stringify(state))` unchanged (CLAUDE.md's rule, true
since M1) — a save *is* exactly that round trip, just persisted across
page loads instead of happening within the same tick. `main.ts` calls
`saveState()` once per simulated day *crossed* (tracked in the `tick()`
loop, not every minute — 1440x fewer writes) and `loadSavedState()`
once at startup, falling back to a fresh game if nothing was saved or
the save didn't parse. Every `localStorage` call is wrapped in a
try/catch that swallows the error — a save that didn't happen (private
browsing, quota exceeded) is a minor inconvenience, not a reason to
crash the simulation.

A fresh game now seeds from `Date.now()` (`sim/state.ts`'s
`createNewGameState()`, `main.ts`'s entry point) rather than a fixed
default — so every new playthrough gets its own weather/delay history.
`src/headless/run.ts` still calls the older `createInitialState()`
instead, which never changed and keeps its own fixed default, so it stays
exactly as reproducible as every verification in this document already
relies on it being.

A "New Game" button in the HUD clears the save and reloads — simpler and
more robust than resetting every piece of in-memory state by hand. It
confirms first, since this is irreversible, via a **real inline
confirmation** (`#new-game-confirm`, swapped in for the button itself)
rather than `window.confirm()` — the native dialog turned out to be
silently blocked in this project's own preview browser, always resolving
to "cancelled" with no visible sign anything had happened, which read
exactly like "New Game doesn't work." Plain DOM can't be suppressed that
way, per CLAUDE.md's panel rule anyway.

Verified in-browser: playing across a simulated day boundary, forcing a
full page reload, and confirming the game resumed at the same day/cash/
schedule rather than restarting; New Game's inline confirmation, then
"Yes, start over," cleared the save and returned to a fresh Day 1 with
zero fleet and a visibly different weather roll than the previous game
had.

## The Fleet Market (`src/sim/fleetMarket.ts`, `src/ui/fleetMarket.ts`)

Week three's biggest structural change: a new game now starts with
**zero aircraft and zero schedule**, not the old fixed 3-tail/12-leg
network. `sim/state.ts`'s `createNewGameState()` is the actual "New Game"
entry point now — `STARTING_CASH` ($500,000) and nothing else. The old
`createInitialState()` (full template, fixed seed) still exists
unchanged, purely so `src/headless/run.ts` keeps simulating its known
test network; the two are deliberately separate functions rather than
one branching on its arguments.

`data/fleet-market.json` is a small, hand-authored list of individual
airframes (registration, age, buy price, daily lease price). Week three
shipped it with one aircraft type; week four added the rest of the
ladder (below), so it now lists two used airframes per type, 12 rows
total, all available from day one. `ageYears` is pricing flavor only —
older is cheaper, with no separate reliability/maintenance mechanic
attached.

The Fleet Market view (a new Reports-menu entry labeled "Fleet," real DOM
like Rotation/Commercial) lists whatever's left in `state.fleetMarket`.
Buying deducts `buyPrice` from cash immediately; leasing costs nothing up
front and instead adds `leasePricePerDay` to a new daily charge in
`step.ts` (same flat-per-day shape marketing spend already has) via the
aircraft's `leaseCostPerDay` field. **Acquisition-only** — no sell-back,
no early lease-end, matching CLAUDE.md's aircraft-trading still being
deferred beyond just getting into a plane.

**No base-airport picker at purchase.** A bought or leased aircraft joins
the fleet with `atAirport: null` — shown as "Unassigned" in the Fleet
panel's Where column — sitting in a pool rather than pinned to a city
before there's a route for it. `ui/routeBuilder.ts`'s
`currentOrUpcomingAirport()` returns `null` for exactly this case (ground,
no airport), which the Add Route confirm handler treats differently from
a real mismatch: instead of queuing a costed positioning leg (see the
Route builder section below), it deploys the aircraft directly to the
new route's origin, for free — there's nothing to fly it in *from*. The
form previews this before confirming: "C-FQAC has no base yet — this
route will make YHZ its new base." That first route is also, implicitly,
how a home base gets chosen — no separate step for it.

Buying/leasing also calls `ui/fleetSelection.ts`'s `setSelectedTail()` on
the new aircraft — since week three's later "pick a plane first" change
(see Route builder, below) means selecting it is what makes it drawable
at all, a purchase now flows straight into drawing its first route with
no extra click needed. Drawing a route with zero aircraft owned is still
explicitly blocked in the form ("Buy or lease an aircraft first...")
rather than left to silently produce a route nothing can ever fly.

**The balance gap week three opened, closed in week four:** the Dash
8-400 became a Beechcraft 1900D at the player's request, with costs
scaled down proportionally, but the demand model wasn't re-tuned for a
plane this much smaller — a headless run showed small net losses that
weren't there before the swap. Week four's aircraft ladder and demand
retune (see below, and the O-D demand section above) is that pass: five
types now span Beechcraft-to-widebody, and `SCALING_CONSTANT` was
tripled so more markets are actually workable starting from a single
1900D.

**The aircraft ladder (week four).** Five types in `data/aircraft-types.json`
now, in order of size — `BEH1900D` (19 seats, 280kt, 700nm), `DH8300`
(Dash 8-300, 50 seats, 270kt, 800nm), `DH8400` (Dash 8-400/Q400, 78
seats, 360kt, 1,000nm — its cost figures are the original pre-swap DH4
numbers, reused rather than re-derived), `A220300` (Airbus A220-300,
149 seats, 450kt, 2,500nm), and `A330300` (Airbus A330-300, the
widebody tier, 280 seats, 470kt, 6,000nm). Seats and cruise speed come
from real public spec sheets, same sourcing rule as the original 1900D;
costs and range stay hand-picked, same spirit as `economy.ts`'s other
constants. Order in the array matters beyond display — `sim/state.ts`'s
`createInitialState()` (the headless runner's entry point) grabs index
`[0]`, so `BEH1900D` has to stay first.

Buying is deliberately constrained on day one: `STARTING_CASH` is
$500,000, the cheapest 1900D listing is $300,000 (leaving $200,000 —
not enough for a second one at any listed price), and the cheapest
listing of any other type (the Dash 8-300 at $2,100,000) is nowhere
close to affordable. A new game can only ever start with exactly one
aircraft, and it's the smallest one. Leasing isn't gated the same way —
any type can be leased with zero upfront cost, the daily
`leasePricePerDay` charge being the tradeoff — so a cash-strapped
player who wants more capacity early still has a route to it, just one
with an ongoing cost instead of a one-time one.

The ladder also creates a second judgment-call trap to match the thin-
market one: the choice model's `scheduleFit` term
(`sim/choiceModel.ts`) rewards flight frequency on a log curve
independent of seats, so on this map even the biggest "golden triangle"
markets are usually better served by several A220 frequencies than by
one or two widebody ones. Buying the A330 is a real strategic mistake
in most markets here, not just a bigger, safer version of the A220 —
symmetrical to putting a 1900D on a market too thin to fill it.

## What isn't built yet

See WEEK-ONE.md's "Deliberately deferred" list — financing, maintenance,
crew, competitor AI, and more — not duplicated here since it would just
go stale. Aircraft acquisition (buying/leasing) is now built, acquisition-
only, per WEEK-THREE.md's Fleet Market section above; selling or
returning an aircraft is not. Everything in "Then, in order" (headless
runner, schedule editor, turn times/delays) is done.
