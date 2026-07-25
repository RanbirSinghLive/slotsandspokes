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
  `name`, `lat`/`lon`, and `utcOffsetMinutes` (winter/standard time, fixed,
  not DST-aware). Coordinates verified against OurAirports.
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

`blockMinutes` here is `arriveMinute - departMinute` on the actual
`ActiveFlight` — since M9, that includes any rolled delay, so a delayed
flight genuinely costs more (more block hours burned) with no separate
code path needed. `revenue` is unaffected (pax count doesn't depend on
delay), so this is also why the economy no longer produces the same
margin every day — see Headless runner, below.

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
   Since M9, a flight running late (`arriveMinute > scheduledArriveMinute`)
   is tinted red instead of the usual yellow — the point being to make a
   cascading delay watchable on the map itself, not just readable as text.
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

Editing is departure time only for now — reassigning a leg's origin,
destination, or tail (which would also mean recomputing `blockMinutes` and
touching `render/routes.ts`'s route list) is out of scope for this pass.

**Column filters:** a second header row holds one text input per column
(Tail/Route/Depart). `applyScheduleFilters()` re-checks all three on every
keystroke in any of them — case-insensitive substring match, ANDed across
fields — and just toggles each row's `display`, not a rebuild, so it can't
interfere with the "build once" rule above. Depart matches against the
row's live `<input type="time">` value rather than text content, since
that cell holds an input, not a text node; editing a row's time re-applies
the filters too, in case the new value no longer matches. `main.ts`'s M10
route builder calls the exported `filterScheduleToRoute(origin, dest)`
right after adding a leg, clearing the Tail/Depart filters (so a stale one
can't hide the row just created) and setting the Route filter to that
leg's exact text — the table narrows to just the route you touched instead
of the new row landing wherever it lands among a dozen others.

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
