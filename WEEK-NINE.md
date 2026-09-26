# airgame — Week nine (edges and moats)

Handoff document. Week eight (growth as a pipeline, the North American
fill-out, fare stances, the side panel and the headless player) lives in
`WEEK-EIGHT.md`. Read this one first.

**State at handoff:** save key `airgame-save-v46`. Week eight's headless
player and `npm run balance` give every balance change a measured
before and after (baseline below). Route views now show a route's share
of slot fees and leases. **Thread 1 is done; thread 2 is next.**

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

Slices:
1. **Hunger for service in the sim, and the faster ramp.**
   `sim/serviceLevel.ts`: seats by all airlines per airport against its
   potential, and the ramp multiplier in `rollDailyMarketDemand()`.
   The airport view says it in words. Measured with `balance`: the
   starter should survive more often; the steady player's early months
   get quicker.
2. **Sizes in words everywhere.** One `marketSize()` function in the
   sim that every panel calls; the numbers leave the route form,
   tooltips, route view and Airports list.
3. **The map hint.** Underserved airports marked subtly, so a player
   can spot an edge by looking (CLAUDE.md: the map is not decoration).

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

Slices:
1. **Attractiveness, and entry weighted by it.** Same entry timer,
   new choice of market. Measured: the sitter's fat markets get
   contested.
2. **The entry rate follows the network's attractiveness.** The timer
   goes; harvesting draws more rivals. Measured: the sitter declines.
3. **Deterrence: frequency dominance and hub feed.**
4. **Deterrence: slot control.** Rivals pay for slots at congested
   airports, and can be priced out.
5. **Legibility:** the ticker's reasons and the route view's warning.

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
- **How slow should sitting erode?** Drafted as a decline from about
  month four. Faster makes the game tenser; slower is kinder to people
  who play in short sessions.
- **How much should a moat protect?** Full protection (no entry at a
  controlled hub) makes the late game a fortress; partial protection
  keeps rivals probing. Drafted as partial.
- **Should the headless player read markets in words too?** Honest
  balance says yes, once thread 2 hides the numbers. It currently scores
  markets by exact potential.
- **What should reckless mean?** Today's reckless player busts in every
  game within two months, so the "a third bust" target can't be tuned
  toward without making leasing much safer. Either keep it as the
  extreme (and the target becomes "always busts, not before day 30"),
  or define a milder reckless player (grows fast but still cuts
  losers) and aim that one at a third.
- **Five sizes, or three?** You suggested small, medium and large.
  Five gives a trunk route somewhere to stand out; three is simpler.
