# airgame — Week seven (the utilisation pivot)

Handoff document. Week six's full history lives in `WEEK-SIX.md` — read
this one first, and go there only for the reasoning behind a specific
system.

**State at handoff:** commit `817544a`, save key `airgame-save-v22`,
12 sidebar tabs, working tree clean. Phase A of the pivot is done and
committed; **phase B is the next thing to build.**

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

## Phase B — next. Build this.

**Key finding from phase A: B is a single-file change to
`src/ui/routeBuilder.ts`.** It needs no data model change and no `step.ts`
change, because a rotation *already is* a sequence of legs on one tail —
which is exactly what `ScheduleLeg[]` filtered by tail expresses. Every
other system (economy, market stimulation, map, on-time, validation) keeps
seeing ordinary timed legs and keeps working untouched. This makes B
independently revertible, which matters given the size of the pivot.

### What to build

1. **Chain collection.** `BuilderState` (in `routeBuilder.ts`) gains a
   `stops: Airport[]`. An **"Add stop"** button in the New Route popover
   appends the current candidate and re-arms the builder from it rather
   than confirming. Confirm closes the loop back to the base.

2. **Auto-pack on confirm.** Walk the chain from
   `USABLE_DAY_START_MINUTE` (06:00), assigning each leg
   `departMinute = cursor`, then advancing
   `cursor += blockMinutes + MIN_TURN_MINUTES`. The final leg returns to
   the base, so continuity is automatic and no positioning leg is ever
   needed.

3. **Live utilisation preview in the popover.** `legUtilisationShare()`
   already exists — show "this rotation uses 34% of an aircraft; YHZ has
   0.69 spare" *before* the player commits.

4. **Reject rotations that don't fit** — either the packed chain runs past
   22:00, or it exceeds the base pool's spare capacity. Use the same
   hard-block-with-plain-message shape the range, network and slot checks
   already use in `updateFormValidation()`.

### Watch out for

- The route builder already enforces **range**, **network reachability**,
  **slot capacity** and **aircraft-type-allowed-at-airport**. Each new stop
  must be checked against all of them, not just the first leg.
- `formReturnCheckbox` ("Add return leg too") becomes redundant once
  chains exist — a return is just a one-stop chain. Decide whether to keep
  it as a shortcut or drop it.
- The popover's overflow clamp runs *after* `updateFormValidation()`
  populates dynamic text. If you add rows to the popover, keep that
  ordering or it will spill off-screen (this bug was already fixed once).

---

## Phases C and D — after B lands

**C — deletions.** Remove the Rotation tab (`#rotation-board`,
`ui/rotationBoard.ts`, the `'rotation'` SidebarTab case), the schedule
table in the Fleet tab, `PositioningLeg` and its whole queue including
`step()`'s positioning departure loop, and the half of `validateSchedule`
that rotations make structurally impossible (continuity and turn-time
checks — the `"lands at BOS but next leg departs YQM"` class of error
can no longer occur). Utilisation over 100% becomes the new failure mode.

**D — Commercial becomes Routes.** Aggregated per-market data, fare
policy at the top. Rename the tab and its icon.

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
(Missions), plus Dev and Game. Do this *after* the pivot, since C removes
a tab and D renames one.

Also never built from that plan: route reliability colouring on the map,
a today's-disruption layer (grounded aircraft, cancelled legs, closed
airports), and commercial state per route arc.

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
  change.** Currently `v22`. Old saves are simply never found again
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
