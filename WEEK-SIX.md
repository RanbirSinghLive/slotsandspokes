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

### Decided: unify the ledgers into one tabbed sidebar

The sidebar (`<aside id="panel">`) already does the one thing that
matters — it's docked beside the canvas, never over it. Rather than
generalizing the loan modal's dimmed-backdrop pattern to all five
Reports panels (the option floated earlier), the simpler fix is to
give the sidebar its own internal tab bar — Fleet, Schedule, Rotation,
Commercial, On-Time, Executive — and have tab content replace *within*
the sidebar, the way a browser dev-tools panel or an IDE's side panel
works. The map next to it never disappears, because there's nothing
left that needs to cover it. The top HUD's "Reports" dropdown goes
away entirely — no reason for a second navigation surface once the
sidebar has its own tabs.

The persistent header — Cash, On-time, NPS, Reputation, Today's
Revenue/Cost/Margin — stays exactly where it is, above the tabs,
visible regardless of which tab is selected. That's already the "top
resource bar never disappears" rule Paradox's own ledger screens
follow; nothing about it changes.

### Decided: Rotation stays in the tab system, with its own expand affordance

Rotation is a timeline/Gantt view — genuinely wider than the other
five tables, and nothing about it benefits from being spatially
overlaid on lat/long. Rather than carving it out as a separate
full-screen destination (breaking the "one system" goal this whole
rework is for), it stays a normal tab like the rest, docked at the
same width — but gains its own expand control in its header, a small
maximize-style icon that temporarily widens just that tab's content
well beyond the sidebar's normal width (pushing the map correspondingly
narrower, not to zero), with a matching collapse control to return to
the shared docked width. Every other tab never needs this; Rotation is
the one view where "give me more room right now" is a real, occasional
ask, not the default state.

### Decided: the New Route form becomes a map-anchored popover

The New Route confirmation currently lives in this same sidebar,
appearing and disappearing as a route gets armed and drawn. It isn't a
ledger — it's a live map interaction, tied to the exact two points just
clicked — so it doesn't belong in the tab system either. It becomes its
own small popover anchored to the map itself (Google-Maps
info-window-style: appears right where you're actively working,
dismisses on cancel/confirm/click-away), rather than competing with
Fleet/Schedule for the same sidebar space.

### Decided: the map layers become their own click-toggled popover

Demand and Competition move out of the "Maps" dropdown and get a
dedicated small popover, anchored to its own trigger button — vertically
stacked toggle rows, opens and closes strictly on click (not today's
`mouseenter`-opens behavior), closes on a second click or click-away.
Once ledgers no longer live behind a "Map" panel-switch button (the
canvas never hides, so there's nothing to switch back to), that button
drops out entirely and the popover collapses down to exactly Demand and
Competition — a real layers picker, not a nav menu that happens to also
hold two toggles. Visually it should read with more weight than
today's plain bordered dropdown — a rounded floating card, closer to
Google's actual layers picker than a nav-menu holdover.

### Built as designed

All three phases shipped, in the order proposed: sidebar tab
unification first, then the New Route popover, then the layers
picker. Both "still open" questions above got resolved along the way
rather than staying open:

- **Sidebar width settled at 420px at rest** (up from 280px), 900px for
  Rotation's expanded state — both exported from `ui/panels.ts` as
  `PANEL_WIDTH_PX`/`PANEL_WIDTH_EXPANDED_PX`, read by a `--panel-width`
  CSS custom property that `#map` and `#panel` both size against, so
  the canvas and the sidebar can never drift out of sync.
- **Fleet Market joined the tab bar**, as the "Market" tab — the
  table-plus-buttons argument won out, no separate destination left
  over.

`main.ts`'s `PanelView`/`switchToPanel()` became `SidebarTab`/
`switchToSidebarTab()` — the map is no longer part of the switch at
all; `render()` draws it unconditionally every frame regardless of
which tab is open, and `canvas.hidden` is gone entirely. The former
full-screen panels (`#rotation-board`, `#commercial-panel`,
`#fleet-market-panel`, `#ontime-panel`, `#executive-panel`) kept their
existing element IDs and internal structure — only their CSS treatment
and DOM position changed (nested inside `#sidebar-tab-content` now,
not top-level siblings of `#map`) — so none of `ui/rotationBoard.ts`,
`ui/commercial.ts`, `ui/fleetMarket.ts`, `ui/onTime.ts`, or
`ui/executive.ts` needed any changes at all. A new `#fleet-tab`
wrapper was the one genuinely new container, holding Fleet + Schedule
together as the default tab.

**Rotation's expand affordance** works exactly as decided: a small
"⤢ Expand" button inside the tab widens the sidebar to 900px (and
correspondingly narrows the map); "⤡ Collapse" returns it, and
switching to any other tab auto-collapses it too. A `MIN_MAP_WIDTH_PX`
(200) clamp — found necessary during testing, not anticipated in the
original design — keeps the map from being squeezed to nothing on a
narrower browser window, re-clamping on every `resize()` call so
shrinking the actual window while expanded doesn't leave the map and
sidebar out of sync.

**The New Route popover** anchors to the destination airport's own
projected screen point (not the raw click position), matching the
"anchored to the place" Google-Maps feel. Two real bugs turned up
during verification, both fixed:
- Its overflow-clamp was measuring the popover's height *before*
  `updateFormValidation()` had populated the return-leg/positioning-leg
  preview text, so it clamped against a shorter box than what actually
  rendered and still spilled past the bottom of the screen on routes
  near the edge. Fixed by positioning last, after validation runs.
- The armed-state PDEW tooltip and the general airport/market hover
  tooltip both stayed visible underneath the newly-shown popover —
  harmless when the form lived safely in the sidebar, but a visible
  overlap now that both float near the same map point. `showForm()`
  hides both explicitly.

**The layers picker** (Demand/Competition) now opens and closes
strictly on click — `isLayersPicker` in `main.ts` skips attaching the
hover-open/close listeners for the Maps group specifically, while the
Competition airline filter keeps its original hover behavior
unchanged. Visual weight came from a small gap from the trigger plus a
drop shadow (`[data-group='maps'] .view-dropdown`), rather than new
icons — a deliberate scope cut, not an oversight.

**One regression found and fixed along the way, unrelated to any of
the three phases directly:** widening the sidebar to 420px meant the
HUD bar's own un-constrained width could now extend into the sidebar's
territory on a narrower browser window — and since `#panel` comes
later in the DOM with no explicit z-index, it silently won that
overlap, eating clicks meant for whatever HUD button sat underneath.
Fixed by giving `#hud` a `max-width` tied to the same `--panel-width`
variable plus `flex-wrap`, so it wraps onto a second line instead of
disappearing under the sidebar.

Verified in-browser end-to-end: bought an aircraft from the new Market
tab, selected it, armed and confirmed a real route (including the
positioning-leg and return-leg preview text), landed on Rotation with
the new legs highlighted, checked Commercial/On-Time/Executive all
render correctly and horizontally scroll where their tables are wider
than the sidebar, confirmed the map keeps animating live under every
tab (not just Fleet), and confirmed Rotation's expand/collapse and the
layers picker's click-only open/close all behave exactly as designed.
Zero console errors throughout. No `SimState` shape change, so no
`SAVE_KEY` bump was needed — this was purely a UI reorganization, same
as the Executive ledger consolidation earlier.

**Follow-up refinement, requested directly after seeing it running:**
the tab bar moved to sit above Cash/On-time/NPS/Reputation instead of
below it — the first thing in the sidebar now, not a divider partway
down it — and each tab became an icon (a send/plane glyph for Fleet, a
horizontal-bars glyph for Rotation, a trending-up line for Commercial,
a shopping cart for Fleet Market, a clock for On-Time, a briefcase for
Executive) with a native `title` attribute for the hover description,
the same "aria-label plus a real title, no custom tooltip component"
shape the Maps/Reports HUD icons already used before week six removed
Reports. No JS logic changed — `switchToSidebarTab()` and its
`data-tab` wiring are untouched; this was markup and CSS only (moving
`#sidebar-tabs` earlier in `<aside id="panel">`, and resizing its
buttons from text pills to 32px icon squares). Verified in-browser
without disturbing an in-progress game already loaded from a save:
confirmed all six buttons render with the right icon/title/aria-label,
confirmed the tab bar sits above `#econ-summary` in the actual layout
(not just the markup), and confirmed clicking still switches panes
correctly. Zero console errors.

**Second follow-up: a seventh tab for New Game/Save/Load.** These used
to be a single "New Game" button (plus its own inline confirm) floating
in the HUD bar, with no manual Save or Load at all — saving already
happened automatically once per simulated day (`ui/save.ts`), but
nothing let the player force one, or deliberately step back to it. All
three moved into a new "Game" tab (a floppy-disk icon), owned by a new
`ui/gameControls.ts` module rather than bolted onto `main.ts`, matching
the "one file per concern" shape every other tab already follows.
`ui/save.ts` gained one new export, `hasSavedState()`, so the Load
button can disable itself and read honestly as "nothing to load yet"
rather than silently doing what New Game does (a reload with no save
present falls through to `createNewGameState()` either way — Load
disabling itself is what keeps that distinct from New Game instead of
becoming a confusing second way to do the same thing). Load reuses the
exact mechanism a save already resumes through — `window.location.reload()`,
which `main.ts`'s own `loadSavedState() ?? createNewGameState()` picks
up fresh — so no new load path had to be built at all, just a
deliberate way to trigger the one that already exists. Load and New
Game both kept the "real inline confirmation, not `window.confirm()`"
shape New Game's already had, since native dialogs are silently
blocked in some embedded/preview contexts; Save needed no confirm at
all, since it can't lose anything.

Verified in-browser carefully, since Load and New Game are both
semi-destructive to a real in-progress save: clicked Save Game first
(confirmed the status line updated with a real timestamp), which made
the subsequent Load test safe — clicking "Yes, reload" afterward could
only ever restore the exact state just saved, never lose anything.
Confirmed the reload genuinely discarded the extra sim-time that had
ticked by *between* Save and Load (the clock came back earlier than
where it had drifted to, not where it was at the moment of reload),
proving the discard-since-last-save behavior is real, not a no-op.
Confirmed Load's and New Game's confirm/cancel both work correctly
without ever clicking New Game's own "Yes, start over" (which would
have genuinely erased a real save with no way back). Zero console
errors throughout.

---

## Crew and fuel prices: discussed, fuel built

Asked directly: how could hiring/training pilots, flight attendants, and
mechanics, and fuel prices, be modeled? Two genuinely different kinds of
mechanic:

- **Crew (pilots, FAs, mechanics)** is personnel with constraints and
  progression, and the honest version of it (duty-time limits, rest
  requirements, a second scheduling problem running alongside the
  rotation board) is a real "someday" lift, same conclusion the
  brainstormed-additions entry above already reached. A crude version
  was sketched — a per-base crew pool, hired the same way the Fleet
  Market already works, a coarse pilot qualification tier instead of
  per-type ratings, mechanics as shared maintenance capacity rather than
  per-tail — but **not built this pass**. Mechanics in particular only
  have something real to affect once the cancellation/AOG mechanic
  (below, "Reliability, reframed") exists, so crew should sequence after
  that, not before.
- **Fuel price** is an exogenous cost pressure, not personnel — closer in
  shape to weather than to hiring. This one was built.

### Built: a fuel price index with history, tracked so its direction is guessable

`sim/fuel.ts`: `fuelPriceIndex` is a unitless multiplier (1.0 = baseline)
rather than a $/gallon figure — avoids needing a burn-rate number per
aircraft type on top of what `data/aircraft-types.json` already carries.
It moves by a slow random walk, rolled once per simulated day from
step.ts's day-rollover (same cadence as weather): a uniform step of up to
±1.5%/day, pulled back toward baseline by 2% of however far it's drifted,
clamped to [0.5, 2.0]. The reversion is the deliberate answer to "track it
so anyone can guess direction" — a pure random walk would make the
history genuinely unguessable, but a mean-reverting one gives an
attentive player a real, if noisy, signal: a price that's drifted far
from baseline is more likely than not heading back. `fuelPriceHistory`
keeps the last 60 daily closes (`state.cashHistory`'s own rolling-window
shape, just a longer window, since spotting a cycle benefits from more of
it) with no smoothing or forecast fitted on top — the Executive panel's
new "Fuel price" section (`ui/fuelPrice.ts`, below the cash runway chart)
draws the raw history plus today's live index against a baseline
reference line, deliberately with no projection line the way the cash
chart has: the series is mean-reverting, not trending, so a straight-line
forecast would misrepresent it.

`sim/economy.ts`'s `legCost()` splits each aircraft type's flat
`costPerBlockHour` into a fixed slice and a fuel-sensitive slice
(`FUEL_SHARE_OF_BLOCK_HOUR_COST`, a flat 35% applied uniformly rather than
tuned per type — regional/narrowbody direct-operating-cost studies
commonly put fuel in the 25%-40% range, 35% is the unresearched middle of
that band) rather than touching the hand-authored aircraft-type data
directly. `fuelPriceIndex` multiplies the fuel slice; a new
`fuelEfficiencyMultiplier` field on `SimState` (1.0 = no mitigation
adopted, lower is better) multiplies on top of it and is the hook a
future tech tree's fuel-efficiency initiatives can turn down — nothing
sets it below 1.0 yet, same "exists so a future system has something real
to draw down" reasoning `reputation` already has. `flightResult()` and
every call site (`step.ts`'s revenue and positioning-leg cost paths,
`ui/commercial.ts`'s market preview) were updated to thread the index and
multiplier through; the headless runner's CSV gained a `fuelPriceIndex`
column for balance-tuning visibility.

This is a breaking `SimState` shape change (three new required fields),
so `ui/save.ts`'s `SAVE_KEY` was bumped to `v12` — any save from before
this change is simply not found again (falls back to a fresh game)
rather than crashing on the missing fields, per that file's own
versioning convention.

Verified via `npm run headless -- 200`: `fuelPriceIndex` stayed inside
[0.915, 1.031] over 200 simulated days (no runaway drift, clamps never
needed), and daily cost tracked the rolled index as expected. Verified in
the browser: the Executive tab's new Fuel price chart renders real
history and a live-updating summary/trend line with zero console errors.

### Built: the Tech Tree tab, with Fuel Efficiency as its first branch

The tech tree's own "carried forward" section above says it needs "at
least a couple of real, concrete nodes worth unlocking before the tree
itself is worth building" — the fuel-efficiency hook just built (above)
is that node list. This is the first branch, built as its own new
sidebar tab (`ui/techTree.ts`, a git-branch icon, sitting between
Executive and Game) rather than folded into the Executive ledger the
carried-forward section had guessed it would live in — a tech tree is
its own kind of screen (a chain of purchasable nodes), not a ledger
section, and the existing tab system already makes adding one cheap.

`data/tech-tree.json` holds five linear tiers, each themed on a real
historical aviation efficiency milestone, EU4-tech-tooltip style — High-
Bypass Turbofans (1970s wide-body engines), Winglets (NASA's Whitcomb
research), Digital Engine Control (FADEC, standard by the 1990s),
Composite Airframes (787/A350), and Geared Turbofans (Pratt & Whitney's
PW1000G, 2016). Each multiplies `fuelEfficiencyMultiplier` down by a
further 4-6%; unlocking all five compounds to about a 23% cut in
fuel-sensitive cost. `sim/techTree.ts` holds the rules: a node needs its
branch's previous tier already owned and enough Reputation banked, and
unlocking spends Reputation once for a permanent effect — a deliberate
choice against this doc's other standing option (an ongoing Reputation
drag), reasoned as the right shape for a genuine investment like an
efficiency upgrade, as opposed to a customer-hostile lever like ancillary
bag fees, which should stay an ongoing-drag toggle instead per the
existing design note above. Costs escalate per tier (100/180/300/480/700
Reputation), the EU4 "each tier costs more than the last" shape.

New state: `unlockedTechNodeIds` (which nodes are owned) alongside the
already-existing `fuelEfficiencyMultiplier` (the effect). Another
breaking `SimState` shape change, so `SAVE_KEY` bumped again, v12 → v13.

Verified with a standalone script exercising `sim/techTree.ts` directly:
prerequisite gating blocks tier 2 before tier 1 is owned, costs deduct
correctly, effects stack multiplicatively (cumulative multiplier 0.7737
after all five, matching the ~23% figure above), a node can't be bought
twice, and the resulting state survives a JSON round-trip. Verified in
the browser: the tab renders all five cards with real flavor text,
correctly disabled/priced Unlock buttons, and zero console errors.

---

## Built: the balance sweep, and what it immediately found

`src/headless/sweep.ts` (`npm run sweep -- <lever> [days]`) runs the
headless network many times over, changing exactly one lever per run, and
prints revenue/cost/margin per day plus cumulative cash for each value,
marking where margin peaks. `run.ts` only ever answered "how does one
configuration do" — this answers "does moving this number help, and where
does it stop helping," which is the question balance decisions actually
turn on.

Every run in a sweep uses the **same RNG seed** deliberately: different
seeds would mean different weather, competitor openings and fuel price
history per row, so the differences between rows would be mostly noise
instead of the lever. Three levers so far — fare (a multiplier on every
market's recommended fare), marketing (daily spend per market), and
fuel-efficiency (the tech tree's real cumulative multipliers). All three
are `SimState` fields, which is why this needed **no changes to `sim/`
at all**. Module-level constants (`LOAD_FACTOR`, `RECAPTURE_RATE`,
`FUEL_SHARE_OF_BLOCK_HOUR_COST`) are deliberately *not* sweepable yet —
that needs a tunables layer letting something outside the sim override
them, which is its own design decision, not something to smuggle in.

### Finding 1: fare has no optimum — "charge more" is always correct

Swept 0.6x to 5x the recommended fare over 120 days. Margin climbs
monotonically the entire way, never turning over: $6,910/day at the
recommended fare, $41,227/day at 5x. Six times the profit for doing
nothing but raising the price.

The cause is **not** a weak choice model. Diagnosing per market showed
`sim/choiceModel.ts` responds to price exactly as designed — the thin
Maritime routes fall from 9 booked to 0 across that range. The problem is
capacity: the headless network's two trunk markets carry 3,752 and 4,668
pax/day of demand against a 19-seat Beech 1900D with a 14-seat ceiling.
Even at **5x fare** those markets still book 53 and 16 per flight — above
the cap. They are seat-capped at every price in the range, so price
changes cost literally zero passengers and revenue scales linearly with
fare forever.

So the real finding is a **demand/capacity mismatch, not a pricing bug**:
`recommendedFare()` sits far below the point where demand becomes the
binding constraint on the routes that matter. The pricing tension the
game is built around is entirely masked on exactly the routes a player
flies most. Not yet fixed — the options (raise `recommendedFare()`, scale
`sim/demand.ts`'s gravity output down, or accept that a 19-seater on a
Montreal–Toronto-sized market is simply the wrong aircraft and let the
Fleet Market answer it) are a real balance decision, not a one-line tweak.

### Finding 2: marketing is close to worthless

Peaks at $50/day ($6,970 vs $6,910 at zero spend — inside the noise),
then declines steadily to $3,353/day at $800. This follows directly from
Finding 1: on seat-capped markets, buying more awareness cannot produce
more passengers, so the spend is close to pure cost. Marketing probably
can't be judged fairly until the capacity mismatch is resolved.

### Finding 3: the tech tree's fuel branch is sensibly balanced

The full five-tier branch moves margin from $6,910 to $7,959/day, about
+15%, with revenue untouched. Meaningful enough to be worth the
Reputation, not so large it trivializes the economy — the one result of
the three that needed no follow-up.

---

## Built: market stimulation — potential vs actual PDEW

The fix for Finding 1 above, and the diagnosis that produced it was
sharper than the sweep's own: the problem wasn't really pricing, it was
that **an empty world has no decisions in it.** Every market started at
its full gravity-model size, uncontested, so route choice collapsed into
"pick the biggest number" and the seat cap did the rest.

There are no legacy incumbents in this world — every airline, player and
AI alike, starts from scratch — so the model splits demand in two:

- **Potential** (`potentialDailyDemand()`, renamed from `dailyDemand()`)
  — how big a city pair could get, from population and distance, plus
  slow global growth (`demandGrowthMultiplier`, ~2%/year).
- **Actual** (`sim/marketDemand.ts`, stored per market on
  `SimState.marketDemand`) — who actually flies today. This is what books
  passengers now; potential is only the ceiling it climbs toward.

**A virgin market starts at an absolute floor of 10 PDEW, not a fraction
of potential.** That's the decision the whole thing turns on. A
percentage would leave trunk markets hundreds of passengers deep per
flight — still seat-capped, still no pricing tension — while rounding the
thinnest markets down to about one passenger a day. A flat floor puts
every market in the same playable band on day one, which is what makes a
19-seat aircraft the right tool for all of them early.

**Growth is driven by seats offered relative to potential**, which is
what stops the no-brainer from simply reappearing at the biggest market.
One daily 19-seater against 9 potential PDEW saturates a market outright;
the same aircraft against 4,668 is 0.4% of it and barely moves the
needle. Verified over 120 simulated days: the thin Maritime markets reach
96-100% of potential while YUL-YYZ and YOW-YUL, flown the whole time,
reach only 16% and 13%. Trunk routes now genuinely require real capacity
before they respond — which finally gives the Fleet Market a purpose
beyond being a shopping list.

Decay (requested directly) runs at 0.015/day toward the floor, slower
than growth: a market built to 52 PDEW and then abandoned falls to 37
after 30 days, 27 after 60, 17 after 120. Stimulation is an investment
you can lose by walking away, not one that evaporates the moment a
schedule gap appears.

Because actual demand is a property of the **market**, not of an airline,
stimulation is a public good — everyone flying a market grows it for
everyone serving it. Verified incidentally in testing: a competitor
opened YQB-YUL and grew it to 126 PDEW while the player flew nothing
there. Open a big market early and you pay to build demand a rival can
enter and share. Nothing in the model assumes a single player, so it
survives competitors becoming real airlines later.

**Result — the pricing tension exists now.** The fare sweep turns over
instead of climbing forever:

| fare | before | after |
| --- | --- | --- |
| 1.0x | $6,910/day | $5,851/day |
| 2.5x | $21,486/day | **$13,390/day (peak)** |
| 5.0x | $41,227/day | -$1,085/day |

Overpricing now genuinely loses money. Still open, deliberately not
fixed in this pass: the optimum sits at ~2.5x, so `recommendedFare()` is
still calibrated well below where a player should actually price. The
gap should probably be closed to something like 20-30% — enough that
tuning fare is a real gain, not enough that ignoring it is ruinous.

Marketing is still net-negative at every level tested (best at $0/day),
so the earlier read that it's near-worthless survives the change and
needs its own pass. Fuel efficiency's full tech branch is now worth about
+18% margin.

UI: the Demand map layer draws potential as a wide faint arc with actual
solid on top, so the gap between them *is* the headroom — a fat ghost
with a thin bright core is a big market nobody has built. Route-builder
readouts became "PDEW: 5 now → 20 potential  CAP: 19". The thin-market
warning now tests *potential* against seat count rather than today's
actual, which would otherwise fire on nearly every market in the early
game and mean nothing.

## Built: cost attribution and a Dev tab

`SimState.todayCostByCategory` splits the same dollars `todayCost`
already totalled into fuel, non-fuel block, departure, marketing and
lease. `legCostBreakdown()` (sim/economy.ts) itemizes a leg's cost and
`legCost()` is now literally the sum of its three parts, so a total and
its breakdown cannot disagree — there's one formula, not two.

Loan interest is deliberately excluded: it compounds onto each loan's
balance rather than being charged out of Cash, so it was never part of
`todayCost`, and including it would break the sum. Verified across 60
simulated days with all five categories exercised: worst
`|sum - todayCost|` was 3.6e-12, i.e. floating-point noise.

The Dev tab (`ui/devTools.ts`, wrench icon) renders that live as a cost
tree with proportion bars and hover explanations. **Every leaf reads a
real number out of state** rather than describing the model — a
hand-authored diagram of the formulas would rot the first time a constant
changed, which is exactly the drift `ui/commercial.ts` already avoids by
calling the real `flightResult()`. It refreshes every frame rather than
on tab-select, since watching cost accumulate through a day is the point.
Temporary by intent: one file, one tab button, one markup block.

Verified end to end in the browser — leased an aircraft, opened
YHZ-YQM, ran several simulated days: Fuel $884 + Block $1,616 +
Departure $600 = Flying $3,100, plus Fixed $300 = $3,400 total, matching
the headline figure exactly, with fuel at 35.6% of block cost (the 35%
share times a +2% fuel price index). Zero console errors.

### Built: sampled delay distributions

The Dev tab's second half, and the same principle as the cost tree taken
further. Rather than *describing* what the delay model does — "the
severity roll is squared, which skews toward the low end" — it samples
the real functions 40,000 times each and draws what actually comes out.
A shape is much easier to read off a histogram than off a sentence, and
sampled output can't fall out of date when a constant changes.

Four scenarios: age 0, 10 and 20 years, plus weather. Each shows its
on-time share, mean delay when late, and a 14-bucket histogram of delay
severity. Zero-delay draws are counted separately rather than binned —
most flights are on time, so including them would flatten the severity
shape into one enormous first bar and hide everything worth seeing.

These are computed once at startup, not per frame: unlike the cost tree,
they characterize the *model*, not the running game, so nothing about
them moves as a game plays out.

Getting there needed a refactor first: the delay functions were private
to `sim/step.ts`, which was carrying both the tick loop and the entire
delay model. They're now `sim/delays.ts` — a pure move, no logic change,
verified by diffing 60 days of headless output before and after (byte
identical). That also means the distributions can be sampled without
exporting step()'s internals to a UI module.

What the sampling confirms, as measured rather than asserted: on-time
shares of 65.0% / 54.8% / 45.2% at ages 0/10/20 and 20.0% under weather,
matching the 0.65 / 0.55 / 0.45 / 0.20 constants exactly; mean delay when
late rising 16 → 22 → 29 minutes with age; and the squaring skew putting
27.9% of all delays in the lowest of 14 buckets, against the 7.1% a
uniform distribution would give.

### Built: aircraft ranges cut to full-payload figures

Raised directly — the Beech 1900D could reach most of the map nonstop,
which flattened the fleet ladder into "buy whatever, it goes everywhere."

The published `rangeNm` figures were the brochure numbers, which assume
max fuel and a reduced (often near-empty) cabin. This game always flies a
full load, so the honest figure is **range with a full cabin and
reserves**, which is substantially shorter — the "marketing hype" gap.
Recalibrated on that basis, checked against all 171 pairs on the map
rather than guessed (the same way `sim/demand.ts`'s SCALING_CONSTANT was
originally tuned):

| type | was | now | map coverage |
| --- | --- | --- | --- |
| Beech 1900D | 700 | **380** | 80% → **41%** |
| Dash 8-300 | 800 | **600** | 87% → **74%** |
| Dash 8-400 | 1000 | **850** | 97% → **90%** |
| A220-300 | 2500 | **2400** | 100% |
| A330-300 | 6000 | **5500** | 100% |

The 1900D takes by far the biggest cut, and it's also the best-documented
case: its max-payload range really is around 380 nm against a brochure
figure several times that. The ladder now actually steps —
41% → 74% → 90% → 100% — instead of starting at 80%.

Verified the default `data/schedule.json` still flies: its longest leg is
YHZ-YQB at 349 nm, inside the new 380. And confirmed in the browser that
a route legal before is now blocked, with the existing error text already
framing it correctly: "YTZ is 686 nm from YHZ — beyond the Beechcraft
1900D's 380 nm range with a full load."

The two widebody cuts are cosmetic on this map — everything is already
inside 1,150 nm, so nothing above the Dash 8-400 is range-constrained at
all. Genuinely leveraging the A330 needs a bigger map, which is out of
scope this milestone.

## Fixed: negative cash had no floor

Found while testing: a game left running reached **-$3,996,581 in cash
with "Outstanding loans: 0/20"** — nearly twice the maximum debt the loan
system can even issue.

Each loan is a fixed `LOAN_PRINCIPAL` of $100,000 (not a cap — exactly
that amount), so 20 outstanding loans is $2M of total credit. That part
works as designed. The bug is the failure condition:

```
isInsolvent = cash <= 0 && loans.length >= MAX_LOANS
```

Declining a loan sets `dismissedForThisDip` and the offer stops
reappearing until cash climbs back above zero — which, if you're losing
money, it never does. So the loan count stays at 0, `isInsolvent()` never
fires, the game never ends, and cash falls without limit. **Declining
loans is strictly better than taking them**: you get unlimited free
credit at 0% instead of $100k at 0.5%/day compounding.

**Fixed with a hard floor** (chosen over making the offer
non-dismissable, or auto-drawing loans, as the smallest change that
leaves the existing offer flow alone). `CASH_FLOOR` is the total credit
line negated — `-(LOAN_PRINCIPAL * MAX_LOANS)`, i.e. -$2,000,000 — and
`isInsolvent()` now returns true below it regardless of loan count. The
reasoning is that below the floor, drawing *every* remaining loan still
wouldn't get Cash back to zero, so no sequence of borrowing could rescue
the airline; there is genuinely nothing left to decide.

Derived from the two loan constants rather than typed as its own number,
so changing the principal or the cap moves the floor with them.

Two supporting UI changes, since a floor the player can't see would just
be an ambush:

- The loan offer now shows how much room is left before the floor — e.g.
  "Below -$2,000,000 the airline is finished — $1,936,000 of room left."
- The game-over screen names *which* condition ended the run. "You ran
  past the floor without borrowing" and "you borrowed everything and
  still ran out" are different mistakes, and its old text only described
  the second.

Verified at the boundary in isolation (-$1,999,999 alive, -$2,000,000
game over, the -$3,996,581 case now fatal, and the original
loans-exhausted rule still firing), then end to end in the browser by
leasing the entire fleet market and letting the lease charges drain a
real game.

### Built: the revenue funnel

The mirror of the cost tree, and the last of the four dev tools. A
market's potential demand gets whittled down at four distinct stages
before it becomes revenue, and knowing *which* stage is doing the
whittling is the difference between three completely different fixes
that all look identical from the Commercial panel's output:

| stage | what the gap above it means | the fix |
| --- | --- | --- |
| Market potential | — | — |
| Actual demand | market isn't built yet | keep flying it |
| Booked on you | lost to a competitor or to not travelling | fare, frequency, marketing |
| Carried (seat cap) | aircraft was full | bigger gauge or more frequency |
| Recaptured | *added back* — spill picked up by a later flight | — |
| Passengers flown | | |

`FlightResult` gained a `demandBreakdown` (allocated demand, booked
demand, seat ceiling, spilled, recaptured) for the same reason it gained
`costBreakdown`: recomputing the chain in the UI would be a second copy
of the formula, free to drift from the real one. The panel aggregates a
full-day hypothetical across every served market, walking each market's
legs in departure order so the shared spill pool fills and drains in the
same sequence step.ts would produce — the same approach
`ui/commercial.ts` already uses, for the same reason.

Bars are amber rather than the cost tree's blue, and every row is scaled
to market potential rather than to the row above it, so the whole thing
reads as one continuously narrowing funnel.

Verified two ways. Arithmetically, across all 12 legs of a 120-day
headless game: `pax` always equals `min(booked, ceiling) + recaptured`,
`spilled` always equals `max(0, booked - ceiling)`, spill and recapture
are never both non-zero, and 6 of 12 legs were seat-capped with the other
6 recapturing — zero mismatches. That run also shows the mechanic working
as designed: the trunk legs book 150-177 passengers against a 14-seat
ceiling while the thin ones are demand-limited.

Then live in the browser on a fresh game: a virgin YHZ-YQM opened at 10
of 40 potential with *every* loss at the potential-to-actual stage —
correctly telling you the market simply isn't built rather than blaming
fare or capacity — and by day 16 had grown to 26 actual, 24 booked, with
the choice-model gap now visible as its own step. No console errors.

---

## Proposed build order (not committed)

Roughly in dependency order — each item mostly needs the one before it
to already exist, unlike WEEK-FIVE.md's list where several items were
independent. The map-overlay UI rework (above) is done, built out of
band from this ordering since it was asked for directly. Brainstormed
additions and the cancellations design are still just captured, not
slotted in — neither has been decided as "next" over the C-suite/
missions/tech-tree line below, just recorded so they aren't lost:

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
