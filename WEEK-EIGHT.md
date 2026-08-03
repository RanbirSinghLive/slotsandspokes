# airgame — Week eight (growth as a pipeline)

Handoff document. Week seven's utilisation pivot lives in
`WEEK-SEVEN.md`; read this one first and go there for the pivot's
reasoning.

**State at handoff:** save key `airgame-save-v25`, 11 sidebar tabs.
Aircraft delivery lead times and standing-order recruitment are both done
and committed. **The Grow tab — one pipeline view — is next.**

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
2. **Crew recruitment becomes standing orders with a target** — set a
   hiring rate per role and it runs until the target headcount is met,
   then stops. Not one-off batches. This is the piece that makes it a
   factory rather than a queue.
3. **"Grow" was never a design.** It was a bucket from week six's
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

## Done: standing-order recruitment

`StandingOrder { role, tier, perMonth, accrued }` on `SimState`, advanced
by `runStandingOrders()` inside the daily crew pass.

**There is no target field, and that is the design.** The stop condition
is `crewRequirement()`'s existing target — operating need times reserve
depth — so the player sets only a *rate*. Three things follow:

- An order can never run away: it is bounded by the fleet you own.
- It **self-resumes**. Buy an aircraft or raise reserve depth and the
  requirement rises, so hiring restarts without anyone remembering to.
- Reserve depth and hiring rate stop being unrelated sliders. Reserve
  depth sets *how much* crew you are hiring toward; the rate sets *how
  fast*.

Three guards against the obvious failure mode of a recurring spend:
it never orders past the target, it skips any day it cannot afford a
whole head, and `accrued` is capped at one month so a long pause can't
bank a backlog and dump it in one tick. It also runs **after payroll**,
so wages have first call on cash and a tight month pauses recruitment
rather than failing salaries.

Counting is against `projectedHeadcount()` — pool plus hires in transit
plus trainees due back — not the current pool, or the ten-day lead time
would have it re-order the same people every day until the first batch
landed.

Batch "Recruit" survives alongside it for one-off catch-up hires.

Measured: with two 1900Ds on order and a 4/month order for tier-1 pilots,
the target stepped 0 → 6 → 12 as the aircraft arrived, hiring tracked it,
and it stopped dead at 12 with no further spend.

---

## Next: the Grow tab

One pipeline view listing everything inbound with dates — aircraft, crew
hires, training, later spares — with small controls to add to it. **One
list, not one panel per resource**; a panel each multiplies UI for no
gain.

The pieces already exist and are currently scattered: `pendingDeliveries`
shows in the Fleet tab's Inbound section, `pendingHires`/`pendingTraining`
in the Crew tab's pipeline list, and standing orders in their own Crew
section. Gathering them is mostly a move, not new mechanics.

Executive hires arriving after a notice period is a natural fit and would
make the C-suite a commitment rather than an instant buy. Worth doing
once the rest works.

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
  change.** Currently `v25`.
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
