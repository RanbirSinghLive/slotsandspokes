# airgame — Week ten (goals and progression)

Handoff document. Week nine (edges and moats: rivals drawn by profit,
moats, shocks, real costs, Europe, home difficulty) lives in
`WEEK-NINE.md`; read this one first. **Draft**: the owner annotates it
with playtest findings as they come (see "Playtest notes"), and the
order changes with them.

**State at handoff:** save key `airgame-save-v46`. **Threads 1, 2, 3, 8 and 10 are done.** The game pushes back
the way CLAUDE.md's philosophy asks: over a year a careful airline makes
$6.5M–$19M, a sitter $2M–$5M and eroding, an unattended one-plane start
survives the Standard homes, a reckless one always busts
(`npm run balance`, WEEK-NINE.md). What it lacks is **direction**:
nothing says what to aim for, reputation piles up with nothing to spend
it on, and bigger aircraft arrive on a calendar rather than being earned.

---

## The idea, in one paragraph

Progression is earned, not scheduled. A **ladder of milestones** names
the edges and moats a good airline builds (an underserved city opened
first, a route full every day, a hub feeding connections, slots held at
a busy airport, a shock survived), and reaching them **unlocks** what
comes next: most visibly the bigger aircraft, which today simply appear
on the lessor on day 40, 80 and 180. Quality stops being an abstract
stock and becomes **NPS**, a score passengers actually respond to, built
slowly, so a good reputation is a moat rather than a currency. Parked
systems are kept only if they serve this; the rest go.

---

## Decisions (settled with the owner)

1. **Headline: goals and progression.**
2. **Milestones plus unlocks, in an open-ended game.** No win screen;
   cash stays what the pressure acts on, so rewards are unlocks, not
   money.
3. **Bigger aircraft classes are unlocked by specific milestones,** not
   a debut date. (Regional, Narrowbody and Widebody each have one.)
4. **Reputation shifts toward NPS** (the owner's "maybe": confirmed by
   thread 2's measurement before anything is removed).
5. **In scope as well:** keep-or-cut for the parked systems, map labels
   and "where to fly next", finishing fare stances, and the headless
   player's fidelity.
6. **Planning style:** Claude drafts, the owner annotates from play.

### Out of scope

- A win condition or score screen (decision 2).
- Eras or rule changes over time.
- Per-passenger simulation (CLAUDE.md).

---

## Thread 1: keep or cut the parked systems

**Status: done.** The owner decided each system (table below). The two
cuts are in: the fuel random walk (`b19b1a9`) and the loans
(`a640641`), each with headless output byte-identical before and after,
since both were switched off. The Grow tab is dropped from the plan. The
rest are redesigns that live in their own threads: missions and the
Tech Tree become thread 2's ladder and innovations, executives thread 8,
crew thread 9 (awaiting the owner's pick of direction).

Small, and first, because threads 2 and 3 depend on what survives. Each
system is either brought into the design or removed from the code (a
parked system still costs every change that touches it).

| System | Today | Decision (settled with the owner) |
|---|---|---|
| Missions (`sim/missions.ts`) | 8 early checklists, switched off | **Replaced** by thread 2's ladder |
| Tech Tree (`sim/techTree.ts`) | one fuel-efficiency branch, spends Reputation, hidden | **Folded** into thread 2 as **innovations**: airline programmes a milestone makes available (a loyalty scheme, winglet retrofits, online booking), not "unlocks" |
| Executives (`sim/executives.ts`) | CEO, COO, CFO, CCO paid in Reputation, hidden | **Kept and reworked** (thread 8): no CEO, since the player is the CEO; CFO, COO and CCO chosen from candidate pools that widen as NPS rises; paid in money for their bonuses. Flavour in a game that is otherwise numbers |
| Loans (`sim/loans.ts`) | unreachable: $0 ends the game | **Cut** the offer machinery; keep `isInsolvent()` and the game-over screen. **Done:** `isInsolvent()` is in `sim/insolvency.ts`, the game-over screen in `ui/gameOver.ts`; the loans, their state field, offer pop-up and table are gone; headless output identical |
| Crew (`sim/crew.ts`) | pools, hiring, training lines, payroll; switched off | **Explored** in thread 9: woven into the map, not a tab. The owner chose all three directions |
| Fuel drift (`FUEL_PRICE_MOVES`) | off; shocks set fuel now | **Cut** the random walk; shocks are the fuel story. **Done:** the walk, its switch, the history field and the Executive tab's fuel chart are gone; headless output identical. **Reversed later by the owner:** fuel comes back as a moving price with a chart and hedging, thread 10 |
| The Grow tab | never built | **Dropped** |
| Marketing (per-market spend) | a daily charge buying booking share and faster growth | **Cut** (asked for after the table was drafted): too similar to the fare, a second dial for the same trade. **Done:** the slider, the charge, the choice-model bonus, the growth multiplier, the state fields and the sweep lever are gone; headless output identical. The CCO whose bonus was free marketing now builds markets instead (new markets grow 25% faster) until thread 8 reworks every executive |

Measured: `npm run balance` before and after each cut (it should not
move, since everything cut is switched off).

## Thread 2: the milestone ladder and unlocks

**Status: done** (three slices, below). Innovations have since moved to
the Head office view (thread 10).

The spine of the week.

- **Tiers**, each a handful of milestones, each milestone naming an edge
  or moat in words the player can act on. The owner asked for the first
  route at the start and circumnavigation near the end; the rest is
  Claude's draft:

  | Tier | Milestones | Opens |
  |---|---|---|
  | Start-up | **fly your first route**; a route profitable after its fixed costs for a week; a route at 80% load for a week; be first into a starved city | **Regional** on the lessor |
  | Regional carrier | serve 8 airports; a hub with 25 connecting passengers a day; come through a shock still profitable | **Narrowbody**; innovations: online booking, a younger-airframe listing |
  | Network airline | hold 60% of a busy airport's slots; four routes each flown 4+ times a day; NPS above a mark for a month; a second base | **Widebody**; innovations: loyalty scheme, winglet retrofits |
  | International | a route to another continent; 100 connecting passengers a day at one hub | innovations: codeshare-style feed |
  | Global | **round the world**: your network lets a passenger circumnavigate the globe (a chain of your routes, connections allowed, that crosses every meridian and returns home) | the last tier: bragging rights |

- **Innovations, not unlocks** (the owner's word): airline programmes
  that a milestone makes available and that the player then chooses to
  adopt, most for money, each with a lasting effect. The Tech Tree's one
  real upgrade (fuel efficiency) becomes "winglet retrofits".

- **Unlocks replace debut days** (`sim/market.ts`'s `ClassRhythm`): a
  class's listings start arriving when its milestone is met, not on a
  date. Rivals still get bigger classes by date (decided in slice 2).
- **Legible:** a Goals view in the side panel (Network › Goals) showing
  the current tier, each milestone's progress in words and numbers, and
  what the tier unlocks; the ticker announces each milestone and unlock;
  the lessor section says why a class isn't available ("Regionals unlock
  when you …").
- **Headless:** the steady player must pursue milestones, or it never
  leases a Regional and every balance number changes (thread 5).

**Slice 1 as built:** `sim/ladder.ts` (five tiers, 17 milestones,
checked daily at rollover, `SimState.milestonesMet`, optional in the
save), the Goals view (Network › Goals) and a Goals row in the Network
view, and ticker lines for each milestone and new tier. Calibrated from
headless runs:
- **80% full was impossible:** planes sell at most 75% of seats, so a
  full route shows about 76%. "Standing room only" is 72%.
- **Connecting passengers run large:** 25 and 100 a day were met in the
  first days (London 155 on day 1). The hubs are 150 and 750.
- **Lifetime NPS ends a careful first year at 14–17,** so "a good name"
  is 18 over 1,000 flights, until thread 3 gives NPS a trailing window.
- **"First in" was met on day 0** (every city starts starved): it now
  needs the route held for 30 days.
- **The first tiers came too fast** (Start-up by day 8, which would open
  Regionals far earlier than today's day 40): Start-up now needs all
  four milestones, and the next two tiers each ask for putting the class
  just opened into service.

With that, a steady airline from Montréal reaches Start-up's end between
days 60 and 87 (Boston and London about day 29), and a regional carrier
once it flies a Regional. Timing gets tuned properly in slice 2, once
unlocks are real and the headless player pursues them.

The old missions (`sim/missions.ts`, `data/missions.json`, their switch,
state field, ticker line and cards) are removed; they were switched off,
so headless output is identical. The Missions tab keeps only service
targets, for thread 3 to decide.

**Slice 2 as built:** every class is stocked on day 0; the player may
lease one only once its tier is climbed (`classOpen()`), rivals only
from its old debut day (`rivalDay`). The lease fan and lessor strip say
why a class is locked, and a pop-up announces each class as it opens.
The steady player needed no new policy: it leases the biggest class it
may, so it climbs as a side effect. Balance, steady player, median cash
at day 365 (before → after):

| | YUL | YYZ | BOS | PHL | YHZ | LHR |
|---|---|---|---|---|---|---|
| Before | $6.5M | $10.4M | $17.3M | $18.4M | $81k | $19.4M |
| After | $9.6M | $18.1M | $10.7M | $27.6M | $218k | $64.2M |
| Busts | 1/6 (was 0) | 0/6 (was 1) | 1/6 (was 0) | 0/6 | 3/6 (was 2) | 0/6 |

Fast climbers are paid for it: Regionals open between days 30 and 66 in
the core (the old date was 40), and London flies Widebodies from about
day 65 rather than 180, so its best seed makes $120M. The new busts are
the steady player over-expanding on props with thin cash (Boston seed 3
goes from 6 to 10 props at $400k on day 48), not the ladder: thread 5.
Halifax still reaches Start-up's end only near day 191.

**Slice 3 as built:** `sim/innovations.ts`, five programmes adopted in
the Goals view: online booking (+4% yield) and younger airframes
(leases refurbished 8 years younger) on becoming a network airline; a
loyalty scheme (recapture 60% not 40%, a quarter of the money on the
table kept from rivals, 2% of revenue a day) and winglet retrofits (10%
less fuel) on becoming international; a codeshare feed (30% more
connecting passengers, $6,000 a day) on becoming global. The Tech Tree
(its tab, data, state field) is gone: winglets are its one real effect.
**The second base is not an unlock:** leasing at any airport already
works, so it stays a milestone only. With nothing adopted, headless
output is byte-identical. The steady player adopts on a 90-day payback
(most between days 100 and 200). Steady median cash at day 365:

| | YUL | YYZ | BOS | PHL | YHZ | LHR |
|---|---|---|---|---|---|---|
| Slice 2 | $9.6M | $18.1M | $10.7M | $27.6M | $218k | $64.2M |
| Slice 3 | $12.7M | $19.5M | $17.8M | $30.0M | $218k | $77.6M |

Busts unchanged; starter and reckless identical (they never climb); the
sitter up a little. **Open for the owner:** the prices are small beside
a $10M airline, and the edges last for good, which CLAUDE.md's
philosophy warns against. Two fixes to weigh from play: price them as a
share of the airline's size, or let rivals catch up (online booking
stops being an edge once everyone sells online).

Slices: (1) the ladder model and the Goals view (done); (2) class
unlocks replace debut days (done); (3) innovations (done).

## Thread 3: quality as NPS

- **What's there:** NPS is a per-flight quality score (delay, fare
  against rivals, airframe age); Reputation is a stock it feeds, spent
  only by the hidden Tech Tree and Executives. Neither changes demand.
- **Proposal:** drop the Reputation stock (thread 1 removes what spends
  it); keep a trailing NPS per route and for the network, shown like load
  factor; and let it move **booking share** in the choice model
  (`sim/choiceModel.ts`), a little and slowly. A consistently good airline
  wins passengers from a worse one on the same route: a brand moat that
  takes months to build, which is the philosophy's kind of moat.
- **Measured:** the balance report before and after; steady should gain a
  little over sitter (older fleets, later flights), and it must not
  swamp price and frequency.

**Status: done.** As built:
- **Trailing NPS** (`sim/nps.ts`): a daily moving average weighted 1/30
  for the network and each market; a new market starts from the
  network's score. **A new airline starts at 10, level with a typical
  rival**: starting at 0 cost the steady player about 10% of its first
  year's cash in three homes and added an early bust, a penalty for
  being new rather than bad.
- **Booking share against rivals only**: 0.008 utility per point ahead
  of a typical rival's 10, taken off every rival's option, so it moves
  passengers between airlines and leaves a rival-free route alone. A
  careful airline's network sits at 12–20, so network-wide it's a
  tie-breaker; routes range about −27 to +26, so a badly run route
  really loses to its rival. (The owner's open question: tie-breaker or
  real lever? This answers "tie-breaker for the airline, lever for a
  route"; strengthen `NPS_UTILITY_PER_POINT` if play says it's unfelt.)
- **Reputation is gone**, with the hidden service targets (their tab,
  module and state) it paid. The hidden executives cost a cash signing
  fee ($1,000 per old Reputation point) until thread 8.
- **Shown** on the Network panel, the route view (with what it does
  against a rival), airport routes, the flight tooltip and the On-Time
  table. "A good name" is now a trailing NPS of 15 with 1,000 flights.
- **Measured** (steady median cash, thread 10 → thread 3): YUL $13.9M →
  $10.2M, YYZ $31.2M → $32.5M, BOS $33.0M → $28.2M, PHL $31.2M → $30.3M,
  YHZ $223k → $192k, LHR $73.9M → $76.5M; busts 2 → 3 of 36. Sitter
  within noise. The aggregate effect is small, as intended.

## Thread 4: the map as interface

- **Labels thinned by zoom and importance** (week eight's North American
  slice 4): 185 airports crowd the north-east and Europe.
- **Where to fly next**: the airport view lists its best unserved markets
  in words (size, hunger, distance, rivals), each a link to draw it;
  `suggestSpokes()` already does part of this for hubs.

## Thread 5: headless player fidelity

The balance numbers are only as honest as the player producing them.

- **Pursue milestones** (needed by thread 2's slice 2).
- **Shed planes when overhead bites**, not only when idle.
- **Read markets in words** (size and hunger), as a player now sees them.
- **A milder reckless persona** (grows fast but still cuts losers), so
  "busts through shocks" can be measured; the extreme one stays.
- **Home ratings re-run with the balance report**, so they can't go
  stale after a tuning change.

## Thread 6: finish fare stances

From week eight's fare-stance thread and week nine's findings:
- the forecast **prices in rivals' capacity response** (today it holds
  rival flights fixed and so overrates Premium);
- **Undercut's payoff**: whether a rival closing protects the market for
  a while (today another airline walks straight in);
- the map gauge and ticker lines (the thread's slice 3).

## Thread 7: hygiene

- **Docs:** move week nine's finished threads' detail out of the current
  plan's way; trim HOW-IT-WORKS sections written as history; keep
  CLAUDE.md under its own "keep short" rule.
- **Performance:** connecting flows are still about a quarter of a big
  airline's year; running the balance report's games side by side would
  cut its wall-clock time by the core count (ask the owner first: see
  memory on parallel runs).

---

## Thread 8: executives (reworked)

They live in the Head office view (Network › Head office) beside fuel
and the innovations (the owner's call, thread 10), not a tab of their own.

The owner wants them kept for flavour: named people with backgrounds, in
a game that is otherwise all numbers.

- **No CEO:** the player is the CEO. Three chairs: **CFO**, **COO**,
  **CCO** (the existing `data/executives.json` candidates, CEO removed).
- **Paid in money,** not Reputation: a signing fee and a daily salary,
  in exchange for their bonuses (delay reduction, NPS, maintenance,
  marketing and so on, as today).
- **Candidate pools widen as NPS rises:** a small airline with a poor
  record attracts journeymen; a well-regarded one can hire the stars. The
  candidates on offer are grouped by the NPS they need.
- Shown in the side panel (Network › Executives), not a separate tab.

**Status: done.** As built: three chairs, nine candidates (a journeyman,
an NPS 15 hire and an NPS 20 star per chair, each helping differently),
signing fee plus salary, "Let go", in the Head office view. The old
cash-bonus effects (a CEO's and CFO's bonuses) are gone, since paying an
executive to be paid was money for money; the CFOs now cut overhead,
hedge premiums or lease rates. The Executive tab (hidden) keeps only
its runway chart. With nobody hired, headless output is unchanged. The
steady player hires on a margin-covers-10×-salary rule; steady median
cash (thread 3 → thread 8): YUL $10.2M → $12.0M, YYZ $32.5M → $23.7M,
BOS $28.2M → $27.3M, PHL $30.3M → $45.4M, YHZ $192k → $192k, LHR $76.5M
→ $87.7M; busts unchanged at 3. Mostly seed noise; no chair dominates.

## Thread 9: crew, woven into the map (an exploration)

Crew is the largest parked system (pools, hiring, training lines,
reserve depth, groundings, payroll, about 1,200 lines). The owner wants
it back only as something to optimise **on the map**, not in a tab. Three
directions, not exclusive:

1. **Crew bases.** Crews live at bases, and a plane's day must start and
   end where its crew lives. Opening a crew base at an outstation (a
   cost, on the airport's ring) lets planes overnight there and fly longer
   days; the map shows crew bases as a mark on the airport. What to
   optimise: where to base crews, versus long ferry legs home.
2. **Crew hours as a second pool bar.** Beside each base's plane pools, a
   crew-hours bar: flying hours booked against the crews based there.
   Hiring is a ring action at the base, with a lead time (the training
   line, simplified). What to optimise: hire ahead of growth, not after
   the bar turns red.
3. **Fatigue into delays and NPS.** Long duty days and tight turns tire
   crews: more delays and a lower NPS on the day's later flights. It
   rides on levers already on the map (turn buffers, how full a plane's
   day is). What to optimise: slack against utilisation.

**The owner chose all three** ("excited to see it play"). Claude's
original lean, kept for the order: 2 and 3 first. They add a real trade-off (hire ahead,
leave slack) using bars and levers already on the map, with no new
screen. 1 is the richer idea but changes how rotations work, and fits
with the "second base" milestone. For the owner to choose before any of
it is built.

## Thread 10: fuel price and hedging

Asked for by the owner after thread 1 cut the old random walk: fuel
comes back as a price that moves every day, **in addition to** the fuel
shock (sim/shocks.ts), with a running chart and a hedge the player can
buy as a bet on where the price goes.

- **The price moves daily**: a small, mean-reverting walk around the
  baseline from the seeded PRNG (sim/rng.ts), so it wanders but comes
  back; a fuel shock jumps it on top and fades as today. Deterministic,
  in `state`, so saves and headless runs repeat.
- **A running chart**: the last 90 days of price, with today's price and
  the baseline marked, in the Head office view (see below).
- **Hedging, a bet**: "Hedge" locks today's price on the airline's fuel
  for 30, 60 or 90 days, for an up-front premium. If fuel rises, the
  airline pays the locked price and wins; if it falls, it still pays the
  locked price and loses the difference. One hedge at a time; the view
  shows what the hedge has saved or cost so far, and the chart draws the
  locked price as a line until it runs out.
- **Philosophy**: a hedge bought before a spike is an edge, and it's
  temporary by construction (it runs out). The premium keeps it from
  being free insurance: always hedging should cost money on average.
- **Headless**: the steady player hedges when fuel is below the baseline
  and never when above; the sitter never hedges. Balance measures that
  the walk alone doesn't bust careful airlines, and that always-hedging
  loses a little on average.

**Status: done.** As built:
- `sim/fuelPrice.ts`: the walk keeps 95% of yesterday's deviation plus a
  step of up to ±5% (about ±10–15% typically), clamped 0.6–2.0; a spike
  multiplies on top. Rivals pay the market price; the player the locked
  one while hedged.
- **The premium is a flat fee**, 1% plus 0.02% a day of term of the fuel
  covered. First tried at 3% plus 0.05%: hedging at random then lost
  77–99% of the premium and even a good hedge rarely beat it. Now, over
  36 sitter games: at random, −38% (30 days) and −99% (90 days); 90 days
  when fuel is 5% or more below usual, +380%.
- **Head office** (Network › Head office), as the owner suggested:
  fuel, hedging and the innovations (moved from Goals) in one view, with
  executives to join in thread 8. Not a separate Fuel view. The Network
  view's Head office row shows the price and any hedge; the ticker says
  how a hedge went when it ends.
- Balance (full report): steady median cash YUL $13.9M, YYZ $31.2M, BOS
  $33.0M, PHL $31.2M, YHZ $223k, LHR $73.9M, busts 2 of 36 (from 5); the
  walk on its own, before hedging, left busts at 4. Sitter a little
  lower (it never hedges), starter slightly safer (the price is below
  usual as often as above), reckless unchanged.

## Carried forward from week nine

- **Thread 5 (goal ladder)** becomes this plan's thread 2.
- Its open questions: headless player reading markets in words (thread
  5 here), what reckless should mean (thread 5), goals before or after
  pressure (answered: pressure first, done).
- From week eight, still live: fare stances (thread 6), map labels and
  "where to fly next" (thread 4), the hub planner inside the airport view
  and a cost breakdown under Last 7 Days, alerts and ticker lines as links
  (unscheduled; pick up when a thread touches them), and the Grow tab
  (thread 1 decides).

---

## Proposed order

1. Thread 1 (keep or cut): decisions first, since 2 and 3 build on them.
2. Thread 2, slice 1 (the ladder and the Goals view).
3. Thread 5's "pursue milestones", then thread 2, slice 2 (class unlocks).
4. Thread 3 (NPS), then thread 8 (executives), which builds on it.
5. Thread 4 (map), thread 6 (fare stances), in either order.
6. The rest of thread 5, and thread 7.
7. Thread 9 (crew): hours bar and fatigue first, then crew bases.

Thread 10 (fuel and hedging) is self-contained and can go any time after
thread 2; the owner asked for it, so it's next after thread 2's slice 3.

## Open questions for the owner

- **Do rivals get bigger aircraft by date, or also gated?** Gating them by
  the player's progress would be strange; by date keeps the world moving
  on its own.
- **Which milestone unlocks each class?** The table in thread 2 is a draft.
- **How strong should NPS be in booking share?** A tie-breaker, or a real
  lever?
- **Executives: how much NPS opens each pool, and what do they cost?**

## Playtest notes

*(The owner adds findings from play here; each becomes a slice or moves
one up.)*
