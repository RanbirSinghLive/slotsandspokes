# airgame — Week nine (edges and moats)

Handoff document. Week eight (growth as a pipeline, the North American
fill-out, fare stances, the side panel and the headless player) lives in
`WEEK-EIGHT.md`. Read this one first.

**State at handoff:** save key `airgame-save-v46`. Week eight's headless
player and `npm run balance` give every balance change a measured
before and after (baseline below). Route views now show a route's share
of slot fees and leases. **Thread 1, thread 2's slice 1 and thread
3's slices 1–2 are done, and so are thread 6 (Europe) and thread 2
(all three slices). Thread 3 is done (all five slices). Next in
order: thread 4 (shocks).**

---

## The idea, in one paragraph

The player wins by finding **small advantages and exploiting them before
competition arbitrages them away**: an underserved city, passengers
nobody is carrying, a fare gap, a slot, a well-placed connection. Every
edge is temporary by default, and profit is a signal rivals read.
**Moats** exist but take a long time to build: control of a hub's slots
and connections, a network whose reach no single-route rival can match.
So sitting on profit should erode, growth should pay but not at any
cost, and anything that hands out a permanent edge cheaply is a bug.
(The same rule is in CLAUDE.md, where every session reads it.)

## Why now: what the baseline says

`npm run balance` (six homes × six seeds, a year each):

- **The unattended start is harsh**: the starter player busts in 23 of
  36 games, including every game from Philadelphia, Halifax and London.
- **Careful play is far too rich**: the steady player busts once in 36,
  and turns $500k into $13M–$90M in a year. Planes pay for themselves
  within days.
- **Nothing pushes back but congestion.** An airline that stops at five
  planes prints money forever. Rivals arrive on a timer (every 20 days
  from day 15) at markets weighted by size, not by how much you're
  making there. So a fat margin is never punished, and a thin one gets
  the same visits.
- **The market's numbers are fully visible.** The route form, tooltips
  and route view print potential and current demand to the passenger,
  so choosing a route is sorting a list, not a judgement.

---

## Decisions (settled with the owner)

1. **The nudge is pressure from the world, not a checklist.** A goal
   ladder gives sessions a shape, but it can't be what punishes
   sitting: goals pull, and a player who ignores them still gets rich.
   The market moving under the player is the push; goals come after it.
2. **Profit attracts entry.** Rivals go where the player earns most and
   turns passengers away, and stay away from markets the player serves
   well and prices fairly. This is the arbitrage in the idea above.
3. **Moats are real but slow.** Holding a hub's slots and feeding it
   with connections should deter entry. It should take long enough that
   no one gets there in the first month.
4. **Market size is shown in words, not numbers**, and an airport's
   hunger for service speeds up how fast a new route builds there.
5. **Balance targets are set per headless persona** (below) and checked
   with `npm run balance` before and after every thread.
6. **Five market sizes** (Tiny to Huge), not three.
7. **Sitting erodes slowly.** Today's shape is kept: from YUL a sitter's
   margin falls from about $50k a day in month two to $7–15k by month
   five, then holds. Tuning should not make it faster.
8. **Moats protect partly.** They discount what rivals see and raise
   what it costs them to come; they never make a market untouchable.
9. **Slots are rationed to the peak, for everyone** (the owner's option
   2). An airport gives slots for as many movements a day as keep its
   busiest hours within capacity (`slotCapacityPerDay()`: daily capacity
   over the hub style's peak factor), first come first served.

   Why: rationing only the whole day let rivals keep buying into a
   player's congested hub. From YUL (steady, seed 1) by day 240 rivals
   had 164 of 222 movements, the player had cut itself to 58, and
   congestion delayed 60% of flights by up to 75 minutes. Rationed to
   the peak, YUL fills at 156 of 157 (78 each) with delays of 34% up to
   54 minutes.

   Measured (six seeds): steady medians rose sharply (YUL $45.0M →
   $66.4M, YYZ $65.7M → $90.7M, BOS $46.2M → $58.2M, PHL $70.1M →
   $77.4M, YHZ $7.5M → $11.5M, LHR $87.1M → $103.8M); sitters a little
   ($13–18M → $14–18M). Growing beats sitting by 4.5–8×.

   Two consequences:
   - **The game is rich again.** The structure is right (sitting erodes,
     moats pay), but the amounts are back near where thread 3 started.
     The next balance step is the level of costs and lease rates, not
     the rules.
   - **The report now takes 30 minutes** (bigger airlines are slower to
     simulate). Worth a performance pass before more tuning.

### Explicitly out of scope

- Per-passenger demand (CLAUDE.md).
- Rival airlines as full simulated airlines with their own schedules.
  They keep today's frequency-and-fare model; only where and when they
  go changes.
- Stock prices, a board or shareholders. The pressure comes from the
  market, not from a boss.
- Anything that stops a player from sitting outright (a forced loss).
  Sitting should erode, slowly, and the player should see why.

---

## Thread 1: the measuring stick (headless personas)

**Status: done.** `headless/player.ts` has `sitter` and `reckless`, and
`npm run balance` runs all four players (144 games, about 8 minutes).

**Today's game, measured** (day 365, seeds 1–6):

| Persona | Busts | Median year-end cash, by home |
|---|---|---|
| starter | 23/36 | YYZ $4.1M, BOS $1.0M, YUL $629k; PHL, YHZ and LHR all bust |
| steady | 1/36 | $15M (YHZ) to $91M (YUL) |
| sitter | 1/36 | $6.8M (YHZ) to $17.6M (YUL); planes 4.3–4.8 |
| reckless | 36/36, day 10–51 | bust everywhere |

What it says:
- **Sitting is never punished.** From YUL the sitter's margin peaks at
  about $79k a day around day 90, dips to $46k as rivals arrive, then
  settles at about $60k a day for the rest of the year. Five planes and
  no effort make $7–18M. This is the gap thread 3 exists to close.
- **Growth at any cost is already punished, and hard.** Every reckless
  game busts within two months. The lessor lets it lease faster than new
  routes build demand, and it never cuts. So thread 4 (shocks) isn't
  needed to stop reckless growth; its job is narrower: to punish a
  steady player caught with a thin cushion. The reckless target below
  should be read as "busts", not "busts a third of the time", unless the
  owner wants a gentler reckless player to aim at.
- Halifax's one steady bust and one sitter bust are the same seed: the
  sitter hadn't reached five planes yet, so it was still playing steady.

Two more players in `headless/player.ts`, so the targets below can be
checked rather than argued:

- **sitter**: plays steady until it has 5 planes, then only harvests:
  it keeps slack and cuts losers but never leases, opens or adds.
- **reckless**: leases whenever the lessor allows, fills every plane to
  22:00, never cuts, and ignores congestion and slot fees.

`npm run balance` runs all four. **Targets, to be confirmed after thread
1 measures today's game:**

| Persona | Target over a year |
|---|---|
| starter | busts outside the core, as now |
| sitter | profitable early, then a slow decline from about month four |
| reckless | busts in about a third of games; the rest do well |
| steady | grows every quarter, but its cash curve bends rather than going vertical; median year-end cash well below today's $68M |

Slices:
1. The sitter and reckless players, and `balance` printing all four.
   Record today's numbers here. Expected: the sitter does fine, which
   is the problem stated.

---

## Thread 2: reading a market (size in words, hunger for service)

**The idea.** Before you fly a route you know roughly how big the city
pair is and whether it's being served. You learn the rest by flying it:
how full your planes are and how many you turn away.

- **Size in words.** A market's potential shows as one of five sizes on
  a log scale (Tiny, Small, Medium, Large, Huge), wherever a potential
  number shows today: the route form's PDEW line, the draw-a-route
  tooltip, the route view's "(4745 potential)", the Airports list's
  Waiting column. Current demand ("59 passengers wanted") goes too.
  What you've **observed on your own flights** stays in numbers:
  passengers carried, load factor, passengers turned away. Those are
  facts about your airline, not about the market.
- **Hunger for service** (per airport). Seats offered there by everyone
  against the airport's size. A starved airport is one far more people
  want to fly from than anyone flies. It's shown in words
  ("Underserved: new routes grow fast"; "Well served: slow to build")
  on the airport view, and hinted on the map.
- **The quicker ramp.** A new route's demand growth (`STIMULATION_RATE`
  × `serviceSaturation()` × …, `sim/marketDemand.ts`) gets a multiplier
  from how starved its two airports are, up to about 3×. Opening
  somewhere starved is a real edge, and it wears off as the airport
  gets served, by you or by rivals, which is the idea in miniature.

**Slice 1 as built:** `sim/serviceLevel.ts` works out each airport's
hunger every morning (seats from every airline against its potential),
and `rollDailyMarketDemand()` multiplies a market's growth by
1 + 2 × the average hunger of its ends. `dailySeatsByMarket()` moved
there from `marketDemand.ts`. The airport view says "Starved for
service", "Underserved" or "Well served", with what it means for a new
route.

- **The benchmark had to be reachable.** The gravity model's potential
  dwarfs any airline here: LaGuardia at day 120 had 1,000 seats against
  496,000 potential riders. There are no incumbent airlines, so at the
  start every airport is starved. At a first benchmark of 0.02 seats per
  potential rider almost nothing ever counted as served, and the boost
  was a flat 3× everywhere, which goes against the idea. At 0.005 an
  airport flown hard becomes well served (the steady player's home, then
  Toronto and O'Hare by day 120), while places nobody flies stay starved.
  On the owner's LaGuardia save: Toronto well served, LaGuardia and
  Washington National underserved, Boston starved.
- **Measured** (six seeds, day 365):

  | Persona | Before | After |
  |---|---|---|
  | starter busts | 23/36 | 15/36 (YUL and BOS never; LHR 4/6; YHZ 5/6; PHL 6/6) |
  | steady median | $15M–$91M | $44M–$86M |
  | sitter median | $7M–$18M | $14M–$21M |
  | reckless | 36/36 bust | 36/36 bust, a little later |

  The early game is kinder, as intended. The rich mid-game got richer,
  since the boost only makes starting faster. Wearing profit down is
  thread 3's job.
- The presence line above it can read "Unserved · 0 departures/day"
  (meaning *you* don't fly there) next to "Well served" (meaning
  someone does). Worth rewording in slice 2.

Slices:
1. **Hunger for service in the sim, and the faster ramp.** (Done.)
   `sim/serviceLevel.ts`: seats by all airlines per airport against its
   potential, and the ramp multiplier in `rollDailyMarketDemand()`.
   The airport view says it in words. Measured with `balance`: the
   starter should survive more often; the steady player's early months
   get quicker.
2. **Sizes in words everywhere.** (Done.) `sim/marketSize.ts`: five sizes
   for a city pair (potential under 40, 150, 600, 3,000 riders a day, or
   more) and five for an airport's riders waiting (under 3k, 8k, 20k,
   60k), from the map's spread; and how full a flight would be, in
   words. The numbers left the draw-a-route tooltip and form, the route
   view, the ring's Add flight hint, the airport view and the Airports
   list (sorted by size, not the hidden number). Passengers turned away,
   the fare slider's day and the hub planner's connecting passengers stay
   numbers: they're about the player's own flights. "Unserved" became
   "Not in your network", which no longer clashes with "Well served".
   Five sizes, not the owner's three, as drafted; still an open question.
3. **The map hint.** (Done.) With the Demand layer on, a faint dashed
   teal ring round each airport at least a quarter starved, stronger the
   hungrier. Only with that layer: at the start almost everything is
   starved, so always on it would be noise. Cached against seats, rivals
   and the day, not worked out per frame. The Demand layer's own lines
   dominate at full-map zoom, so the rings read best zoomed in.

---

## Thread 3: profit attracts entry (and moats deter it)

**The idea.** Rivals read the same signals the player does. Where the
player earns a fat margin and turns passengers away, a rival is coming.
Where the player flies most of the seats, holds the slots, and feeds a
hub's connections, entry is expensive, and rivals mostly go elsewhere.

- **Entry follows profit.** Today a new rival arrives on a timer and
  picks a market weighted by size (`competitors.ts`,
  `RIVAL_TARGETS_PLAYER`). Instead, each market gets an
  **attractiveness**: its fully costed margin per seat
  (`sim/routeCosts.ts`), how many passengers are turned away, and how
  far the fare is above the going rate. The chance a rival enters
  somewhere grows with the network's total attractiveness, so a
  harvesting airline draws visitors and a lean one doesn't.
- **Deterrence (moats).** Attractiveness is discounted by:
  - **frequency dominance**: the player's share of the market's
    flights (a rival entering against eight daily flights with one
    gets little);
  - **slot control**: at a congested airport where the player holds
    most slots, a rival can't get in cheaply. This needs rivals to pay
    for slots, which they don't today;
  - **the hub's network**: markets feeding a hub's connections are worth
    more to the player than to a one-route entrant.

  All three take months to build, so they're moats in the sense of the
  idea above.
- **The erosion is visible.** The ticker says why a rival came
  ("Skyline enters YUL–LGA: you're turning away 40 a day at $380"). The
  route view shows a market's attractiveness as a warning before anyone
  enters.

**Slice 1 as built:** `sim/attractiveness.ts`'s `moneyOnTable()`: the
passengers a market turns away (up to one rival flight each way) at the
going fare, plus half its last-week margin after slot fees and leases.
`rollRivalEntry()` weights the player's markets by it, and skips player
markets with nothing on the table. `PLAYER_MARKET_WEIGHT` is gone.

- **It lands where the money is.** From YUL (seed 2), the sitter's
  entrants hit Montréal–Philadelphia ($32.6k a day on the table) and
  Montréal–Boston ($31k). The sitter's fat routes carry $30k+ a day on
  the table each.
- **The effect is small, as expected**: at most 5 new airlines a game.
  Sitter means fell at YHZ ($18.6M → $12.3M) and LHR ($13.3M →
  $11.3M), about the same elsewhere. Starter busts rose 15 → 18 of 36,
  since a starter's four fat routes are now targets.
- **Most rival moves don't go through entry.** Existing rivals open
  routes near their networks by potential (`rollCompetitorRouteOpenings()`),
  and those ignore the money on the table: the same YUL game's
  Cascade Connect opened onto a player market with $0 on it. Slice 2
  should make both paths follow attractiveness.

**Slice 2 as built:**
- **New airlines** arrive with a daily chance of 5% per $100k a day on
  the table across the network (`RIVAL_ENTRY_CHANCE_PER_DOLLAR`, capped
  at 10% a day), from day 15, up to 5. The 20-day timer is gone.
- **Existing rivals** open routes with their old chance × (1 + money on
  the table on player markets in reach / $200k), and 70% of the time on
  one of those markets, weighted by the money
  (`rollCompetitorRouteOpenings()`). Only 7 airline names exist, so this
  is where lasting pressure comes from.
- **The scale needed softening.** At $50k (money doubling the chance)
  the steady player's margin went from $264k a day at day 90 to about
  zero from day 180 for the rest of the year: growth stopped paying. At
  $200k, from YUL it keeps growing after its peak ($17.7M at day 180 to
  $25.4M at day 360, $23–77k a day), while the sitter erodes to
  $7–12k a day.

Measured (six seeds, day 365):

| Persona | Thread 2 baseline | Slice 2 |
|---|---|---|
| starter busts | 15/36 | 7/36 |
| steady median, north-east | $67M–$86M | $29M–$45M |
| steady, YHZ | $44M | $2.2M, 1 bust |
| steady, LHR | $73M | $97M |
| sitter median | $17M–$21M | $9.5M–$15.7M (YHZ $3.1M) |
| reckless | 36/36 bust | 36/36 bust |

What it says:
- **Sitting now costs.** A sitting airline makes about a third of what a
  growing one does in the north-east, and its margin erodes from month
  three. It still ends the year well ahead, which is right for a player
  who stops: the pressure is erosion, not a forced loss.
- **The starter survives far more** (7 busts, from 15), since one plane's
  four full routes leave little on the table.
- **London is untouched.** Existing rivals grow from their own networks,
  all in North America, so none can reach Heathrow's markets, and only
  the five new airlines can. London is now the easiest home by far
  ($97M). It needs rivals based in Europe (a data change).
- **Halifax punishes growth.** Its thin markets swarm with rivals as soon
  as the steady player makes money there, and it busts once in six while
  the sitter survives every seed. Partly fair (not growth at any cost),
  partly the headless player leasing on last week's margin without seeing
  rivals coming. Worth watching once moats exist (slice 3).

Slices:
1. **Attractiveness, and entry weighted by it.** (Done.)
2. **The entry rate follows the network's attractiveness**, and existing
   rivals' openings weigh player markets by it too. (Done.)
3. **Deterrence: frequency dominance and hub feed.** (Done.)
   `moneyOnTable()` is discounted by the player's flights each way /
   (flights + 4) (four a day halve it, one keeps 20%) and by the share of
   the market's passengers connecting through the player's hub, which a
   one-route entrant can't sell. Measured against the Europe baseline
   (steady medians): YUL $38.2M → $40.7M, YYZ $54.9M → $62.2M, BOS
   $42.8M → $39.8M, PHL flat, YHZ $3.6M with a bust → $5.5M with none,
   LHR $64.5M → $89.4M. Sitters gain a little ($10–15M → $12–18M), since
   a few flights build almost no moat, so growing now beats sitting by
   3.5–7.5×. London is on top again: about 8 flights a day on each of
   its huge markets plus Heathrow's connections is exactly the moat this
   rewards. Whether the biggest city should also be the richest home is
   a balance question, not a bug.
4. **Deterrence: slot control.** (Done.) Rivals need a slot pair at
   both ends at today's price to open a route or add a flight (checked
   before leasing a plane), get none at an airport whose day is full, and
   pay them daily (`slotFeesPerDay`, in their route costs); seed routes
   pay nothing for what they start with. Money on the table is reduced by
   a rival's slot cost, and is zero at a full airport. Steady medians
   rose (YUL $40.7M → $45.0M, BOS $39.8M → $46.2M, PHL $57.8M → $70.1M,
   YHZ $5.5M → $7.5M, LHR about flat) while sitters barely moved: slots
   taken early are the builder's moat. By day 240 rivals around YUL pay
   about $190k a day in slots, and some routes turn to losses. A full
   day, not a congested peak, is what refuses a slot, so rivals still
   crowd a busy hub (YUL's peak load reached 1.41), paying dearly.
   Quoting slots for every rival made `averageServedMovements()` a
   hotspot (the report went from 17 to 24 minutes); it now tallies all
   airports in one pass, checked equal to the old count on 400 days, and
   the full report reproduced exactly in 14 minutes.
5. **Legibility:** the ticker's reasons and the route view's warning.
   (Done.) The route view's "Rivals' view" line: the money on the table
   and what draws it, what the player's frequency and hub keep back, and
   a rival's slot cost (or a full airport), amber at $1,000 a day. On the
   owner's LaGuardia save, LGA–BOS reads about $13,700 a day (95 turned
   away), LGA–DCA about $600 (half kept by the hub's connections). The
   ticker adds the reason when a rival opens on a player market: the
   turned-away passengers or the margin, whichever drew it more.

---

## Thread 4: shocks

**The idea.** Growth at any cost should be dangerous because the world
isn't steady. A thin cash cushion and an over-extended fleet should be
what a shock punishes.

- A small set of **announced events**, each with a start, a length and
  a cause in the ticker: a fuel spike (the fuel index already moves;
  a shock pushes it for weeks), a demand dip (a recession: potential
  down 15–25% for a season), and a regional disruption (a storm season
  closing airports more often).
- Drawn from the seeded PRNG like everything else, so a run repeats.
- Balanced against the reckless persona: it should bust through
  shocks, and the steady player should get through them bruised.

Slices:
1. The event model and a fuel spike.
2. The demand dip and the storm season.
3. The route view and ticker saying what an event is doing to a route.

---

## Thread 5: a goal ladder

**The idea.** Goals give a session a shape and say what a good airline
looks like in this game. They are milestones of edges and moats, not
chores: first underserved city opened, a hub with 50 connections a day,
most of a hub's slots, reaching Europe, a quarter with rising fully
costed margin.

- Built on `sim/missions.ts`, which exists and is switched off
  (`MISSIONS_ENABLED`), or replacing it (open question).
- Rewards should unlock things rather than pay cash, since cash is the
  thing pressure acts on: younger airframes on the lease market, a
  second base, a bigger class early.

Slices are drafted after threads 2 and 3, since the goals should name the
moats those threads make real.

---

## Thread 6: Europe (airports and rivals)

**Status: done.**
- 35 European airports added to AIRPORTS (Manchester, Madrid, Rome,
  Munich, Istanbul and so on); the map holds 185. The North American
  fill-out now adds a fixed 111 (`FILL_ADDED_COUNT`), and all 150
  airports already on the map came out byte-identical. Dense Europe gives
  big 60 km catchments: Manchester 8.5M (it takes Liverpool, Leeds and
  Sheffield), Düsseldorf 11M (the Ruhr), Brussels 8.1M. That's the same
  rule as North America's, so they stay.
- Four fictional European airlines seeded (`data/competitors.json`):
  Albion Regional (London–Manchester, London–Edinburgh,
  Manchester–Dublin), Lowlands Air (Amsterdam–London, Amsterdam–Paris),
  Rhine Express (Frankfurt–Munich, Düsseldorf–Berlin), Meseta Air
  (Madrid–Barcelona, Madrid–Lisbon).
- London now has 10 neighbours in a Propeller's reach, not 4.

Measured (six seeds, day 365):

| London | Before | After |
|---|---|---|
| steady median | $97M | $64.5M (north-east: $38M–$58M) |
| steady markets | 4.0 | 9.3 |
| sitter median | $15.6M | $11.1M |
| starter | $2.6M, no busts | $4.7M, no busts |
| reckless | bust by day 14 | bust by day 124 |

London is no longer the outlier. The other homes moved too (steady
north-east $29M–$45M → $38M–$58M): the new airlines share the random
draws and the lessor, so every game's dice fall differently, within the
spread between seeds. The report now takes 17 minutes instead of 11,
since 185 airports make about 50% more pairs for the daily demand pass.

**Asked for by the owner after thread 3's slice 2.** London was the one
home the new pressure couldn't reach: every existing rival grows
outward from its own network, and all four seed rivals fly in eastern
Canada, so none could get to Heathrow's markets. London was also a
four-market home (Paris, Amsterdam, Frankfurt, Dublin), so its airlines
stacked planes on those four.

1. **European airports.** About 30 more, one per metro, hand-listed in
   `buildAirports.ts`'s AIRPORTS (names only; coordinates, catchments
   and time zones come from the data as for every other airport). The
   North American fill-out adds a fixed number of airports rather than
   filling to a total, so it comes out exactly as before.
2. **European rival seeds.** A few fictional airlines on European
   trunks in `data/competitors.json`, so rivals grow around London the
   way they do around Montréal.

Measured with `npm run balance`: London should stop being the easiest
home by far.

---

## Carried forward from week eight

Still live, and still named by this plan:

- **North American fill-out**, slice 4 (map labels thinned by zoom and
  importance) and slice 5 (balance, now owned by this plan's threads).
- **Fare stances**, slice 3 (map gauge, ticker lines), and its open
  questions, including the headless player's finding that the forecast
  overrates Premium.
- **The Grow tab** (one pipeline view).
- **Inspector ideas not yet built:** the hub planner as part of the
  airport view, "where to fly next" (which thread 2 changes: suggestions
  in words, not numbers), a cost breakdown under Last 7 Days, and alerts
  and ticker lines as links.

---

## Order

1. Thread 1 (personas), since every later thread is measured by it.
2. Thread 2, slice 1 (hunger for service and the faster ramp): the
   smallest change, helps the early game, easy to see.
3. Thread 3, slices 1–2 (profit attracts entry): the main pressure.
4. Thread 2, slices 2–3 (sizes in words, the map hint).
5. Thread 3, slices 3–5 (moats, legibility).
6. Thread 4 (shocks).
7. Thread 5 (goals).

## Open questions for the owner

- **Goals before or after the pressure?** Drafted after, so goals can
  name the moats. Goals first would give playtests direction sooner.
- **Should the headless player read markets in words too?** Honest
  balance says yes, once thread 2 hides the numbers. It currently scores
  markets by exact potential.
- **Rivals in Europe?** London has no existing rival that can reach it,
  so the new pressure barely touches it. Seed data for a European
  rival or two would fix that. Worth doing before tuning further?
- **What should reckless mean?** Today's reckless player busts in every
  game within two months, so the "a third bust" target can't be tuned
  toward without making leasing much safer. Either keep it as the
  extreme (and the target becomes "always busts, not before day 30"),
  or define a milder reckless player (grows fast but still cuts
  losers) and aim that one at a third.
