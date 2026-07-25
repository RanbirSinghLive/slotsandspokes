# How airgame works

A running reference for the mechanics as they actually exist right now — as
opposed to CLAUDE.md (conventions for writing new code) or WEEK-ONE.md (the
original milestone plan, now a historical record). This file should get a
short update whenever a milestone changes how something works; if it drifts
out of sync with the code, the code is right and this needs fixing, not the
other way around.

Status: M1–M6 complete (scaffold through economy/panel). Phase 2 M7
(headless runner) done — see "Headless runner" below. M8 (schedule editor)
and M9 (turn times/delays) not started, though the seeded PRNG that M9 will
need already exists (see "Randomness" below).

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
  `name`, `lat`/`lon`, and `utcOffsetMinutes` (winter/standard time, fixed,
  not DST-aware). Coordinates verified against OurAirports.
- **`aircraft-types.json`** — one type right now: the Dash 8-400 (`DH4`),
  78 seats, 360kt cruise, `costPerBlockHour` and `costPerDeparture` for the
  economy model below. Multiple types are explicitly deferred.
- **`schedule.json`** — the daily-repeating schedule: 12 legs across 3 tails
  (`C-GVIA`, `C-FATL`, `C-GMAR`), each a hand-authored rotation that returns
  to its own overnight base by end of day. Each entry has `legId`, `tail`,
  `origin`, `dest`, `departMinute` (minute-of-day) — `blockMinutes` is *not*
  stored here, it's computed at load time (see below).

## The simulation state (`src/sim/state.ts`)

`SimState` is the entire truth of where the world is — plain data, no class
instances, no `Map`/`Set`, no functions, and it survives
`JSON.parse(JSON.stringify(state))` unchanged (that's what makes save/load
"free" whenever it gets built, and what makes the headless runner and
in-browser sim behave identically).

```
simMinute        — current time, see above
cash             — running total, persists across days
aircraft[]       — { tail, typeCode, status: 'ground'|'airborne', atAirport, activeLegId }
activeFlights[]  — { legId, tail, origin, dest, departMinute, arriveMinute }
completedToday[] — legIds finished since the last day rollover
todayRevenue/Cost/Margin — reset to 0 at day rollover; cash is not reset
rngSeed          — seeded RNG state (see Randomness) — not consumed yet
```

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
2. **Depart** — any scheduled leg whose `departMinute` matches
   `simMinute % 1440`, flown by an aircraft that's on the ground at the
   right airport, takes off: the aircraft flips to `airborne` and an
   `ActiveFlight` is created with `blockMinutes` (computed once at schedule
   load time from great-circle distance ÷ cruise speed, in
   `sim/schedule.ts`) added to the absolute departure minute.
3. **Arrive** — any `ActiveFlight` whose `arriveMinute` has been reached
   lands: the aircraft flips back to `ground` at the destination, and
   `sim/economy.ts`'s `flightResult()` is applied (see Economy below).

## Economy (`src/sim/economy.ts`)

Deliberately crude, per WEEK-ONE.md — the same for every leg regardless of
route or day:

```
LOAD_FACTOR = 0.75      AVG_FARE = 185
pax     = round(seats * LOAD_FACTOR)
revenue = pax * AVG_FARE
cost    = (blockMinutes / 60) * costPerBlockHour + costPerDeparture
margin  = revenue - cost
```

Applied on **arrival**, not departure — a flight in the air hasn't earned or
spent anything yet. `margin` is added to `state.cash`; `revenue`/`cost`/
`margin` are each added to the day's running totals.

## Headless runner (`src/headless/run.ts`)

`npm run headless` (optionally `-- 30` for a shorter run than the 365-day
default) imports `createInitialState`/`step` directly and calls `step()` in
a plain loop — no canvas, no `requestAnimationFrame`, no waiting for real
time to pass. It writes one CSV row per day (`headless-output.csv`, git-
ignored — it's a report, not source) with that day's cash, revenue, cost,
margin, and legs flown, reading `state.todayRevenue` etc. right after the
day's last minute is processed but before the next day's first minute would
reset them (see the note on reset timing under "The tick" above).

Running the full year today shows margin is *exactly* $84,423 on every one
of the 365 days — expected, since nothing in the sim varies day to day yet
(no delays, no seasonality), but worth having actually confirmed rather
than assumed, which is the entire point of this milestone per WEEK-ONE.md.

## Rendering (`src/render/`, plus `main.ts`'s loop)

Canvas draws the map; everything else (clock, speed buttons, sidebar) is
real DOM, per CLAUDE.md's rule against hand-rolled canvas widgets. Draw
order each frame, back to front:

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
5. `airports.ts` — a dot + IATA label per airport.

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
and a fleet table (tail, type, status, and either the current airport or
`origin → dest (N min)` while airborne). Rebuilt from `state` every render —
a pure read, same rule as the canvas layers.

## Randomness (`src/sim/rng.ts`)

A seeded PRNG (mulberry32) exists and `state.rngSeed` carries its entire
internal state, but nothing calls it yet. This is groundwork for M9 (turn
times and delay propagation) — the seed lives in `state`, not a module-level
variable, specifically so a delay roll stays reproducible: same state in,
same state out, and a saved/reloaded or headlessly-rerun game produces the
identical sequence of "random" delays.

## What isn't built yet

See WEEK-ONE.md's "Then, in order" (schedule editor, turn times/delay
propagation — headless runner is now done, above) and "Deliberately
deferred" (aircraft market, financing, maintenance, crew, competitor AI,
multiple aircraft types, save/load, and more) — not duplicated here since
it would just go stale twice.
