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
- Lead time is 1 day for every class. Delivery happens at the next day
  rollover after that, so aircraft land one to two days after ordering.
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


---

## Conventions worth knowing

- **Bump `SAVE_KEY` in `src/ui/save.ts` on any breaking `SimState`
  change.** Currently `v28`.
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
