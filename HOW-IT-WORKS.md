# How airgame works

A running reference for the mechanics as they actually exist right now — as
opposed to CLAUDE.md (conventions for writing new code) or WEEK-ONE.md (the
original milestone plan, now a historical record). This file should get a
short update whenever a milestone changes how something works; if it drifts
out of sync with the code, the code is right and this needs fixing, not the
other way around.

Status: current through **week seven, phase C** (the utilisation pivot —
see WEEK-SEVEN.md).

**One known gap:** `src/sim/utilisation.ts` has no section of its own.
The route builder and rotations-list sections below use its results, but
the model itself — the 06:00–22:00 usable day, charging each leg its own
turn, pooling spare capacity per base and reporting it *in aircraft* —
is only written up in WEEK-SEVEN.md's phase A. That's the one part of
the pivot this file doesn't explain.

---

## Time

Everything in `src/sim/` measures time as `simMinute`: an integer count of
minutes since the start of day 0, UTC. There is no `Date` object anywhere in
the simulation. `Math.floor(simMinute / 1440)` is the day index (0-based);
`simMinute % 1440` is the minute of that day, which is what the daily-
repeating schedule is authored against.

The HUD showed this as "Day N" through week three. Week four fixed
`simMinute` 0 at January 1, 2027 and displays a real calendar date
instead (`main.ts`'s `updateClock()`/`formatCalendarDate()`) — the one
and only place a `Date` object appears anywhere in this codebase,
deliberately: it's display formatting, exactly the same "local time
exists only for display" carve-out CLAUDE.md already grants each
airport's UTC offset, not a change to what `step()` itself knows or
needs (still nothing but a plain integer).

The browser compresses time: 125ms of real time = 1 simulated minute at 1×
speed (`MS_PER_SIM_MINUTE` in `main.ts`). The speed buttons (Pause/1×/4×/20×)
just multiply how fast an accumulator fills up; `step()` itself always
advances by exactly one minute per call regardless of speed.

The spacebar toggles pause too (week four), not just the Pause button —
a `keydown` listener flips `speedMultiplier` between 0 and whatever it
was before pausing (`speedBeforePause`), so resuming lands back on 4x
or 20x rather than always resetting to 1x. Ignored while a real DOM
input has focus, so it doesn't hijack a space typed into a fare field
or the schedule filters.

Daylight saving is out of scope — each airport has one fixed
`utcOffsetMinutes` (see Data files below), and nothing in the sim adjusts it
seasonally.

## Data files (`data/`)

- **`airports.json`** — 19 airports (10 originally, plus week four's YDF,
  YQX, YYR, YQY, YUY, YBG, YTZ, LGA, and BOS). Each has `iata`, `name`,
  `lat`/`lon`, `utcOffsetMinutes` (winter/standard time, fixed, not
  DST-aware), and `population` (catchment CMA/CA population for Canadian
  airports, StatsCan 2021 census; 2020 US Census MSA for the two
  American ones — see `sim/demand.ts`, below). Coordinates verified
  against OurAirports directly (fetched, not recalled). Deer Lake and
  Sydney use their broader catchment's population (Corner Brook CA,
  Cape Breton CA) rather than the small named town's own, since that's
  the region the airport actually serves; Goose Bay and Rouyn-Noranda
  use their own standalone town/city figure, having no larger CA above
  them; Toronto's two airports (YYZ, YTZ) share one Toronto CMA number.
  Some airports also carry a `maxAircraftType` — see "Airport
  constraints" under `sim/schedule.ts`, below.
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
3. **Arrive** — any `ActiveFlight` whose `arriveMinute` has been reached
   lands: the aircraft flips back to `ground` at the destination and
   records `groundSinceMinute` (for the *next* leg's turnaround check).
   `sim/economy.ts`'s `flightResult()` is applied (see Economy below).

**Why "at or after" instead of an exact match (M9):** once delays exist, an
aircraft can still be mid-flight or mid-turnaround at the exact minute its
next leg was scheduled to leave. Matching only the exact minute would just
silently skip that leg for the rest of the day the moment it missed its
slot. "Has the time passed, and haven't we flown this leg yet today"
instead means a late aircraft departs the moment it's actually ready — the
whole mechanism that lets one delay push a later one back rather than the
schedule quietly giving up on that leg.

**Delay rolling** (`step.ts`'s `rollTotalDelayMinutes()`, reworked at the
player's explicit request to stop being one flat random roll): a
departing flight's total arrival delay is the *sum* of three named
causes, not one distribution —

- **Age** (`rollAgeDelay()`) — every aircraft's own baseline mechanical/
  operational unreliability, worse the older it is. `Aircraft.ageYears`
  (new: copied from `FleetListing.ageYears` at acquisition,
  `ui/fleetMarket.ts` — that field already existed for Fleet Market
  pricing flavor, now doing double duty) drives an on-time probability
  that degrades linearly from 65% at age 0 down to a 35% floor, and a
  worst-case severity that grows from 45 minutes upward with age. Age 0
  reproduces this model's *original* 65%/45 numbers almost exactly — a
  deliberate choice, so age is a genuine widening of the old model
  rather than a silent re-tune of the game's whole balance in the same
  pass. Checked with a throwaway 200k-sample script (`nextRandom()`,
  same disposable-script pattern the demand-model retune used, deleted
  after, never committed): age 0 → 65.1% on-time; age 24 (the oldest
  Fleet Market listing, an A330-300) → 41.0% on-time, 18.7 min average
  delay, 93 min worst case.
- **Weather** (`rollWeatherDelay()`) — unchanged in mechanism from
  before this rework, just pulled out into its own named function: an
  airport with active weather (`sim/weather.ts`) rolls against far
  worse odds; clear skies contribute nothing.
- **Knock-on** (`knockOnDelayMinutes()`) — *not* a fresh random draw.
  25% of however many minutes a flight is *already* departing late
  (because an earlier leg on the same tail ate into its turn buffer)
  carries forward as *additional* arrival delay, rather than a late
  departure simply landing exactly on schedule for how late it left.
  Zero for a flight that got away on time. The randomness already
  happened when the upstream delay was rolled; this cause only
  propagates a fraction of it forward, which is what actually produces
  a cascade that compounds through a rotation instead of one that just
  shifts uniformly later.

Age and weather each still take two draws from `sim/rng.ts`'s
`nextRandom()` (one for "delayed at all," one for "how much" when it
is), threading `state.rngSeed` forward each time — same reasoning as
always: a delay has to be reproducible from `state` alone. Knock-on
needs no draw of its own; it's a pure function of state already
determined by the moment a flight departs.

One concrete traced example (seed 3, single age-0 aircraft, predating
this rework but still exact — age 0's on-time/severity numbers are
unchanged, and this was the day's first delay for that tail, so weather
and knock-on both contributed zero): a leg rolled a 27-minute arrival
delay, landing at minute 6401 against a scheduled 6374. Its next leg
was due to depart at 6420, but `6401 + 30 (MIN_TURN_MINUTES) = 6431`
came out later than that — so it departed at 6431, 11 minutes late,
gated by the turnaround rule rather than the original schedule. That's
the cascade mechanic, confirmed by hand arithmetic against the actual
output — and, per the note above, also exactly the quantity
`knockOnDelayMinutes()` now reads to push that *next* leg's own arrival
delay a bit further still.

Verified in-browser after the rework: bought the oldest available
1900D (C-FQAE, 21 years) and flew it alone on a short shuttle for 20
simulated days at 20x speed — On-time (the HUD stat, departure-side)
settled at 72%, and the Fleet panel's live status caught one specific
flight 77 minutes late in the air, consistent with a 21-year-old
airframe's expected age-driven severity range. Zero console errors
across the run.

A full-year run (3 aircraft, several seeds) never produced a "stranded"
aircraft — a tail sitting at the wrong airport for its next scheduled
leg — because the schedule's turn buffers (46–59 minutes) comfortably
absorb the maximum single-leg delay (45 minutes) in practice.

**On-time performance (week four).** The 11-minutes-late cascade above
is exactly what the HUD's On-time % stat (next to Cash) measures on the
*departure* side, not arrival: a leg can never depart before
`dayStart + leg.departMinute` (the "not due yet" check above rules that
out), so "on time" collapses to "departed at exactly its due minute,"
and a leg whose aircraft is still working off an earlier delay departs
late by construction, the same cascade traced above. Two new lifetime
counters on `SimState`, `flightsDepartedTotal`/`flightsOnTimeTotal`,
incremented right in this departure loop. Lifetime rather than reset-per-day like `todayRevenue`,
since a "running" performance stat that blanked out every midnight
would defeat the point — it sits next to `Cash` in the HUD for exactly
that reason, both being the sidebar's two lifetime numbers.

## The On-Time panel (`src/ui/onTime.ts`) — week four

A Reports-menu view answering two questions the HUD's single lifetime
On-time stat can't: which *routes* are actually unreliable, and *why*
flights are delayed at all, across the whole airline.

`SimState.onTimeByMarket: Record<marketKey, { departed, onTime }>`
mirrors `flightsDepartedTotal`/`flightsOnTimeTotal` exactly, just split
per market — lazily created the first time a market's first leg ever
departs (`??=` in the departure loop), same "create on first use" shape
`routeSettings` already has. Unlike `routeSettings`, an entry is never
deleted when a market's last leg is removed: past reliability is real
history worth keeping even for a route you've since dropped.

`SimState.delayMinutesByCause: { age, weather, knockOn }` needed
`step.ts`'s `rollTotalDelayMinutes()` to return a `DelayBreakdown`
object instead of a pre-summed number, so each cause's contribution can
be attributed before the three are added together into one flight's
actual delay. The panel's "top delay codes" table ranks them by total
minutes, using real BTS delay-code names mapped onto whichever
mechanic actually produces each one — not decorative relabeling: a
knock-on delay from an earlier leg is literally what the BTS calls
"Late Aircraft"; age/reliability is the classic "Carrier" delay;
weather is weather. Both new fields cover every flight, since every flight
now serves a market — week seven removed positioning legs, the one
kind of movement that didn't.

The route table sorts worst-first — surfacing problems is the whole
point of this panel, not an alphabetical ledger — and colors anything
under 90% amber, under 70% red (`.ontime-pct-warn`/`.ontime-pct-bad`,
the same #ffd166/#ff8080 colors already used everywhere else in the
app for "worth a look" and "actually broken"). Both tables are fully
rebuilt on every view (`updateOnTimePanel()`), same "no live inputs to
lose focus on" shape `ui/rotationBoard.ts`'s board uses, not the
"build once, patch in place" discipline `ui/commercial.ts` needs for
its sliders.

New required `SimState` fields meant another `ui/save.ts` version bump
(v4 → v5). Verified in-browser: one 21-year-old 1900D juggling two
tight routes (YHZ↔YQM, YHZ↔YFC) over 8 simulated days at 20x — both
markets landed deep red (7%, 38% on-time) and "Late Aircraft
(knock-on)" dominated at 84% of total delay minutes, exactly the
cascade a single old aircraft on a tight schedule should produce.
Confirmed the new fields round-trip through a save/reload. Zero
console errors.

## Economy (`src/sim/economy.ts`)

Deliberately crude, per WEEK-ONE.md — same load factor, regardless of
route or day — but since week two, capped by whether the route's market
can actually support that many passengers, and priced at the route
(market) level rather than one flat rate for everyone:

```
LOAD_FACTOR    = 0.75
RECAPTURE_RATE = 0.4
demandPerFlight = dailyDemand(origin, dest) / legsServingMarket
bookedDemand    = demandPerFlight * bookingShare(fare, legsServingMarket, origin, dest, marketingSpend, competitorRoutes)
seatCeiling     = round(seats * LOAD_FACTOR)
if bookedDemand > seatCeiling:
  pax             = seatCeiling
  spilloverDelta  = round((bookedDemand - seatCeiling) * RECAPTURE_RATE)  // deposited for a later flight
else:
  recaptured      = min(seatCeiling - bookedDemand, spilloverAvailable)   // drawn from an earlier flight's spill
  pax             = bookedDemand + recaptured
  spilloverDelta  = -recaptured
revenue = pax * fare
cost    = (blockMinutes / 60) * costPerBlockHour + costPerDeparture
margin  = revenue - cost
```

`fare` and `marketingSpend` come from `state.routeSettings[marketKey(origin, dest)]`
(sim/state.ts's `RouteSettings`), not from the leg — see "Pricing" and
"The Commercial panel," below, for why fare lives at the market level.

**Spill and recapture (week four)** — added after being asked directly
whether demand should use connecting flights, and recommending this
instead as the smaller, more surgical fix: until this, a seat-capped
flight's overflow demand was simply deleted (`pax` hard-capped, the
remainder went nowhere). Real airline revenue management distinguishes
total overflow ("spill") from the fraction the *same* airline recovers
on one of its own other flights ("recapture") rather than losing it to
a competitor or a traveler giving up — `RECAPTURE_RATE` (0.4, a flat
crude constant, same spirit as `LOAD_FACTOR`) is that fraction.
`flightResult()` stays a pure function (no `state` access): it takes
`spilloverAvailable` as an input and reports `spilloverDelta` as an
output, and the caller (`step.ts`'s arrival handling, or
`ui/commercial.ts`'s preview, each with its own pool — see "The
Commercial panel," below) is the one that actually reads and writes
`SimState.spilloverByMarket`, reset to `{}` at day-rollover alongside
`todayRevenue` and friends, since unclaimed spill doesn't carry into
tomorrow.

One deliberate consequence: the pool is keyed by the same bidirectional
`marketKey()` `dailyDemand()`/`legsServingMarket()` already use, so a
spilled leg in one direction can be recaptured by spare room on the
*return* leg. Not a new inconsistency — the same "a market's demand
doesn't care which way you're flying" simplification this model
already had, just carried through consistently rather than inventing a
new directional distinction nothing else respects.

Verified directly against `flightResult()`: a thin slice fed an
artificial 20-passenger pool topped up to exactly its 14-seat ceiling,
drawing precisely 13 and leaving 7 behind — the boundary math is
exact. A throwaway multi-day script confirmed the pool genuinely
accumulates during real `step()` runs on the fixed headless network
(YOW-YUL and YUL-YYZ built up 850+ pax of unclaimed spill), even though
that network's total cash came back byte-for-byte unchanged — every
leg on every one of its saturated markets turned out to already be
seat-capped in *both* directions, so there was nothing to recapture
into. A legitimate outcome for an oversaturated fixed network, caught
by checking the pool's actual activity rather than trusting the
top-line number alone. Deterministic across repeated 60-day headless
runs.

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

**Competitors** (`data/competitors.json`, week two's "Competition"
layer) started on four markets — three on the busy Ottawa-Montréal-
Toronto triangle (one of which, YYZ-YOW, the player's fleet doesn't even
fly yet) and one on the smaller Québec-Halifax route (fictional airline
names, not real carriers, per CLAUDE.md's public-sources-only rule).
**Static through week three** — fixed schedules and fares, authored
once, never reacting to anything the player did. Week four's competitor
AI (see "Rendering," below, and `sim/competitors.ts`) changed that: the
same three airlines now open new routes on their own over the course of
a game, so this four-market snapshot is a starting point rather than
the whole competitive picture forever. Verified via the headless runner: the two big,
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
   every competitor's markets as "the competitor set." `CompetitorOffering`
   now lives in `sim/competitors.ts` (week four — see below), and this
   file's own `competitorRoutesByAirline`/`allCompetitorMarketKeys` are
   recomputed fresh from `state.competitorRoutes` on every call rather
   than built once at import time, for the same reason `ownRoutesFrom()`
   just above already had to be: a snapshot built once silently stops
   reflecting reality the moment the underlying data can change, and
   since week four it can.
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
a fixed bounding box and clipped to the canvas's own pixel bounds. Widened
in week four (39°N–54°N, 81°W–51°W, up from 42°N–50°N/80°W–51°W) once two
of the nine new airports fell outside the old eastern-Canada-only box —
Goose Bay (53.3°N) north of the old top edge, LaGuardia (40.8°N) south of
the old bottom one. Pan drags `projection.translate()`; scroll zooms
`projection.scale()` toward the cursor, clamped to 0.5×–20× of the fitted
scale.

The accumulator loop (`main.ts`) turns real frame time into whole simulated
minutes (`step()` calls) plus a continuous fractional minute for rendering,
per the pattern in CLAUDE.md's "Time" section.

## The competitor AI (`src/sim/competitors.ts`) — week four

Competitor service was static from week two through week three — fixed
routes and fares in `data/competitors.json`, loaded once, never
touched again; `SimState` had no competitor field at all, and
`sim/choiceModel.ts` read the frozen JSON import directly. Requested
directly: make competitors actually open new routes while a game is
running.

**The data moved.** `CompetitorOffering` (the type) and
`loadCompetitorRoutes()` (a fresh per-game copy, same shape as
`sim/schedule.ts`'s `loadSchedule()`) now live in `sim/competitors.ts`,
not `sim/choiceModel.ts`. Every seed route gets a new
`openedAtMinute` field, stamped with a sentinel
(`PRE_EXISTING_OPENED_AT_MINUTE`, a large finite negative number — not
`-Infinity`, since `JSON.stringify(-Infinity)` produces `null` and
would silently break `SimState`'s JSON-round-trip requirement) so the
render layer's "just opened" flash (below) never mistakes an original
route for news. `SimState.competitorRoutes` holds each game's own
mutable copy — a new required field, another `ui/save.ts` version bump
(v5 → v6).

**The AI itself**, `rollCompetitorRouteOpenings(state, dayStartMinute)`,
runs once a day from `step.ts`'s day-rollover, right alongside
`rollDailyWeather()` — same cadence, same reasoning: this is a day-scale
event, not worth re-checking every minute. The roster (which airline
*names* can act) is derived from whichever airlines already have at
least one route, so this never invents a fourth carrier — only the
three from `data/competitors.json` can expand. Each gets an independent
3%-per-day roll (`nextRandom()`, threading `state.rngSeed` forward, same
determinism rule as every other random model in `sim/`); on a hit, it
picks one of its not-yet-served markets via a demand-weighted random
draw (`dailyDemand()` as the weight, so bigger markets are more likely
targets without it being deterministic about always taking the single
biggest one) and adds a new route at frequency 1, priced at this map's
own `recommendedFare()` — the same default a player's own new route
gets. Verified with a throwaway 120-simulated-day script (`nextRandom()`,
deleted after, not committed): the seed 4 routes grew to 9, each
correctly weighted toward the busiest (golden-triangle) pairs, no
airline ever duplicating a market it already served.

**Wiring this into the choice model was the bigger change.**
`sim/choiceModel.ts`'s `bookingShare()`/`trafficShare()` used to read a
fixed import directly; both now take a `competitorRoutes` parameter
instead, and `sim/economy.ts`'s `flightResult()` gained the same
parameter, threaded down from every caller (`step.ts`'s arrival
handling, `ui/commercial.ts`'s market summary) as `state.competitorRoutes`.
Without this, a newly-opened competitor route would only ever be a
cosmetic line on the map — this is what actually makes it steal real
booking share and market share from the player the moment it opens.
`render/competition.ts` needed the equivalent fix on the drawing side:
its `competitorRoutesByAirline`/`allCompetitorMarketKeys` used to be
built once at import time from the static data (the exact "snapshot
never reflects reality again" bug `ownRoutesFrom()`'s own comment
already documented and fixed for the player's *own* routes back in
week two) — now recomputed fresh from `state.competitorRoutes` on every
call, so the Competition overlay and its hover tooltips pick up an
AI-opened route immediately, no reload needed.

**The map flash.** `CompetitorOffering.openedAtMinute` is a plain
`state` fact, but *when* to actually flash it on screen is a real-time
question, not a sim-time one — a fixed sim-minute window would flicker
past instantly at 20x speed and linger too long at 1x.
`render/competition.ts`'s `drawNewCompetitorRouteFlashes()` tracks
"have I already shown this route's opening" using wall-clock
`performance.now()` timestamps kept entirely in the render layer —
never written to `state`, the same category of transient, UI-owned
bookkeeping as `ui/rotationBoard.ts`'s drag state or this file's own
`latestFractionalMinute` — by diffing `state.competitorRoutes` against
what it's already seen. The very first call just records whatever's
already there (so a fresh page load or a resumed save doesn't flash
every pre-existing route at once); anything that shows up after that is
genuinely new. A newly-discovered route gets a pulsing, fading amber
arc (`#ffd166`, the same "new/highlighted" color already used for
"served by both" in the overlay above) plus a small "Airline opens
X–Y" label, for about 4 real seconds, drawn unconditionally on the map
panel — not gated behind the Competition or Demand overlay toggles,
since a rival opening a route is news worth noticing even if you
weren't specifically looking at the competitive layer. `main.ts`'s
`render()` gained an optional `nowMs` parameter (defaulting to
`performance.now()`, so its many incidental call sites — button
clicks, panel switches — don't need to change) so the main `tick()`
loop can pass through the exact `requestAnimationFrame` timestamp it
already has, rather than the flash animation reading a second, slightly
different clock.

Verified live in the browser (temporarily boosting the daily open
probability to make the test fast, reverted before committing): two
competitor routes opened within seconds of a fresh game starting, each
correctly drawing a pulsing amber arc with a fading label that
disappeared after ~4 seconds; the Competition overlay's route count
jumped immediately to match, with no page reload; the airline filter
dropdown still listed exactly the original three carriers. Zero console
errors, and the headless runner's 30-day balance check still produces
a deterministic (same-seed, same-result) outcome at the real 3%
probability.

## The event ticker (`src/ui/ticker.ts`) — week four

The map flash above only reads as news if you're actually looking at
the map. `ui/ticker.ts` adds a persistent, always-visible strip fixed
to the bottom of the screen (`#ticker`, `pointer-events: none` so it
never blocks a click on whatever's underneath), scrolling the same two
"non-player" event categories — new weather forming, a competitor
opening a route — regardless of which panel is currently showing.
`main.ts`'s `render()` calls `updateTicker(state)` *before* its
`panelView !== 'map'` early return, specifically so an event while
you're deep in the Commercial panel still gets announced.

Deliberately duplicates a small "is this new" diff loop rather than
sharing `render/competition.ts`'s existing one for the map flash: two
independent consumers polling one shared, mutating diff would race
over which one actually claims a new event first the moment both ran
in the same frame. A few duplicated lines per module, each keeping its
own local "seen" state, is simpler than restructuring already-tested
code to hand out events centrally. Both diffs establish their baseline
on the very first call (so a fresh load or resumed save doesn't
announce every pre-existing storm and route at once) and only report
genuinely new appearances after that.

Renders as one continuously-scrolling line (`#ticker-track`), capped at
the last 20 messages. The CSS animation's *duration* is recalculated
in JS every time the queued text changes — `(scrollWidth +
window.innerWidth) / PIXELS_PER_SECOND` — rather than left at a flat
number, so scroll *speed* stays constant whether the queue holds one
message or twenty; a fixed duration would make a short queue zip past
and a long one crawl. Restarting a CSS animation cleanly requires
setting `animation: none`, forcing a reflow (reading `offsetWidth`),
then reapplying it — otherwise the browser just continues whatever
frame the previous animation was already on instead of starting over.

Verified in-browser (competitor probability still boosted from the
flash test above): three "Airline opens X–Y" messages appeared and
scrolled correctly; switching to the Commercial panel at 20x speed
confirmed updates keep happening regardless of `panelView`. A
throwaway 365-day script (deleted after, not committed) confirmed the
weather side of the same diff pattern fires correctly and often —
dozens of winter snowstorm-formation events across the year, matching
the weather model's already-verified seasonal rates. Zero console
errors.

## Panel (`src/ui/panels.ts`)

A real HTML sidebar, 280px wide (canvas width = `window.innerWidth - 280`,
kept in sync via `PANEL_WIDTH_PX`). Shows cash, today's revenue/cost/margin,
a fleet table (tail, type, status, and either the current airport or
`origin → dest (N min)` while airborne — with `, N min late` appended when
`arriveMinute > scheduledArriveMinute`, M9), and the schedule table below.
The econ/fleet parts are rebuilt from `state` every render — a pure read,
same rule as the canvas layers.

## Airport constraints (`src/sim/schedule.ts`) — week four

New alongside the nine new airports: some real airports have a real
runway or gate limit on what can land there, and now this map does
too. `Airport.maxAircraftType` (`data/airports.json`) names the
largest type allowed to operate there — YTZ (Billy Bishop Toronto
City) is capped at `"DH8400"` (its real Dash 8/Q400 restriction), LGA
at `"A220300"`. Every other airport has no field at all and is
unconstrained, same as before this existed.

"Largest" needed a size ordering, and rather than invent a separate
numeric field, `isAircraftTypeAllowedAt(iata, typeCode)` reads it
straight off `data/aircraft-types.json`'s own array order — the
aircraft ladder is already authored smallest-to-largest (see CLAUDE.md
and WEEK-FOUR.md's own aircraft-ladder section), so a type's position
in that array *is* its rank. `typeRank <= maxRank` is the whole check;
an absent constraint or an unrecognized code both fail open (true)
rather than block on a data gap.

Enforced in three places, deliberately mirroring how this codebase
already treats the *other* hard aircraft limit, range:
- **`ui/routeBuilder.ts`** — a route into or out of a too-small airport
  is a flat "no," exactly like the existing range check: `Add Route`
  disables with a plain explanation (`updateFormValidation()`), and the
  confirm handler re-checks defensively before ever touching
  `state.schedule`, the same "belt and suspenders" shape the range
  check already has there.
- **`ui/rotationBoard.ts`** — dragging a leg onto a different-gauge
  tail that violates either endpoint's constraint flags the bar red,
  same "allow the drop, just flag it" treatment the existing range
  check gets there — a drag's commit never blocks on anything, so this
  doesn't either.
- **`validateSchedule()`** — a leg already assigned to a tail whose
  aircraft violates one of its two airports' constraints (however it
  got that way) is a standing warning in the sidebar, not just a
  one-time red flash during a drag someone might not have caught.

Verified directly: `isAircraftTypeAllowedAt()` checked against all five
aircraft types at YTZ and at LGA, plus an unconstrained airport (BOS)
against the biggest type, matched expectations in every case. Live
in-browser: arming a route with an A220-300 selected and confirming
into YTZ produced the exact expected error and a disabled Add Route
button; switching to a DH8400 for the identical route cleared both.

## Route builder (`src/ui/routeBuilder.ts`) — M10, rewritten week seven

Building service is a map gesture, not a form: **pick a plane from the
Fleet panel first**, click an airport to arm it, move the mouse (no need
to hold the button) to draw a live preview arc toward the cursor, and
click a second airport. The preview is a `LineString` run through the same
`d3.geoPath` machinery `render/routes.ts` uses, so it curves exactly like
the real route will, snapping onto the nearest airport once the cursor is
within `HIT_RADIUS_PX`. Escape, re-clicking the armed origin, or clicking
open water all cancel back to idle.

A small state machine (`idle` / `armed` / `confirming`) lives entirely in
this module, not in `SimState` — transient UI interaction, not simulated
state. `main.ts`'s canvas `mousedown` handler gives this module first
refusal on every click, so the pan gesture and the builder never fight
over the same event.

### What gets built is a rotation, not a leg

Week seven's pivot. `BuilderState` carries a `chain: Airport[]` — base
first, last entry being wherever the next leg departs from. **"Add stop"**
appends the pending destination and re-arms from it instead of
confirming, so `YUL-YFC-YQM-YFC-YQM-YUL` is one gesture. Confirm closes
the loop back to the base, which is why there's no "add return leg"
checkbox: a plain out-and-back is just the two-airport chain.

A rotation **must start at the aircraft's `baseAirport`**. Arming
elsewhere is a hard block. An unbased airframe gets based by flying its
first rotation from there, which is the only place other than the Fleet
tab's dropdown where a base is set.

### Packing

`packRotation()` walks the chain giving each leg the cursor's time, then
advancing `cursor += blockMinutes + MIN_TURN_MINUTES`. The player no
longer authors departure times at all — there is no time input.

Start time comes from `rotationStartMinute()`: `USABLE_DAY_START_MINUTE`
(06:00) for a tail with no legs, otherwise its last arrival plus a turn.
Packing every rotation from 06:00 would double-book a tail against itself.
Because every rotation ends at base, appending after the previous one
always chains cleanly.

`packRotationAvoidingCollisions()` then shifts the whole rotation later in
five-minute steps until no leg departs at the exact minute another tail
already flies that market. Auto-packing makes that collision likely rather
than rare — two aircraft at one base both opening at 06:00 on the same
market hit it every time — and there's no time field left for the player
to change, so it's resolved quietly.

### One place decides everything

`planRotation()` produces the popover's text *and* gates the confirm
handler. Range, network reachability, slot capacity and
airport-size-limit are checked across **every** leg of the chain,
including the closing one back to base. Two failures are new:

- The packed chain lands past `USABLE_DAY_END_MINUTE` (22:00). The message
  then reports whether the *base* still has spare capacity — "put this on
  another tail based there" versus "buy another airframe". A separate
  pooled-capacity gate would never fire on its own, since a rotation that
  fits one tail's day always fits its base's pool.
- Only the closing leg being out of range sets `blocksAddStop = false`,
  because that one *is* fixable by adding a nearer stop. Every other
  failure only gets worse with more legs.

The popover's live reading is the pivot's headline: "Uses 23% of an
aircraft — YHZ has 1.00 spare, 0.78 after this."

## Rotations list (`src/ui/panels.ts`) — week seven, phase C

The Gantt rotation board and the per-leg schedule table are both gone. The
Fleet tab lists rotations instead: one row per rotation with its chain
(`YHZ → YQM → YFC → YHZ`), its window, its utilisation share, and a
remove button.

`rotationsForTail()` (in `sim/utilisation.ts`, so it stays testable
without a browser) derives rotations by splitting a tail's departure-
sorted legs wherever one lands at its base. Nothing is stored: a
`Rotation[]` on `SimState` alongside `schedule` would be two
representations of one fact, free to drift.

Removing drops the **whole** rotation. Deleting one leg out of the middle
would strand the rest of it away from base, and the rotation is the unit
the player built. Any market left with no legs at all loses its
`routeSettings` entry and Commercial row too. A flight already airborne is
unaffected — `ActiveFlight` carries its own copied data.

A rotation that never returns to base is flagged red rather than hidden.
That's only reachable by changing a base in the Fleet tab while legs
already exist, which regroups them around the new base — the one remaining
way to break a rotation from outside, and the red flag plus the remove
button are the repair path.

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

Since spill-and-recapture (week four, see "Economy," above), this
market's legs are sorted by depart time first — approximating the same
chronological order `step.ts` actually processes arrivals in — and the
loop threads its own local `previewSpillover` variable through each
`flightResult()` call, not `state.spilloverByMarket`: this is a
hypothetical full-day run-through, not a read of wherever the real,
currently-playing day happens to be.

**Seat-capped vs. demand-capped** is the single most useful thing this
panel adds: a market is seat-capped when its passengers are pinned at
the combined load-factor ceiling of every plane actually serving it
(summed per leg's own aircraft type as of M13/M14, not one type times
frequency — a market split across a 1900D and a Q400 sums 19 and 78
seats' worth of ceiling, not double whichever type happens to be
hardcoded) — there's more demand than the fleet can carry, so raising
fare trades away spare demand nobody could fly anyway (free margin);
anything short of that ceiling is demand-capped (every passenger is
real, so raising fare costs real pax). Previously the only way to know
which case a market was in was to run the headless script and read the
numbers by hand.

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
cancellations. Weather at an airport is one of the three causes
`rollTotalDelayMinutes()` sums (see "The tick," above, for the other
two — age and knock-on): a leg departing from there rolls against
much worse odds (`WEATHER_ON_TIME_PROBABILITY` 0.2, `WEATHER_MAX_DELAY_MINUTES`
90, vs. a fresh age-0 aircraft's baseline 65%/45) via the exact same
bernoulli-then-severity shape the age cause uses, just with harsher
parameters — no new aircraft state needed.

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
a thin wrapper around it, keyed by `airgame-save-v23` at last count —
bumped by hand whenever `SimState`'s shape changes in a breaking way
(most recently week seven phase C removing `positioningLegs`; before that
phase A adding `Aircraft.baseAirport`), so an old save under a
retired key is simply never found again rather than crashing on a field
the current code doesn't expect (bare-bones versioning, not a migration
system).

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
airframes (registration, age, buy price, daily lease price, lead time).
Week three shipped it with one aircraft type; week four added the rest of
the ladder (below), so it now lists two used airframes per type, 12 rows
total, all available from day one. `ageYears` does double duty: it prices
the listing *and* feeds one of `step.ts`'s three delay causes, so an old
airframe is cheap and unreliable rather than cheap for no reason.

The Fleet Market tab lists whatever's left in `state.fleetMarket`.
**Acquisition-only** — no sell-back, no early lease-end, matching
CLAUDE.md's aircraft-trading still being deferred beyond just getting
into a plane.

### Deliveries take time (week eight)

Buying no longer produces an aircraft. It produces a **`PendingDelivery`**
that becomes one after the listing's `leadTimeDays`, resolved by
`resolveDeliveries()` in the same daily rollover that delivers crew.

Before this, a $42M widebody was operational the instant you clicked Buy
while four pilots took ten days to show up — the expensive, irreversible
commitment was the one with no wait attached. It also made `ageYears` a
pure discount: nothing recommended the newer airframe except a delay rate
you couldn't see.

Lead times are authored **against** age on purpose. An old airframe is
cheap *and* quick (14 days for the 21-year 1900D) because it is sitting on
a ramp and its owner wants rid of it; a young one is dear *and* slow (90
days for the 4-year A220) because everyone else wants it too. So the cheap
option wins on price and speed and loses on reliability, which is a real
three-way trade instead of a single dominant answer.

Two money rules worth knowing:

- The **full purchase price is charged at order**, not on arrival. There
  is no deposit schedule, since CLAUDE.md defers financing — and paying up
  front is what makes lead time cost something rather than being a free
  wait.
- A **lease costs nothing until the aircraft arrives**; `leaseCostPerDay`
  rides along on the delivery and only starts being charged once the
  Aircraft record exists.

The listing leaves `state.fleetMarket` at **order** time, not arrival —
it's yours the moment you pay, and that is also what stops the same
airframe being ordered twice while in transit. Inbound aircraft show in
their own section under the fleet (`ui/panels.ts`'s `renderInbound()`),
and `ui/ticker.ts` announces the arrival, since a 90-day order lands long
after the player stopped watching for it.

**No base-airport picker at purchase.** A bought or leased aircraft joins
the fleet with `atAirport: null` and `baseAirport: null` — shown as
"Unassigned" in the Fleet panel's Where column — sitting in a pool rather
than pinned to a city before there's a rotation for it. Confirming its
first rotation places it at that rotation's base and sets `baseAirport`
to match, for free: there's nothing to fly it in *from*. The popover
previews this before confirming: "C-FQAC has no base yet — this rotation
will make YHZ its base." That first rotation is one of two ways a base
gets chosen; the Fleet tab's own Base dropdown is the other.

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

## Reputation, NPS and the quality loop (`src/sim/nps.ts`, `src/sim/reputation.ts`) — week five

Three different things that are easy to confuse:

- **On-Time performance** is a *rate* — on-time departures over all
  departures. It only ever describes flights that actually operated.
- **NPS** is a *score* per flight, derived (this game has no passengers to
  survey) from four things step.ts already knows at the moment a flight
  departs: how late it's going to be, how its fare compares to
  competitors on that market, how old the airframe is, and what share of
  cabin crew hold recurrent service training. Bounded to [-100, 100].
- **Reputation** is a *stock*. Neither of the above accumulates, so
  neither can be spent. Reputation is what they feed, and it's the
  currency the tech tree, the C-suite and service targets all draw on.

`applyDailyReputationChange()` runs once per day at rollover, reading
*yesterday's* figures before they're reset. Three terms: on-time against
an 80% baseline, completion factor against 98%, and average NPS. All
three are scaled by a confidence factor for small samples — with two
departures a day, "today's on-time %" can only be 0%, 50% or 100%, and
reacting to that at full strength swung Reputation wildly for a
one-plane operation.

**Reputation is floored at zero.** Below roughly 78% on-time the daily
delta is negative, and without a floor a struggling airline banked an
ever-deepening deficit that even an excellent recovery took months to
climb out of — locking it out of the very tools that would help. A
mediocre airline still accrues nothing; it just doesn't go backwards.

---

## Loans and the failure state (`src/sim/loans.ts`) — week five

Cash hitting zero offers a $100,000 loan, up to 20 outstanding. Interest
compounds onto each loan's *balance* daily rather than being charged to
Cash, so ignoring a loan costs nothing today and progressively more later.

Two ways to lose. Either every loan slot is taken and Cash is still gone,
or **Cash falls past `CASH_FLOOR`** — the total credit line negated,
-$2,000,000. That floor exists because declining a loan used to be free:
the offer stopped reappearing until Cash went positive (which for a
failing airline is never), so the loan count stayed at zero, insolvency
never fired, and Cash fell without limit. Declining was strictly better
than accepting.

---

## Fuel prices (`src/sim/fuel.ts`) — week six

`fuelPriceIndex` is unitless, 1.0 being baseline, moved once a day by a
mean-reverting random walk: a ±1.5% step pulled back toward baseline by
2% of however far it has drifted, clamped to [0.5, 2.0]. The reversion is
the point — a pure random walk would be unguessable, but a price far from
baseline is more likely than not heading back, so watching the 60-day
history in the Executive tab is a real if noisy signal.

`legCostBreakdown()` splits each type's flat `costPerBlockHour` into
slices rather than touching the hand-authored data: 35% fuel-sensitive,
30% carved out for crew (see below), the rest bundled maintenance and
overhead. The index multiplies the fuel slice, and
`fuelEfficiencyMultiplier` multiplies on top of that — the hook the tech
tree turns down.

---

## Market stimulation (`src/sim/marketDemand.ts`) — week six

Demand became **two numbers**. `potentialDailyDemand()` (the gravity
model) is the ceiling a market could reach; `state.marketDemand` is what
actually flies today. A market nobody serves sits at a virgin floor of
about 10 passengers regardless of how big it could get.

This exists because the old model handed every market its full gravity
demand from day one, so the map opened as a field of large, uncontested,
instantly-profitable routes and route choice collapsed into "pick the
biggest number." The balance sweep found the symptom: fare had **no
optimum at all** — the trunk markets stayed seat-capped even at 5× the
recommended fare, so raising price cost literally no passengers.

Growth is driven by `seatsOffered / potential`, which is what makes size
matter: one daily 19-seater saturates a 9-PDEW market and is a rounding
error against a 4,600-PDEW one. Marketing spend multiplies that rate.
Unserved markets decay back toward the floor, more slowly than they grow.

Actual demand is a property of the **market**, not of any airline —
everyone flying it grows it, everyone serving it draws from the same
pool. Stimulation is a public good.

---

## Fare policy (`src/sim/pricing.ts`) — week six

One airline-wide multiplier on `recommendedFare()` prices the whole
network. Per-market override stays available, and
`RouteSettings.fareIsOverridden` marks those so a policy change sweeps
everything except the routes deliberately priced differently.

This replaced twenty identical slider-drags. Per-market pricing was busy
work that got *worse* the larger your network grew, which is backwards.
It doesn't remove the static optimum — competitors would have to react to
price for that — but you now find it once instead of per route.

---

## Airports: presence, connectivity and slots (`src/sim/airports.ts`) — week six

Three things keyed off how many daily departures you operate at a field:

- **Level** — Unserved / Outstation / Focus city / Base / Hub.
- **Connectivity multiplier** on revenue, growing with concentration,
  capped at 1.25. This is a deliberate stand-in for connecting
  itineraries, which aren't modelled: it gives the *benefit* of a hub
  without tracking passengers through one. A flight earns the average of
  its two ends, not the product.
- **Slots**, but only at LGA and YYZ — the two fields on this map that
  really are slot-coordinated. Every departure needs one, prices escalate
  40% per slot held, and the route builder blocks departures with nowhere
  to put them.

Presence is read off the **map**, not a table: dot radius grows with
departures, Base and Hub get a halo, controlled fields get a ring that
turns red when departures exceed slots held.

---

## Crew (`src/sim/crew.ts`) — week six

Pools of headcount, never named individuals — a real roster means duty
times, rest rules and pairing, which is a second scheduling problem
beside the one this project just deleted.

Three disciplines, deliberately modelled differently:

- **Pilots** are a *threshold* and tiered (light turboprop / regional /
  mainline jet), because type ratings are the real progression gate.
  Below complement, the aircraft doesn't fly.
- **Cabin crew** are a threshold too but untiered, at one per fifty seats
  — a real FAA and Transport Canada standard.
- **Mechanics** are a *continuum*: shared capacity, no hard cliff.
  Running thin makes airframes behave older than they are, feeding the
  existing age-delay cause.

Hiring is **bulk** with a 10-day lead time — that gap is the mechanic.
Buy an aircraft before you have crew and it sits idle; hire ahead and you
pay idle salaries. Training moves pilots up a tier over 21 days, and
takes cabin crew off the line for 7, raising NPS once they're back.
Recurrent training **lapses** over roughly 180 days.

**Standing orders (week eight)** are the alternative to clicking batches:
set a rate per role — `perMonth` — and `runStandingOrders()` hires toward
the fleet's target every day until it's met, then stops. There is
deliberately no target input; the stop condition is `crewRequirement()`'s
own target (operating need times reserve depth), which bounds the order to
the fleet you actually own and makes it self-resume when the fleet grows.
Counting is against *projected* headcount (pool + in transit + due back
from training), or the ten-day lead time would have it re-order the same
people daily. It runs after payroll, skips days it can't afford a head,
and caps its fractional carry at one month so a pause can't bank a
backlog.

**Reserve depth** is the player's lever: 1.0 is exactly enough crew with
no slack, 1.4 is 40% more. Each day a disruption fraction is drawn and
reserve depth absorbs it. Cost is linear in depth; protection is a
threshold — which is what gives it a real interior optimum rather than an
obvious best setting.

Crew salaries were **carved out of** `costPerBlockHour`, not added on
top. That figure always bundled crew in, so adding salaries would have
double-charged.

---

## Cancellations (`src/sim/step.ts`, `src/sim/weather.ts`, `src/sim/crew.ts`) — week six

The second axis of reliability. On-Time only describes flights that
operated; **Completion Factor** is `completed / scheduled`.

Three causes, each with a different answer available:

- **Crew shortage** — answered by reserve depth.
- **Unscheduled maintenance** (AOG) — a daily per-aircraft roll scaling
  with *effective* age, so answered by maintenance staffing and younger
  metal.
- **Severe weather** — an airport closes outright. No answer at all,
  which is why it's kept rare.

A cancellation scores a flat **-80 NPS** rather than extending the delay
curve, which floors at -50: a cancellation isn't a very late flight, it's
a different failure. NPS therefore divides by its own denominator
(departures *plus* cancellations), while On-Time keeps departures.

---

## The tech tree (`src/sim/techTree.ts`) — week six

Reputation's first spender. One branch so far — fuel efficiency — with
five linear tiers themed on real aviation milestones, each multiplying
`fuelEfficiencyMultiplier` down 4–6%. All five compound to roughly a 23%
cut in fuel-sensitive cost.

Data and conditions are split the same way missions are: the JSON holds
the authored parts, the code holds the rules. A node needs its branch's
previous tier and enough Reputation; unlocking is a one-time payment for
a permanent effect.

---

## Missions and targets (`src/sim/missions.ts`, `src/sim/targets.ts`) — week six

The answer to "what should I be striving for," which is the complaint
that started weeks five and six.

**Missions** are authored: `data/missions.json` holds name, objective,
flavour and reward; `MISSION_CONDITIONS` holds the predicates, because a
condition over `SimState` can't go in JSON without inventing a query
language. Checked every tick so completion is immediate, and announced in
the ticker.

**Targets** are the player's half. You commit to an on-time percentage
and average NPS; the promise runs 30 days against its own scoped
counters. Reward scales with ambition above an 80% / 0 NPS baseline, and
**missing costs half what hitting pays** — without a downside the
dominant play is to promise the maximum every time, so staking Reputation
is what makes the choice real. Windows with under 20 departures expire
unjudged.

---

## The C-suite (`src/sim/executives.ts`) — week six

Four slots — CEO, COO, CFO, CCO — bought with **Reputation**, which makes
it a second real spender and puts the whole C-suite out of reach until
the airline has been good at something. Two of the four convert
Reputation back into cash.

Each attaches to a system that already existed rather than a stat
invented for them: the COO's three backgrounds hit the delay roll, the
NPS scorer and the maintenance age factor respectively; the CCO
subsidises the marketing *charge* (the spend still counts in full); the
CEO and CFO pay escalating bonuses. Escalation resets when an incumbent
is replaced — seniority belongs to the person, not the chair.

Effects are placeholders pending real numbers.

---

## The balance sweep (`src/headless/sweep.ts`) — week six

`npm run sweep -- <lever> [days]` runs the headless network repeatedly,
changing one lever per run, and reports revenue, cost and margin per day
plus where margin peaks. `run.ts` answers "how does one configuration
do"; this answers "does moving this number help, and where does it stop
helping," which is the question balance decisions actually turn on.

**Every row uses the same RNG seed.** Different seeds would mean
different weather, competitor openings and fuel history per row, so the
differences would be mostly noise. This guarantee is fragile: it also
requires the *number* of random draws per day to be constant, which was
broken once by a roll that skipped already-grounded aircraft. See
`rollDailyMechanicalGroundings()`.

It has found real problems — fare having no optimum, marketing returning
0.00x on nearly every market — that no amount of reading the code would
have surfaced.

---

## The Dev tab (`src/ui/devTools.ts`) — week six

A development tool, and deliberately *not* a hand-drawn diagram of the
model: every leaf reads a real number out of `state`, so it can't drift
out of date the way documentation describing the same formulas would.

Three parts: a live cost tree (the categories are guaranteed to sum to
`todayCost`), a revenue funnel showing where passengers are lost
(potential → actual → booked → carried → recaptured → flown), and
histograms of the delay distributions **sampled from the real functions**
40,000 times rather than described. Seeing the squaring skew is much
easier than reading about it.

---

## What isn't built yet

Not duplicated from WEEK-ONE.md's "Deliberately deferred" list, which
would just go stale — but the big ones as of week seven:

- **Connecting itineraries.** Still the heaviest structural lift on any
  list. The connectivity multiplier (Airports, above) is a deliberate
  stand-in for the benefit without the machinery.
- **Competitor price response.** Competitors open routes but never react
  to what you charge, which is why pricing still has a findable static
  optimum. Gated by CLAUDE.md until asked for directly.
- **Selling or returning aircraft.** Acquisition-only.
- **Ancillary revenue** (bag fees), designed twice and never built.
- **More tech tree branches** — fuel efficiency is the only one.
- **Phase D of the utilisation pivot**: Commercial becomes a Routes tab
  carrying aggregated route data, with fare policy at the top of it. See
  WEEK-SEVEN.md.
- **Tab grouping**, 11 down to about 6. Proposed but never started.

One open *balance* question rather than a missing feature: margin
currently favours under-staffing. On the reference network it peaks at
reserve depth 1.05 (77.7% completion) rather than 1.25 (99.9%), because
cancelling marginal flights saves more variable cost than it loses in
revenue. Completion factor and Reputation still order correctly, and
Reputation gates the tech tree and C-suite, so reliability pays in ways
the sweep can't see — but raw margin points the wrong way.
