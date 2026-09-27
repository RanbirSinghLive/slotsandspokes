# airgame — Week ten (goals and progression)

Handoff document. Week nine (edges and moats: rivals drawn by profit,
moats, shocks, real costs, Europe, home difficulty) lives in
`WEEK-NINE.md`; read this one first. **Draft**: the owner annotates it
with playtest findings as they come (see "Playtest notes"), and the
order changes with them.

**State at handoff:** save key `airgame-save-v46`. The game pushes back
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

Small, and first, because threads 2 and 3 depend on what survives. Each
system is either brought into the design or removed from the code (a
parked system still costs every change that touches it).

| System | Today | Proposal |
|---|---|---|
| Missions (`sim/missions.ts`) | 8 early checklists, switched off | **Replace** with thread 2's ladder; reuse the module's shape |
| Tech Tree (`sim/techTree.ts`) | one fuel-efficiency branch, spends Reputation, hidden | **Fold** its upgrades into milestone unlocks, then remove the tree |
| Executives (`sim/executives.ts`) | C-suite paid in Reputation, hidden | **Cut** (or re-price in cash as a later, separate idea) |
| Loans (`sim/loans.ts`) | unreachable: $0 ends the game | **Cut** the offer machinery; keep `isInsolvent()` |
| Crew (`sim/crew.ts`) | pilots, cabin, mechanics, training lines; switched off | **Open question**: the biggest parked system |
| Fuel drift (`FUEL_PRICE_MOVES`) | off; shocks set fuel now | **Cut** the random walk; shocks are the fuel story |
| The Grow tab | never built; half moot with crew off | **Cut** from the plan unless crew returns |

Measured: `npm run balance` before and after each cut (it should not
move, since everything cut is switched off).

## Thread 2: the milestone ladder and unlocks

The spine of the week.

- **Tiers**, each a handful of milestones, each milestone naming an edge
  or moat in words the player can act on. A first draft to argue with:

  | Tier | Milestones (examples) | Unlocks |
  |---|---|---|
  | Start-up | first route profitable after costs; a route at 80% load for a week; open an underserved (starved) city first | **Regional** on the lessor |
  | Regional carrier | serve 8 airports; a hub with 25 connecting passengers a day; survive a shock | **Narrowbody**; a younger-airframe listing |
  | Network airline | 60% of a busy airport's slots; four routes each dominant (4+ daily); NPS above a mark for a month | **Widebody**; a second base |
  | International | a route to another continent; 100 connecting a day at one hub | open |

- **Unlocks replace debut days** (`sim/market.ts`'s `ClassRhythm`): a
  class's listings start arriving when its milestone is met, not on a
  date. Open question: do rivals still get bigger classes by date?
- **Legible:** a Goals view in the side panel (Network › Goals) showing
  the current tier, each milestone's progress in words and numbers, and
  what the tier unlocks; the ticker announces each milestone and unlock;
  the lessor section says why a class isn't available ("Regionals unlock
  when you …").
- **Headless:** the steady player must pursue milestones, or it never
  leases a Regional and every balance number changes (thread 5).

Slices: (1) the ladder model and the Goals view, with unlocks still
cosmetic; (2) class unlocks replace debut days, with the headless player
pursuing them; (3) the other unlocks (younger airframes, second base).

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
4. Thread 3 (NPS).
5. Thread 4 (map), thread 6 (fare stances), in either order.
6. The rest of thread 5, and thread 7.

## Open questions for the owner

- **Crew: keep, cut, or park longer?** It's the largest parked system
  (pools, hiring, training lines, groundings, payroll).
- **Do rivals get bigger aircraft by date, or also gated?** Gating them by
  the player's progress would be strange; by date keeps the world moving
  on its own.
- **Which milestone unlocks each class?** The table in thread 2 is a draft.
- **How strong should NPS be in booking share?** A tie-breaker, or a real
  lever?
- **Executives: cut, or re-price in cash later?**

## Playtest notes

*(The owner adds findings from play here; each becomes a slice or moves
one up.)*
