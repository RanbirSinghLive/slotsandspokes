# airgame — Week eight (growth as a pipeline)

Handoff document. Week seven's utilisation pivot lives in
`WEEK-SEVEN.md`; read this one first and go there for the pivot's
reasoning.

**State at handoff:** save key `airgame-save-v26`, 11 sidebar tabs.
Aircraft delivery lead times and **training lines** are done and
committed. **The Grow tab — one pipeline view — is next.**

---

## The idea, in one paragraph

Everything the airline grows with — aircraft, pilots, cabin crew,
mechanics, eventually spares — becomes a **pipeline**: you commit money
now and the thing arrives later. Growth stops being a shop where you
click and receive, and becomes a set of lead times you plan around. The
value is *commitment under uncertainty*, not throughput optimisation.

---

## Decisions already made — do not re-litigate

Settled directly with the repo owner.

1. **Aircraft deliveries first**, before any Grow-tab restructuring.
   Smallest slice, biggest effect, ends in something runnable.
2. **Crew comes from funded training lines**, modelled on Hearts of Iron
   production. Fund a line per month; it converts money to people at an
   efficiency that ramps as the line runs. Lines exist for **all three
   roles**; output goes into the existing pools. Supersedes the
   standing-order design, which was built and then replaced — see below.
3. **Surplus stockpiles.** Overproduction is the player's to manage as
   salary drag; the sim does not auto-stop a line. This deliberately
   reverses the auto-stop guard the standing orders had.
4. **"Grow" was never a design.** It was a bucket from week six's
   menu-condensing plan (Fleet Market + Tech Tree + Executive share a
   shelf, not a mechanic). The pipeline idea replaces it and gives the
   tab an actual job. The tab-grouping plan should be re-derived from
   this, not followed as written.

### Explicitly out of scope

- **Throughput/buffer management.** If it drifts into optimising a
  production line it becomes a different genre and the map stops being
  the point.
- **Named individual crew.** Pools with rates is not rostering; CLAUDE.md
  defers rostering and that still holds.
- **Multi-stage aircraft induction** (delivery → paint → C-check → line
  entry). One number carries the same decision.
- **Financing and order deposits.** CLAUDE.md defers financing.
- **Tech tree lead times.** Considered and left alone for now.

---

## Done: aircraft delivery lead times

- `FleetListing.leadTimeDays` in `data/fleet-market.json`.
- `PendingDelivery` + `orderAircraft()` + `resolveDeliveries()` in
  `sim/fleetMarket.ts`, deliberately the same shape as `sim/crew.ts`'s
  `PendingHire`, resolved in the same daily rollover.
- `SimState.pendingDeliveries`. Fleet Market gained a Lead column; the
  Fleet tab gained an Inbound section; `ui/ticker.ts` announces arrivals.

**Lead times are authored against age on purpose.** Old is cheap *and*
quick (14 days for the 21-year 1900D); young is dear *and* slow (90 days
for the 4-year A220). Since `ageYears` already feeds the delay roll, the
cheap airframe now wins on price and speed and loses on reliability —
a three-way trade rather than one dominant answer. Retuning these numbers
is the intended balance lever if the trade turns out lopsided.

Money rules: **full price charged at order**, so lead time costs
something real rather than being a free wait; **lease charges start on
arrival**. The listing leaves the market at order, which also prevents
double-ordering.

---

## Done: training lines

`TrainingLine { id, role, tier, fundingPerMonth, efficiency, retoolDaysLeft,
accrued }` on `SimState`, run by `runTrainingLines()` in the daily crew
pass. Output goes straight into the pools.

**Efficiency scales output, not spend.** A line starts at 20%, reaches
100% in about six months, and costs the same throughout. An immature line
therefore *wastes* money rather than costing less — which is the only
version of this that punishes churn. If efficiency discounted the spend
instead, starting a fresh line would be free and the mechanic would say
nothing.

**The point of all this is fleet commonality.** Adding an aircraft from a
tier you don't already train for is no longer just a purchase; it's a
second pipeline starting cold. Nothing in the game charged for fleet
diversity before, which is odd for a genre where it's the most famous
constraint there is.

**Retooling** points a line at another tier: half its efficiency survives
and it produces nobody for 30 days while still being funded. Retaining
half is what makes retooling better than closing and reopening, so it's a
real choice when a fleet pivots rather than something the player fakes
with delete-and-create. That also means no artificial cap on lines is
needed — starting cold *is* the cost, so concentration is self-rewarding.

Measured over 300 days at $12,000/month: 20% → 33% (day 30) → 60% (day 90)
→ 100% (day 180), producing 1 / 5 / 16 pilots by those marks. Retooling at
day 200 dropped efficiency to 50% and produced **nobody for 30 days while
spending ~$100k** — the fleet-diversity penalty, made concrete.

Scaling by training length falls out of the existing hire costs
(2,600 / 5,200 / 11,000 per pilot tier): the same funding buys far fewer
mainline-jet pilots, because they take far longer to produce.

**Immediate "Recruit" survives** at `IMMEDIATE_HIRE_PREMIUM` (1.75x) —
agency hire, ten-day lead. Without a premium a line would be strictly
worse than buying heads outright, since efficiency never discounts. The
form now quotes both: "$18,200 up front ... a mature line makes the same
head for $10,400."

### Superseded: standing orders

Built and then replaced within the same week. `StandingOrder`,
`runStandingOrders()` and their UI are gone. What survived: `PendingHire`
and the arrival queue, `projectedHeadcount()`, and `crewRequirement()`'s
target — which is now a *readout* of what the fleet needs rather than an
auto-stop.

### Known open point

`crewTier` has three values but there are five aircraft types, and
**A220-300 and A330-300 share tier 3** — so retooling a line from
narrowbody to widebody currently costs nothing, which is exactly the case
the mechanic was asked for. Fixing it means promoting the A330 to a fourth
tier, which extends `PILOT_DAILY_SALARY`, `PILOT_HIRE_COST`,
`TRAINING_COST_PER_PILOT` and the `pilotsByTier` tuple, and needs new
balance numbers. **Deliberately not bundled into the mechanic change** —
it's a balance decision, not a refactor detail.

### Balance risk worth watching

A new game starts with no crew and no lines, so the first pilots are
either an expensive agency hire or a six-month ramp. That may make the
opening too slow. `LINE_START_EFFICIENCY` and the ramp length are the
dials.

## Next: the Grow tab

One pipeline view listing everything inbound with dates — aircraft, crew
hires, training, later spares — with small controls to add to it. **One
list, not one panel per resource**; a panel each multiplies UI for no
gain.

The pieces already exist and are currently scattered: `pendingDeliveries`
shows in the Fleet tab's Inbound section, `pendingHires`/`pendingTraining`
in the Crew tab's pipeline list, and training lines in their own Crew
section. Gathering them is mostly a move, not new mechanics.

Executive hires arriving after a notice period is a natural fit and would
make the C-suite a commitment rather than an instant buy. Worth doing
once the rest works.

---

## Mapmodes (a second thread, not part of the pipeline idea)

Prompted by a separate conversation about borrowing Paradox
(EU4/Vic3/HoI4) map-as-primary-interface principles: recolour the
existing route network by a per-market metric instead of drawing new
geometry, the way those games swap between political/trade/supply
mapmodes on one map.

**Done:** `render/mapmodes.ts` — `'profitability'` (margin ÷ revenue,
via the same `summarizeMarket()` the Commercial panel uses) and
`'ontime'` (`state.onTimeByMarket`, coloured against
`sim/reputation.ts`'s own `OTP_BASELINE` so the map and the Reputation
score can't silently disagree about what "acceptable" means). A
single-select picker in the HUD, mutually exclusive with itself and
taking priority over the Competition overlay when active — both already
recolour the same route lines, so only one can draw at a time. A floating
legend explains whichever mode is on and hides for `'none'`.

`summarizeMarket()` moved from `ui/commercial.ts` into
`sim/marketSummary.ts` so the mapmode could call the identical formula
rather than a second copy of it — pure sim logic, the move was free.

### Done: the alert strip

`ui/alerts.ts` — a strip fixed under the HUD, visible regardless of which
sidebar tab is open, listing every current problem with a click target
that jumps to the tab that explains it. Sources: `scheduleProblems()`
(schedule/utilisation, → Fleet tab) and `state.groundedTails`
(crew-caused grounding, → Crew tab, previously only a bare count on that
one tab). Both used to be invisible unless you happened to have the right
tab open; this is the fix. Signature-gated the same way
`ui/panels.ts`'s `renderFleet()`/`renderRotations()` are, so the row
buttons survive their own re-render instead of being torn out from under
a click.

Verified live: an unbased-but-scheduled aircraft produces the correct
row, the row survives across animation frames, and clicking it switches
from the Crew tab to the Fleet tab. The crew-grounded branch is
code-identical in shape (same push-into-array pattern reading a state
field `ui/crew.ts` already reads successfully elsewhere) and verified
correct headlessly with a forced multi-tail `groundedTails`, but I
couldn't hold it long enough to see live in the browser: it's a value
`rollDailyCrew()` recomputes from scratch at every day rollover, and the
dev-server tab's own "idle tabs catch up in one burst on refocus" quirk
(noted in WEEK-SEVEN.md) meant a rollover fired — correctly clearing it,
since the fixture's actual crew numbers were sufficient — before I could
read the DOM. Worth knowing for next time: don't try to hold a
derived-every-rollover field steady in a live tab; force the underlying
cause (real crew shortfall) instead of the flag, or read it back
immediately after injection with the sim paused from the very first
frame.

### Done: click an airport, get the airport

`ui/airportDetail.ts` — clicking an airport with no plane selected now
opens a real-DOM popover: level and departures/day, slot info when
controlled (red once departures exceed what's owned), based aircraft
plus that base's utilisation and spare, and every market touching the
field with frequency. Read-only on purpose — slot purchase and base
assignment already live in the Airports and Fleet tabs, and duplicating
those controls here would mean two places that can buy a slot. Clicking
elsewhere or Escape closes it; clicking with a tail selected still arms a
route exactly as before, since a selected tail always means the route
builder owns the click (`getSelectedTail()` is the whole priority rule).

`findNearestAirport()` moved out of `ui/routeBuilder.ts` (where it was a
private helper) into `render/airports.ts`, since a second consumer needed
the identical hit-test and "given a screen point, which airport" belongs
to the module that owns the airport list, not the module that happened
to use it first.

Verified live against a seeded fixture with known ground truth: YHZ
(based aircraft, 4 legs) showed the exact right departure count, the
exact right based tail with its real utilisation %, and the exact right
market list with frequencies; YYZ (slot-controlled, at capacity but not
over) showed `slots 1/12` with the over-styling correctly *not* firing at
exactly-at-capacity. Also checked: dismiss-on-click-elsewhere,
dismiss-on-Escape, and — the one that had to not regress — a tail
selected still arms a route on the same click, popover never appears
while arming.

### Noted, not built: basemap render caching

`render/basemap.ts` re-walks the full TopoJSON land geometry and calls
`path.fill()`/`path.stroke()` on every single frame, even though the
shape only changes on pan/zoom. Caching it to an offscreen canvas
(re-rendered only when `projection` changes, blitted with `drawImage()`
otherwise) would turn a 60×/second geometry walk into a single blit, and
is what makes any further basemap richness (ocean tint, a graticule,
country borders instead of just coastline) cost nothing per frame once
built. Worth doing before adding any of those, not after.

### Done: the capacity ring (replaces the slot ring)

A deep dive into "is utilisation actually legible on a map" found it had
**zero presence on the canvas** — the whole point of the week-seven pivot
lived only in a Fleet-tab bar, a route-builder popover, and a table. None
of that is the map. `render/airports.ts` now draws a partial-arc ring
around every *based* airport: it sweeps from empty to a closed circle as
a base's pooled utilisation goes 0% → 100%, colouring green-to-amber over
that same range, then turns solid red and thickens the instant share
passes 100% — the exact threshold `sim/utilisation.ts`'s
`utilisationProblems()` already uses to raise an alert-strip warning, so
the ring and the alert can never disagree about what "broken" means.

This **replaces** the old slot ring rather than sitting beside it — a
deliberate call, not a compromise: slots were reclassified as supporting
infrastructure, not core loop, in the same audit that sharpened the core
loop down to build → watch it run → diagnose why. The slot mechanic
itself is untouched (still gates route-building, still shown precisely in
`ui/airportDetail.ts`'s popover — verified live, `slots 1/12` still reads
correctly on click); it only lost its own always-on map glyph once
utilisation needed that visual slot more.

Verified live against a fixture with a genuinely overloaded base (123%,
built by duplicating a rotation's legs): the ring rendered solid red and
visibly thicker at that airport in a real screenshot, matching the
alert-strip warning and the Fleet-tab figure exactly. Two lower-risk
things — the exact green-to-amber hue at partial shares, and the ring's
absence at non-base airports — were reasoned through and match the code,
but weren't independently pixel-verified; a repeat of the pixel-sampling
approach used for mapmodes hit stale-coordinate issues this time and
wasn't worth re-fighting for a purely cosmetic gradient.

Deliberately not built alongside this: a rotation-arc recolour by its own
day-share, and a dedicated Utilisation mapmode. Both answer a real but
more granular question ("which specific rotation is the heavy one") that
only matters *after* this ring says a base is tight — building either now
would be exactly the unforced complexity the same audit just cut two
tabs for.

---

## Carried forward from week seven

- **Phase D of the utilisation pivot is still outstanding**: Commercial
  becomes a Routes tab carrying aggregated per-market data, fare policy at
  the top, tab and icon renamed. Deliberately deferred in favour of this
  work; it doesn't block anything here.
- **Spares** — operational and heavy-maintenance, plus `timeUntilHeavyCheck`
  on `Aircraft`. Requested by the owner and written up in WEEK-SEVEN.md.
  It fits this pipeline framing exactly and would give `ageYears` its
  third consequence. Note this lifted CLAUDE.md's do-not-build entry for
  maintenance planning.
- **Margin still favours under-staffing.** Peaks at reserve depth 1.05
  rather than 1.25. A balance decision for the owner, not a bug to tune —
  and standing orders may change it, since hiring becomes a rate rather
  than a lump.
- **Tab grouping** 11 → ~6, never started. Re-derive it from the pipeline
  idea rather than following week six's proposed buckets.

### Done: aircraft types collapsed to four size classes

`data/aircraft-types.json` went from five real-world types (1900D, Dash
8-300, Q400, A220-300, A330-300) to four generic classes, in size order:
`PROP` (25 seats), `REGIONAL` (75), `NARROWBODY` (150), `WIDEBODY` (300).
Costs, range and cruise speed were carried over from the nearest old type
(the Q400 became the regional, the A220 the narrowbody, the A330 the
widebody, scaled up to the new seat counts); the propeller kept the 1900D's
range and cruise speed so `data/schedule.json` still fits inside it. Crew
tiers are unchanged (1, 2, 3, 3), so the widebody-retooling-is-free gap
noted above is still open.

Knock-on edits: the Fleet Market lost its two Dash 8-300 listings (10
listings now, 4/2/2/2), the two airport size caps were renamed (YTZ
`REGIONAL`, LGA `NARROWBODY`), and `SAVE_KEY` went to `v27` because saved
games carry the old type codes.

**This is a deliberate balance change, not a refactor.** The headless
runner's fixed fleet is built from `aircraft-types.json[0]`, and a 25-seat
propeller earns about a third more than a 19-seat one on the same costs:
`npm run headless` final cash moved from $2,207,661 to $3,019,697. Fares,
demand and the opening $500,000 were left alone, so the starter airframe
is now the most forgiving it has been.


### Done: crews parked behind a switch

`CREWS_ENABLED` in `src/sim/features.ts` is `false`. It is a sim-level
switch, not just a hidden tab: with it off `rollDailyCrew()` charges no
payroll and grounds nothing, `maintenanceAgeFactor()` assumes a fully
maintained fleet, `cabinServiceShare()` reads 1 (service is neither
rewarded nor penalised), and `economy.ts` stops carving the 30% crew slice
out of block-hour cost, so it stays inside block cost instead of vanishing.
The Crew tab button is `hidden`. Nothing was deleted: set the flag to
`true` and remove the `hidden` attribute to get the old system back.
`SimState` didn't change, so the save key stays `v27`.

Balance moved again: `npm run headless` final cash $3,019,697 to
$4,586,231 (no payroll, no crew cancellations). `npm run sweep -- reserve`
is now flat and meaningless while the flag is off.


### Done: mini-metro pass (start with planes, fewer tabs, zero cash ends the game)

- **A new game starts with two owned propeller planes based at YUL**
  (`createStartingFleet()` in `sim/state.ts`), so the first move is drawing
  a route from the map. $500,000 is still the opening cash.
- **Only Fleet, Fleet Market, On-Time and Game tabs are visible.** Commercial,
  Executive, Airports, Missions and Dev are `hidden` (Dev returns with
  `?dev` in the URL). Fares and marketing stay at their defaults, loans are
  unreachable.
- **`FUEL_PRICE_MOVES` and `SLOTS_ENABLED` (`sim/features.ts`) are `false`**
  so the parked tabs don't leave invisible rules behind: fuel is pinned at
  its baseline and no airport is slot-controlled.
- **`isInsolvent()` is just `cash <= 0`.** The loan code is dormant.
- **Bug fixed:** `#sidebar-tabs button { display: flex }` beat the `hidden`
  attribute, so hidden tab buttons (Tech Tree, Crew and the rest) were never
  actually hidden on screen. The last tuck-away was only checked via the
  `hidden` property. Fixed with a `[hidden]` rule.
- Leftovers from this list are handled in the next section.

`npm run headless` final cash is now $5,484,951 (was $4,586,231 before fuel
and slots were parked).


### Done: Fleet Market is four class rows

`data/fleet-market.json` is now a four-line price list, one row per
aircraft class, with unlimited stock. The ten individually named used
airframes are gone: no registrations, ages or per-airframe lead times.

- Prices (buy / lease per day): propeller $890,000 / $700, regional
  $13.5M / $2,600, narrowbody $42M / $7,200, widebody $62M / $14,000. The
  first three are the youngest old listing of each type; the widebody is a
  new number (the old one was a 12-year-old airframe). All tunable.
- Lead time was 1 day for every class here; the map menu made it 0.
- Tails are generated on order (`C-P001`, `C-R001`, `C-N001`, `C-W001`).
  Aircraft are bought at age 0, so age-driven delays and breakdowns are
  dormant.
- `fleetMarket` is no longer in `SimState` (it was a list that shrank as
  you bought); the catalogue is static data. `SAVE_KEY` went to `v28`.
- Buy is greyed out unless it leaves cash above zero, since zero cash ends
  the game. Lease has no such check: at $500,000 you can lease a $14,000/day
  widebody straight away.


### Done: HUD and ticker leftovers

- The HUD keeps Cash, On-time, Completion and Today's revenue, cost and
  margin. NPS and Reputation rows are removed (deleted, not hidden: `.econ-row`
  sets `display`, which would beat `hidden`). Both are still computed.
- `MISSIONS_ENABLED` (`sim/features.ts`) is `false`: `checkMissions()` does
  nothing, so no mission completes or announces itself.
- The ticker no longer announces competitor route openings. The openings
  themselves are **not** frozen: with them frozen `npm run headless` final
  cash fell from $5,484,951 to $3,412,029, because competitor frequencies
  also stimulate demand (`COMPETITOR_ASSUMED_SEATS` in `marketDemand.ts`).
  They still show on the map flash when the Competition overlay is on.
  Whether to freeze them is a balance call for the owner.
- Ticker events now: weather forming and aircraft deliveries.


### Done: the map menu (radial buttons, planes chosen for you)

Clicking the map now opens one radial menu, for two kinds of thing. The
menu is `ui/radial.ts` (a generic ring of circular DOM buttons: fixed
angle per action, an optional fan of choices around one action, disabled
buttons that say why on hover, a two-click confirm for destructive ones).
`ui/mapMenu.ts` decides which actions each thing gets and replaces
`ui/airportDetail.ts`; `ui/routeActions.ts` holds what the actions do to
the network.

- **Airport:** Route (arms the route builder), Plane (a fan of the four
  classes; each button leases one, which arrives immediately, based and
  parked there).
- **Route (click the line):** upgauge and downgauge one flight, remove and
  add one flight, remove the route (asks twice). The unit of change is one
  flight, so a route can be mixed-class and every click has an opposite.
- **Nobody names a tail any more.** `armRouteBuilderAt(airport, null)` arms
  in automatic mode and `autoPickTail()` chooses the smallest class whose
  plan fits (range, airport size, day length). Frequency and gauge reuse
  `planRotation()`/`commitRotation()` (now exported from `routeBuilder.ts`),
  so a rotation built by a button is identical to one drawn by hand. Gauge
  moves a flight to a plane of the next class based at the same airport;
  with none, the button says to add one.
- **Only there-and-back rotations** are changed by these buttons. A route
  flown only as part of a multi-stop rotation shows a disabled button
  pointing at the Fleet tab.
- The Fleet Market tab is hidden; planes are leased from the map and
  **leasing is the only way to get one** (owned starting planes aside).
  Lead time is 0 days, `PendingDelivery` gained `baseAirport`, and
  `SAVE_KEY` is `v29`. The Fleet tab is still there as a read-out (rotation
  list, utilisation) and still allows the old select-a-tail flow.
- Not built yet: hover previews on the map, per-class pool bars (the plan's
  next step), a way to buy instead of lease.


### Done: utilisation as class pools

Utilisation is now read per aircraft class, since that is the level a
player decides at ("do I need another Regional here"). `utilisationPools()`
in `sim/utilisation.ts` returns the four pools (planes, minutes used,
share), for the whole fleet or for one base.

- **Map overlay** (`ui/poolBars.ts`, bottom-right of the map): one bar per
  class that has planes, in the capacity ring's colours. Updates only when
  a visible number changes.
- **Airport and route cards** show the same bars for the planes based at
  that airport. The old "Based: C-FSTA (PROP)..." tail list is gone from
  the cards.
- **The ring on each base** now shows the *fullest* class pool there
  (`worstPoolShareByBase()`), not the average of all planes, so an idle
  widebody can no longer hide a full propeller pool. Red still means a pool
  at or over 100%, the same threshold as the alert strip.
- `capacityColor()` in `render/airports.ts` is the one colour scale for the
  ring and the bars.
- The sidebar's per-base bar in the Fleet tab is unchanged (pooled across
  classes) and is now the odd one out.


### Done: hover previews

Hovering an enabled route-ring button shows what it would do before it is
pressed. `render/preview.ts` holds one transient `MapPreview` (never in
`SimState`, never saved): pool-minute effects plus the routes to
emphasise. `ui/routeActions.ts` already computed every action's plan to
decide whether it was enabled, so each `preview*` now returns the effect
along with it and the button carries it (`RadialAction.preview`).

- **Bars** (overlay and card): a touched class shows "21% -> 28%" and a
  ghost segment (extra booking in the new colour; freed time hatched).
- **Base ring:** a dashed arc just outside the real one at the new
  fullest-pool share.
- **Route arc:** green for an added flight, amber for a gauge change or a
  removed flight, red dashed for removing the route.
- Cleared when the pointer leaves, when the menu closes, and when an
  action rebuilds the ring.
- Not previewed: the airport ring (Route has nothing to show; leasing a
  plane would change a pool's size rather than its bookings).


### Done: Fleet tab trim, one popup at a time

- **The Fleet tab is one section: the rotations list.** The tail table
  (with its base dropdowns), the per-base utilisation bars, the Inbound
  list and the select-a-plane hint are gone, along with their code in
  `ui/panels.ts` and their CSS. Rows show the plane's class ("Propeller");
  the tail is on hover. Bases can now only be set by leasing at an
  airport, so nothing in the UI assigns or changes one.
- **The hover tooltip** (`ui/competitionTooltip.ts`: who flies this, plus a
  presence line that duplicated the click card) now only appears while the
  Competition overlay is on, and never while a click menu is open. Opening
  a menu hides it. Before, both popups showed on the same airport.
- Dead code left in place: `ui/fleetSelection.ts` and the select-a-tail
  branch of `handleRouteBuilderMouseDown` can no longer be reached, since
  nothing sets a selected tail. Some messages still say "assign a base in
  the Fleet tab" (`sim/utilisation.ts`, `planRotation()`), which can now
  only happen from an old save.


### Done: lease-only fleet, lease preview, dead code removed

- **Every aircraft is leased.** `sim/leasing.ts` replaces
  `sim/fleetMarket.ts`: a rate card (`data/lease-rates.json`, per class per
  day, unchanged from the old lease prices) and `leaseAircraft()`, which
  adds the plane, based and parked at the airport, with no delivery step.
  There is no purchase price and no `ownership` field. The two starting
  planes are leased too, so a new game pays $1,400/day from day one. The
  reasoning: outright prices ($13.5M regional, $42M narrowbody) can never
  be reached inside one game, so the buy option was a button nobody could
  press. Lease rates themselves are untuned.
- **Deleted:** the Fleet Market tab and `ui/fleetMarket.ts`, the delivery
  pipeline (`PendingDelivery`, `resolveDeliveries()`, the step hook, the
  `pendingDeliveries` state field, the ticker's "delivered" line),
  `ui/fleetSelection.ts` and every select-a-tail branch in the route
  builder and map menu, and the unreachable "no base" and "change its base
  in the Fleet tab" messages. `SAVE_KEY` is `v30`.
- **Lease preview:** hovering a class in the Plane fan shows the pool
  growing ("Propeller x2->3", share falling, a new row for a class you
  don't own yet). `PoolEffect` gained an optional `planes` field, so a
  preview can change a pool's size as well as its bookings.
- Headless final cash is $4,718,451 (was $5,484,951): the fixed 3-plane
  fleet now pays its lease, exactly 3 x $700 x 365 = $766,500 less.


### Done: unmet demand on the map by default

The map now shows demand nobody is carrying, without turning on the Demand
overlay (which is still there, for the full web of every market). Two
signals, defined in `sim/unmetDemand.ts` and kept apart because they answer
different questions:

- **Hollow pips** around each airport: *latent* demand, the potential of
  every market touching it minus the seats you put in that market, half
  attributed to each end. Mostly geography (LGA and the big Toronto,
  Montreal and Boston pairs dominate: the median pair's potential is 13 a
  day, the largest 29,854), so it says where the opportunity is and
  barely moves as you play. Log scale (`pipCount()`): 1 pip for a town of
  ten a day, a full ring of 12 for a big city.
- **Solid amber pips**, and an **amber route line**: *spilled* demand, on a
  market you already fly, today's stimulated demand beyond the seats
  offered. This is the responsive one. Solid pips fill the ring first.
- The airport card reads "Waiting: N potential riders/day, M turned away".
- Not counted: competitors' seats (this is your view of what you are not
  carrying) and unserved markets' 10-a-day floor (identical everywhere, so
  it would only be noise).
- Spill is rare early: demand starts near 10 a day against 25 seats and
  grows at 5% of the gap per day scaled by how saturated the market is, so
  a thinly served big market takes a long time to spill. Tested with a
  hand-built save (120 demand against 50 seats: 3 solid pips at each end).
- The route line only turns amber in the default map; the Profitability,
  On-Time and Competition views draw their own colours.


### Done: lease rates tuned against what a plane earns

`npm run lease` (`src/headless/lease.ts`) flies one plane of each class on
a market it suits, round trips all day, with its own lease zeroed, and
prints earnings per day at days 30, 90 and 180, per flight, and how many
flights a day it takes to cover the lease. It is the tool to re-run when
anything in the economy moves.

What it found: the old rates ($700 / $2,600 / $7,200 / $14,000 a day) were
0.3 to 1 flight of margin at day 90. A propeller earns about $28,000 a day
before lease on YUL-YOW, a narrowbody about $220,000 on YUL-YYZ, so an idle
plane cost almost nothing and there was no pressure to right-size the fleet.

**The rule:** a plane covers its lease with about **two flights a day** on
a market it suits, at day-90 demand. Per-flight margin at day 90 is about
$2,200 (propeller), $8,500 (regional), $23,000 (narrowbody) and $30,000
(widebody), so the rates are **$4,400 / $17,000 / $46,000 / $60,000** a
day. Consequences, all from the tool:

- Early on a plane needs more: 4 to 5 flights a day at day-30 demand. A
  starting propeller flying one round trip a day is about -$9,000 at day 30
  and +$86,000 at day 90; two round trips a day is +$81,000 at day 30.
  Flying five round trips a day from day one burns about $89,000 by day 10
  (demand is still near 10 a day) and wins by day 60.
- A big plane on a thin or long market loses: a regional on YYZ-YHZ (696 nm)
  loses $8,000 a day before lease, a narrowbody $47,000.
- Widebody is only 1.3x narrowbody because on this small map its earnings
  are limited by demand, not seats, so it pays off only on the very biggest
  markets.
- **A lease now needs 14 days of it in cash on hand**
  (`LEASE_RESERVE_DAYS`, `sim/leasing.ts`), replacing "cash covers a day".
  At the $500,000 opening that allows Propeller and Regional and holds
  Narrowbody ($644,000) and Widebody ($840,000) until the airline has
  earned its way there.
- Starting planes now cost $8,800 a day, so 500k of cash is about 57 days
  of doing nothing. `npm run headless` final cash is $666,951 (was
  $4,718,451): the fixed 3-plane fleet pays $13,200 a day in lease and
  still nets a profit at 4 flights a plane a day.

Caveats: one seed, one plane, no competitors' response beyond the
starting ones, and the economy itself is generous (a mature plane clears
about $90 a seat on a short hop); the rates are sized to that economy as it
is. The two-flights target and the 14-day reserve are the two numbers to
move first if it plays too hard or too soft.


### Done: the world hubs (data slice of the escalation plan)

`data/airports.json` grew from 19 airports to 40. The 19 are untouched
(census populations, everything tuned so far rests on them); 21 world hubs
were added by `npm run airports` (`src/headless/buildAirports.ts`), which
reads OurAirports (coordinates) and GeoNames (populations, time zones),
caches the downloads in `data/.cache/` (git-ignored), and is safe to rerun.

- **The 21:** DTW PHL DCA ORD ATL MIA DFW LAX YVR MEX (North America), LHR
  CDG AMS FRA DUB KEF (Europe), DXB HND SIN GRU JNB. One airport per metro,
  so no new same-city pairs. Dense enough to hop in a propeller from the
  north-east (DTW, PHL, DCA, ORD) and from western Europe; the rest are
  destinations for the bigger classes.
- **Population** is the GeoNames city total within 30 km, chosen by
  checking the method against the census numbers for the 11 existing
  airports over 100,000 people: within about 16% on average. It is rougher
  abroad: Atlanta comes out at 1.1 million (real metro about 6), Mexico City
  at 30 million (about 22), Keflavik at 36,000. Edit a number in the JSON
  to fix one. Time zones are standard (no DST), like the rest of the file.
- **Competitors** now grow outward: a new route must touch an airport the
  airline already flies and be within 850 nm (`COMPETITOR_MAX_ROUTE_NM`).
  Without it the AI would open Toronto-Singapore, and weight all its
  openings toward the biggest European pairs.
- **Headless is noisy.** The same change moved seed 1 from $667k to $281k,
  but over six seeds the mean is $169k before and $209k after, with single
  results swinging by more than $1M either way. Do not read a headless
  number from one seed.


### Done: choose your home city

A new game (no save to resume) opens a "Choose your home city" picker over
the paused map. Choosing puts the two starting propellers at that city,
saves immediately, refits the map around it, and starts the clock.

- **Who can be home:** `homeOptions()` in `sim/homes.ts` offers a city if at
  least 3 other airports are within propeller range (380 nm) *and* have a
  market with it. Derived from the data, so a new airport can add a home
  without touching code. 24 cities qualify today, from Boston (12 within
  reach) and Montreal (11) down to Frankfurt and Paris (3). Chicago,
  Atlanta and Dublin do not: too few neighbours.
- **The map follows the home:** `fitProjection()` takes the home's
  coordinates and frames a 30 by 15 degree box around it (the size of the
  old fixed eastern-Canada box), so a London start shows Dublin, Amsterdam,
  Paris and Frankfurt.
- `SimState.homeAirport` records it; `SAVE_KEY` is `v31`. The headless
  fixture still starts from Montreal.
- Spacebar is ignored while the picker is open, so the clock cannot start
  behind it.
- Known leftover: the loan-offer modal in `ui/loans.ts` can no longer be
  reached (cash at zero ends the game), and is dead code.


### Done: fog by reach

Only airports you could fly to are shown; the map opens up as you grow.
Rules live in `sim/reach.ts`:

- **Network** = your home city, every airport a plane is based at, and
  every airport a rotation touches.
- **Reach** = the range of the biggest class you have leased (380 nm to
  start).
- An airport becomes **known** when it is within reach of a network
  airport, and **stays known** (`SimState.knownAirports`, only ever grows;
  `SAVE_KEY` is `v32`). Removing a route or a plane never re-closes the
  fog. Revealing is not transitive: a newly known airport only opens its
  own ring once you fly there.
- `revealReach()` runs after a lease, after a rotation is committed, when a
  home is chosen, and once a day as a backstop. Cash decides when: leasing a
  class needs 14 days of it on hand.

What the player sees: unknown airports are not drawn, not clickable (the
hit-test respects it), not in the pips or demand overlay or competitor
layer, and their weather is not announced. A dark fog sheet covers the
rest of the map (`render/fog.ts`), with clear circles around the network
out to your reach and small discs around known airports. The ticker says
"New airports in reach: DUB". Tested from Paris: a Propeller hop to London
revealed Dublin; leasing a Narrowbody (2,400 nm) opened Iceland and the
Newfoundland airports. The zoom-out limit went from 0.5x to 0.15x so a
widebody's reach can be seen.

Limits worth knowing:
- Fog circles are capped at 40 degrees (2,400 nm): a bigger circle would
  swallow a pole, which Mercator cannot draw. Beyond that airports are
  still known and drawn, in their own small clear disc, but the fog sheet
  is not lifted around them.
- Nothing stops you flying to an airport that is known but beyond a
  plane's own range; the route planner refuses it, as before.
- At world zoom the labels of a dense cluster overlap; a proper level of
  detail is not built.
- Not built: time pressure, and long-haul balance. Fares, demand and lease
  rates were tuned on the small map, and a widebody is only 1.3x a
  narrowbody there.


### Done: time pressure

Standing still now loses ground. Everything is in `sim/pressure.ts`, one
place to tune:

- **Rivals enter.** From day 15, and every 20 days after, up to 5, a new
  airline (`data/rival-airlines.json`) opens one daily flight next to the
  player's network. 70% of the time it goes straight for a market the
  player already flies. Needed because every seed competitor is Canadian: a
  London or Paris start had no rivals at all. `rollRivalEntry()` in
  `sim/competitors.ts`; "how many have entered" is read off the routes, so
  no new state and no save bump.
- **Rivals grow.** Each competitor route adds a daily flight with
  probability 0.8% a day times `pressureFactor()` (1 at day 0, 2 at day 90),
  up to 4 a day. New-route openings scale by the same factor.
- **Rivals cut your fares.** `rivalYieldFactor()`: up to 40% off your
  average fare, in proportion to the rivals' share of the market's flights.
  Four rival flights against four of yours is -20%; against fourteen, -9%.
  More flights of your own is the counter.
- **Demand grows** 0.3% a day (was 2% a year): about 1.4x in four months.

**Why the fare cut.** Measured first: a rival with 4 flights a day on a
plane's only route changed its 90-day profit by nothing, even nudging it
up. Markets here are seat-limited (demand in the hundreds against 25
seats), so a rival splitting demand leaves every plane full, and a rival's
seats also stimulate the market (`dailySeatsOffered()` counts competitor
seats). Competition only mattered once it touched the price.

Effects, from `npm run lease -- 365` and six-seed headless runs:
- A starting propeller on YUL-YOW, cumulative profit after lease at day 365:
  1 round trip a day -$346k (was +$444k); 2 a day +$679k (was +$2.9M); 3 a
  day +$2.2M (was +$5.2M); 5 a day +$4.7M (was +$7.9M). Growing still
  wins; stopping loses.
- The fixed 3-plane headless fleet averages -$172k a year over six seeds
  (was +$397k): a static airline decays.
- Lease break-even is now about 2.5 to 3.8 flights a day at day 90, against
  the 2 the rates were tuned for. Re-tune leases if that feels too harsh.

Legibility: the ticker announces rivals that touch your network ("Harbour
Express opens LHR-CDG", "adds a flight on ..."); the route card reads
"Rivals: Harbour Express 1/day. They cut your fares 8%"; the Competition
overlay's airline list now rebuilds as rivals arrive.


### Done: long-haul economics

Measured first with `npm run lease` on long routes (the tool now includes
them): a widebody on Toronto-London lost **$49,000 per flight before its
lease** ($97,000 a day), and nothing over about 3,300 nm could be
scheduled. Three causes, three fixes:

1. **The choice model priced fares in absolute dollars** (tuned around
   $185). A $1,577 ticket put the leisure segment's utility at -21, so a
   plane with 347 passengers wanting each flight carried about 8.
   `sim/choiceModel.ts` now judges a fare *relative to the going rate for
   that trip* (`recommendedFare()`), rescaled to `REFERENCE_FARE` = $280 so
   every existing weight means what it did. A market priced at the going
   rate gets the same price penalty at any distance.
2. **Fares were linear in distance** ($1,577 at 3,082 nm; real ones are
   about 3x a 500 nm fare at 3,000 nm, not 6x). Past 500 nm a mile now adds
   $0.18 instead of $0.45 (`sim/schedule.ts`). Every fare of 500 nm or less
   is unchanged; Toronto-London is $880.
3. **The 06:00-22:00 window made intercontinental routes impossible.** A
   plane that does nothing else may now fly **one long-haul round trip a
   day around the clock** (`isLongHaulRoundTrip()`, `sim/utilisation.ts`):
   two legs, longer than the usable day, cycle under 24 hours. It counts as
   exactly one full plane (100%, not the 141% the clock would say), so no
   false over-booked alert. This opens Dallas-London (4,118 nm),
   Los Angeles-Tokyo (4,758) and London-Johannesburg (4,900). Windows that
   land the next morning now read "06:00-04:02 +1". Pool bars and rings go
   red only strictly above 100%, matching the alert.

Results at day 90, before lease, one plane, one route
(`npm run lease -- 180`):

| Class | Route | Per flight | Per day |
|---|---|---|---|
| Widebody | Toronto-London (3,082 nm) | $130,600 (was -$48,700) | $261,000 |
| Widebody | London-Dubai (2,969) | $128,200 | $256,000 |
| Widebody | Dallas-London (4,118) | $72,300 | $145,000 |
| Widebody | London-Johannesburg (4,900) | $84,400 | $169,000 |
| Narrowbody | Toronto-Los Angeles (1,887) | $50,600 (was $18,200) | $101,000 |
| Narrowbody | Toronto-Dallas (1,041) | $43,800 | $175,000 |

Short and medium markets barely moved (Propeller Montreal-Ottawa is
identical at day 90; the starting propeller's year table is within 3%). The
fixed 3-plane headless fleet averages +$49k a year over six seeds (was
-$172k after time pressure, +$397k before it).

**Leases are unchanged.** They already sit at about 17% (propeller) to 30%
(narrowbody) of a full day's earnings on a market the class suits, and the
widebody's $60,000 is about 23% of a transatlantic day.

Things this does *not* settle:
- **A widebody earns a lot on short routes too** (Toronto-Boston $253,000 a
  day): big planes fill wherever the market is big, so the class ladder is
  limited by the cash gate and lease rate, not by geography. Right-sizing
  still matters on small markets (a widebody on Montreal-Ottawa loses for a
  month), but "widebody = long-haul only" is not enforced.
- **The whole economy is generous**: a mature plane clears $100-260k a day
  against a $500,000 start, so past the early game cash stops mattering.
  Time pressure (rival fare cuts) is the only thing pulling it back.
- Long-haul rotations are a single round trip, one plane each; adding a
  flight to such a route needs a second plane.


### Done: one starting propeller, and an icon for each class

- **A new game starts with one propeller** (`STARTING_PLANES` = 1 in
  `sim/state.ts`), not two: the pool reads "Propeller x1" and the lease is
  $4,400 a day rather than $8,800.
- **The Propeller is the only class you can lease at the start.** The cash
  gate is what unlocks the rest, so `LEASE_RESERVE_DAYS` went from 14 to 30:
  a class needs 30 days of its lease on hand. At the $500,000 opening the
  Propeller needs $132,000, the Regional $510,000, the Narrowbody
  $1,380,000 and the Widebody $1,800,000, so each bigger class opens when
  the airline has earned it. The locked buttons stay in the fan and say
  what they need. Note the Regional sits only $10,000 above the opening
  cash, so it is one decent week away.
- **Four unique icons** (`ui/planeIcons.ts`), top-down, told apart by
  shape: Propeller (straight wings, a propeller bar across the nose),
  Regional (swept wings, two rear engines, T-tail), Narrowbody (long swept
  wings, an engine under each), Widebody (wider fuselage, longest wings,
  two engines under each). They replace the one plane glyph scaled four
  ways in the lease fan (now 22 px, `RadialAction.large`) and appear next
  to the class name in the pool bars (map corner and both cards) and the
  Fleet tab's rotation list.
- The lease tool's starting-propeller table still models one plane.


### Done: why five Montreal-Toronto round trips lose money at first

Reproduced from the rules (one starting propeller plus a second for the
fifth round trip, home Montreal, seed 3) and measured. Day 1: ten flights a
day carry about **one booked passenger each** (the market's stimulated
demand starts near 10 a day, split across ten flights, then only 37% of it
books us) while each flight costs about $2,100. That is -$28,000 a day
including $8,800 of lease. Demand grows about 5% of the gap a day, so
the route reaches break-even around day 21 to 40 and then pays.

Cumulative profit after every cost, propellers, as many as needed:

| Round trips/day | Deepest hole | Day 30 | Day 90 |
|---|---|---|---|
| 1 | -$124k, never recovers | -$84k | -$124k |
| 2 | -$83k (day 15) | +$2k | +$474k |
| 3 | -$100k (day 13) | +$18k | +$893k |
| 4 | -$170k (day 17) | -$63k | +$748k |
| 5 | -$198k (day 14) | -$141k | +$958k |

So five is not a mistake in the long run, but it burns about $200,000 of a
$500,000 start in the first two weeks; three round trips is the better
opening, and one is too few to ever pay its lease.

**Two real causes, both fixed here:**
- **The incumbent's fare was stale.** The four seed competitors charged
  $170 to $210, typed in before fares were recalibrated upward, so each
  undercut the going rate by 23% to 51% (Trillium Air on Montreal-Toronto:
  $210 against $313). A player charged the going rate lost most bookings on
  those markets by construction. `sim/competitors.ts` now computes them as
  90% of the going rate and the `fare` fields are gone from
  `data/competitors.json`. Effect on five round trips: deepest hole
  -$198k becomes -$134k, day 90 +$958k becomes +$1.17M.
- **The map made a young market look big.** "Waiting: 20,000 potential
  riders" is ceiling, not demand, and reads as "add flights". The route
  card now says "Demand is still growing: extra flights fly emptier for
  now" when demand per flight is under 40% of the seats, and the Add
  button says how thin it would spread ("about 4 passengers wanted per
  flight after, 25 seats, mostly empty for now").

Not changed, by design: the rival fare cut (a small player up against a
2-a-day incumbent takes -20% on fares until it flies more itself), and the
slow demand ramp.


### Done: speeds are 1x, 20x, 100x

The speed buttons were 1x / 4x / 20x and are now 1x / 20x / 100x. Checked
before changing: a large late-game airline (30 planes, 240 legs a day)
costs about 48 microseconds a step, so 100x is about 13 steps a frame or
0.64 ms of a 16 ms frame. In the browser it holds 60 fps and a simulated
day takes about 1.8 seconds. One guard added: `MAX_FRAME_DELTA_MS` (250)
caps how much real time a single frame feeds the simulator, so a
backgrounded tab (which pauses animation frames) cannot come back to
hundreds of thousands of steps in one go at 100x.


### Done: hold-to-repeat on the route ring, and a reliable way into it

Getting a route to several flights a day, or bumping several same-class
flights up together, meant clicking the same ring button once per flight
— tedious, and the exact complaint "keep clicking add route add rotation
to get a bunch of short-haul legs added." Fix: holding Add flight, Remove
flight, Upgauge or Downgauge now repeats it (after a short delay, then on
an interval) instead of firing once. No new capacity-tracking logic was
needed — every click already tears the ring down and rebuilds it with
fresh `disabledReason`s, so the repeat loop just looks its action back up
by id after each rebuild, and stops itself the instant that fresh lookup
says it can't go further (fleet out of room, already the largest class,
whatever it is). Verified live: holding Add flight on a single-propeller
route went 1→4 flights and stopped right at 91% pool utilization; holding
Upgauge with several propeller flights on one route moved three of them
to Regional in one hold without thrashing on one flight.

Separately, reported as "can't get to the +/- freq modal": the ring only
opens by clicking the route's own line, which has an 8px hit zone against
a 14px zone around each airport dot — on a short route, or the map zoomed
out, there can be almost no pixel where the line wins. Fixed by turning
the airport card's "Markets: YUL (8)" list into real buttons that open
that route's ring directly, no line-clicking required.

### Done: "Last 7 Days" bar charts (Revenue, Cost, Margin)

The sidebar's Today figures are a single day's snapshot — no way to tell
"is the network actually getting better" from them alone. Added three
small bar charts under Today, one bar per finished day: `SimState` gained
`revenueHistory`/`costHistory`/`marginHistory` (`sim/pnlHistory.ts`,
`recordDailyPnlHistory()`), a same-shape rolling window as
`cashHistory`/`fuelPriceHistory`, recorded at the same moment in
step.ts's day-rollover so each entry is a genuinely finished day.
`SAVE_KEY` went to `v33`.

Revenue and Cost are plain histograms (bars up from zero, reusing the dev
tools' bar idiom). Margin can be negative, so its chart splits each day's
cell into a profit half and a loss half around one shared zero line,
sized once from the whole window so an always-profitable stretch doesn't
waste half the chart on an unused loss zone — colored green/red so a
losing week is visible at a glance, not just readable from the axis.
Rebuilds only on an actual day change, not every frame.

### Done: per-route P&L history

The sidebar's chart answers "is the network trending right"; it can't say
*which route* is the problem. Extended the same rolling window per
market: `SimState` gained `todayRevenueByMarket`/`todayCostByMarket`
(filled in step.ts's arrival loop, right beside the network totals) and
`revenueHistoryByMarket`/`costHistoryByMarket` (rolled at the same
day-rollover moment, one entry per day for every market currently in the
schedule — even a zero one, so "yesterday" always means yesterday and not
"the last day this route flew"). `SAVE_KEY` went to `v34`.

Deliberately narrower than the network figures: only a flight's own
fuel/block/departure economics are attributed to a market. Marketing,
lease and crew are airline-wide overhead a plane's day is shared across —
no honest way to give one market its "share" of a lease payment — so they
stay out, same reasoning the dev tools' cost tree already uses. Margin
isn't stored a third time; a market's margin is just its own revenue
minus its own cost, computed in `ops.marketPnlHistory()`.

The route card shows this as one small Margin chart (`buildBipolarBars()`
now lives in the new `ui/pnlBars.ts`, shared with the sidebar's copy) —
only Margin, since the popover is 280px wide at most; Revenue and Cost
ride along in each bar's tooltip instead of getting their own row.
Verified live: on a single-route airline, the route's own cost tracked
$4,400 (one propeller's daily lease) below the sidebar's network cost on
every day, exactly the gap the scoping choice above predicts.

---

## Conventions worth knowing

- **Bump `SAVE_KEY` in `src/ui/save.ts` on any breaking `SimState`
  change.** Currently `v33`.
- **`headless-output.csv` and `sweep-reserve.csv` must stay
  byte-identical** across changes that aren't meant to affect balance.
  Both were verified unchanged after the delivery work — `createInitialState()`
  grants aircraft directly and never touches the Fleet Market, and
  deliveries roll no RNG, so no draw sequence moved.
- **Anything with a control in it must be verified with real input.**
  Scripted `.click()` calls the handler directly, setting `.value` skips a
  native dropdown, and synthetic mousedown/mouseup pairs never produce a
  click at all. A per-frame table rebuild broke the rotations remove
  buttons and the base dropdown outright while every scripted check
  passed — see the `renderFleet()` comment in `ui/panels.ts`.
