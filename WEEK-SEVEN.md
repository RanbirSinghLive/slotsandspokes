# airgame — Week seven (the utilisation pivot)

Handoff document. Week six's full history lives in `WEEK-SIX.md` — read
this one first, and go there only for the reasoning behind a specific
system.

**State at handoff:** save key `airgame-save-v23`, 11 sidebar tabs.
Phases A, B and C of the pivot are done and committed; **phase D is the
next thing to build.**

---

## The pivot, in one paragraph

The Gantt (Rotation tab) is being mothballed. Instead of placing legs at
times on a timeline, an aircraft's day is a **budget** and every rotation
spends a share of it: `(Σ block minutes + Σ turns) ÷ usable day`, where
the usable day is 06:00–22:00 (960 minutes). This makes adding a
frequency a commercial decision rather than an exercise in finding a gap,
surfaces unused aeroplane directly, and expresses long-haul turns that a
timeline model could only call impossible.

---

## Decisions already made — do not re-litigate

These were settled directly with the repo owner. Changing them needs a
fresh conversation, not a judgement call.

1. **Frequencies pool per base, not per tail.** A per-tail figure can't
   answer "have I a spare aeroplane's worth of gaps scattered about",
   which is the question the pivot exists to make answerable.
2. **Bases are assigned explicitly** (`Aircraft.baseAirport`), never
   inferred from wherever a route happened to start. This is what lets an
   airline fly a multi-leg loop and be based at one airport only.
3. **A frequency is a rotation — an ordered chain starting and ending at
   its base** — not a per-market round trip. The owner's example is
   `YUL-YFC-YQM-YFC-YQM-YUL`, which flies YFC↔YQM legs that never touch
   the base. A plain out-and-back is just the two-leg case.
4. **No schedule view at all.** The Gantt goes; nothing replaces it.
5. **Commercial tab becomes a Routes tab** carrying aggregated route
   data, and **fare policy stays at the top of it** — it's per-market
   pricing and that's where markets live.
6. **"Add stop" button in the New Route popover** is the chosen
   interaction for building a multi-leg rotation.

### The one conflict, and how it was resolved

CLAUDE.md is explicit that the map exists chiefly to show *"how a delay
on one sector cascades through the rest of that aircraft's day."*
Percentages have no sequence, so a naive utilisation model would delete
the cascade and `delayMinutesByCause.knockOn` with it.

**Resolution: split planning from operating.** Planning — what the player
touches — is rotations and percentages, no times. Operating is unchanged:
`step()` still flies real legs at real times and still cascades delays.
The player stops *authoring* the timeline; the game derives it. Watching
an aircraft fall behind on the map is unaffected.

Keep this split. It is the reason the pivot doesn't violate the project's
core principle.

---

## Phase A — done, committed in `817544a`

- `src/sim/utilisation.ts` — `USABLE_DAY_MINUTES` (960),
  `legUtilisationMinutes()`, `aircraftUtilisation()`,
  `utilisationByBase()`, `impliedBase()`.
- `Aircraft.baseAirport: string | null` on `SimState`. New aircraft from
  the Fleet Market arrive **unbased**; `createInitialState()` bases its
  fixture aircraft where their first leg departs.
- Fleet tab shows a per-base utilisation bar plus a base `<select>` per
  aircraft.

Spare capacity is reported **in aircraft** (`spareAircraft`) because that
is the number that answers "is another airframe worth it" — 0.05 says no,
0.9 says nearly.

Measured on the reference network: three aircraft at 31–48% utilisation,
roughly 0.6 of an airframe idle at every base.

---

## Phase B — done

As predicted, a single-file change to `src/ui/routeBuilder.ts` (plus the
popover's markup and CSS). No data model change, no `step.ts` change, no
`SAVE_KEY` bump — every other system still sees ordinary timed legs.

- `BuilderState` carries `chain: Airport[]`, base first, last entry being
  whatever the next leg departs from. **"Add stop"** appends the pending
  destination and re-arms from it; confirm closes the loop back to the
  base. The chain is drawn solid on the map as it's built.
- `packRotation()` walks the chain from a start minute, advancing
  `cursor += blockMinutes + MIN_TURN_MINUTES`, last leg closing to base.
- `planRotation()` is the single source of truth for both the popover's
  text and the confirm handler — the old form re-derived its checks in a
  defensive second pass, which was two copies of the same rules.
- Live preview: "Uses 23% of an aircraft — YHZ has 1.00 spare, 0.78 after
  this."

### Decisions taken while building, settled with the owner

1. **A rotation must start at the tail's `baseAirport`** — arming from
   anywhere else is a hard block with a plain message. An unbased airframe
   gets based by flying its first rotation, which is now the only place
   other than the Fleet tab's dropdown where a base gets set.
2. **The Depart input and the "Add return leg too" checkbox are gone.**
   Auto-pack owns the timeline, so a depart field would be a control that
   lies, and a return is just the two-airport chain.

### Three things worth knowing before touching this

- **A second rotation on a tail packs after its existing day**
  (`rotationStartMinute()`), not from 06:00. Packing everything from 06:00
  would double-book a tail against itself and `validateSchedule()` would
  rightly call it broken. Because every rotation ends at base, appending
  always chains cleanly.
- **Exact-time collisions are nudged, not blocked.** Auto-packing makes
  two tails departing the same market at the same minute likely rather
  than rare, and the player has no time field to change any more, so
  `packRotationAvoidingCollisions()` shifts the whole rotation in
  five-minute steps until it's clear. Verified: a second YHZ aircraft's
  rotation packs at 06:05 behind the first's 06:00.
- **The pooled-capacity check folded into the fit check.** A rotation that
  fits one tail's day always fits its base's pool (the pool contains that
  tail), so a separate pooled gate could never fire. Instead, when the
  22:00 fit fails, the message reports whether the *base* still has spare —
  "put this on another tail based there" vs "buy another airframe."

### Known small wart

Utilisation charges a turn to every leg including the last, but the fit
check uses actual arrival — so a base can read `-0.01 spare` while its
schedule is perfectly legal. Worth at most 30 minutes (0.03 of an
aircraft). Left alone deliberately: `legUtilisationMinutes()` is phase A's
model and the Fleet tab already shows it that way, so changing it is a
phase A decision, not a phase B one.

---

## Phase C — done

Two commits, each independently runnable.

**Deletions.** The Rotation tab and `ui/rotationBoard.ts`, the
`'rotation'` SidebarTab case, its 900px expand affordance
(`PANEL_WIDTH_EXPANDED_PX` and `setPanelWidth()` with it), the per-leg
schedule table and its filters, `PositioningLeg` and its whole queue
including `step()`'s positioning departure loop and
`ActiveFlight.isPositioning`. `SAVE_KEY` bumped to **v23** for the
`positioningLegs` removal.

**`validateSchedule` lost the half rotations make impossible** —
`tailRotationProblems()` is gone entirely, so the continuity, turn-time
and loop-closure checks with it. Two checks survive because both are
about the schedule meeting the *world* rather than agreeing with itself:
too-large-for-the-airport, and stranded-aircraft.

**The new failure mode is `utilisationProblems()`** in
`sim/utilisation.ts` — over 100% of a usable day, as promised. It lives
there rather than in `schedule.ts` because the utilisation model defines
what "too much" means, and because `schedule.ts` importing it would close
an import cycle. `ui/panels.ts`'s **`scheduleProblems(state)`** runs both
halves; every call site should use it rather than either half alone.

### The one thing C had to add rather than delete

Removing the schedule table would have left the player able to add
rotations but never remove one — its `×` button was the only way back
from an unwanted route. So the **rotations list** replaces it in the
Fleet tab: one row per rotation with its chain, window, utilisation
share, and a remove button that drops the whole rotation.

This is not the Gantt returning. It has no timeline and nothing is
draggable; it's the budget view, listed. Removing a *rotation* rather
than a leg is also the only coherent unit now — deleting one leg out of
the middle would strand the rest of it away from base.

`rotationsForTail()` derives rotations by splitting a tail's legs wherever
one lands at its base. Deliberately **not** stored on `SimState`: a
stored `Rotation[]` alongside `schedule` would be two representations of
one fact, free to drift.

### Consequences worth knowing

- **Changing a base in the Fleet tab regroups existing legs.** The split
  point is the *current* base, so legs built around the old one re-form
  into different rotations, and one may not close. Those are flagged red
  (`.rotation-row--open`) and are removable, which is the intended repair
  path. This is now the only way to break a rotation from outside.
- **The stranded check got much harder to reach.** Confirming a rotation
  places a tail at its base when it has no legs, so "remove everything and
  redraw" relocates the aircraft rather than stranding it. The check is
  kept for the narrow case it still covers, but do not expect to see it.
- **Balance is provably untouched.** `headless-output.csv` and
  `sweep-reserve.csv` are both byte-identical after C — the fixture never
  used positioning legs, so removing that RNG draw changed no sequence.

## Phase D — next. Build this.

**Commercial becomes Routes.** Aggregated per-market data, fare policy at
the top. Rename the tab and its icon.

---

## Carried-forward items, none blocking

### Open balance question, flagged and deliberately not fixed

**Margin currently favours under-staffing.** With crew as a large fixed
cost, the reference network's margin peaks at reserve depth **1.05 (77.7%
completion)** rather than 1.25 (99.9%) — cancelling marginal flights saves
more variable cost than it loses in revenue. Completion factor and
Reputation still order correctly, and Reputation gates the tech tree and
C-suite so reliability pays in ways the sweep can't see. But raw margin
points the wrong way. It may be the fixture's tight schedule (56% on-time
even fully staffed), or it may mean the marginal flight doesn't earn its
keep at current fares. **This is a balance decision for the owner, not a
bug to quietly tune.** The utilisation pivot may change it outright.

### Unfinished from the menu-condensing plan

Phases 1 and 2 landed (airport presence → map; prose → tooltips, flavour
collapsed). **Phase 3 — tab grouping, 12 → ~6 — was never started.**
Proposed grouping: Operate (Fleet/Rotation/Crew), Network
(Commercial/Airports), Grow (Fleet Market/Tech Tree/Executive), Goals
(Missions), plus Dev and Game. C has since removed the Rotation tab
(11 left, so Operate is just Fleet/Crew now) and D renames Commercial —
do the grouping after D.

Also never built from that plan: route reliability colouring on the map,
a today's-disruption layer (grounded aircraft, cancelled legs, closed
airports), and commercial state per route arc.

### Requested, not yet designed: spares

**Asked for directly by the repo owner (2026-08-02), to build after the
pivot.** Two buyable kinds of spare, both money spent up front to protect
something the player currently has no lever over:

- **Operational spares** — line-maintainable parts held at a base, so a
  minor defect is a delay rather than a cancellation. Protects **on-time
  performance** and feeds the existing mechanical-groundings path.
- **Heavy maintenance spares** — the expensive rotables that decide how
  long an airframe sits in a heavy check. Protects **downtime**: with
  spares held, a check returns the aircraft sooner.

This needs a new per-aircraft field, **time until heavy check** (hours or
cycles remaining), which is also the first thing on `Aircraft` that gives
airframe age a mechanic rather than just a cost multiplier.

Note this lifts CLAUDE.md's do-not-build entry for **maintenance
planning** — it was gated "until explicitly asked," and this is that ask.
Nothing else on that list is unlocked by it.

### Other open items

- **Executive effects are placeholders** by the owner's own framing. Real
  numbers still to come. Note the maintenance COO does nothing on an
  age-0 fleet — `effectiveAge = age × factor`, so zero times anything is
  zero. That's intended, not a bug.
- **Competitor price response** — repeatedly identified as the thing that
  would stop pricing being solved-once, still gated by CLAUDE.md's
  do-not-build list until asked for directly.
- Weather/mechanical cancellations exist; **ancillary revenue (bag fees)**
  designed twice and never built.
- The tech tree has one branch (fuel efficiency).

---

## Conventions worth knowing before touching anything

- **Bump `SAVE_KEY` in `src/ui/save.ts` on any breaking `SimState`
  change.** Currently `v23`. Old saves are simply never found again
  rather than crashing.
- **`npm run sweep -- <lever> [days]`** is the balance tool. Its
  guarantee is that rows differ only by the lever, which requires the
  **number of RNG draws per day to be constant**. This was broken once by
  a roll that skipped already-grounded aircraft; see
  `rollDailyMechanicalGroundings()` for the fix and why it rolls every
  aircraft and discards the result.
- **`createInitialState()` is the balance fixture** and grants itself
  crew, slots and bases so it models a working airline. A real new game
  (`createNewGameState()`) starts with none of those, because acquiring
  them is the mechanic.
- **The dev-server browser throttles rAF when idle.** Sim time barely
  advances unless something forces frames (a screenshot, an explicit
  wait). State read immediately after an action can be stale — prefer
  direct JS state reads over screenshots when timing matters.
- **Clear test saves** (`localStorage.removeItem('airgame-save-vNN')`)
  *and reload in the same call*, or the running game re-saves over the
  clear at the next day rollover.
- Cost categories in `todayCostByCategory` **must sum to `todayCost`**.
  Executive bonuses are income and credit `cash`/`todayRevenue`, never a
  negative cost.
