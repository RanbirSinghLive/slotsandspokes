# airgame — CLAUDE.md

Conventions and architecture for airgame. Read this before writing code.

Keep this file short. It loads into context every session, so bloat here costs
tokens on every single task. If something is only relevant to one feature, put
it in a comment in that file, not here.

---

## What this project is

airgame is a browser-based airline network simulator. The player owns a small regional
carrier in eastern Canada, sets a daily flight schedule, and watches aircraft
fly it in compressed time on a map. The core loop is: adjust the schedule →
watch the day run → read the P&L → adjust again.

The map is not decoration. The player must be able to learn things by looking
at it that a table would not tell them — chiefly how a delay on one sector
cascades through the rest of that aircraft's day.

Not a goal: realism for its own sake, global scale, aircraft trading,
financing, passenger simulation at the individual level.

---

## Stack

- TypeScript, Vite, no framework
- `d3-geo` for projection, geodesic paths, and the day/night terminator
- `topojson-client` for the basemap
- Canvas 2D for the map. **Not WebGL.** Peak load is well under 100 moving
  sprites; Canvas handles that with room to spare.
- Plain HTML/CSS for all panels and controls

No React, no Vue, no game engine, no state management library. If a task seems
to need one, say so and stop rather than adding it.

---

## The one architectural rule

**The simulation never touches the DOM, the canvas, or `window`.**

Everything under `src/sim/` must be runnable in Node with no browser present.
This is not stylistic. It is what makes the headless balance runner possible,
and the headless runner is how this project's economy gets tuned. If a
simulation function needs to draw something, log something to the page, or read
a slider value, the design is wrong — pass the value in as an argument instead.

Three consequences:

1. `step(state)` advances the world by one simulated minute. It returns
   nothing and mutates `state` in place. It must be deterministic: same state
   in, same state out, every time. No `Math.random()` without a seeded PRNG
   passed through state, no `Date.now()`, no reading the clock.
2. Rendering is a pure read of `state`. Renderers never write to it.
3. `state` must survive `JSON.parse(JSON.stringify(state))` unchanged. No class
   instances, no `Map`, no `Set`, no functions, no circular references. This
   gives us save/load for free.

---

## Layout

```
index.html
CLAUDE.md
WEEK-ONE.md
data/
  airports.json          10 airports, coords from OurAirports
  aircraft-types.json    performance and cost parameters
  schedule.json          the daily repeating schedule
  world-110m.json        Natural Earth basemap, TopoJSON
src/
  main.ts                wires everything together, owns the rAF loop
  sim/
    state.ts             types and the initial state factory
    step.ts              the one-minute tick
    geo.ts               great circle distance, bearing, interpolation
    economy.ts           revenue and cost per flight
  render/
    projection.ts        shared projection instance, pan and zoom
    basemap.ts           coastlines and borders
    routes.ts            geodesic route arcs
    aircraft.ts          plane sprites
    terminator.ts        day/night shading
  ui/
    panels.ts            DOM sidebars
  headless/
    run.ts               runs N days with no browser, writes CSV
```

---

## Time

Every time value in the simulation is **an integer count of minutes since the
start of day 0, in UTC.** Call it `simMinute`. There are no `Date` objects
anywhere in `src/sim/`.

Local time exists only for display. Each airport carries a fixed
`utcOffsetMinutes`. Daylight saving is deliberately out of scope — do not add
it without being asked.

Time compression: one simulated day takes about three minutes of real time,
which works out to 125 ms of wall clock per simulated minute. The loop in
`main.ts` uses an accumulator:

```ts
const MS_PER_SIM_MINUTE = 125;

accumulator += deltaMs * speedMultiplier;
while (accumulator >= MS_PER_SIM_MINUTE) {
  step(state);
  accumulator -= MS_PER_SIM_MINUTE;
}
render(state);
```

Aircraft positions are **not** interpolated between ticks. Compute position
directly from continuous fractional time:
`t = (nowFractionalMinutes - departureMinute) / blockMinutes`. This is simpler
than tween state and it stays smooth at any speed multiplier.

---

## Geography

- Projection: `d3.geoMercator()`, one shared instance in `render/projection.ts`.
  Nothing else may construct a projection.
- Route arcs: build a GeoJSON `LineString` and render it through `d3.geoPath`.
  It interpolates along the geodesic automatically, which is what produces the
  curved route-map look. Do not draw straight lines between screen coordinates.
- Aircraft position: `d3.geoInterpolate(origin, destination)(t)`.
- Sprite heading: sample the interpolator at `t` and `t + 0.001` and take the
  bearing between the two points.
- Block time estimate:
  `blockMinutes = TAXI_ALLOWANCE + (distanceNm / cruiseKts) * 60`, with
  `TAXI_ALLOWANCE = 20`. Round to the nearest minute and store it on the
  schedule entry rather than recomputing every tick.

---

## Panels

Canvas renders the map. **Everything else is real DOM** — real `<table>`, real
`<button>`, real `<input>`, positioned over or beside the canvas with CSS.

Never draw a control inside the canvas. Hand-rolled canvas widgets lose
scrolling, text selection, keyboard input, focus handling and accessibility,
and reimplementing those badly will eat more time than the rest of the project
combined. The schedule editor in particular is just a table.

`localStorage` is available here (this is a normal Vite app, not a sandboxed
artifact) and is the right place for saves.

---

## Working practices

- **Commit whenever something works.** Small commits, present-tense messages.
  This is the single most important habit in the repo.
- **When something breaks, revert rather than patching over it.** A stack of
  speculative fixes on top of broken code is unrecoverable. `git checkout` the
  last good state and try a different approach.
- **One vertical slice per session, always ending in something runnable.** Never
  leave the repo in a state where `npm run dev` shows a blank screen.
- **Explain code as you write it.** The owner of this repo is learning to
  program through this project. Prefer obvious code over clever code, name
  things fully, and when introducing an unfamiliar concept, say what it is and
  why it is the right tool in two or three sentences.
- **Say when a request is a bad idea.** Scope creep is the main risk to this
  project. If a request pulls in a dependency, breaks the sim/render boundary,
  or belongs three milestones later, push back instead of complying.
- Data files are hand-authored JSON for now. No database, no server, no API.

## Do not

- Add a framework or state library
- Reach for WebGL
- Import anything into `src/sim/` that touches the DOM
- Use real-world proprietary or internal airline data. Public sources only:
  OurAirports for coordinates, Natural Earth for the basemap, published type
  specs for aircraft performance.
- Build the aircraft market, financing, maintenance planning, crew rostering,
  competitor AI, or airport slot systems until explicitly asked
