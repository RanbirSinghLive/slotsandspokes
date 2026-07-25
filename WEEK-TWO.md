# airgame — Week two (brainstorm, converging)

This is a working document, not a committed plan like WEEK-ONE.md was.
The five biggest open questions are now answered (see Decisions,
below) — this isn't a finished plan yet, but it's converged enough
that the shape of the actual milestones is starting to be visible.
Update this freely as we keep talking.

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

### One thing this raises that still needs an answer

**How is "recommended fare" computed?** It needs to be more than a
flat number (today's `AVG_FARE = 185` for everyone) to be worth having
as a default at all. The natural inputs, given what's already
planned: distance (a per-nm rate plus a fixed component, the same
shape `blockMinutes`-based cost already has) and the route's yield mix
(a route skewing business can plausibly support a higher default than
one that's mostly leisure/VFR). Whatever the formula, overriding it
plugs cleanly into the choice model without any special-casing: a
higher fare directly lowers that route's utility score
(`w_price · -price`), so pricing above the recommendation trades away
market share for margin per passenger — exactly the tradeoff a fare
lever should create. Worth deciding the actual formula before building
it, not after.

**Related, smaller question:** should the player be able to *see*
competitor fares/schedules on a route before pricing their own? Static
competitors can't react either way, but pricing blind against a fixed
opponent you can't see is a strange player experience. Leaning toward
yes — visible, just not reactive.

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

### 1. O-D demand

How many people want to travel between each pair of the 10 airports,
per day. A gravity model, `demand(A,B) ∝ pop(A) · pop(B) /
distance(A,B)^k`, using each airport's catchment population (decision
5, above — sourced from StatsCan) and the great-circle distance already
computed in `sim/geo.ts`. `k` and the scaling constant are tunable,
crude parameters in the same spirit as `LOAD_FACTOR`/`AVG_FARE`.
Direct-service-only per decision 1: this demand number is the ceiling
for a route that exists, and just a visible "market size" figure for
one that doesn't.

### 2. Yield mix / travel purpose (business, leisure, VFR)

Splits the O-D demand pool into segments with different fare
sensitivity and different tastes for schedule/frequency. Simplest v1:
a fixed percentage split applied to every O-D pair (say 20/50/30);
refine to vary by route later if it matters. Each segment gets its own
weights in the choice model (below) — that's what actually makes the
segmentation do anything, rather than just being a label — and
plausibly its own contribution to a route's recommended fare (see
"Pricing," below).

### 3. Competition (static AI airlines)

Other carriers exist alongside yours on some subset of the same O-D
market, with fixed schedules and fares (decision 2) authored as data,
not decision-making logic. Their whole job is to be a competing option
in the choice model below — nothing more.

### 4. The connective piece: a choice / market-share model

None of layers 1–3 actually *do* anything without this. Given a
passenger segment and a route, something has to decide: book you, book
a (static) competitor, or don't travel. The standard, well-worn
technique: a multinomial logit model — each airline's offering on that
route gets scored by a utility function (`w_price · -price +
w_schedule · schedule-fit + w_product · quality`, weights varying by
segment), and market share falls out as a softmax over the scores.
Real airlines use almost exactly this (the industry term is QSI,
Quality of Service Index, for the schedule-fit piece specifically).

This is "crude but principled" in the same way `economy.ts` already
is — not a simulation of individual passengers, just an aggregate
formula — but it's the piece that makes demand, yield mix, pricing, and
competition into one system instead of four unconnected ones.

**Side note on frequency specifically:** real airline schedule
competition has a well-documented effect where frequency share
translates into *more than proportional* market share (the "S-curve").
Worth knowing about even if v1 skips the nuance and treats frequency
share as directly proportional.

---

## Loops

### Pricing (new — falls out of decision 3)

Each route gets a computed recommended fare (formula still open, see
above) and the player can override it. Directly feeds the choice
model's price term, so raising fare trades market share for margin and
lowering it does the reverse — the core yield-management tension, for
free, once the choice model exists.

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
3. Population data (StatsCan research) + O-D demand layer (gravity model)
4. Choice/market-share model — the connective piece
5. Yield mix / travel purpose segmentation
6. Static competitor data, authored and wired into the choice model
   (small, now that AI is non-reactive — see "What this simplifies")
7. Pricing (recommended fare + override) — formula TBD, see above
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
