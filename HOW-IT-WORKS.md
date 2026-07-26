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
- **`aircraft-types.json`** — one type right now: the Dash 8-400 (`DH4`),
  78 seats, 360kt cruise, `costPerBlockHour` and `costPerDeparture` for the
  economy model below. Multiple types are explicitly deferred.
- **`schedule.json`** — the daily-repeating schedule *template*: 12 legs
  across 3 tails (`C-GVIA`, `C-FATL`, `C-GMAR`), each a hand-authored
  rotation that returns to its own overnight base by end of day. Each entry
  has `legId`, `tail`, `origin`, `dest`, `departMinute` (minute-of-day) —
  `blockMinutes` is *not* stored here, it's computed at load time (see
  below). This file itself is never edited at runtime: `sim/schedule.ts`'s
  `loadSchedule()` hands each new `SimState` its own fresh, independent
  copy (`state.schedule`), which the M8 schedule editor mutates instead.

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
   `completedToday`/`todayRevenue`/`todayCost`/`todayMargin` reset to zero
   *before* anything else this call does. `cash` does not reset. The reset
   happens at the start of the new day rather than the end of the old one
   specifically so that right up until this call, those fields still hold
   the just-finished day's real totals — readable from outside step()
   (the M7 headless runner, for instance) between calls.
2. **Depart** — any leg in `state.schedule` whose `departMinute` has arrived
   ("at or after," not only the exact minute — see below), not already
   flown or in the air today, flown by an aircraft that's on the ground at
   the right airport *and* past its minimum turnaround
   (`groundSinceMinute + MIN_TURN_MINUTES`), takes off: the aircraft flips
   to `airborne` and an `ActiveFlight` is created with `blockMinutes`
   (computed once at schedule load time from great-circle distance ÷ cruise
   speed) plus a randomly rolled delay (M9, see below) added to the
   departure minute. Reading from `state.schedule` rather than a fixed
   constant is what lets the M8 schedule editor's edits actually change
   what the sim does.
3. **Arrive** — any `ActiveFlight` whose `arriveMinute` has been reached
   lands: the aircraft flips back to `ground` at the destination and
   records `groundSinceMinute` (for the *next* leg's turnaround check), and
   `sim/economy.ts`'s `flightResult()` is applied (see Economy below).

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
`sim/geo.ts` already computes for route arcs and block time. `k = 1`
and the scaling constant `C = 1.6e-8` are hand-picked, crude parameters
in the same spirit as `economy.ts`'s `LOAD_FACTOR`/`AVG_FARE` — not
calibrated against any real O-D survey, just tuned so the biggest pair
(Montréal-Toronto) lands in the low thousands and the smallest
(Saint John-Fredericton) lands in the tens.

This is a pure function of static data (population never changes at
runtime, distance is fixed per airport pair), so nothing caches a
matrix — it's cheap enough to call directly whenever a number is
needed. It's visible in the map's Demand view (see "Rendering," below)
and, as of this same milestone, caps `economy.ts`'s pax count too (see
"Economy," above) — a route whose demand can't fill a 78-seat DH4 now
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
real DOM, per CLAUDE.md's rule against hand-rolled canvas widgets. The
Ops/Demand/Competition/Rotation/Commercial toggle in the HUD (`main.ts`'s
`currentView`) picks what `render()` draws each frame; `basemap.ts` is
the one layer shared by all three canvas modes, drawn first and every
time.

**Ops mode** (the default) — draw order back to front:

1. `basemap.ts` — land/coastlines from Natural Earth 110m TopoJSON.
2. `terminator.ts` — the night hemisphere: a 90°-radius `d3.geoCircle`
   centered on the antisolar point, computed from `simMinute` (declination
   from day-of-year, subsolar longitude from minute-of-day). Semi-
   transparent dark navy, so land and ocean still show through it.
3. `routes.ts` — one thin arc per distinct city pair (dedup'd across the
   schedule's directional legs), drawn as a 2-point `LineString` that
   `d3.geoPath` resamples along the true geodesic.
4. `aircraft.ts` — one triangle per active flight. Position comes from
   `d3.geoInterpolate(origin, dest)(t)` at the *current fractional* simulated
   minute — not interpolated tick-to-tick, recomputed fresh every frame, so
   it stays smooth at any speed and freezes exactly when paused. Heading
   comes from `sim/geo.ts`'s `bearing()`, converted to a canvas rotation
   (valid specifically because Mercator always draws north-up/east-right).
   Since M9, a flight running late (`arriveMinute > scheduledArriveMinute`)
   is tinted red instead of the usual yellow — the point being to make a
   cascading delay watchable on the map itself, not just readable as text.
5. `airports.ts` — a dot + IATA label per airport.

**Demand mode** — `demand.ts`'s `drawDemandLayer()`, on top of the same
basemap: one geodesic arc for every one of the 10 airports' 45 distinct
pairs, width and opacity scaled to that pair's `sim/demand.ts` figure
relative to the single busiest pair, so the big markets read as the
thickest, brightest lines. A pair that already has scheduled service
(same bidirectional "served" definition `routes.ts` uses) gets an amber
halo drawn behind its arc, so it's visible at a glance which big markets
are already flown versus still white space. Airport circles are sized by
`sqrt(population)` (area, not radius, tracking population — otherwise
Toronto would swallow the map) instead of Ops mode's fixed dot. Read-only,
same "visualize first" phasing as the rotation board's first pass — no
legend or tooltip yet, and not clickable.

**Competition mode** — `competition.ts`'s `drawCompetitionLayer()`, the
same one thin-arc style `routes.ts` uses, but drawing every market that
falls into exactly one of three states relative to a second piece of
state (`selectedCompetitorAirline` in `main.ts`, driven by a `<select>`
shown only in this view — `null` means "any competitor," the default
"All competitors" view; a specific name means just that one carrier):

- **Yours only** — default color. The competitor set being considered
  doesn't serve this market at all.
- **Theirs only** — red, at full visibility (not dimmed): a market the
  player doesn't fly but the competitor set does. This is exactly what
  the view exists to surface — e.g. Trillium Air's YYZ-YOW, which the
  player has no route on at all — so it's drawn just as prominently as
  anything else, not backgrounded.
- **Both** — amber, reusing the same "already exists/served" meaning
  amber carries elsewhere (`ui/routeBuilder.ts`'s new-route highlight,
  Demand mode's served-halo) rather than a fourth unrelated color.

The same three-way logic drives both the aggregate view and a single
airline's — `selectedAirline === null` just swaps in the union of every
competitor's markets as "the competitor set" instead of one airline's.
`sim/choiceModel.ts`'s exported `competitors` data and `CompetitorOffering`
type are reused directly, no new data model.

**Hover tooltips** (`ui/competitionTooltip.ts`) are the one interactive
piece: hovering a route or airport shows every airline touching it as a
pie chart sliced by daily frequency, plus a `CODE Name — percent%
(frequency/day)` legend line per airline. Every airline now has a
two-letter code, the player included — `sim/airline.ts`'s
`PLAYER_AIRLINE` (`Fundy Air`, `FA`) and each competitor's new `code`
field in `data/competitors.json` (Capital Wings `CW`, Trillium Air `TA`,
Bluenose Regional `BR`). `render/competition.ts`'s `operatorsForMarket()`/
`operatorsForAirport()` always return the *complete* breakdown regardless
of the current airline filter — hovering answers "who's actually here,"
independent of which one carrier happens to be selected in the dropdown.

Hit-testing a route needed a new technique, since `d3.geoPath` has no
"distance from a point to this path" query: `findCompetitionHover()`
samples 24 points along the geodesic (the same `geoInterpolate()`
technique `aircraft.ts` uses to position a flight) and finds the closest
sampled segment. Airports reuse the simpler nearest-projected-point test
`ui/routeBuilder.ts`'s arming gesture already established, and take
priority when both are within range — a point is a smaller, more precise
target than a line. The tooltip itself is real DOM (a hand-built inline
SVG pie plus an HTML legend), per CLAUDE.md's rule against hand-rolled
canvas widgets; it hides on mouseleave, on leaving Competition mode, or
on changing the airline filter, so it never shows stale content or a
stale position. Read-only otherwise, same phasing as Demand mode's first
pass.

Switching away from Ops cancels any in-progress route-creation gesture
(`ui/routeBuilder.ts`'s `cancelPendingRoute()`), and the route-builder's
own mouse handlers only run at all when `currentView === 'ops'` — arming
a route by clicking an airport wouldn't mean anything while looking at
the demand or competition layer instead. Panning and zooming (below)
stay live in all three canvas modes, since seeing a market more clearly
is just as useful as seeing operations more clearly.

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

Editing is departure time only — reassigning a leg's origin,
destination, or tail (which would also mean recomputing `blockMinutes`
and touching `render/routes.ts`'s route list) is out of scope for this
pass. Fare briefly lived here as a per-leg column during the Pricing
loop's first pass, then moved to the route (market) level — see "The
Commercial panel," below — once it became clear fare needed to be a
route-level decision, not one independently adjustable per frequency.

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

Creating a *new* route is a map gesture, not a form: click an airport to
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

Confirming opens a real DOM form (per CLAUDE.md's panel rule) for tail and
departure time. "Add Route" does nothing clever: it appends a new
`ScheduleLeg` to `state.schedule` (the same array `step()` reads from) and
re-runs `validateSchedule()` — exactly the mechanism M8's time-editing
already uses. There's no new rotation-fitting solver; a leg added
somewhere the chosen tail isn't actually going to be gets caught by the
same console error a bad manual edit would produce, and nothing prevents
adding it anyway, for consistency with M8.

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

`#map`, `#rotation-board`, and `#commercial-panel` (below) are CSS
siblings sized identically; the HUD's view toggle swaps which one is
visible via the `hidden` attribute rather than absolute positioning.
The four views are grouped into two icon-triggered dropdowns rather than
a flat row of buttons — **Maps** (a folded-map SVG icon; Ops, Demand)
and **Reports** (a bar-chart SVG icon; Rotation, Commercial) — each
group's trigger shows only the icon, not a text label, and opens a
small popup with its two views on click. Clicking a view, or clicking
anywhere outside an open dropdown, closes it; the trigger for whichever
group the current view belongs to stays visually active even while its
dropdown is closed, so it's visible at a glance which mode you're in
without opening anything. Hit the same `[hidden]`-vs-class-selector
specificity gotcha CLAUDE.md documents for `#map`/`#rotation-board` —
`.view-dropdown[hidden] { display: none }` has to be explicit, or the
dropdown's own `display: flex` rule silently wins and it never actually
hides. `main.ts`'s `render()` still updates the clock and
sidebar panel every frame regardless of which view is showing, but skips
all canvas drawing while the board (or the Commercial panel) is up
(`if (currentView === 'rotation' || currentView === 'commercial') return;`)
— there's no point paying for it while hidden.

The board is read-only for now (phase 1 of a longer plan — see
WEEK-TWO.md's "rotation board" section for phases 2–4, none of which are
built). Unlike the schedule table or the route-builder form, it has no
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

## What isn't built yet

See WEEK-ONE.md's "Deliberately deferred" list (aircraft market, financing,
maintenance, crew, competitor AI, multiple aircraft types, save/load, and
more) — not duplicated here since it would just go stale. Everything in
"Then, in order" (headless runner, schedule editor, turn times/delays) is
now done.
