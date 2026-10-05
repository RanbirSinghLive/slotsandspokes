# airgame — Week eighteen (the map you can read and watch)

Handoff document. Week seventeen (the first minute) lives in
`WEEK-SEVENTEEN.md`.

**Status:** render and UI work only, from a review of the whole game (a
Boston save at day 75, Toronto at day 120). No new sim rule changes state.
The balance read doesn't apply except to confirm it is unchanged.

---

## The idea

After the route-label overlap fix the map is readable at the network level
but still crowded at the hub, and its planes, disruptions and operating
pressure are small or only in the side panel. This week adds operating
detail to the map behind one switch, **Ops view** (bottom left, key O,
remembered between visits, `render/opsView.ts`), so the plain map never
changes unless asked.

## Slices

All but the basemap draw only when `isOpsView()` is true.

1. **Hub core clean-up.** Airport labels and the "on its way" badges claim
   space first and route labels avoid them; the hub dot grows with departures
   a day; spoke labels thin out at a busy hub.
2. **Route width by volume.** Width scaled by seats a day, under Network and
   Profit.
3. **Planes worth watching.** Larger at close zoom, a short trail, a delayed
   halo, tail label when zoomed in.
4. **Disruption layer.** A grounded plane's pin with days back at its
   airport; cancelled legs dashed.
5. **Fare-gap tick and airport chips.** ▲/▼/≈ against the going rate on a
   route label; a chip for crews short or slots full on an airport.
6. **Basemap at city zoom.** Finer coastline as you zoom, lakes and rivers,
   softer ocean edge. Always on: it is graphics, not operating detail.
7. **"What's holding you back" line.** A read-only function in `src/sim/`
   naming the next bottleneck, shown in the alert strip in Ops view.

## Queued, not started: airport sprites

A spec for later. Nothing here is built; start it when the owner says so.

### The idea

Zoom into an airport and watch its runway work: planes land, roll out,
park, and later taxi out and take off, at the minutes the schedule says,
late when they are late. Home first, then hubs, then any airport the airline
serves. Later the airport grows buildings you upgrade, and planes visit a
hangar.

### Verdict: fits, with three limits

Steps 1 to 3 fit this architecture and need **no sim change and no save
change**. Everything a sprite needs is already in `state`: an
`ActiveFlight` has `departMinute` and `arriveMinute` with the delay already
rolled at departure, plus `scheduledDepartMinute`/`scheduledArriveMinute`; an
`Aircraft` on the ground has `atAirport` and `groundSinceMinute`; the
schedule has the next departure. Sprites are a pure read, like planes today
(`render/aircraft.ts`). The three limits:

1. **Sim time is slow to watch at speed.** One sim minute is 125 ms at 1x.
   A landing roll is about a minute, so it reads at 1x, is a blink at 20x
   and invisible at 100x. Sprites are for 1x and 20x; above that the airport
   shows a plain count (see Speed below). This is the main limit and no
   engineering removes it.
2. **The sim has no runway capacity.** Two flights can depart the same
   minute. The sprite can show them lined up (a queue at the hold line, at
   most 3 minutes of visual shift, never changing the sim) or on parallel
   runways. It must never imply the sim enforces separation, because it does
   not. A real runway limit would be a new sim rule and a balance change,
   which is out of scope here.
3. **Steps 4 and 5 need new state.** Upgradeable buildings need an airport
   facility level in `state` (optional field, read with `??`, per CLAUDE.md),
   and a rule for what each level costs and does, which is a game design
   decision (see the philosophy in CLAUDE.md: it must not hand out a
   permanent edge cheaply). Hangar visits need the Mtc bay work already in
   flight (hangar bays, line-only bases). Do those after that lands; do not
   design them here.

Too ambitious? Steps 1 to 3 are not. They are one new render module and a
small pure helper. Steps 4 and 5 are the ambitious part and are gated on
decisions, not on engineering.

### What it looks like

- A stylised runway, **not the real one**: a grey strip with a dashed
  centreline, drawn at a fixed pixel length (about 90 px at the threshold
  zoom, growing with zoom to a cap of about 220 px), centred on the airport
  dot. Never real runway data (no public runway layout in `data/`, and CLAUDE.md
  limits data to the listed public sources).
- **Runway heading**: the bearing of the airport's busiest route, so
  arrivals come in roughly straight, falling back to a stable value derived
  from the IATA code when there are no routes. Parallel runways share that
  heading. Computed in the render helper, never stored.
- **Runway count by demand size** (`airportDemandSize`, the same Tiny to Huge
  words the game already shows): Tiny 1, Small 1, Medium 2, Large 3,
  Huge 4. Parallel strips sit side by side, with arrivals on the outer
  strips and departures on the inner one when there are three or more, and
  mixed use when there are two. The airline never shows more strips than
  its own peak need: a Huge airport the airline flies one flight a day from
  still shows one working strip and the rest dimmed.
- **Arrival**: for the last 6 minutes of an `ActiveFlight` (position from
  `t = (now - departMinute) / blockMinutes`, as today), the plane lines up
  on the runway heading, descends in size slightly, touches down, rolls out
  over 1 minute, and exits to a stand beside the strip. The existing
  route-layer plane fades out inside the sprite radius so there is never
  two of the same plane.
- **Departure**: an aircraft on the ground whose next leg is due and whose
  turn is done (`groundSinceMinute + MIN_TURN_MINUTES` or the route's turn
  buffer) waits at the hold line, rolls for 1 minute from `departMinute`, and
  lifts into the route layer's plane.
- **Delays are visible.** A plane held past its scheduled departure waits
  at the hold line in the late colour (`AIRCRAFT_FILL_LATE`); a late arrival
  shows the same halo as `aircraftOps.ts`. Hover gives the tail and minutes
  late, reusing the plane tooltip. No new text on the map.
- Stands: grounded planes sit as small parked icons beside the strip,
  grouped by type like the Mtc tab, so the later hangar step has a place to
  take them from.

### Rules for the build

- **Where it lives:** `src/render/airportSprites.ts` draws;
  `src/sim/airportMovements.ts` is a pure function
  `movementsAt(state, iata, nowFractionalMinute)` returning
  `{ arrivals, departures, parked }` with each plane's phase and 0 to 1
  progress. It reads `state` only, runs in Node, and gets a headless test
  that it matches `activeFlights` exactly. Shape helpers (runway heading,
  strip count) go in the same sim file so the headless runner can check them.
- **Gate:** the **Ops lens** (`isOpsView()`), like the other operating detail
  (PR #28). Plain Network and Profit lenses never show sprites.
- **Zoom gate:** show a runway only when zoom is at least **6** of the 20
  maximum and the airport is inside the viewport; full detail (parked
  planes, tail labels) at 10 or more. Zoom out below 6 and the sprites are
  gone with no fade cost, the plain map returns. First task of step 1:
  confirm by eye that 6 puts a hub's neighbour airports clear of the
  runway, and adjust the number in the spec if not.
- **Speed:** sprites animate at 1x and 20x. At 100x the runway stays drawn
  but shows no moving planes, only a tally of movements today. At 20x
  movements are drawn as short fixed-length hops rather than true 1 minute
  rolls so each plane is visible for at least 150 ms.
- **Redraw budget (PR #29):** sprites add no draw cost while paused: the
  paused 250 ms refresh and input-driven redraw stay exactly as they are,
  because nothing moves. While running, planes already force a frame, so
  sprites add draw work, not frames. Keep it cheap: cull airports outside the
  viewport and below the zoom gate first (usually 0 to 3 airports pass), draw
  each strip as one cached `Path2D`, and keep the 30 fps phone cap. If a
  phone run drops below 30 fps in Chromium with phone emulation and CPU
  throttling, move sprites to their own canvas above the map so the basemap
  is not repainted. Do this only if measured, not by default.
- **Hit-testing:** `findFlightAt` and airport hit-testing must still win
  over sprites. Sprites are hoverable only for their own tail tooltip and
  never block a click on the airport.
- **Midnight rollover hitch at 100x** (still open) is unaffected: sprites
  show nothing moving at that speed and add no sim work.
- **Save and sim determinism:** unchanged. `SAVE_FORMAT` does not move.
- **Docs:** add a short "airport sprites" section to HOW-IT-WORKS.md in the
  same commit as step 1.

### Steps

1. **Home runway.** `movementsAt`, the strip, arrivals and departures at the
   home airport only, 1 runway for Tiny and Small, parallel strips for
   larger sizes, delays shown, zoom and lens gated, speed behaviour as
   above. Check in Chromium on a saved game and at phone size, click every
   hover and every lens switch.
2. **Hubs.** The same drawing for every airport the airline has made a hub
   (`sim/hubs.ts`). No new rules; a hub earns a bigger parked-planes area.
3. **Active spokes.** Any airport with a flight in the last day. The viewport
   and zoom cull is what keeps this cheap, so there is no list of airports to
   maintain.
4. **Buildings (needs a design decision first).** Facility levels per
   airport (terminal, ramp, hangar), drawn beside the strip and growing as
   they are upgraded. Needs a state field, costs, and a check against the
   "no permanent edge cheaply" rule before any code.
5. **Hangars (after the Mtc bay slices land).** A plane going into a bay
   drives into the hangar sprite, uses the Mtc tab's look (bays, check-due
   axes, grouped by type), and comes out on its first departure.

### Not in this spec

Real runway layouts, taxiways and gates, runway capacity as a sim rule,
weather on the runway, ground crew, and sound.

## Not in this week

- Late-game spending, sound, a day summary card, and early-game balance:
  each needs a decision first.
