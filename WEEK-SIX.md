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

## Brainstormed next additions, not yet spec'd

Raised directly, as a "what's logically next beyond what's already
spec'd" pass — none of this is decided, just captured so it isn't
lost. Roughly cheapest/most-connected-to-existing-systems first:

- **Seasonal demand.** `sim/demand.ts`'s gravity model is flat day to
  day, but weather already runs on a real seasonal cycle (more storms
  in winter). A seasonal multiplier — a summer leisure spike, a
  holiday VFR bump — would hit the existing 3-segment choice model
  differently per segment (business flat, leisure/VFR swinging), which
  is exactly the "no new architecture, just a new multiplier" shape
  this project favors. Probably the cheapest item on this whole list.
- **More ancillary revenue beyond bag fees.** Belly cargo/freight is a
  real historical regional-carrier revenue stream and would slot into
  the same trade-off framing already decided for bag fees in
  WEEK-FIVE.md (available anytime, costs Reputation to run).
- **Real financial statements**, not just Today's P&L. Loans exist now
  (a liability), so a proper period statement — monthly close, assets
  vs. liabilities — is a natural next step for the Executive ledger.
  Also hands a concrete answer to this doc's still-open "what does a
  CFO actually do" question: maybe the CFO's unlock isn't a number
  tweak at all, it's *better financial reporting* (forecast accuracy,
  a real balance sheet) — a genuine bonus that doesn't require
  inventing a fake stat to modify.
- **A rolled-up scorecard**, once missions exist. The original
  complaint that started WEEK-FIVE.md was "no clear goal." Missions
  answer that per-target; a single "how's this airline actually doing"
  number (blending Cash trend, Reputation, on-time) is the natural
  capstone once there's more than one thing to blend.
- **Maintenance/reliability events.** The age-delay model already
  treats an old airframe as less reliable — the obvious next step is
  an actual AOG event (unscheduled maintenance grounds a plane for a
  day), turning "this plane is old" from a delay-minutes stat into a
  real scheduling stake. This is also the most natural source for the
  cancellation mechanic discussed below. **Explicitly gated by
  CLAUDE.md** ("do not build... maintenance planning... until
  explicitly asked") — needs that gate lifted before it's fair game.
- **Crew.** Same gate as maintenance, a much bigger lift (duty time,
  fatigue, a labor cost line) — a "someday," not a "next."
- **Sound.** Been on WEEK-ONE.md's deferred list since the very first
  milestone and never revisited. Even a minimal ambient pass is low
  risk relative to everything else here.
- **A day-ahead briefing.** WEEK-FOUR.md floated an ambient "weather is
  happening" indicator and it got dropped as not needed (WEEK-FIVE.md)
  — a proper day-ahead *forecast* (tomorrow's weather, which routes are
  exposed) is a different, arguably more useful idea than the
  ambient-indicator version that got cut.

## Reliability, reframed: on-time vs. cancellations

Raised directly: on-time currently means exactly one thing — departed
at its due minute, over every flight that ever departs — because
nothing in this sim can fail to depart at all. Real airlines (and the
BTS delay-code naming this project already borrows) track two separate
things: **On-Time Performance**, computed only over flights that
operated, and **Completion Factor**, the fraction of scheduled
departures that happened at all. A cancelled flight isn't "late," it's
a different failure mode, and blending the two into one number would
hide exactly the thing worth knowing — a carrier that's always on time
when it flies but cancels constantly is a very different airline from
one that's chronically 40 minutes late.

**Proposed reconciliation:** keep the two separate at the raw-stat
layer, combine them only downstream. On-time keeps meaning exactly
what it means today, untouched. A new **Completion Factor** sits next
to it in the HUD — same lifetime shape, `completed / scheduled`. The
two only combine at NPS and Reputation, which is where "how good is
this airline, overall" already gets summarized.

- **NPS:** a cancellation should score worse than any delay, not sit on
  the same continuum — a rebooked/stranded passenger is more upset than
  one who's 90 minutes late. A flat, large negative contribution
  (something like -80) rather than stretching the existing delay curve
  to cover it, since that curve floors at -50 even for a catastrophic
  delay — cancellation needs headroom to read as strictly worse.
- **Reputation:** the daily formula currently reads
  `todayFlightsOnTime/todayFlightsDeparted` — a cancelled flight never
  departs, so it'd silently vanish from that ratio entirely unless
  added on purpose. Needs a third term for cancellation rate, and the
  small-sample dampening built for the exact same reason
  (`REPUTATION_MIN_SAMPLE_FLIGHTS`) should apply to it too — one
  cancelled flight out of 2 scheduled shouldn't read as a 50%
  Completion Factor collapse for a one-plane operation.

**What actually causes a cancellation** is the real open question. A
bare random chance is the wrong model — nothing to look at, nothing the
player can affect or learn from, and it breaks the "deliberately crude
but real-sourced" rule this sim follows everywhere else. Two candidate
causes are already half-built and would give a cancellation somewhere
real to come from:

- **Severe weather, escalated.** Weather already worsens delay odds but
  never stops a flight outright — real airports do close above some
  storm severity. Giving weather events a severity tier, where the
  worst tier cancels rather than delays, is the smallest possible
  new-machinery cost.
- **A mechanical event**, extending the age-delay model. An old
  airframe already rolls worse delay odds; letting a bad-enough roll on
  that same curve become an outright cancellation instead of a long
  delay is a small conceptual step — and it's arguably the first sliver
  of the maintenance system above, not a separate thing.

**Undecided:** does a cancelled flight still cost anything? Real
airlines still eat crew/gate costs on a cancellation, just not fuel.
Leaning toward zeroing the whole leg out first — fewer moving parts —
and only adding partial-cost realism if it turns out to matter for
balance.

## The map-overlay UI rework — getting out of ledger-after-ledger

Raised directly: the game feels like it's going "deeper and deeper into
ledgers," and the drift is traceable to one specific place. Demand and
Competition (WEEK-FOUR.md) are already built the way Paradox-style
strategy games do it — map *lenses*: the base map never disappears, a
layer toggles on top of it, switching away is instant because you were
never anywhere else. WEEK-FOUR.md literally calls this "layers, not
modes."

Every other Report — Rotation, Commercial, Fleet Market, On-Time, and
now the Executive ledger — is built the opposite way:
`main.ts`'s `switchToPanel()` sets `canvas.hidden = true` and swaps in
a full-bleed DOM panel. That's not a layer on the map, it's navigating
away from it to a different destination. Five of this game's seven
views hide the map outright; only two treat it as a lens. The "layers,
not modes" fix from WEEK-FOUR never got extended past Demand/
Competition to the other five.

**What Paradox's own ledger screens actually do** (EU4's Ledger, CK3's
Realm screen, Stellaris' Situation Log) isn't "always show the full
map" either — those screens cover most of the view too. The real
pattern: the map dims/blurs behind rather than vanishing (a continuity
cue — still the same world, not a different page); the screen is a
bounded floating card that's closed (Escape, an X, click-outside), not
navigated to via a persistent nav bar; the top resource bar never
disappears on any screen; the simulation keeps running behind an open
one. This project already has two of those four right — the sidebar
never hides, and nothing in `tick()` is gated by which panel is open.

**Proposed fix:** generalize the `.modal-overlay`/`.modal-box` pattern
already built for the loan-offer/game-over pop-ups (a dimmed backdrop,
a floating card, not a full-screen takeover) to the five Reports
panels — same dimmed-map-behind treatment, same floating-card sizing
(not full `100vw`/`100vh`), same "this is a window you opened, not a
page you navigated to" feel. Demand/Competition stay exactly as they
are, since they're correctly lenses already, not windows.

**Rotation is the one genuine edge case** worth naming: it's a
timeline/Gantt view, and nothing about it benefits from being
spatially overlaid on lat/long. Still a floating card, not forced into
a lens just for consistency's sake — Paradox has plenty of screens
like this too (a character sheet isn't map-anchored either).

**Scope, honestly:** this is a real architecture change, not a CSS
tweak — canvas visibility, the dropdown active-state logic, and the
route-builder's "cancel on leaving the map" behavior are all currently
written around "which view is active" rather than "is a window open,"
and all of it needs rethinking around the new model. Smaller than it
sounds, though, since most of the actual card/backdrop styling already
exists from the loan modals.

---

## Proposed build order (not committed)

Roughly in dependency order — each item mostly needs the one before it
to already exist, unlike WEEK-FIVE.md's list where several items were
independent. Everything in the three sections above (brainstormed
additions, cancellations, the map-overlay rework) is captured but not
yet slotted into this ordering — none of it has been decided as "next"
over the C-suite/missions/tech-tree line already below, just recorded
so it isn't lost:

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
