# airgame — Week five (a goal, a floor, and something to spend besides cash)

Same working-document spirit as WEEK-TWO/THREE/FOUR.md: nothing here is
committed until it's built, update freely as we keep talking. Different
starting complaint again: **there's no clear sense, early on, of what
the player is actually striving for.** You can fly routes, watch the
board, and read the P&L, but nothing tells you what "winning" looks
like, and nothing stops "losing" either — cash can drift negative
forever with no consequence. This week is about giving the game a
floor (a real failure state, via loans rather than a hard wall), a
second thing to chase besides the Cash number, and a home for goals
(missions/targets) once both of those exist.

---

## Ported from WEEK-FOUR.md — still genuinely open

WEEK-FOUR ported four items forward from WEEK-THREE. One of them —
bankruptcy / a failure state — is this week's actual subject, covered
below in full rather than staying a one-line open question. The other
two are still just open, untouched since they were first raised in
WEEK-THREE:

### Time navigation and pacing

Speed controls top out at 20×. A full simulated year at 20× is still
real minutes of watching mostly-nothing happen. Worth a faster top
speed, a "skip to next event" (next departure/arrival/weather change),
or both — still genuinely unsure which matters more without a longer
real session first. Decided against for now, dropped from this week's
build order.

### Weather visibility outside Ops mode — no longer needed

Weather only shows up visually in Ops mode, and only if you're looking
at the right airport at the right frame. No ambient signal (HUD note,
sidebar line, log) that a storm started or ended. Was a legibility
nice-to-have, not a blocker — decided against, dropped from this
week's build order.

**Also worth naming, not from the ported list but from this week's own
spill-and-recapture work:** connecting itineraries. WEEK-FOUR
deliberately built recapture instead of connections, on the reasoning
that recapture is the smaller fix and "a real building block
connections would need anyway." That building block now exists.
Connections (itinerary tracking, minimum connect time, a schedule-
quality penalty in the choice model) are a genuinely heavier structural
lift than anything else on this page, and not what this week is about
— noted here so it doesn't get lost, not proposed for this milestone.

---

## What's actually being asked

Three things, discussed together, resolving into one connected system:

1. Give the early game a visible goal instead of an open-ended sandbox.
2. Give cash a real floor — not a hard wall, but a mechanism (loans)
   that lets mismanagement compound into an actual loss state instead
   of drifting negative forever with no consequence.
3. Give the player something to chase besides the Cash number — a
   second resource, earned through service quality rather than pure
   revenue, spendable on things cash can't buy.

## Design: loans and a real failure state

**The trigger.** When Cash hits zero, a pop-up offers a loan rather
than just letting the number go negative. This replaces "nothing
happens" with a real decision point.

**Interest is compound**, applied daily alongside the existing
day-rollover charges (`step.ts`'s day-rollover block, where marketing
spend and lease cost are already charged — the natural home for this
too, since it's the same "recurring daily charge against Cash"
pattern).

**Loans stack, up to 20 concurrent.** They can also be repaid, which
frees up room under that cap — this isn't a lifetime counter, it's how
many are outstanding at once. **The failure state is needing a 21st
loan**: hitting zero cash again while already carrying the maximum of
20. That's the actual "this is over" moment — a concrete, checkable
condition, not a vague spiral with no defined end.

**A runway forecast graph**, living in the same screen as the loan
mechanic (see the executive ledger below): a forecasted line projecting
the current cash trend forward, toward either a target or the 20-loan
ceiling. This is a read of numbers the sim already produces (a rolling
window of recent daily cash deltas, projected forward) — no new
simulation logic, same "UI reads what the sim already computes"
principle the PDEW/CAP work and the On-Time panel both already follow.
Needs its own small line-chart renderer, since nothing in this codebase
draws a line chart yet.

## Design: the executive ledger

Four C-suite roles — COO, CFO, CCO, CEO — each with bonuses, maluses,
and a daily salary (charged the same day-rollover way as loan interest).

**All four are locked at game start.** You don't hire anyone on day
one. Each role unlocks at a specific point in the game — the exact
triggers are **still TBD**, a genuinely open question, not an oversight
— and each role **gets better with each unlock**, implying more than
one tier per role over the course of a game rather than a single
binary hire. The Fleet Market's existing pattern (`ui/fleetMarket.ts`,
`data/fleet-market.json` — pick from a small table of rolled/named
options) is the obvious shape to reuse for candidate selection at each
unlock, rather than inventing a new interaction.

This same screen is also where **missions and targets** get accepted
and set — goals the player opts into, which is the direct answer to
"what should I be striving for early on." Missions are a natural
consumer of the Reputation resource below (a mission might reward
Reputation, or require a minimum Reputation to accept), but the
mission system itself is separate machinery — a data model for
targets, acceptance state, and completion tracking — not just a UI
wrapper around Reputation.

## Design: Reputation — a second resource besides Cash

The core question was what the game's "key resources" should be beyond
Cash, and how to portray them without turning into a cartoonish points
system.

**Two spendable pools, not three or four.** Cash stays exactly as it
is. A single new pool — **Reputation** — is the "not just cash"
resource, rather than introducing OTP and NPS as separate currencies
each. More than two starts to feel like a mobile game; the CFO/CEO
vocabulary already in play makes "Reputation" (a real, unpretentious
business term — closer to brand equity than to a game-y meter) the
right name and the right scale for it.

**OTP and NPS are quality signals that drive Reputation, not resources
spent directly.** OTP is already a rate (a percentage of on-time
departures) — it doesn't accumulate, so it can't really be "spent,"
only read. NPS doesn't exist anywhere in the codebase yet and needs
deriving, same "deliberately crude, real-sourced-where-possible"
treatment every other constant in this project gets. A reasonable first
formula, built entirely from signals the sim already produces: on-time
rate (`flightsOnTimeTotal`/`flightsDepartedTotal`, already tracked),
fare relative to competitors on the same market (already available via
`choiceModel`), and aircraft age (already sitting on every `Aircraft`
record from the delay-cause work) — nobody feels good flying an old
plane, and it's a free, thematically fitting third input.

**Reputation's daily gain (or loss) is a function of OTP and NPS**,
computed in the same day-rollover block as everything else new this
week: strong OTP/NPS earns Reputation, weak OTP/NPS costs it — a real,
felt consequence for letting service quality slide, rather than a
number that only ever goes up.

**Present both as real metrics, not game abstractions.** NPS as an
actual -100 to +100 score (what real NPS actually is), OTP as the
percentage it already is on the HUD. An exec dashboard showing a
percentage and a score reads like a real airline ops review, which is
what keeps this from feeling cartoonish — no meters, no gems, no XP
bar.

**Reputation spends into a tech tree** — the player's own example was
unlocking ancillary revenue like baggage fees. One nuance worth
building in deliberately: real ancillary fees are a customer-hostile
lever in practice (how low-reputation discount carriers make money),
not something that should require good reputation to access. At least
some tech-tree nodes should be framed as trade-offs — available
anytime, but turning them on costs Reputation going forward — rather
than every node being a one-way "good behavior unlocks nice things"
reward. Otherwise the tree stops making sense the moment it includes
something real airlines only do once they've stopped worrying about
goodwill.

---

## Proposed build order (not committed)

Quick wins first, heavy lifts later — sequenced so nothing depends on a
piece that hasn't been built yet.

1. ~~Weather visibility outside Ops mode~~ — dropped, no longer needed.
2. ~~A faster speed cap~~ — dropped, no longer needed.
3. **Loans** — done: the cash-hits-zero pop-up, compound interest in the
   day-rollover block, the 20-loan stacking cap, repayment, and the
   21st-loan failure state. Self-contained — doesn't need executives or
   Reputation to exist first, and directly closes the "no failure
   state" gap that's been open since WEEK-THREE.
**Built as designed**, one small addition beyond the original spec: a
flat $100,000 per loan (`LOAN_PRINCIPAL`, `sim/loans.ts` — deliberately
crude, same spirit as `economy.ts`'s `LOAD_FACTOR`), 0.5%/day compound
interest applied to each loan's own balance at day-rollover (not charged
to Cash directly — the balance owed grows on its own, which is the
"drag" asked for), and full-balance-only repayment (one "Repay" button
per loan, no partial paydown) via a new sidebar section that only
appears once a loan exists. The pop-up itself re-offers every frame
Cash is at or below zero, dismissible per-dip (a decline doesn't mean
"never ask again," just "not for this particular dip" — it resets the
moment Cash climbs back above zero). Reaching the 21st-loan trigger
(`isInsolvent()`: Cash ≤ 0 with all 20 slots full) shows a distinct,
undismissable game-over screen and force-pauses the simulation — the
first real loss state this game has had.

Verified in-browser (via a temporary `window` debug hook, removed
before finishing): forced Cash negative — the loan pop-up appeared with
the correct amount and outstanding-loan count; took a loan, Cash rose
by exactly $100,000 and a new sidebar row appeared with Repay correctly
disabled (Cash still under the balance); raised Cash above the balance
and clicked Repay — the loan and its row disappeared and Cash dropped
by exactly its balance. Ran two real day-rollovers at 20× and confirmed
compounding directly: $100,000 → $101,002, matching
`100,000 × 1.005²` (≈$101,002.50) within float rounding. Forced 20
loans and Cash negative: the game-over screen appeared with its red
border, the speed controls snapped to Pause and the clock visibly
stopped advancing, and "Start a new game" correctly cleared the save
and reloaded. Zero console errors throughout. `SimState` gained a
`loans` field, so `ui/save.ts`'s `SAVE_KEY` bumped v7 → v8.

4. **NPS derivation** — done. A new formula from existing signals (on-time
   rate, fare vs. competitors, aircraft age). Needed before Reputation
   can be fed by it.

**Built as designed** (`sim/nps.ts`): a per-flight satisfaction score
from three additive, independently-clamped components — delay (a
+30-point baseline falling a point per minute of rolled delay, floored
at -50), fare vs. the average competitor fare on that exact market
(±30 points, 0 if no competitor serves it), and aircraft age (+10
baseline, -1/year, floored at -15) — summed and clamped to the real
NPS range of [-100, 100]. Scored in `step.ts`'s departure loop, the
same moment as the on-time counters, into a new lifetime running sum
(`SimState.npsPointsTotal`) divided by the *same* `flightsDepartedTotal`
denominator On-Time performance already uses (deliberately a lifetime
average, not a trailing window — same "simplest first pass" shape as
On-Time itself). Shown in the sidebar as a signed integer (`+42`/`-15`)
right under On-time, "—" until the first departure.

Verified two ways. Direct formula checks (`flightSatisfactionScore()`
called standalone) matched hand-computed expectations exactly: a
perfectly on-time, brand-new aircraft with no competitors scored 40
(30 delay + 10 age); the same flight on a 24-year-old airframe scored
16 (age component down to -14); a 90-minute-late flight on that same
old aircraft scored -64 (delay floored at -50, confirming the floor
works); undercutting a single $200 competitor at a $150 fare added
exactly +25. Then an integration check running `step()` on the fixed
3-tail headless network for 5 simulated days produced 60 departures
(3 tails × 4 legs × 5 days, exactly as expected) at an average NPS of
+27.45 — solidly positive and in-range, consistent with brand-new
aircraft and mostly-on-time performance on that fixture. In-browser:
confirmed the sidebar shows "—" on a fresh game, and correctly
formats both a positive (`+42`) and negative (`-15`) score once
`flightsDepartedTotal`/`npsPointsTotal` are non-zero. Zero console
errors. `SimState` gained `npsPointsTotal`, so `SAVE_KEY` bumped
v8 → v9.
5. **Reputation** — done: the new `SimState` pool, daily accrual from OTP
   and NPS in the day-rollover block. Builds directly on item 4.

**Built as designed** (`sim/reputation.ts`): an unbounded running score,
starting at 0 — a brand-new airline with no track record, not already
"good" or "bad." Moved once per simulated day by
`applyDailyReputationChange()`: `(todayOtpPct - 0.8) * 50 + todayAvgNps *
0.2`. 80% on-time is picked as the "neutral" day (better swings
Reputation up, worse swings it down); NPS needs no baseline since it's
already zero-centered. A day with zero departures is left untouched
rather than guessed at.

The one real design wrinkle: On-Time and NPS are shown in the HUD as
*lifetime* averages (deliberately, so they read as a stable track
record), but a lifetime average barely moves once a game has run for a
while — using it to drive a *daily* accrual would make Reputation
almost inert late-game. So three new day-scoped counters
(`todayFlightsDeparted`, `todayFlightsOnTime`, `todayNpsPoints`, same
reset-at-rollover shape as `todayRevenue`/`todayCost`/`todayMargin`)
track *that day's* performance specifically, and
`applyDailyReputationChange()` reads them — and only then are they
reset to zero — right at the start of the *next* day's rollover, the
same "read the just-finished day's real totals before they're cleared"
ordering already used for revenue/cost/margin.

Verified with direct formula checks: a perfect day (100% on-time, NPS
+40) produced exactly +18.00; a bad day (50% on-time, NPS -50) produced
exactly -25.00; a zero-departure day left a starting Reputation of 42
untouched. A `step()` integration run on the fixed 3-tail headless
network across 5 simulated days confirmed the day-boundary ordering
directly: Reputation stayed at 0.00 through day 1 (its own delta not
yet applied), moved to -5.83 only once day 2's rollover had processed
day 1's real numbers, and `todayFlightsDeparted` correctly read 12
(that day's own total, not yet reset) at the moment each day's loop
ended, confirming the read-before-reset ordering holds under the real
simulation loop, not just in isolation. In-browser: a fresh game shows
Reputation as a real "0" immediately (not a "—" placeholder, since 0 is
a genuine starting value), sitting under NPS in the sidebar. Zero
console errors. `SimState` gained four fields, so `SAVE_KEY` bumped
v9 → v10.

Nothing spends Reputation yet — that's the tech tree, still ahead on
this list.

**Built as designed** (`sim/forecast.ts` + `ui/executive.ts`, in what
was first a standalone "Finances" Reports panel, later folded into the
Executive ledger below): `SimState` gained `cashHistory`, a rolling
window (capped at 30 days, oldest dropped as new days arrive) of
closing Cash balances, recorded once per simulated day at the very top
of step.ts's day-rollover — before that day's own marketing/lease/loan
charges touch Cash, same ordering the Reputation calc right above it
already relies on, so each entry is genuinely "yesterday's closing
balance." `computeCashForecast()` reads that window plus today's live
Cash: the average day-over-day delta across the window becomes a
straight-line projection 14 days out, and — deliberately *not* trying
to account for loans the player might take along the way, since that's
a real interactive decision the forecast can't know in advance — a
plain "days until Cash hits $0 at this trend" if the trend is actually
heading there.

The panel itself is a small hand-rolled Canvas 2D line chart (a fixed
2x-scaled pixel buffer, no `devicePixelRatio` handling needed since it
never resizes, unlike the map's own canvas) — solid line for real
history, dashed for the projection, a dashed red reference line at $0,
a plain-English summary underneath ("At the current trend, Cash
reaches $0 in about N days" in red, or "flat or trending upward" when
it isn't heading there, or "not enough history yet" pre-launch).

Verified with direct formula checks: no history at all produces a flat
projection at current cash and no crash; a steady synthetic -$1,000/day
trend over 10 days with $90,000 cash produced exactly `dailyDelta: -1000,
daysUntilZero: 90`; a rising trend correctly reported `daysUntilZero:
null`; pushing 40 days through `recordDailyCashHistory()` confirmed the
30-day cap holds, oldest entries dropped first. In-browser: a fresh
game's forecast panel showed the correct "not enough history yet"
message with a flat line at $500,000; force-feeding a synthetic 10-day
declining history ($500K → $160K, then $120K live) rendered a
correctly-sloped solid-to-dashed line crossing the zero line, "At the
current trend, Cash reaches $0 in about 4 days" (matching a hand
calculation exactly), and "Averaging -$37,778/day over the last 10 days
— projected 14 days ahead." Zero console errors. `SimState` gained
`cashHistory`, so `SAVE_KEY` bumped v10 → v11.
6. **The runway forecast graph** — done. Needed a real loan/cash history
   to project against, so it landed after loans; a dedicated home
   ("Finances," in the Reports dropdown) at first, since the executive
   screen didn't exist yet.
7. **The executive ledger — the screen itself, done; hiring not
   started.** Asked directly to build the ledger now, scoped down to
   just the two pieces that already existed: Loans and the runway
   forecast, folded into one new "Executive" Reports panel (replacing
   the standalone Finances panel — see its own section below). Locked
   C-suite roles, per-unlock tiers, salaries, and bonuses/maluses are
   **not built** — carried forward to WEEK-SIX.md, along with missions
   and the tech tree, rather than left as unfinished sub-items on this
   page.

---

## The executive ledger, scoped down to what already existed

Asked directly to stop deferring the ledger and build it now — but only
the two pieces already real: Loans (item 3) and the runway forecast
(item 6). The C-suite hiring/salary/unlock system is a separate, much
larger effort with a genuinely open design question (unlock trigger
points, still TBD) and stays out of this pass entirely; see
WEEK-SIX.md.

**What changed:** the standalone "Finances" Reports panel is gone,
replaced by a new "Executive" entry housing both Loans and Financial
runway as two sections of one screen. The sidebar's own Loans section
(`#loans-section`, previously living in `<aside id="panel">` alongside
Fleet and Schedule) moved into this new panel too — one home for
financial state, not two. `ui/loans.ts` needed no code changes at all
(same element IDs, just relocated in the DOM — it wasn't scoped to the
sidebar, just querying `#loans-section` wherever it happened to live);
`ui/finances.ts` was renamed to `ui/executive.ts` and its exports
renamed (`setupFinancesPanel`/`updateFinancesPanel` →
`setupExecutivePanel`/`updateExecutivePanel`) and its DOM ids
(`#finances-chart` etc. → `#executive-chart` etc.), since this module's
whole reason for existing now is specifically "the Executive panel's
forecast half," not a generic "finances" concept. The two features stay
separate modules sharing one screen — same "one file per concern" shape
every other panel in this codebase already uses, not a merge into a
single mega-file.

The Loans section keeps its own independent update cadence: since
`ui/loans.ts`'s `updateLoans()` is already called every frame from
`main.ts`'s `render()` regardless of which panel is showing (it has to
be, to drive the loan-offer/game-over pop-ups as global overlays), the
Loans table inside the Executive panel is always current the instant
you switch to it, with no extra wiring needed. The forecast chart keeps
its original "refresh on select" cadence (same as On-Time/Commercial),
since nothing about a 14-day trend line needs to animate live.

Verified in-browser: a fresh game's Executive panel showed only
"Financial runway" (Loans section correctly hidden, zero loans);
forcing Cash negative and taking a loan via the pop-up, then switching
to the Executive panel, showed both "Loans 1/20" (with the new loan's
balance and a correctly-disabled Repay button) and the forecast chart
together on one screen; switching to On-Time and back confirmed the
other Reports panels' wiring was unaffected by the rename. Zero console
errors. No `SimState` shape change, so no `SAVE_KEY` bump was needed —
this was purely a UI reorganization.

---

Everything else — C-suite hiring, missions/targets, the tech tree, and
connecting itineraries (noted above, never proposed for this
milestone) — carries forward to WEEK-SIX.md rather than staying an
open tail on this page.
