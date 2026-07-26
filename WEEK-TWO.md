# airgame — Week two (brainstorm, converging)

This is a working document, not a committed plan like WEEK-ONE.md was.
The five biggest open questions are now answered (see Decisions,
below), and — as of the "Pricing" milestone — every item in the "Draft
dependency order" is done except the last one (random events). Update
this freely as we keep talking.

Everything here is scoped for phase 3 discussion — it deliberately
revisits some things WEEK-ONE.md's CLAUDE.md-linked "deliberately
deferred" list put off limits (competitor AI, in particular). That's
fine — the user is explicitly opting back into that territory now —
but each place it happens is called out below rather than done quietly.

---

## The goal, restated

Right now the economy is flat: every seat, every route, every day sells
at the same fixed load factor and fare (`sim/economy.ts`). Week two is
about replacing that with an actual market — passengers who exist in
some volume between specific city pairs, who choose between airlines
(yours and AI-run competitors) based on price/schedule/product, split
into segments (business/leisure/VFR) that weight those factors
differently. On top of that market, the player gets real levers: build
routes, set frequency, price them, and live with operational disruption
(delays already exist via M9; diversions and airspace closures are the
next step up).

## Decisions

1. **Direct flights only.** Connections/connecting itineraries stay
   deferred, per CLAUDE.md. Demand still *exists* for every O-D pair
   (the gravity model doesn't care whether anyone serves it), but only
   pairs with actual direct service — yours or a static competitor's —
   can capture any of it. Unserved pairs are visible "addressable
   market" the player can see and decide to go serve, not modeled
   traffic that goes anywhere.
2. **Non-reactive (static) competitor AI.** Competitor schedules and
   fares are fixed data, authored once, never adapting to the player's
   moves. This has a real consequence, see "What this simplifies,"
   below.
3. **Recommended fare, overridable.** The game computes a default fare
   per route (see "Pricing," a new loop below); the player can override
   it. Not a free-text price — a lever with a sensible default.
4. **Fleet stays at 3 aircraft.** No aircraft market, no financing,
   both still deferred. The route/frequency editor works only by
   reassigning the existing 3 tails' rotations, not by growing the
   fleet.
5. **Population data from StatsCan.** A real, sourced number per
   airport's catchment population, added to `airports.json` — not a
   hand-picked proxy. (Research task when we get to implementation:
   look up each city's metro-area population from StatsCan census
   data, the same "public sources only" standard `airports.json`
   already holds to.)

   **Scaling strategy, so a future non-Canada expansion doesn't force a
   rewrite:** the seam is the data, not the code. `population` is just
   a plain field on each airport record — today all 10 are Canadian and
   sourced from StatsCan, but the field itself has no opinion about
   where the number came from. Adding a US airport later means adding
   one `airports.json` entry with a Census-sourced population (noting
   the source the same way this file does); it does not mean adding a
   country field, a source registry, or a per-country code path. The
   gravity formula in "1. O-D demand" below only ever multiplies two
   populations and divides by a distance — it's already country-
   agnostic by construction, so there's nothing to genericize later.
   Deliberately not building any actual multi-source plumbing now
   (no registry, no per-country strategy pattern) — that would be
   designing for a country we haven't picked, using data-sourcing
   problems we don't have yet. The first real non-Canada airport is
   the point to learn what, if anything, actually needs to change.

### What this simplifies

Non-reactive AI (decision 2) quietly shrinks "Competition" from a
systems-engineering problem into a data-authoring one. There's no
competitor decision-making logic to design at all — a static schedule
is just a second, smaller `schedule.json`-shaped file for other
airlines' routes/frequencies/fares. The only real engineering is
feeding that data into the *same* choice model the player's own routes
already need (see layer 4, below). That also means competitor data can
exist early, as soon as there's a choice model to test against, rather
than waiting for its own build phase.

### One thing this raised — now answered, see "Pricing" below

**How is "recommended fare" computed?** Answered: distance alone —
`round(125 + 0.3 * distanceNm)`. Yield-mix skew was considered but
dropped, since every market currently shares an identical fixed
20/50/30 split, so it would've added a constant, not real
differentiation. Full writeup, including the verified before/after
effect of actually using the resulting lever, is under "Pricing" in the
Loops section, below.

**Related, smaller question, still open:** should the player be able to
*see* competitor fares/schedules on a route before pricing their own?
`data/competitors.json` exists and feeds the choice model now, but
nothing surfaces it in the UI yet — still leaning toward yes (visible,
just not reactive), just not built.

## Two different kinds of thing, worth keeping separate

**Market/model layers** — state that describes the world beyond what
exists today. These mostly live in new `sim/` modules and new
`SimState` fields; nothing here needs a UI to matter, only to be
tunable data, the same way `economy.ts`'s constants are.

**Player-facing loops** — the actual interactions: creating a route,
setting a frequency, pricing it, reacting to an event. These are new
UI plus new `step()` logic, and only become *meaningful* decisions once
the layers below give them something to push against.

---

## Layers

### 1. O-D demand — done

How many people want to travel between each pair of the 10 airports,
per day. A gravity model, `demand(A,B) = round(pop(A) · pop(B) /
distance(A,B)^k · C)`, using each airport's catchment population
(decision 5, above — sourced from StatsCan, now live in
`airports.json`) and the great-circle distance already computed in
`sim/geo.ts`. Built as `dailyDemand(originIata, destIata)` in the new
`sim/demand.ts` — a pure function of static data, so it's cheap to call
directly rather than caching a matrix anywhere.

`k = 1` and `C = 1.6e-8` are tunable, crude parameters in the same
spirit as `LOAD_FACTOR`/`AVG_FARE` — picked by hand so the biggest
pair (Montréal-Toronto) lands in the low thousands and the smallest
(Saint John-Fredericton) lands in the tens, not calibrated against any
real O-D survey. Verified headlessly across all 45 pairs: the two
big-market pairs (YUL-YYZ at 1556, YUL-YOW at 1251) dominate, and the
small Atlantic routes the fleet actually flies today (YQB-YHZ, YHZ-YSJ,
YQM-YYG) sit at single/low-double digits — already a visible mismatch
against a 78-seat DH4 at 75% load factor, which is exactly the tension
the next layers (yield mix, choice model, pricing) exist to resolve.

Direct-service-only per decision 1: this demand number is the ceiling
for a route that exists, and just a visible "market size" figure for
one that doesn't.

**Made visible via a new "Demand" map mode** (`render/demand.ts`),
alongside a rename of the old lone map view to "Ops" — the toggle in
the HUD is now Ops/Demand/Rotation, all three sharing the same
canvas-vs-`#rotation-board` swap mechanism M11 built. Demand mode draws
all 45 city-pair arcs weighted by `dailyDemand()`, with an amber halo
on pairs that already have scheduled service, plus airport circles
sized by population — see HOW-IT-WORKS.md's "Rendering" section for the
full draw order.

**Now also caps `economy.ts`'s pax count**, not just visualization: a
market's total daily demand is split evenly across however many
scheduled legs serve it (`sim/schedule.ts`'s `legsServingMarket()`), and
`pax` is the smaller of the old flat load-factor figure or this
flight's actual slice of that split — further refined by layer 4's
`bookingShare()`, below, so not everyone in that slice necessarily
travels.

### 2. Yield mix / travel purpose (business, leisure, VFR) — v1 done

Splits the O-D demand pool into segments with different fare
sensitivity and different tastes for schedule/frequency. Built directly
inside `sim/choiceModel.ts` (layer 4, below) rather than a separate
module — segments only matter through the weights they contribute to
the choice model, so there was nothing for a standalone module to own.
v1 is exactly the "simplest v1" this section originally called for: a
fixed 20/50/30 (business/leisure/VFR) split applied to every O-D pair
alike, not varied by route. Each segment gets its own price/schedule
weights — business barely reacts to fare but strongly wants frequency;
leisure is the opposite; VFR sits in between — blended into the single
number `economy.ts` consumes. Not yet done: varying the split by route,
and giving segments their own fare (both real refinements, not needed
for this to already behave sensibly) — the latter waits on the pricing
loop existing at all.

### 3. Competition (static AI airlines) — v1 done

Other carriers exist alongside yours on some subset of the same O-D
market, with fixed schedules and fares (decision 2) authored as data,
not decision-making logic. Their whole job is to be a competing option
in the choice model below — nothing more.

**Built as `data/competitors.json`** — a flat list of `{airline, origin,
dest, dailyFrequency, fare}`, deliberately small (four entries, not one
per market): three on the busy Ottawa-Montréal-Toronto triangle
(including YYZ-YOW, a market the player's own fleet doesn't fly at all
yet — a plausible incumbent on a market big enough to be worth entering
later) and one on the smaller Québec-Halifax route, since realistically
no carrier competes for a 1-pax/day market like YYG-YFC. Fictional
airline names ("Capital Wings," "Trillium Air," "Bluenose Regional") —
CLAUDE.md's public-sources-only rule rules out using real carriers'
names for invented competitive behavior. `sim/choiceModel.ts` looks
competitors up per market (same bidirectional definition every other
"market" concept in this codebase uses) and folds them straight into the
softmax below — no separate "competition" logic exists outside that
lookup.

### 4. The connective piece: a choice / market-share model — v1 done

Given a passenger segment and a route, something has to decide: book
you, book a (static) competitor, or don't travel. The standard,
well-worn technique: a multinomial logit model — each airline's
offering on that route gets scored by a utility function (`w_price ·
-price + w_schedule · schedule-fit + w_product · quality`, weights
varying by segment), and market share falls out as a softmax over the
scores. Real airlines use almost exactly this (the industry term is
QSI, Quality of Service Index, for the schedule-fit piece specifically).

**Built as `bookingShare(fare, legsServingMarket, origin, dest)` in the
new `sim/choiceModel.ts`**, wired into `economy.ts` (see
HOW-IT-WORKS.md's "Economy"). It's a real softmax now: your flight,
every competitor serving the same market (layer 3, above), and a "stay
home" option fixed at utility 0 all get scored, and your share is your
score over the sum of everyone's. A market with zero competitors
collapses this to the plain logistic sigmoid of your own utility —
algebraically identical to the pre-competitor v1, confirmed by every
market without a competitor producing unchanged numbers.
`w_product · quality` is dropped entirely for now (no product-quality
axis exists yet either); `schedule-fit` is each offering's own
`dailyFrequency`, log-scaled for diminishing returns — your flight and
every competitor each get their own utility from their own fare and
frequency, and the softmax is what turns those independent scores into
shares. Weights and intercepts are hand-picked, crude constants per
segment, same spirit as `LOAD_FACTOR`/`AVG_FARE` — calibrated so, blended
together at
today's $185 fare, the result stays close to what a single undifferentiated
segment would have produced, so this pass adds *sensitivity that differs
by segment* without secretly re-swinging the economy again. It already
shows up as intended: a hypothetical $300 fare now drops blended booking
share to ~0.57 versus ~0.73 in the pre-segment v1, since leisure (50% of
demand) is genuinely price-sensitive — real leverage for the pricing
loop, still ahead, to pull once it exists.

This is "crude but principled" in the same way `economy.ts` already
is — not a simulation of individual passengers, just an aggregate
formula — but it's the piece that makes demand, yield mix, pricing, and
competition into one system instead of four unconnected ones, and with
layer 3's competitor data now live, all three non-pricing layers are
actually connected through it at once. Verified via the headless runner
and matched exactly against a live browser run, cash/revenue/cost/margin
all identical at the same simulated day: daily revenue fell in three
steps as each layer landed — $128,760 (no layers) → $52,725 (demand cap
only) → $51,615 (choice model, single segment) → $51,430 (yield mix) →
$49,950 (competitors) — and **the fleet's current schedule now runs a
net loss over any 5-day stretch** ($-4,623 cash after 5 days). Frequency
and price are both already real, player-actionable levers today, with no
further layers needed: adding a second daily frequency to a market via
the M10 route builder measurably raises its booking share, and a market
that gains a competitor (like Québec-Halifax just did) visibly loses
passengers to it.

**Side note on frequency specifically:** real airline schedule
competition has a well-documented effect where frequency share
translates into *more than proportional* market share (the "S-curve").
v1 skips that nuance and treats frequency as a log-scaled, diminishing-
returns bump instead of a true S-curve, even now that competitors exist
on four markets — each offering (yours and every competitor's) scores
its own utility from its own raw frequency independently, rather than
from a *share* of the market's total frequency. Worth revisiting once
there's a reason to think the difference actually matters in play.

---

## Loops

### Pricing (falls out of decision 3) — done

Each route gets a computed recommended fare, and the player can
override it. Directly feeds the choice model's price term, so raising
fare trades market share for margin and lowering it does the
reverse — the core yield-management tension, for free, now that the
choice model exists.

**The formula question this section originally left open** ("How is
'recommended fare' computed?"): distance alone, in the end — `round(125
+ 0.3 * distanceNm)`, the same fixed-plus-per-unit shape
`costPerDeparture`/`costPerBlockHour` already has. The other candidate
input, yield-mix skew, was dropped: every market currently shares the
identical fixed 20/50/30 business/leisure/VFR split
(`sim/choiceModel.ts`), so a skew term would multiply every route by the
same constant and add nothing real — worth revisiting once yield mix
actually varies by route. **The related smaller question** ("should the
player see competitor fares/schedules") is still open — not addressed
by this pass; `data/competitors.json` exists and feeds the choice model,
but nothing in the UI surfaces it yet.

**The override lever, revised: route-level, not per-leg.** Originally
built as a per-leg slider in the schedule table — reverted after
feedback that fare belongs at the route/market level, to keep the
game's decision space manageable as more levers get added (see
"Commercial panel," below). `fare` moved off `ScheduleLeg` entirely,
into a new `SimState.routeSettings: Record<marketKey, RouteSettings>` —
one entry per market (bidirectional, `sim/schedule.ts`'s new
`marketKey()`), so a market with two daily frequencies still has
exactly one fare, not two independently adjustable ones. The lever
itself (a range slider, 50%-150% of that market's recommended fare, $5
steps, live $ readout — still not free text, per decision 3) moved with
it, into the new Commercial panel.

Verified via the headless runner and a live browser test: the effect of
raising a fare depends entirely on whether the market is seat-capped or
demand-capped. Ottawa-Montréal (recommended $150, but pegged at the
78-seat aircraft's 59-pax load-factor ceiling regardless of fare, since
demand there is abundant) gained roughly $4,425 of pure margin over two
days from manually dragging its fare to $225 — losing booking share
cost it nothing, because 59 seats filled either way. That's free money
sitting in the current schedule, right now, for a player who notices it.
A demand-capped market (most of the Atlantic routes) wouldn't behave the
same way — it would genuinely lose passengers it can't make up
elsewhere. Distance-based defaults also recalibrated every route
relative to the old flat $185 — short Atlantic hops now default
cheaper, Québec-Halifax (the longest leg, already the one with a
competitor) now defaults more expensive — landing total daily revenue
at $47,962 (down slightly from $49,950) and the schedule's net loss over
5 days at $-14,563. The lever existing doesn't fix profitability by
itself; using it well is now a real decision, not a foregone one.

### Route creation + editing: the map interaction — M10, done

**Scope for this milestone:** the gesture itself, plus a minimal
confirmation form that actually appends a working leg to
`state.schedule` — reusing `validateSchedule()` exactly as M8 does for
correctness feedback, not a new rotation-fitting solver. No frequency
UI yet (that's a repeat of "add another leg," better done once this
lands and feels right). No fare/demand meaning yet — see the priority
call below.

**Done when:** dragging from one airport to another and confirming
produces a new row in the schedule table with a real block time, and —
if the chosen tail and departure time are compatible with that tail's
existing rotation — an aircraft actually flies the new route on the
map. If they're not compatible, the same console validation M8 already
has catches it, the same way an edit that breaks a rotation always has.

**Verified:** headlessly — `nextLegId`/`computeBlockMinutes` produce
correct values, a leg added where the tail's rotation genuinely allows
it gets flown by `step()` exactly as scheduled, and a leg added
somewhere the tail isn't actually located gets caught by
`validateSchedule()` with the same error shape M8 already produces. In
the browser — the full gesture end to end (arm → live preview,
pixel-verified tracing from the exact origin toward the cursor → snap
→ confirm → form → Add → new schedule row), all three cancel paths
(Escape, re-click origin, click empty water), and confirmed panning
still works unaffected for clicks away from any airport.

**Post-M10 refinement, from playtesting:** the form always said "New
Route" even when the origin/destination already had service, and
nothing stopped adding a leg at the exact same origin/destination/time
as one that already existed. Fixed: the heading now reads "New
Frequency" for an existing market (checked bidirectionally, same
definition as `render/routes.ts`'s route-drawing dedup), and an exact
origin+destination+minute match is hard-blocked in the form itself
(live, disabled Add button) rather than allowed-through-and-flagged —
unlike M8/M9's rotation checks, there's no legitimate reading of two
departures at the identical minute on the identical route, so it
doesn't get the same benefit-of-the-doubt a temporarily-awkward
rotation does.

Two more rules were proposed alongside this and are still open,
pending a decision:
- Checking same-tail double-booking as a genuine time-*overlap*
  against that tail's other legs (not just an exact match), surfaced
  live in the form in plain English, rather than only caught after
  submission by `validateSchedule()`'s less direct chain-mismatch
  error.
- A minimum spacing between frequencies on the same market (blocking
  only the *exact* same minute still allows two departures a few
  minutes apart, which adds no real coverage in the current model and
  is probably also a slip) — needs a threshold decision, not just
  logic.

**Second post-M10 addition — filterable schedule table:** the schedule
table now has a type-in filter per column (Tail/Route/Depart, case-
insensitive substring, ANDed together), and adding a new frequency
auto-narrows the table to just that route (clearing any stale Tail/
Depart filter that would otherwise hide it) instead of the new row
landing wherever it lands among a dozen-plus others. Verified in-
browser: each filter in isolation, filters clearing correctly, and the
auto-narrow correctly overriding a deliberately-left-stale Tail filter.

**Bug found via playtesting and fixed:** the auto-narrow appeared to
silently fail when adding a second YSJ-YQB frequency. Root cause
wasn't the filter at all — the confirmation form's depart-time input
never reset between separate uses, so a time left over from an earlier,
unrelated route carried into the next one. When that stale time
happened to exactly match YSJ-YQB's existing leg (13:00), the M10
exact-time block silently prevented the Add entirely, so nothing was
ever added for the filter to narrow to. Fixed: the form now resets its
depart input to a fixed default every time it opens. Reproduced the
exact failure (leave a route's time at 13:00, then arm YSJ-YQB without
touching the field) and confirmed the fix.

**Second round of playtesting feedback:** even after the fix above, the
auto-filter still felt broken — because it was applied on *confirm*
(clicking "Add Route"), the instant the popup closed. By the time the
table narrowed, attention had already moved on with the closing popup,
so it looked like nothing happened. Moved `filterScheduleToRoute()` to
fire when the popup *opens* (`showForm()`) instead of when it resolves
— now the table narrows to the pending market's existing frequencies
while the player is still choosing a tail and time, which is also just
better context for that decision. Verified in-browser: the filter is
visibly active while the form is still open (before Add is clicked),
and the newly added leg joins the already-filtered view automatically
once confirmed.

**Priority call:** build this first, ahead of the demand/choice-model
layers, deliberately reversing the sequencing note below. The reasoning:
nailing the core interaction — does *creating a route* feel good? — is
worth getting right before investing in the economic depth underneath
it. This doesn't actually undo the dependency trap, it just separates
two different things that were bundled together: the *gesture* (how a
route gets drawn) can be built and iterated on now, against today's
flat economy as a placeholder; its *economic meaning* (was this a good
decision) arrives later, once layers 1–4 exist, without needing to
redesign the interaction itself.

**The gesture — drag-then-follow hybrid:**
1. Click an airport to arm it (cursor enters a distinct "drawing"
   state — e.g. crosshair). This is *not* a held-button drag; release
   the mouse and the arm state persists.
2. While armed, a live preview arc follows the mouse continuously:
   invert the cursor's screen position to a [lon, lat] via
   `projection.invert()`, build a 2-point `LineString` from the armed
   origin to that point, and render it through the *same*
   `d3.geoPath` machinery `render/routes.ts` already uses for real
   routes — so the preview curves exactly like a confirmed route
   would, not an approximation.
3. When the cursor comes within a hit-radius of another airport,
   snap the preview's endpoint to that airport's exact coordinates and
   highlight it as the candidate destination.
4. Click the highlighted airport to confirm — this opens a real DOM
   form (per CLAUDE.md's panel rule) for the actual configuration:
   which of the 3 tails flies it, departure time, frequency. That
   configuration step is the constraint-satisfaction problem flagged
   below, not solved by the gesture itself.
5. Escape, or clicking anywhere that isn't a valid destination,
   cancels and clears the preview.

**Scope call: creation only, not in-place editing.** Hit-testing a
click against an arbitrary curve (to let the player click an *existing*
route arc to edit it) is a meaningfully harder problem than hit-testing
a click against a point, and there's already a working answer:
editing/removing legs stays table-driven, extending M8's existing
schedule table (which already lists every leg) rather than adding a
second, harder interaction for the same job. The drag gesture is
specifically for the "what if I connected these two cities" moment —
discovery, not maintenance.

**Technical note:** this needs to be disambiguated from the existing
pan gesture, which currently starts on any `mousedown` on the canvas.
The fix is a priority check: `mousedown` within an airport's hit-radius
arms/confirms a route instead of starting a pan; everywhere else, pan
behaves exactly as it does today.

**Reassigning a tail's full rotation** (fitting a new leg into a tail's
daily chain without breaking its turn times or its return to base) is
still the harder part of "assign a plane to a route," and it's still
gated on the same layers as before — see the reordered list below.

**Original dependency-trap note, still true for the *decision-quality*
half of this loop:** against today's flat economy, adding frequency is
free linear revenue with no downside — there's no scarcity to push
against, so *whether creating a route pays off* isn't a real question
yet. That's fine for iterating on the gesture; it matters again once
the layers below exist.

### Random events (diversion, airspace closure)

Not just "a bigger M9 delay." M9's delay mechanic assumes the flight
still completes, late. A diversion or closure needs:
- **Cancellation handling** — passengers not carried (lost revenue, or
  rebooked onto a later flight/competitor — ties back into the choice
  model above)
- **Aircraft recovery** — a diverted aircraft is out of position for
  its next scheduled leg, possibly for the rest of the day
- **Scope beyond one flight** — an airspace closure plausibly affects
  every flight touching one airport for some time window, not a single
  ActiveFlight the way a delay roll does

Plugs into the seeded PRNG infrastructure that already exists
(`sim/rng.ts`, `state.rngSeed`), so the mechanical foundation is there.
Sequencing-wise, this reads as an enrichment on top of a working
demand/competition loop, not a prerequisite for it — recommend doing
it last of everything above.

---

## Deferred, not urgent

- **Recommended-fare formula** — no need to lock this in now; revisit
  once the pricing loop is actually being built.

## Draft dependency order (not committed)

1. **Route creation + editing map interaction** (drag-then-follow) —
   done, M10. The gesture and the confirmation form, against today's
   flat economy as a placeholder; not yet meaningful as a decision.
2. **Rotation board, phase 1 (visualize-only)** — done, M11. Raised
   organically after M10, not originally in this list: scaling the
   schedule-editing UI to more aircraft turned out to be a prerequisite
   for the rest of this list feeling good to use, not a nice-to-have.
   Phases 2–4 (create/reschedule-by-drag, bulk tool) are back-burnered
   behind this same dependency order, not next by default.
3. **Population data + O-D demand layer** — done. StatsCan 2021 census
   figures added to `airports.json`; gravity model in `sim/demand.ts`,
   visible via the new Demand map mode, and now capping `economy.ts`'s
   pax count so a thin market genuinely flies half-empty.
4. **Choice/market-share model** — v1 done. `sim/choiceModel.ts`'s
   `bookingShare()`, a logistic sigmoid (softmax collapses to this with
   only one real alternative to "stay home"), wired into `economy.ts`.
   No competitor offerings yet, so it only ever scores your own flight
   — see the "Layers" write-up for what's next.
5. **Yield mix / travel purpose segmentation** — v1 done, built into
   the same `sim/choiceModel.ts`: a fixed 20/50/30 business/leisure/VFR
   split, each with its own price/schedule weights, blended into the
   one number `economy.ts` sees.
6. **Static competitor data** — v1 done. `data/competitors.json` (4
   fixed entries, fictional airlines), folded into `bookingShare()`'s
   softmax as real alternatives instead of just "stay home." The
   schedule the fleet flies today is now a net loss over 5 days —
   see the "Layers" write-up for the full revenue trail.
7. **Pricing** — done. Distance-based `recommendedFare()` in
   `sim/schedule.ts`, overridable via a bounded range slider (not
   free-text) in the schedule table. Feeds `bookingShare()`'s price
   term and revenue directly — the full yield-management tension now
   exists and is player-actionable, see the "Pricing" write-up below.
8. Random events / operational disruption (diversion, closure)

Steps 1–2 are the deliberate exceptions to "layers before loops": the
map gesture and the board that makes it scale don't need the economy
to be rich to be worth building and feeling right, even though *whether
a given route is a good idea* still waits on steps 3–6.

---

## The rotation board — M11

Raised after M10: the flat schedule table doesn't scale. Even at 3
aircraft/12 legs it's already a wall of rows you have to mentally
reconstruct into "what is this tail doing all day" — and the actual ask
was for more aircraft, some of them different types, added in bulk, with
a way to actually *see* where a tail has free time to put a new leg. A
text table was never going to answer "where's the white space."

### The shape of it

The standard tool for exactly this problem, used in real airline
scheduling software under names like a rotation diagram or string
diagram: a Gantt chart. One row per tail, one shared time-of-day axis,
each scheduled leg drawn as a bar from `departMinute` to
`departMinute + blockMinutes`, labeled with the route. Everything that
isn't a bar *is* the white space — no separate "free time" indicator
needed, the gaps just are the answer, which is what makes this solve
the legibility complaint directly rather than layering more filters on
top of the same wall of text.

This scales the way the flat table doesn't: more aircraft is just more
rows (scrollable past some count); a second aircraft type (still on
CLAUDE.md's deferred list — flagging that this plan would touch it,
not deciding it) falls out for free, since a bar's width is already
`blockMinutes`, which is already computed from that type's cruise speed
(`sim/schedule.ts`'s `computeBlockMinutes`) — a faster type's bars are
just narrower for the same route, no special-casing needed in the view
itself.

### Where it lives

280px of sidebar isn't enough room for a legible 24-hour timeline. Two
real options:
- **A toggle that swaps the map for the board.** A "Map / Rotation"
  switch (matching the existing HUD's button styling) gives the board
  the full canvas area. The existing filterable schedule table could
  move here too, alongside the board, since there's finally room for
  both the visual and the precise-detail view side by side.
- **A modal/overlay on top of everything.** Simpler to bolt on, but
  modals read as quick in-and-out interactions, and building out a
  fleet's schedule is more of an extended-session task — leaning
  toward the toggle instead, but this is a real open question, not a
  settled one.

### Phasing (build in this order, each one a real stopping point)

1. **Visualize only.** Read-only board: bars for every existing leg,
   nothing clickable yet. This alone answers "not legible" — worth
   shipping and sitting with before adding any interaction, the same
   "nail the core thing first" lesson M10 was built on.
2. **Create from a gap.** Click-drag inside empty space on a tail's row
   to place a new leg there — reusing the *exact* confirmation-form
   machinery already built for the map gesture (tail is already
   implied by which row you clicked, so that field disappears; time
   comes from where you dragged; the same `computeBlockMinutes`/
   `isExistingMarket`/`findExactTimeCollision` checks apply unchanged).
   The market (origin/destination) still needs picking somehow — likely
   a lightweight selector rather than the map, since you're not looking
   at the map in this view.
3. **Reschedule by dragging.** Drag an existing bar left/right to change
   its `departMinute`, live-checking the same collision/overlap rules
   instead of only through the table's tiny time input.
4. **Bulk generation (speculative, only if 2–3 don't already cover the
   felt need).** A small "add N frequencies, every X minutes, starting
   at Y" tool for a market, rather than repeating the single-add
   gesture by hand. Whether this is actually needed once dragging into
   gaps is fluid, or whether "adding a bunch of flights at once" was
   really asking for phase 2's workflow all along, is worth finding out
   before building a separate bulk tool.

### Decisions

Answered in one pass ("1st pass visual ony, toggle, step 2"):

1. **Phase scope: phase 1 only.** Visualize-only, ship it, sit with it
   before touching interaction.
2. **Toggle**, not a modal — a "Map / Rotation" button pair in the HUD,
   matching the existing speed-control styling.
3. **"Adding a bunch of flights at once" means phase 2**, not a separate
   bulk-generation tool. Phase 4 is shelved unless phase 2 turns out not
   to cover the felt need after all.
4. Multiple aircraft types: still not being introduced. The board is
   built ready for it (bar width already comes from `blockMinutes`,
   which already accounts for cruise speed), but a second type is not
   in scope here — this stays on CLAUDE.md's deferred list.

### Phase 1 — done

Built as a new `ui/rotationBoard.ts` module, a sibling of `#map` in
`index.html` sized identically and swapped via the `hidden` attribute
(same pattern the schedule editor already used for live inputs vs.
plain reads — the board has no interactive elements yet, so unlike the
schedule table it can safely be wholesale-rebuilt on every call rather
than patched).

One row per tail from `state.aircraft`, one bar per leg from
`state.schedule` positioned by percentage (`left` from
`departMinute / 1440`, `width` from `blockMinutes / 1440`) against a
shared 00:00–24:00 axis ticked every 3 hours. Switching to the Map view
cancels any in-progress route-creation gesture (`cancelPendingRoute()`
in `ui/routeBuilder.ts`), since an armed/pending route stops making
sense once the canvas it was drawn on is hidden.

Verified in-browser: toggle swaps Map ⇄ Rotation cleanly in both
directions, axis ticks land at the right positions, each tail's bars
match the schedule table's times, and the map re-renders correctly
(routes/aircraft/basemap) after switching back. One false alarm during
verification — a `Schedule error: C-GVIA lands at YOW on C-GVIA-4 but
C-GVIA-5 departs from YSJ` console line turned out to be stale buffered
history from an earlier manual test, not a real regression; confirmed
by forcing a hard reload and checking that the *most recent* startup
log read `Schedule OK: 12 legs across 3 aircraft, no broken rotations.`
and that `data/schedule.json` on disk has no such leg.

Not built yet, by design: phases 2–4 above, all still gated on being
explicitly asked for.

## The Commercial panel

Raised the same way the rotation board was: not on the original layers/
loops list, but a real gap once the Pricing loop landed — a per-leg fare
slider buried in the schedule table made every route's economics
legible one row at a time, not as a network. The actual ask was for a
route-level dashboard: every profitability lever for a market in one
place, plus enough diagnostic context (load factor, whether a market is
seat- or demand-capped) to know which lever is worth pulling.

**Naming:** "Ledger" was the first name floated and rejected — too
passive/accounting for something meant to be tweaked, not just read.
Landed on **Commercial**, the real airline-department term for the
group that owns pricing, marketing, and distribution — pairs naturally
with "Ops" (the map's other real-department-named view) and says what
the panel is *for* rather than what it displays.

**Navigation grouping:** with four views, a flat row of buttons stopped
being the right HUD shape. Regrouped into two icon-triggered dropdowns —
**Maps** (Ops, Demand: both draw on the canvas/projection) and
**Reports** (Rotation, Commercial: both real DOM) — each trigger showing
an SVG icon instead of a text label, per request. Picked a folded-map
icon for Maps and a bar-chart icon for Reports; neither term is deeply
considered, just reasonable placeholders — worth revisiting if either
stops fitting as more views get added.

**Fare moves to the route, not the leg.** The immediate trigger:
fares should be a route-level decision, to keep the game's decision
space manageable as more levers arrive — a market with two daily
frequencies has one price, not two independently adjustable ones. This
meant a real data-model change, not just a UI move: `fare` came off
`ScheduleLeg` entirely and into a new `SimState.routeSettings`, one
entry per market. `ActiveFlight` still locks in the fare (and now
marketing spend) it departed with, same reasoning as before — a change
mid-flight shouldn't retroactively affect one already in the air.

**Marketing spend — the second lever, and the reason RouteSettings
exists as a record rather than fare living alone.** A per-market daily
dollar amount (`sim/choiceModel.ts`'s `marketingBonus()`, log-scaled for
diminishing returns, added only to *your* utility term — competitors are
unaffected by what you spend) that boosts booking share, charged once
per day per market at day-rollover (`step.ts`), not per flight. Bounded
0–$1,000 in $50 steps. Explicitly "and more to come": `RouteSettings` is
built to grow, not a one-off pair of fields.

**What a row shows:** market, frequency, pax/day, load factor, **market
share**, revenue, cost, margin, and a Seat-capped/Demand-capped status —
the single most useful fact this panel adds, since it's the answer to
"is raising fare here free money or a real trade-off" that previously
required running the headless script and eyeballing the output by hand.
Market share (`sim/choiceModel.ts`'s `trafficShare()`, added after
market feedback) is a distinct question from booking share: it excludes
"stay home" from the denominator entirely, answering "of the people who
actually fly this market, what fraction fly you" rather than "what
fraction of the whole addressable population books at all." A market
with no direct competitor is trivially 100% by this definition — verified
headlessly, every uncontested market in today's schedule shows exactly
100%, while the three with a competitor show real erosion (37–63%).
Direct-competitor-driven only for now: connecting itineraries aren't
modeled (decision 1), so a rival reachable only by connecting through a
third city can't yet pull share away here — worth revisiting once
connections exist. All of it is computed by calling `sim/economy.ts`'s
real `flightResult()` per leg and summing — never a reimplementation of
the pax/revenue/cost formula, so the panel can't drift from what the
simulation actually does. Numeric cells refresh live as a slider moves
(a hypothetical, not-yet-committed
value flows straight through the same real formula); the sliders
themselves are only rebuilt when a genuinely new market appears, so a
lever mid-drag is never torn out from under the player.

**Read-only was never the plan here**, unlike Demand/Rotation's first
passes — the whole point is edits, so the levers are live from the
first version.

**A layout bug repeated itself building this**, same root cause as the
schedule table's Fare column during the Pricing loop's build: automatic
table layout let `<input type="range">`'s intrinsic width push the
table past its container (951px of content in a 687px panel, silently
overflowing off-screen). Same fix: `table-layout: fixed` with explicit
per-column percentages, plus stacking each slider and its readout
vertically instead of side by side. Worth remembering as a pattern
next time a table gains a slider column: automatic layout and range
inputs don't mix inside a fixed-width container.

Verified in-browser: dragging Québec-Halifax's fare down from $230 to
$120 doubled its pax from 6 to 12 (a demand-capped market, so a lower
fare directly converts to more real passengers) and revenue recomputed
correctly ($1,440); adding $500/day of marketing spend on top raised it
further to 14 pax and correctly added the $500 into that market's
displayed cost, not just its booking share — the panel doesn't make
marketing spend look free just because its cost is charged elsewhere in
the simulation.
