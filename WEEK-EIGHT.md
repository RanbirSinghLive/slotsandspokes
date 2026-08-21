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

**Not done, and the more valuable half of the pitch:** an alert strip
(persistent, clickable warnings that navigate to the problem — `Fleet
tab has scheduleProblems()` today, just buried) and click-an-airport-for-
detail (right now a click only arms a route). Both are cheap and were
flagged as higher leverage than mapmodes alone; mapmodes was the
recommended starting point because it's additive and touches no sim
logic.

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

---

## Conventions worth knowing

- **Bump `SAVE_KEY` in `src/ui/save.ts` on any breaking `SimState`
  change.** Currently `v26`.
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
