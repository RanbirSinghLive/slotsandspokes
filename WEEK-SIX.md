# airgame — Week six (running the airline, not just flying it)

Same working-document spirit as WEEK-TWO through WEEK-FIVE.md: nothing
here is committed until it's built, update freely as we keep talking.
WEEK-FIVE.md gave the game a floor (loans, a real failure state) and a
second resource (Reputation, fed by On-Time and NPS), plus a home for
both — the Executive ledger, built so far as just Loans and the
financial runway forecast. Everything below is what that same design
conversation opened up but didn't build yet: who runs the airline
alongside the player, what they're actually trying to achieve, and what
Reputation is eventually spent on.

---

## Carried forward from WEEK-FIVE.md

### The C-suite: hiring, salaries, bonuses/maluses

Four locked roles — COO, CFO, CCO, CEO — designed in WEEK-FIVE.md but
not built. All four start locked; you don't hire anyone on day one.
Each unlocks at a specific point in the game, and **the unlock
triggers themselves are still an open question, not decided** — could
be a Cash milestone, a Reputation threshold, a day count, a fleet size,
or some combination, and it's fair game to revisit whether all four
should even unlock the same way. Each role also **gets better with
each unlock**, implying more than one tier per role over a game, not a
single binary hire.

The Fleet Market's existing pattern (`ui/fleetMarket.ts`,
`data/fleet-market.json` — pick from a small table of rolled/named
options, Buy/Lease-style buttons) is the obvious shape to reuse for
candidate selection at each unlock, rather than inventing a new
interaction from scratch. Salaries charge daily, the same day-rollover
pattern loan interest and lease cost already use.

**The real open design question, not yet answered:** what do a COO's,
CFO's, CCO's, and CEO's bonuses/maluses actually *modify*? Nothing in
this codebase has an obvious "this number represents operations
quality" or "this number represents commercial acumen" lever waiting
for a multiplier — that mapping needs to be decided before the hiring
system can be built, not discovered by building it first and hoping it
lands somewhere sensible. Worth a short, dedicated design pass before
writing any code here: one candidate mapping per role, checked against
what the sim already tracks (on-time causes, booking share, fare/yield,
cost lines) rather than inventing a new stat purely to give an
executive something to modify.

Lives in the Executive ledger panel (`#executive-panel`,
`ui/executive.ts`) alongside the already-built Loans and Financial
runway sections — a third section, not a new panel.

### Missions and targets

The direct answer to "what should I be striving for early on," raised
in the same conversation that produced the executive ledger. A data
model for player-accepted goals: acceptance state, a target condition,
completion tracking. Naturally lives in the executive ledger too, once
it exists, as a fourth section.

Missions are a real consumer of Reputation once both exist — a mission
might reward Reputation on completion, or require a minimum Reputation
to accept in the first place — but the mission system itself is
separate machinery from Reputation, not just a UI wrapper around it.
Needs its own small data shape (`data/missions.json`? or generated?)
and its own acceptance/progress UI, not yet designed in any detail.

### The tech tree, spending Reputation

Reputation (`sim/reputation.ts`, WEEK-FIVE.md) has had no spender since
the day it was built. This is that spender. Deliberately last on this
list: it needs Reputation to already be a meaningful, moving number
(it is) and needs at least a couple of real, concrete nodes worth
unlocking before the tree itself is worth building — the player's own
example, ancillary revenue (baggage fees), is still the only one on the
table.

**One design constraint already settled, carried forward from
WEEK-FIVE.md:** at least some tech-tree nodes should be framed as
trade-offs — available anytime, but turning them on *costs* Reputation
going forward — rather than every node being a one-way "good behavior
unlocks nice things" reward. Real ancillary fees are a customer-hostile
lever in practice (how low-reputation discount carriers make money),
not something that should require good reputation to access, so baggage
fees specifically should probably be built this way: an always-available
toggle in the Commercial panel that trades near-term Cash for ongoing
Reputation drag, not a locked node behind a Reputation gate.

Needs, before building: a short list of real candidate nodes beyond the
one example (what else would Reputation plausibly unlock? favorable
loan terms? a Fleet Market discount? marketing-spend efficiency? — not
decided), and a decision on whether nodes cost a one-time Reputation
payment, an ongoing drag, or both depending on the node.

---

## Also still open, not from this week's own design conversation

### Time navigation and pacing

Speed controls top out at 20×. Raised in WEEK-THREE, ported through
WEEK-FOUR and WEEK-FIVE, decided against each time so far — still
genuinely unsure whether a faster cap, a "skip to next event," or
neither actually matters without a longer real session. Not proposed
for this week either; noted only so it isn't lost a fourth time.

### Connecting itineraries

Raised in WEEK-FOUR alongside spill-and-recapture: recapture was built
as the smaller, more surgical fix, on the reasoning that it's "a real
building block connections would need anyway." That building block
exists now. Connections (itinerary tracking, minimum connect time, a
schedule-quality penalty in the choice model) remain the single
heaviest structural lift on any of these lists — a genuinely different
scale of work than anything above, and not competing with the
executive/missions/tech-tree line of work for this week's attention.

---

## Proposed build order (not committed)

Roughly in dependency order — each item mostly needs the one before it
to already exist, unlike WEEK-FIVE.md's list where several items were
independent:

1. **Decide the C-suite bonus/malus mapping** — a design pass, not
   code: what does each of COO/CFO/CCO/CEO actually modify? Blocks
   item 2 entirely; building hiring UI around an undecided mechanic
   would mean redoing it once the mapping is picked.
2. **The C-suite hiring system** — locked roles, unlock gating (once
   trigger points are decided, likely alongside item 1), per-unlock
   tiers, daily salaries, and the bonus/malus effects item 1 defines.
   The single biggest chunk of new surface area on this page.
3. **Missions and targets** — the actual "what should I strive for"
   answer, and the reason this whole line of work started. Benefits
   from the executive ledger already having a hiring section to sit
   alongside (item 2), but doesn't strictly depend on it — could move
   earlier if hiring's open design question (item 1) stalls.
4. **The tech tree spending Reputation** — deliberately last, since it
   needs a short list of real candidate nodes decided first (not just
   the one baggage-fee example), and benefits from missions already
   existing as a second consumer of Reputation to design against.

Not proposed for this milestone, noted only so they aren't lost: time
navigation/pacing (decided against three weeks running now) and
connecting itineraries (the next heavy structural lift after all of
the above, not competing with it).
