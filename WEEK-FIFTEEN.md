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

**Status:** decided with the owner; stages 0–2 built, stage 3's first pass built.

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

**Stage 0 built:**
- **The map:** the fog and the basemap are drawn to cached layers,
  rebuilt only when the view, the size, the reach or the airports opened
  up change. On a 17-plane, 82-leg test airline, the fog alone had taken
  17.7 ms of a 23.9 ms frame; the map now draws at 60 frames a second,
  paused and at 100×.
- **Midnight:** the market pass visits only pairs that can move (9.0 ms
  to 0.9 ms a night). Rival route openings search pairs by airport
  instead of every pair on the map. Midnight is 27 ms on the test
  airline (30 before); what's left scales with the airline and its
  rivals, not the map. Both changes play exactly the same game (the
  headless year is unchanged to the cent).

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

**Stage 1, steps 1–4 built:**
- **480 airports** from the regional fill-out, North America unchanged.
  Istanbul's second airport is left out, so it doesn't take the city
  from IST. North Korea is left out. Fill-out names read as people say
  them ("Nagoya", not "Tokoname").
- **Character tags** for 187 notable new airports.
- **Eight invented incumbents**, one or two per new region, on its
  busiest markets, and eight more names in the entrant pool. Rival entry
  and the home rival now search pairs by airport.
- **Southern-hemisphere seasons:** seasonal bumps six months on south of
  the equator, holidays on their dates. Sydney–Melbourne peaks +16% in
  January and dips −7% in July.
- **The browser** draws all of it at under 4 ms a frame.
- **One-seed headless years** from Montréal: $1.8M before, $38.3M with
  the world open, then just bust with the new rivals (their draws change
  the path). The quick read after the ratings will say more.
- **Home ratings:** 404 homes rated (169 before): 240 Standard, 54 Hard,
  110 Brutal. The big world hubs mostly rate Standard; islands and thin
  homes stay Brutal. Most homes rated before got easier with more places
  to fly (Rome, Naples, Stockholm, Málaga, Omaha Brutal to Standard).
- **Quick read with the world open** (against the stage 4 reference):
  Montréal $18.2M, 1/10 bust (was $11.0M, 3/10); Toronto $55.3M (was
  $33.4M); Philadelphia $69.7M (was $68.7M); Halifax 7/10 bust (was 9/10).
  The read now takes about 11 minutes (6 before), probably the headless player's
  planning searches more airports.

### Stage 2: a start worth choosing

1. **The choice:** summer, starting 1 May, or winter, starting
   1 November, picked on the new-game screen. Whether winter is marked
   harder is decided by the quick reads below (decision 4).
2. **One start day of the year, everywhere.** The game's day 0 becomes
   the chosen date: the clock's calendar (main.ts), the weather's
   seasonal windows (sim/weather.ts), the seasons (sim/seasons.ts) and
   the year one report all count the year from `state.startDayOfYear`.
   An old save, which has none, reads as 1 January and plays on as it
   was.
3. **Balance, after this stage:** a quick read with summer starts as the
   new reference, and one with winter starts, to see whether and how
   much harder it plays. The headless runner starts summer by default.

**Stage 2, steps 1–2 built:**
- **The choice:** "Start · Summer · 1 May | Winter · 1 Nov" above the
  home list, summer lit unless changed.
- **One start day:** `state.startDayOfYear` (sim/clock.ts) feeds the
  seasons, the weather, the terminator and every date on the page. Every
  year is 365 days. An old save reads as 1 January (the owner's Toronto
  game still says Jan 25, 2027).
- **Headless:** games start in summer; `npm run quick -- --winter` plays
  winter starts.
- **Weather by hemisphere** (the owner's call): southern storm seasons
  six months on, and no snow nearer the equator than 30° north or 40°
  south (none in Singapore, Miami or Sydney; some in Christchurch).
- **The two quick reads** (against the stage 4 reference, after the
  weather fix):

  | Home | Summer start | Winter start |
  |---|---|---|
  | YUL | $16.0M, 2/10 bust | $3.8M, 1/10 bust |
  | YYZ | $48.5M, 1/10 bust | $54.8M, 0/10 bust |
  | PHL | $74.1M, 0/10 bust | $92.5M, 0/10 bust |
  | YHZ | −$2k, 7/10 bust | $44k, 5/10 bust |

  Winter doesn't play harder: fewer busts (6 against 10), and the
  medians split both ways within the read's noise. Per decision 4, the
  picker offers the two as different openings, not easy and hard. The
  summer read is the new reference.

### Stage 3: the picker

**Stage 3 built (first pass):**
- **The world map** with 61 featured homes, the roving cursor, the
  story panel, the start date with a note per hemisphere, Start, and
  "Select a different airport" (the old list, with "Back to the map").
- **The stories** were drafted by a Sonnet helper from the data and
  public knowledge, then checked: every rival named matches
  `data/competitors.json`; three real-world facts corrected (Montréal is
  Canada's third-busiest airport; Mumbai's crossing runways; Dublin's
  preclearance). The rest is for the owner to edit.
- **Thin regions:** Sydney, Melbourne, Johannesburg, Buenos Aires,
  Santiago, Lima, Cape Town, Bangkok, Jakarta and Manila can't be homes:
  each has fewer than three airports within a propeller's 380 nm.
  Oceania's only featured home is Brisbane.

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
4. **"Select a different airport"** opens today's full list of homes,
   for any airport that isn't featured.
5. **Then the season choice and start**, as in stage 2.

---

## Decided with the owner (2026-10-02)

1. **About 500 airports; about 60 featured homes**, two or three per
   region, each with a story. A "Select a different airport" button
   opens today's full list, so any airport can still be home, as a
   strategy game lets you pick a nation off the featured list.
2. **The picker's map is the game's Mercator** at world zoom with a flat
   style: one projection, as CLAUDE.md says.
3. **Southern-hemisphere seasons** are in stage 1.
4. **Winter's difficulty is measured, not assumed.** On demand alone a
   1 November start isn't plainly harder: it opens in the quietest month
   for leisure and the holiday business low, but reaches the Christmas
   VFR and leisure peak within about seven weeks, while a 1 May start
   climbs steadily into July. What clearly differs is the weather:
   snowstorms close airports through the winter, which means
   cancellations, NPS and slower market growth when the airline has one
   plane and no slack. Stage 2 ends with a quick read for each start. If
   winter plays harder, the picker says so and why ("stormy first
   months"); if not, the two are offered as different openings, not easy
   and hard.
5. **The stories** are written by Claude from public knowledge for the
   owner to edit.

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
