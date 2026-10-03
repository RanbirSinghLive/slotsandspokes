# airgame — Week fifteen (the whole world, and a start worth choosing)

Handoff document. Week fourteen (every seat a decision: market character,
fare classes and the learned revenue hill, cabins, low fares growing
markets, brand, seat sales, fare wars, crew sickness, maintenance checks,
seasons, demand events, seasonal leases) lives in `WEEK-FOURTEEN.md`.

**State at handoff:** save key `slotsandspokes-save`, save format 2.
185 airports, densest in eastern Canada and the US, with Europe's main
cities and a few world hubs. Every game starts on 1 January 2027, the
year's quietest stretch. A new game opens on a home picker over the
game map. The quick balance read (`npm run quick`, 4 homes × 10 seeds)
has a saved reference from after week fourteen's stage 4; stage 5 is
below it (Montréal $2.1M against $11.0M).

**Status:** a plan for the owner to review. Nothing below is built.

---

## The idea, in one paragraph

The first minute of the game should feel like choosing a campaign: a
world to look across, cities that each say why they're worth playing,
and a season to start in, the summer an easy one and the winter a test.
That needs a world worth roaming (the map today stops at the North
Atlantic's edges), a calendar that starts where the player chooses, and
a picker screen that tells each home's story. The world also has to
stay fast as it grows: today the map is redrawn whole every frame, and
every one of the 17,000 city pairs is walked every midnight.

---

## Stages

| Stage | What | What it feels like |
|---|---|---|
| **0. Make room** | The map draws only what changed; midnight walks only the markets that move | A big airline still runs smoothly at 100× |
| **1. The world** | A respectable spread of airports on every continent, with their character, rivals and home ratings | Somewhere worth flying everywhere you look |
| **2. A start worth choosing** | Summer (1 May) or winter (1 November) start; winter harder | The first choice is a real one |
| **3. The picker** | A flat world map, a roving cursor lighting up homes, each home's story at the bottom | Choosing a home like choosing a nation in a strategy game |

### Stage 0: make room

1. **The map draws only what changed.** Today `render()` repaints the
   basemap, every route and every airport each frame, so a 17-plane
   airline draws at about 30 frames a second even paused. The fix: draw
   what moves (aircraft, weather, the now line) every frame, and redraw
   the rest (basemap, water, routes, airport dots) to a cached layer only
   when it changes: a pan or zoom, a route added or removed, a mode
   switch. Paused with nothing hovered, draw nothing new.
2. **Midnight walks only the markets that move.** `rollDailyMarketDemand()`
   visits every pair in `MARKET_PAIR_TABLE` (185 airports, about 17,000
   pairs). At 500 airports that's about 125,000 pairs a night. Only
   pairs someone flies, or that are still decaying back to their floor,
   need visiting; the rest sit at their floor by definition.
3. **Measure before and after**, in the browser at 100× on a big test
   airline (the method in WEEK-FOURTEEN.md's speed check), and on the
   midnight step in Node.

### Stage 1: the world

1. **More airports, from the script.** `src/headless/buildAirports.ts`
   fills out only the US and Canada (`FILL_COUNTRIES`). Widen it: the
   main hubs of every region first (a `FILL_HUBS` list per region), then
   the same one-airport-per-metro fill by catchment, with a per-region
   count so no region swamps the map. A first target, for the owner to
   adjust: about 500 airports in all, adding roughly 120 in Europe, 80
   in Asia, 40 in Latin America and the Caribbean, 30 in the Middle East
   and Africa, and 20 in Oceania. Rebuild with `npm run airports`, never
   by hand.
2. **Their character.** `data/airport-character.json` (business, leisure,
   VFR, 0–2) for each new airport that is notable, hand-authored from
   public knowledge, as week fourteen's were. Unlisted airports read as
   ordinary.
3. **Rivals there.** `data/competitors.json` and `rival-airlines.json`
   have seven invented North-Atlantic rivals. New regions need their
   own invented carriers (no real airline names or data), seeded on the
   region's busiest markets, so a home in Singapore or São Paulo isn't
   empty of competition.
4. **Seasons for the southern hemisphere.** Seasons are northern only.
   With Sydney, Johannesburg or Buenos Aires on the map, a southern
   market's leisure and VFR peaks move six months (sim/seasons.ts),
   and a route crossing the equator takes its mix of both.
5. **Home ratings.** `npm run homes` rates every pickable home's
   difficulty (a long run: it plays every home). Which airports are
   pickable is a decision below.

### Stage 2: a start worth choosing

1. **The choice:** summer, starting 1 May, or winter, starting
   1 November, picked on the new-game screen before the home. Winter is
   marked harder. The difficulty is the calendar itself: a November
   start runs straight into the holiday business low, the January
   leisure trough and the snowstorm season, with a one-plane airline;
   a May start grows into July.
2. **One start day of the year, everywhere.** The game's day 0 becomes
   the chosen date: the clock's calendar (main.ts), the weather's
   seasonal windows (sim/weather.ts), the seasons (sim/seasons.ts) and
   the year one report all count the year from `state.startDayOfYear`.
   An old save, which has none, reads as 1 January and plays on as it
   was.
3. **Balance, after this stage:** a quick read with summer starts as the
   new reference, and one with winter starts to see how much harder it
   plays. The headless runner starts summer by default.

### Stage 3: the picker

1. **A flat world map** for choosing: the whole world in one view,
   styled flatter than the game map (no relief, muted land, the
   pickable homes as bright dots and the rest of the network as faint
   ones).
2. **A roving cursor.** The cursor snaps to the nearest pickable home
   as it moves, lifting it with its name, its rating and its region's
   airports around it.
3. **Each home's story**, along the bottom of the screen: a short
   paragraph on what made the airport matter in the real world (its
   history as a hub, its geography, who flies it) and what makes it
   worth playing here (its catchment, its market character, its rivals,
   its rating). Written for every pickable home, from public knowledge,
   in `data/home-stories.json`, for the owner to correct.
4. **Then the season choice and start**, as in stage 2.

---

## Decisions for the owner

1. **How many airports, and which homes are pickable.** About 500 in
   all is the first target. Pickable homes: every airport (the picker
   gets crowded), or a curated list of about 60, two or three per
   region, each with a story? Recommended: the curated list.
2. **The picker's map and the one-projection rule.** CLAUDE.md says one
   shared projection (Mercator, render/projection.ts) and nothing else
   constructs one. A "flatter" picker could either (a) use the same
   Mercator at a world zoom with a flat style (keeps the rule), or (b)
   use an equirectangular world map for the picker only (needs the rule
   changed for that one screen). Recommended: (a), unless the owner
   wants (b)'s look.
3. **Southern-hemisphere seasons** in stage 1, or left northern-only for
   now?
4. **Winter's difficulty:** the calendar alone (recommended), or more on
   top (less starting cash, a harder rival)?
5. **The stories:** written by Claude from public knowledge for the
   owner to edit, one paragraph each.

---

## Carried from week fourteen

- **Night stops**, reverted: a redesign needs a forecast that sees the
  curfew and positioning, and mustn't push a plane's other flying later.
- **Montréal's slide** since stage 3, inside the noise at each step.
- **Thin homes:** Halifax busts most years.
- **Booking curves** (fare classes stand in with a booking order).
- **Week thirteen's carried list:** the browser pass before alpha;
  mobile as good as desktop; colour-blind red/green; a changelog; a `?`
  shortcuts card; the other well-known rival codes; a rebasing plane
  drawn at its old base; innovation prerequisites between innovations.
- **The airport tags** (week fourteen's decision 1), for the owner to
  correct; the new airports' tags join them.
