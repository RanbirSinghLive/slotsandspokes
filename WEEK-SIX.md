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

### Fixed: marketing spend was structurally worthless

Measured per market on a matured 120-day game, marketing's return was
**0.00x on nearly every market** — best case 0.50x. Not a mistuned
constant; the shape was wrong. It failed in a pincer:

- On a **big** market the extra booking share was worth exactly nothing,
  because those flights were already seat-capped. Buying share you can't
  seat is buying nothing.
- On a **small** market the share gain was real but absolutely tiny — a
  passenger or two — against a cost quoted in flat dollars.

There was no market size at which a flat daily fee bought enough share to
pay for itself.

The fix routes marketing through **market stimulation** rather than only
through booking share: spend now multiplies the rate at which a market
matures toward its potential (`log2` diminishing returns, $200/day
doubles it, $800/day roughly triples it). Marketing becomes an investment
that permanently grows a market rather than a per-day purchase of a
sliver of share. The old booking-share bonus stays as a secondary effect.

An additive version was tried first — marketing buying "virtual seats" of
presence, so cost would scale with market size automatically — and
measured net-negative everywhere: small markets are already at full
saturation from their own aircraft so extra presence bought nothing, and
trunk markets are so large that any plausible daily spend is a rounding
error. The useful band was too narrow. A rate multiplier applies wherever
a market is still growing, which is exactly the period the spend is meant
to shorten.

Result — marketing now has a real interior optimum, and a genuine
interaction with fleet capacity:

| spend/market/day | margin, 19-seat fleet | margin, 78-seat fleet |
| --- | --- | --- |
| $0 | $5,851 | -$3,596 |
| $100 | **$5,920** | -$1,970 |
| $200 | $5,686 | **-$1,622** |
| $800 | $2,954 | -$3,263 |

Capacity-starved, marketing is barely worth anything (peaks at +$69) —
correctly, since you can't carry the demand you're creating. Given
aircraft big enough to absorb the growth, the same spend is worth
+$1,974/day at its peak. Over-spending is punished at both gauges.

That interaction is the point: marketing and fleet planning are now
complementary decisions rather than independent sliders.

---

## Fare: recalibrated, and turned into a policy

Raised directly, and the complaint was exact: a per-market fare slider is
busy work, not a decision. Three things made it so.

1. **Nothing reacts.** Competitor fares are fixed JSON and never respond,
   so a static optimum exists permanently — find it once, never revisit.
2. **The UI hands you the answer.** The Commercial panel previews margin
   live as you drag, so finding the optimum isn't even a search.
3. **It's the same puzzle N times.** Per-market pricing across twenty
   markets is twenty identical drags. The chore *grows with your
   network*, so the mechanic got more tedious the better you played.

(3) is the real complaint; (1) and (2) are why it isn't interesting even
once.

### Fixed first: the baseline was recommending a bad price

`recommendedFare()`'s two constants were raised 1.5x (125 → 190 base,
0.30 → 0.45 per nm). The sweep had margin peaking at ~2.5x the old
recommendation, meaning a player who never touched fare was leaving well
over half the achievable margin on the table — "recommended" was
recommending badly.

Deliberately **not** moved all the way to the measured optimum: the curve
is flat at its peak (2.0x scored $13,217 against the peak's $13,390, a
1.3% difference), so a default sitting exactly there would make pricing
pointless. After the change the default scores $11,168 against a $13,745
optimum — about 23% upside for tuning, enough to be worth doing, not so
much that ignoring it is ruinous.

### Then: fare became an airline-wide policy

`SimState.farePolicyMultiplier` is one number that prices the entire
network through `recommendedFare()`, which is already distance-aware — so
a single control prices twenty markets sensibly rather than needing
twenty drags. Per-market override stays available via each row's own
slider for the cases that genuinely differ, and
`RouteSettings.fareIsOverridden` marks those so a policy change sweeps
everything *except* them. A per-row Reset puts a market back on policy.

Touching a market's own slider is what overrides it — an explicit
"override this market" checkbox would be a second click for something the
drag already unambiguously means.

This addresses (3) only. A static optimum found once is still a static
optimum; what would actually remove it is competitors responding to
price, which is competitor AI and gated by CLAUDE.md until asked for
directly. Noted as the natural follow-up rather than smuggled in here.

Verified in the browser on a two-market game: policy at 100/150/75%
re-prices both markets proportionally and returns exactly ($230/$237 →
$345/$356 → $173/$178 → $230/$237), preserving the distance difference
between them. Overriding one market pins it at $290 while policy moves
the other to $356; Reset rejoins it at the current policy price ($345);
and the status line tracks "1 of 2 following policy, 1 overridden"
throughout. Zero console errors.

---

## Built: missions and targets

The complaint that started this whole line of work (WEEK-FIVE.md) was
"no clear goal." Every system built since has been machinery *for* an
answer rather than the answer itself. This is the answer.

Two deliberately separate mechanics sharing one currency: **missions are
the game telling you what's worth doing; targets are you telling the game
what you intend to do.** Both pay Reputation, which now has a real
spender (the tech tree) so the currency goes somewhere.

### Missions

Authored content, split the way every data-driven thing in this project
is: `data/missions.json` holds the hand-written parts (name, objective,
flavour, reward) and `sim/missions.ts` holds the *conditions* as real
code, because a completion condition is a predicate over `SimState` and
there's no sane way to put that in JSON without inventing a query
language nobody asked for. Adding a mission is one JSON entry plus one
line in `MISSION_CONDITIONS`.

Checked every tick rather than once a day — the conditions are trivial
reads, and "you bought your first aircraft" landing a simulated day late
would feel broken for what is most players' first contact with the
system. Completions announce themselves in the ticker, using the same
"diff against what I already announced" shape weather and competitor
routes already use.

**No acceptance step this pass.** The original sketch had missions being
accepted before they count, but nothing in the current set has a cost or
risk to weigh, so an accept button would be a click that changes nothing.
Worth adding when there's a mission where declining is a real choice.

First mission, *Wheels Up* — buy or lease your first aircraft, +50
Reputation — themed on Trans-Canada Air Lines, which began in 1937 with
two Lockheed Model 10A Electras and a single Boeing Stearman biplane, and
flew its first revenue service that September from Vancouver to Seattle
in fifty minutes carrying mail and two passengers.

### Targets

The player's half. You name an on-time percentage and an average NPS you
intend to hit; the promise runs 30 days and is judged on what you
actually delivered in that window (its own scoped counters, incremented
by step.ts alongside the today- and lifetime-scoped ones).

Reward scales with ambition above a neutral standard — 80% on-time
(deliberately the same figure `sim/reputation.ts` already treats as
neutral) and 0 NPS. Missing costs **half** what hitting pays.

That asymmetry is the whole design. Without a downside the dominant play
would be to promise the maximum every time and pocket whatever landed;
staking Reputation on the claim turns "pick the biggest number" into a
judgement about what your operation can actually sustain. Keeping the
penalty at half the reward means committing stays worth doing on
balance — the mechanic should encourage engagement, not punish anyone who
uses it.

| promise | pays | costs if missed |
| --- | --- | --- |
| 85% on-time, 10 NPS | +35 | -18 |
| 90% / 25 | +78 | -39 |
| 95% / 40 | +120 | -60 |
| 99% / 60 | +166 | -83 |

A window with fewer than 20 departures expires **unjudged** — no reward
and no penalty. Same reasoning as `REPUTATION_MIN_SAMPLE_FLIGHTS`: with a
handful of flights, on-time percentage says more about luck than about
the operation. It can't be exploited by flying less, since an unjudged
promise pays nothing either.

### Where it lives

Its own sidebar tab, not the Executive ledger the original sketch
proposed. That sketch predates the tab system existing; now that adding a
tab is cheap, burying the game's only statement of purpose underneath
loans and a cash chart would undercut the exact complaint it answers.

### Verified

In isolation: the mission fires the tick its condition holds, pays
exactly once, and never double-pays across 100 further ticks; reward
scaling runs 0 at baseline to 166 at the maximum promise; commitments
resolve at window close, apply the signed Reputation delta, clear
`activeTarget`, and stay unresolved while the window is still open.

In the browser: leasing an aircraft completed *Wheels Up* immediately,
Reputation moved 0 → 50, the card turned green, and the ticker announced
it. A 95%/40 promise committed correctly, swapped the setup block for
live progress, and reported "0 departures in window · 30 days left ·
needs 20 to be judged". Zero console errors.

**One thing the testing surfaced, not fixed here:** the headless test
network runs at ~54% on-time, well under the 80% both this and
`sim/reputation.ts` treat as neutral — so its Reputation bleeds steadily.
A well-scheduled small network hits 91% comfortably (observed in a
one-aircraft browser game), so the baseline looks right and the fixture
is simply a badly-scheduled airline. Worth re-checking against a real
playthrough before trusting either number.

---

## Built: crew, reserves, and crew-shortage cancellations

CLAUDE.md gates crew rostering until asked directly; this was asked for
directly, which is why it hadn't been built alongside fuel.

The design constraint that mattered most was avoiding the failure mode
where staffing is a **tax** — every aircraft costs more per day, click
hire, nothing else changes. Four things stop that: hiring has a lead
time, tiers gate the fleet ladder, training trades capacity now for
capability later, and crew are paid whether or not they fly.

### Three disciplines, modelled differently

Deliberately not three copies of the same thing:

- **Pilots** are a *threshold* — below complement the aircraft doesn't
  fly. Tiered (light turboprop / regional / mainline jet), because type
  ratings are the real progression gate in aviation. A tier-N pilot can
  fly anything rated N or below.
- **Cabin crew** are a threshold too, but untiered. Complement is **one
  per fifty seats** — an actual regulatory standard (FAA and Transport
  Canada both), so 1 on the Beech, 2 on a Q400, 6 on an A330, straight
  from seat counts already in the data.
- **Mechanics** are a *continuum*, not a threshold: shared capacity
  across the fleet rather than something consumed per flight. Running
  thin doesn't stop you flying, it makes airframes behave older than they
  are — `maintenanceAgeFactor()` scales effective age into the existing
  age-delay cause, which is what gives mechanics a real job without
  waiting for a full maintenance system.

Pools, never named individuals. A real roster means duty times, rest
rules and pairing — a second scheduling problem beside the rotation
board, and out of scope permanently.

### Reserve depth, and why cancellations came with it

Reserve depth replaced what was originally going to be a fixed crew-ratio
constant — raised directly, and a better idea: a hidden constant becomes
the player's decision. 1.0 is exactly enough crew to cover the schedule
with normal days off; 1.4 is 40% more. Each day a disruption fraction is
drawn (up to 20%: sickness, rest, recurrent training) and reserve depth
is what absorbs it. Shortfalls are proportional — losing 5% of crew
grounds roughly 5% of the fleet.

**Cost is linear in depth; protection is a threshold.** That's what makes
it a decision rather than a slider with an obvious best setting, and the
sweep finds a genuine interior optimum:

| reserve | heads | salary/day | completion | on-time | margin/day |
| --- | --- | --- | --- | --- | --- |
| 1.00 | 33 | $4,185 | 66.7% | 39% | $5,755 |
| 1.05 | 36 | $4,550 | 80.0% | 46% | $7,137 |
| 1.15 | 40 | $5,065 | 93.3% | 50% | $8,438 |
| **1.25** | 43 | $5,430 | 100% | 54% | **$9,082** |
| 1.40 | 47 | $5,945 | 100% | 54% | $8,567 |

The max daily disruption was tuned to 20% specifically to put that peak
mid-slider: at 15% the safe point sat at 1.15 and everything above was
strictly dominated, and at 25% deeper was always better and the optimum
vanished off the end.

This is also why **cancellations were built in the same pass**. Reserves
trade cost against on-time *and* cancellations, and cancellations didn't
exist — so half the lever's value would have been missing. Only the
crew-shortage slice was built, not the whole design above: weather
severity tiers and mechanical events can join later using the same
machinery. What that machinery is:

- **Completion Factor** as its own HUD stat beside On-Time
  (`completed / scheduled`), the second reliability axis.
- **A flat -80 NPS** per cancellation, per the existing design — not an
  extension of the delay curve, which floors at -50 even for a
  catastrophic delay. NPS now divides by its own denominator
  (`npsScoredFlightsTotal` = departures *plus* cancellations), since a
  cancelled flight never departs and would otherwise vanish from the
  average. On-Time deliberately keeps the departures denominator.
- **A third Reputation term** for completion factor, weighted 120 against
  on-time's 50 — a cancellation isn't a very late flight, it's worse.
  The same small-sample dampening applies, for the same reason.

### The double-charging problem

`costPerBlockHour` already included crew — the Dev tab's cost tree says
so in as many words. Adding salaries on top would have double-charged and
quietly broken the economy, so this is a **carve-out**: 30% of block-hour
cost moved out into explicit salaries. Measured rather than guessed, using
the cost attribution built earlier this week — total daily cost on the
reference fleet moved $16,938 → $18,208, about +7.5%, so crew is a real
new cost rather than a stealth re-tune of everything else.

Salaries are calibrated as a *share* of operating cost (~25%) rather than
to real absolute figures, the same way LOAD_FACTOR and the fuel share
work. Real regional salaries in absolute dollars would make a 19-seat
operation structurally unprofitable — arguably true in reality, but a
poor starting aircraft for a game.

### Hiring is bulk

Not a Fleet-Market-style candidate table: that works at twelve aircraft
but not at forty pilots, and crew are pools rather than individuals
anyway, so named candidates would pretend at a granularity the sim
doesn't have. Order a count at a tier, pay up front, they arrive in 10
days. Training moves pilots up one tier over 21 days and removes them
from the pool immediately — losing their capacity is the real cost.

`createInitialState()` now staffs itself to target, since the headless
fixture exists to be a working airline; left unstaffed every aircraft
would be grounded and the balance tools would simulate an airline that
never flies. A real new game still starts with no crew, because hiring
into a fleet is the mechanic.

### Verified

Hiring lands exactly on day 10 and not before; training returns pilots
one tier up exactly on day 21 with the pipeline cleared; state survives a
JSON round trip. Sweeping reserve depth reproduces the table above.
Browser: pools show have-vs-need with shortfalls in red, the reserve
slider re-derives target headcount live, bulk recruitment queues all
three disciplines with countdowns, and the tier selector correctly
disables for untiered roles. Zero console errors.

**One bug found and fixed during testing:** `startTraining()` subtracted
from a pool without checking availability, so training more pilots than
you had drove the count negative and would have corrupted every
requirement and salary calculation downstream. Now guarded, matching
`repayLoan()`'s existing "silently does nothing if it can't" shape.
`hireCrew()` needs no guard — it only ever adds.

### Added: recurrent cabin service training

Raised directly, and it turned out to be the piece that makes reserve
depth do two jobs instead of one.

Cabin crew can be sent for recurrent service training. They come **off
the line** for 7 days, and since cabin crew are a staffing threshold,
pulling people out counts against the operating minimum and can ground
aircraft. So slack isn't only insurance against sickness any more — it's
also what lets you train without cancelling flights. Thin reserves make
you choose between service quality and completion factor.

Once back, they raise NPS: a fourth component in
`flightSatisfactionScore()`, worth up to **+15 points** at 100% trained,
scaling linearly with the trained share of the cabin workforce. Sized
deliberately between the age nudge (±10/-15) and the delay component
(+30/-50) — service should matter more than a fresh airframe and less
than getting people there on time. It's purely a bonus, never a penalty:
untrained crew are the baseline everything else was tuned against.

Notably it's **the only NPS input the player improves directly** rather
than by buying something. Delay follows from schedule and fleet, fare
from pricing, age from what you bought — this one is a decision on its
own terms.

Deliberately **not** modelled as a tier. Any cabin crew member can staff
any aircraft, so unlike pilot ratings this gates nothing; it's a quality
axis, not a qualification.

**It lapses**, which is the point of "recurrent" — roughly a 180-day
decay, so it's an ongoing commitment rather than a one-time purchase you
make and forget. Newly hired cabin crew arrive untrained too, so growing
the fleet dilutes the trained share: expansion costs service quality
until the new people have been through it.

Verified: sending 6 of 10 drops the pool to 4 immediately and returns it
to 10 at day 7 with 60% trained; the NPS score runs 35 → 50 across 0-100%
trained on an otherwise identical flight; the share decays 60% → 36% →
22% over 90 and 180 days; over-requesting leaves the pool untouched and
the trained count can never exceed the total. `PendingTraining` became a
discriminated union so the two kinds of training can't be confused — a
pilot comes back a tier higher, a cabin crew member comes back trained,
and the type says so.

---

## Built: the C-suite

Four slots — CEO, COO, CFO, CCO — each holding at most one appointment,
paid for in **Reputation**. Placeholder effects by design; the point of
this pass was the architecture and the interface.

That currency choice is the design decision. Reputation is earned slowly
by running a good airline and until now had exactly one spender, the tech
tree. Executives make it a real second — and two of the four convert
Reputation back into *cash*, so a well-regarded airline can borrow
against its own standing. It also puts the whole C-suite out of reach
early: you have to have been good at something first.

### The open question, finally answerable

This doc carried "what do a COO's, CFO's, CCO's and CEO's bonuses
actually *modify*?" as a blocker for weeks, with the note that nothing in
the codebase had an obvious "operations quality" lever waiting for a
multiplier. **That stopped being true this week.** Crew, maintenance,
delays, NPS and marketing spend are all now real systems with real
numbers, so every executive attaches to something that already existed
rather than needing a stat invented for them:

| slot | candidate | effect | attaches to |
| --- | --- | --- | --- |
| CEO | Turnaround chief executive | $200k/year, +40% per payout | cash directly |
| COO | Flight operations | -15% delay on every flight | the delay roll |
| COO | Inflight service | +8 NPS per departure | the NPS scorer |
| COO | Maintenance and engineering | -15% further on effective airframe age | the maintenance age factor |
| CFO | Airline finance | $18k/month, +8% per payout | cash directly |
| CCO | Commercial and distribution | covers the first $400/day of marketing | the marketing charge |

The COO has three backgrounds because that's where the interesting choice
is — the same chair pointed at three different problems. The others have
one candidate each for now.

### Details worth recording

- **Bonuses escalate and seniority belongs to the incumbent.** Each
  payout multiplies the last, so an executive kept on grows more
  valuable; replacing one resets `payoutsMade` to zero. Replacing also
  costs the new appointment's full price with no refund, which is what
  stops slot-shopping being free.
- **Bonuses credit Cash and revenue, never `todayCost`.** They're income,
  and folding them in as a negative cost would break the invariant that
  the cost categories sum to `todayCost`.
- **The CCO subsidises the marketing *charge*, not the spend.** The
  promotion still counts in full toward stimulation and booking share —
  the airline is doing the marketing, it just isn't paying for all of it.
- **The flight-ops COO scales the summed delay, not each cause.** Delay
  attribution stays the raw picture of *why* flights run late, with the
  executive's effect visible as the gap between that and what actually
  happened.

### Verified

Measured over 120 days against an identical seed: the inflight COO moves
average NPS 9.1 → 16.6 (+7.5, slightly under its +8 because cancellations
score flat and take no bonus); the flight-ops COO moves on-time 51% → 53%
and cuts *raw* delay minutes 5.3% even though it doesn't touch the
attribution — because fewer real delays means less knock-on cascading
into later legs, which is the emergent behaviour you'd want. The CFO pays
13 escalating instalments over 400 days ($18,000 → $45,327); the CEO pays
one ($200,000). The CCO drops marketing charged from $2,400 to $2,000 a
day on a $400 allowance.

**The maintenance COO measured as doing nothing at first** — worth
recording, because it isn't a bug. `createInitialState()`'s fixture flies
age-0 aircraft, and effective age is `age x factor`, so zero times
anything stays zero. Re-run at age 20 it cuts age-attributed delay 4.6%.
That's a genuinely nice emergent pairing rather than a flaw: the
maintenance chair is worth most to an operator flying cheap old metal,
and worth nothing to one flying new.

---

## Fixed: the Reputation cliff

Measured after the C-suite landed, because Reputation had quietly gone
from gating nothing to gating three systems — the tech tree, the C-suite
and service targets:

| on-time | completion | NPS | rep/day | days to afford a 300-rep COO |
| --- | --- | --- | --- | --- |
| 51% | 100% | 9 | -10.8 | never |
| 65% | 100% | 10 | -2.3 | never |
| 75% | 98% | 15 | -0.7 | never |
| 80% | 98% | 20 | +3.8 | 80 |
| 90% | 100% | 30 | +13.4 | 23 |

Below roughly 78% on-time the daily delta is negative, so a struggling
airline didn't merely fail to accrue — it banked an ever-deepening
deficit with no floor. A hundred rough days left it near -1000, and even
an excellent airline then needed seventy-odd days of climbing just to
reach zero. Past failure permanently taxed future success, and the tools
that would help dig out were exactly the ones the deficit locked away.

**Fixed with a floor at zero.** It doesn't soften the standard — a
mediocre airline still accrues nothing, which is the intended message —
but the compounding stops, and the moment it improves it starts building
immediately. Negative Reputation had no mechanic attached to it anyway;
nothing cost more or behaved worse for being in deficit, so it was
unbounded punishment with no gameplay behind it.

## Built: seven more missions

The architecture existed with exactly one mission in it. Now eight, each
one JSON entry plus one predicate, roughly in the order a game would meet
them: first aircraft, first route, five airports, twenty crew, $750k
banked, five aircraft, 90% on-time over 100 departures, first executive.
Rewards run 50 to 200 Reputation.

Flavour is real aviation history throughout — the St. Petersburg–Tampa
Airboat Line's twenty-three-minute first service in 1914, Western Canada
Airways flying into Fort Churchill in 1927, Maritime Central Airways out
of Charlottetown, and the 1987 rule that first made American carriers
publish on-time figures.

They also matter more than they did an hour ago: with the Reputation
floor in place, missions are the reliable early income that gets a new
airline to its first tech node or executive.

## Built: weather and mechanical cancellations

The remaining two causes from the original cancellation design, now that
Completion Factor, the NPS penalty and the Reputation term all exist to
receive them. Both feed the same machinery the crew-shortage cause
already used.

- **Severe weather** closes an airport outright. Storms gained a
  severity tier; the worst grounds everything departing from there.
- **Unscheduled maintenance** (AOG) strands an airframe for the day, with
  a daily per-aircraft chance scaling on *effective* age — so it reads
  off the same maintenance staffing the delay model already uses.

`cancellationsByCause` mirrors `delayMinutesByCause`, and the On-Time
panel now shows completion factor and the three causes beside the delay
codes. Splitting them matters because each has a different answer:
reserve depth for crew, maintenance staffing and younger metal for
mechanical, and nothing at all for weather.

Measured over 180 days, the causes stay proportionate and each responds
to its own lever:

| fleet age | reserve | crew | mechanical | weather | completion |
| --- | --- | --- | --- | --- | --- |
| 0 | 1.25 | 0 | 0 | 2 | 99.9% |
| 20 | 1.25 | 0 | 76 | 4 | 96.3% |
| 20 | 1.00 | 720 | 40 | 3 | 64.7% |

### Two things worth recording from getting there

**Severe weather started at 18% and had to come down to 4%.** At 18% it
wiped out 27% of the schedule and moved the optimum on two unrelated
sweep levers. Sub-day closure windows were tried as the alternative and
rejected: weather in this sim is deliberately day-scale, and storms are
created spanning the start of the day, so a real window meant closures
only ever caught the small hours and the mechanic never fired at all.
Matching the model's existing treatment and making severe weather rare is
consistent with how the rest of that file already behaves — and weather
is the one cause with no player lever against it, which is its own
argument for keeping it a background risk.

**The AOG roll skipped already-grounded aircraft, and that was a real
bug.** Skipping made the *number* of random draws consumed per day depend
on how many aircraft happened to be crew-grounded, which changed the
entire downstream seeded history — weather, delays, competitor openings —
between two runs differing only in reserve depth. It silently broke the
balance sweep's core guarantee. Now every aircraft is rolled and the
result discarded for grounded ones, so the draw count is constant.

### Open: margin now favours under-staffing in the fixture

Worth flagging rather than quietly tuning. With crew as a large fixed
cost, the reference network's *margin* peaks at reserve 1.05 (77.7%
completion) rather than 1.25 (99.9%) — cancelling its marginal flights
saves more variable cost than it loses in revenue. Completion factor and
Reputation still order correctly, and in a real game Reputation gates the
tech tree and C-suite, so reliability pays in ways the sweep doesn't
measure. But raw margin currently points the wrong way, and that's a
balance question rather than a bug: it may be the fixture's tight
schedule (56% on-time even fully staffed), or it may mean the marginal
flight genuinely doesn't earn its keep at current fares.

---

## The suppressed-markets register

`data/suppressed-markets.json` — markets the gravity model gets badly
wrong, forced to zero demand, each with its own written reason. The
register exists because these will accumulate, and a bare zero six months
from now would be indistinguishable from a bug.

First entry: **YTZ-YYZ**. Both serve Toronto, 11 nm apart, and the
gravity model reads a same-city pair as two full metro populations at
almost no distance. It is by far the largest "market" on the map and
entirely an artefact — flying it would have been an exploit rather than a
strategy.

Deliberately a **soft** restriction: nothing stops the route being drawn,
it simply carries nobody, so the mistake costs money rather than being
forbidden. That keeps the rule out of the route builder's constraint
logic and lets it read as a property of the world. The builder does
explain itself though — hovering shows "No market — same city" and the
confirmation popover gives the full reason, since discovering this from
an empty P&L would be worse than being told.

## Built: the Airports tab

What the airline looks like at each *field* rather than route by route.

### Presence and connectivity

Every airport the airline touches, with a level derived from daily
departures (Unserved / Outstation / Focus city / Base / Hub) and the
**connectivity multiplier** that concentration earns on revenue.

That multiplier is a deliberate stand-in for something this sim doesn't
model. Real airlines concentrate flying at hubs because a passenger
arriving on one flight can leave on another, and connecting itineraries
remain the heaviest structural lift on any list here (WEEK-TWO.md
decision 1, still unbuilt). This gives the *benefit* of a hub without the
machinery of tracking itineraries through one — it rewards concentration
over scattering, which is the strategic pressure a hub is supposed to
create.

| departures/day | level | multiplier |
| --- | --- | --- |
| 1 | Outstation | x1.019 |
| 4 | Focus city | x1.060 |
| 8 | Base | x1.095 |
| 12 | Hub | x1.120 |
| 40 | Hub | x1.208 |

A flight earns the *average* of its two ends rather than the product, so
hub-to-outstation gets half the benefit of hub-to-hub instead of the two
compounding. Capped at 1.25: this is a proxy, not a measurement, and an
uncapped network effect would make a single mega-hub strictly correct and
every other shape of airline wrong.

### Slots

Only at the two fields on this map that really are slot-coordinated —
**LGA and YYZ**. Everywhere else grows without asking. Every departure
needs a slot; prices escalate 40% per slot already held ($45,000 →
$63,000 → $88,200 → ...), which is both scarcity and a brake on buying a
whole airport at once.

Enforced in the route builder as a hard block with a purchasable answer,
the same shape the range and network checks already use — you're told
which airport, how many you hold, and where to buy more. Existing
schedules aren't retroactively grounded.

`createInitialState()` grants itself the slots its own schedule needs,
same reasoning as the crew it staffs: the fixture exists to be a working
airline, and modelling one permanently over capacity would distort every
balance measurement taken from it. A real new game owns none, because
buying them is the mechanic.

### Verified

Suppression returns zero in both directions with the reason retrievable,
and leaves every other market untouched (YUL-YYZ still 4,668). Slot
pricing escalates as designed and correctly refuses at 6/6; the fixture
covers its own YYZ departure exactly. In the browser both controlled
airports list with live counts, buying updates holdings and price in
place, and the presence table reads empty on a fresh game as it should.
Zero console errors.

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
