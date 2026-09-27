# airgame — CLAUDE.md

Conventions and architecture for airgame. Read this before writing code.

Keep this file short. It loads into context every session, so bloat here costs
tokens on every single task. It holds rules, not history: how a mechanic works
goes in HOW-IT-WORKS.md, and why it changed goes in the commit message.

---

## What this project is

airgame is a browser-based airline network simulator. The player picks a home
city from 185 airports (densest in eastern Canada and the US, with
Europe's main cities and world hubs beyond), starts with one leased propeller, and grows an airline
against rival carriers. The core loop is: draw routes on the map → watch the
days run → read the P&L → adjust.

The map is not decoration. The player must be able to learn things by looking
at it that a table would not tell them — chiefly how a delay on one sector
cascades through the rest of that aircraft's day.

**The game's philosophy.** The player wins by finding small advantages and
exploiting them before competition arbitrages them away: an underserved
city, passengers nobody is carrying, a fare gap, a slot, a well-placed
connection. Every edge is temporary by default, and profit is a signal
rivals read. Durable advantages (moats) exist but take a long time to build:
control of a hub's slots and connections, a network whose reach no
single-route rival can match. So sitting on profit should erode, growth
should pay but not at any cost, and a mechanic that hands out a permanent
edge cheaply is a bug. Judge every new mechanic against this.

Not in scope unless asked: passenger simulation at the individual level,
daylight saving, and per-base time zones (see `sim/clock.ts`).
**The current plan is the newest `WEEK-*.md`. Don't build a system it doesn't
name. If a request pulls one in, say so and stop.**

---

## Stack

- TypeScript, Vite, no framework
- `d3-geo` for projection, geodesic paths, and the day/night terminator
- `topojson-client` for the basemap
- Canvas 2D for the map. **Not WebGL.**
- Plain HTML/CSS for all panels and controls

No React, no Vue, no game engine, no state management library. If a task seems
to need one, say so and stop rather than adding it.

---

## The architectural rule

**The simulation never touches the DOM, the canvas, or `window`.**

Everything under `src/sim/` must run in Node with no browser present. This is
what makes the headless runner possible, and the headless runner is how the
economy gets tuned.

1. `step(state)` advances the world by one simulated minute, mutating `state`
   in place. It is deterministic: randomness comes only from the seeded PRNG
   in `state.rngSeed` (`sim/rng.ts`); never `Math.random()`, `Date.now()` or
   the clock. A seed is always passed in from outside the sim.
2. Rendering is a pure read of `state`. Renderers never write to it.
3. `state` survives `JSON.parse(JSON.stringify(state))` unchanged: no class
   instances, `Map`, `Set`, functions or cycles *in state*. (A `Map` as a
   local variable or a module-level lookup over `data/` is fine.) This is
   what saves are. When `SimState`'s shape changes incompatibly, bump
   `SAVE_KEY` in `ui/save.ts`.
4. **Game rules live in `src/sim/`, even when only the UI calls them.** If
   code decides whether something is *allowed* or *what it costs*, it belongs
   in the sim, and the UI calls it and then refreshes the page. Example:
   `sim/rotations.ts` plans and commits routes, and `ui/routeBuilder.ts` is
   only the gesture and the popover.

All four are checked in practice: two runs from the same seed match exactly,
and so does a save reloaded mid-game.

## The headless runner

`npm run headless`, `sweep` and `balance` start a game **the same way the
browser does**: `startHeadlessGame()` in `src/headless/newGame.ts` calls
`createNewGameState()` and then `chooseHome()`. Then a headless player
(`src/headless/player.ts`) plays it, once a day, only through the route
planner and the actions in `sim/playerActions.ts` that the page uses. Never hand-build a schedule or starting state for balance work.
If a new mechanic needs a player decision to work, give the headless player a
policy for it; otherwise balance numbers describe a different game.

---

## Layout

```
data/          hand-authored or script-generated JSON (see Data below)
src/main.ts    wires everything together, owns the rAF loop
src/sim/       the simulation: state.ts (types, new-game factory), step.ts
               (the one-minute tick), and one module per mechanic
src/render/    canvas drawing; projection.ts owns the one projection
src/ui/        DOM panels, tooltips, menus, save/load
src/headless/  Node entry points: run, sweep, lease, and the data builders
```

Find a mechanic's module by name (`crews.ts`, `slots.ts`, `competitors.ts`…)
rather than keeping a file list here.

---

## Time

Every time in the simulation is an **integer `simMinute`: minutes since the
start of day 0, UTC.** No `Date` objects in `src/sim/`; a `Date` appears only
in display formatting.

The airline's *day* runs on the home airport's local clock (`sim/clock.ts`):
the schedule's `departMinute`, the 06:00–22:00 usable day, the curfew and the
midnight rollover are all home-local. Ask `sim/clock.ts` for "what time of day
is it", and never compute `simMinute % 1440` directly. Each airport has one
fixed `utcOffsetMinutes`.

The loop in `main.ts` runs `step()` from an accumulator at
`MS_PER_SIM_MINUTE = 125` (1× ≈ three real minutes per day). The speeds are
1×, 20× and 100×, and real time fed per frame is capped at 250 ms. Aircraft
positions are computed from fractional time
(`t = (now - departure) / blockMinutes`), not tweened.

---

## Geography

- Projection: `d3.geoMercator()`, one shared instance in `render/projection.ts`.
  Nothing else constructs a projection.
- Routes are GeoJSON `LineString`s drawn through `d3.geoPath`, so they follow
  the geodesic. Never draw straight lines between screen points.
- Aircraft position: `d3.geoInterpolate(origin, destination)(t)`; heading from
  sampling at `t` and `t + 0.001`.
- Block time: `20 + (distanceNm / cruiseKts) * 60`, rounded, stored on the leg.
- Fog of war (`sim/reach.ts`): only airports in `state.knownAirports` are
  drawn or clickable. Renderers and hit-testing read the list handed over by
  `setKnownAirports()`, so what is clickable always matches what is drawn.

---

## Panels

Canvas renders the map. **Everything else is real DOM** — real `<table>`,
`<button>`, `<input>` — positioned over or beside the canvas with CSS. Never
draw a control inside the canvas. Saves go in `localStorage`.

---

## Data

Public sources only: OurAirports for coordinates, Natural Earth for the
basemap and water, GeoNames for population (checked against StatsCan
census metros), and published type
specs for aircraft. Some files are **generated** (`npm run airports`,
`lakes`, `rivers`, `homes`; scripts in `src/headless/build*.ts`). To change a generated
file, change its script and re-run it. Never hand-edit its output. No
database, server or API.

---

## Docs

- **HOW-IT-WORKS.md**: how each mechanic works *now*. Update it in the same
  commit as a change to a mechanic.
- **WEEK-*.md**: milestone handoffs. The newest one is the current plan;
  older ones are history and are not updated.

---

## Working practices

- **Commit whenever something works.** Small commits, present-tense messages.
  Stage only your own files.
- **When something breaks, revert rather than patching over it.** `git
  checkout` the last good state and try a different approach.
- **One vertical slice per session, always ending in something runnable.**
  `npm run build` and `npm run headless` both pass before a commit.
- **Parallel sessions work in their own git worktree**, never in the same
  working tree at once.
- **Explain as you go, in the chat.** The owner is learning to program through
  this project. Prefer obvious code over clever code and name things fully.
  When introducing an unfamiliar concept, explain it in two or three
  sentences in your reply.
- **Comments say why the code is the way it is now.** No history in comments
  ("week four:", "used to…", "phase C removed…"): that goes in the commit
  message. Delete stale history comments when you touch the code around them.
- **Say when a request is a bad idea.** If a request pulls in a dependency,
  breaks the sim/render boundary, or isn't in the current plan, push back
  instead of complying.

## Do not

- Add a framework or state library
- Reach for WebGL
- Import anything into `src/sim/` that touches the DOM
- Put game rules in `src/ui/`
- Use real-world proprietary or internal airline data
- Start a system the current WEEK plan doesn't name
