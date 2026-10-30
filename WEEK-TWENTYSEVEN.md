# airgame — Week twenty-seven (globe spike)

Handoff document. Origin: the "Plan game design improvements" thread, the
rebuild plan's phase 1 and the S2 "lifted arcs" look book the owner picked
on 29 October 2026.

**Status:** a spike on its own branch. It is not merged to main; it exists
to be played on a preview URL and judged.

## Decisions (from the owner)

- Build phase 1 of the rebuild plan: today's game state drawn on a three.js
  globe, planes and arcs only, at a preview URL, in the S2 look.
- This one spike may use WebGL and the `three` package. CLAUDE.md's
  "Canvas 2D, not WebGL" rule still holds on main until the owner decides
  on the rebuild.

## Defaults picked

- The globe is a second view of the same game, opened with `?globe=1`. The
  2D map, the sim and saves are unchanged; the globe only reads `state`.
- `three` loads only in globe view (a dynamic import), so the normal game's
  bundle does not grow.
- Earth layers: NASA Blue Marble day colour and Black Marble city lights
  (public domain, taken from the `three-globe` package's examples), a
  water mask drawn from our own Natural Earth land, and procedural clouds.
  `npm run globetextures` rebuilds them.
- The sun is where the 2D terminator puts it, so night falls on the globe
  at the same time it does on the map.
- Arcs rise with distance and cast a shadow on the ground; width is seats a
  day (render/routeWidth.ts), colour is the route's on-time week.
- Drag turns the globe, pinch or wheel zooms. No taps, rings or panels on
  the globe in this spike.

## What to judge on the preview

Frame rate and warmth on the owner's iPhone over 15 minutes at 20x, memory
(does Safari reload the tab), and whether watching the network on the globe
is more fun than on the 2D map.

## Not built

Tapping airports or planes, the route builder, lenses, fog of war, labels
beyond airport codes, and any of the rebuild plan's later phases.
