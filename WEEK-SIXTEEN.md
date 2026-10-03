# airgame — Week sixteen (bases, nights away, and starts worth surviving)

Handoff document. Week fifteen (the whole world, start seasons, the
picker) lives in `WEEK-FIFTEEN.md`.

**State at handoff:** save key `slotsandspokes-save`, save format 2.
554 airports on every continent; 516 pickable homes rated (283 Standard,
88 Hard, 145 Brutal), 74 of them featured on the world-map picker with
stories. Games start on 1 May or 1 November. The quick read's reference
(`balance-reference.json`, summer starts) is from commit 8c6e9dc, before
the 74-airport top-up; the weekly balance read (pre-approved, Sundays)
will say whether that moved anything. Desktop is the target: the
browser and mobile pass is dropped.

**Status:** stage 1 built, waiting on its quick read.

---

## The idea, in one paragraph

Today every plane sleeps at its base and gets its line check there, so
maintenance is almost never a decision, and a base is just where a plane
was leased. This week a base becomes an investment: a **crew base** is
where crews live and planes can be based, a **maintenance base** is
where a night counts as a line check, and each is opened deliberately,
at a cost, on its own tab. On top of that, a plane can **sleep away**
(a night stop): drag a rotation off the end of its day on the Gantt and
it wraps round to the morning. That buys an early flight into the hub
and more flying out of the plane, at the price of a night without a
check unless it sleeps at a maintenance base. Out-and-backs are the
early game; bases and night stops are the mid-game's next layer.

---

## Stages

| Stage | What | What it feels like |
|---|---|---|
| **1. Bases as investments** | Crew bases opened on the Crews tab, maintenance bases on the Mtc tab; line checks only at a maintenance base | Where you build decides where you can fly from and where planes rest |
| **2. Night stops** | Drag a rotation past either end of the day and it wraps: out at night, back in the morning | A mid-game way to squeeze more flying and a morning wave into the hub |
| **3. Thin homes** | The 145 Brutal homes: why they're thin, and whether they're winnable | Sydney is a real choice, not a trap |

### Stage 1: bases as investments

1. **Crew bases are opened on the Crews tab.** An "Open crew base"
   action there: pick a known airport, pay a one-time cost and a daily
   cost (the crew room). A plane can be leased or based only at a crew
   base. Leasing at a new airport no longer opens one by itself (today's
   lease opens one for $100,000, `CREW_BASE_FEE`).
2. **Maintenance bases are opened on the Mtc tab**, the same way: a
   one-time cost and a daily cost. Abstract: no hangar sizes or slots.
3. **One maintenance rule, everywhere** (`sim/mxChecks.ts`): a night
   counts as a line check, and banks heavy-check hours, only where the
   plane sleeps at a maintenance base. Anywhere else the night is
   either a **contracted check** (paid by the hour of the night's work)
   or a **deferred item**, by a setting per station on the Mtc tab
   (contracted unless changed). A plane based at a crew base without a
   maintenance base pays or defers every night: cheap to open, dearer
   to run. Heavy-check hours bank only at a maintenance base; a plane a
   week past due ferries to the nearest one and is grounded there, as
   today.
4. **The Airports tab marks each base** (crew, maintenance, both) for
   reference, and an airport's own view says what's there.
5. **Home comes with both, in the starting cost**: a new game plays as
   today until the player expands. Old saves: every existing crew base
   gets a maintenance base, so no one's planes start deferring.
6. **The headless player:** opens a crew base when it wants to base a
   plane away from home; opens a maintenance base where two or more
   planes sleep regularly or where its contracted checks cost more than
   the base would.
7. **First numbers, for the balance read to settle:** crew base $100,000
   to open and $500 a day; maintenance base $400,000 and $1,500 a day;
   contracted checks $300 an hour of work (a Propeller's ~3h night is
   about $900).

**Stage 1 built:**
- `sim/bases.ts`: open and close crew and maintenance bases, their daily
  costs (home's free), each station's contract-or-defer setting.
  Leasing needs a crew base; the lease no longer opens one.
- `sim/mxChecks.ts`: a night is a line check only at a maintenance base;
  elsewhere contracted ($300/h of the work) or deferred. An MX hold
  happens where the plane slept, contracted away from a maintenance
  base; an overdue heavy check at a base without one is contracted.
  Fixed on the way: a heavy check finishing on a night that also cleared
  an item left the count at −1, which made the plane age as if younger.
- The Crews screen's Crew bases (open, close, hire at a new base), the
  Mtc screen's Maintenance bases and Stations, the Airports screen's
  Base column, each airport's view, and ☾c on the Gantt.
- Checked in the browser on a test game (opening a crew base at
  Ottawa, both screens, the Base column), and end to end in Node: a
  lease refused without a crew base, then contracted, deferred and
  checked nights at Ottawa as its setting and bases changed.
- **One finding from the browser:** a Hong Kong game had replaced the
  owner's Toronto save before stage 1's browser check; the game keeps
  one save, so Toronto can't be recovered.
- One-seed headless Montréal: $29.6M before, $11.1M after. The
  headless player never leaves home, so the rules barely touch it (21
  contracted nights a year, $30k); the path moves because those nights
  no longer leave items. The quick read decides.

### Stage 2: night stops

1. **The gesture.** On the Fleet page's Gantt, drag an out-and-back past
   the right end of the day (or the left) and it **snaps into a wrap**:
   the flight out sits at the end of the day, the flight home at the
   start of the line, leaving the station in the morning. Drag either
   half back into the day and it snaps back into an out-and-back. There
   is no menu and no money in the tip: the tip says what the night is,
   in ops terms ("Night stop YHZ · out 20:40 · back 06:00 · no mtc
   base: contracted check"), or why it won't fit.
2. **It never moves other flying.** The wrap is offered only where both
   halves fit the plane's day as it stands: the flight out after its last
   arrival and inside the curfew with slack, the flight home landing
   before its first departure with a turn. Where it doesn't, the tip
   says why ("needs first departure 07:20 or later"); moving the rest
   is the player's own drag.
3. **A night stop is just the schedule's shape** (as the first version
   had it): a plane whose day ends at an outstation and starts there is
   on one. Every night there costs the crew's hotel ($200 a crew for a
   Propeller up to $900 for a Widebody), and the line check follows
   stage 1's rule: free at a maintenance base, contracted or deferred
   elsewhere.
4. **A broken night stop costs one flight, not a day.** If the evening
   flight out is cancelled or would run past the curfew, the plane
   sleeps at base and tomorrow's morning flight from the station is
   cancelled that evening (its reason shown); the plane flies the rest
   of its day from base. In the first version the morning flight was
   left without a plane and the day cascaded.
5. **Deferred items bring a plane home.** At 3 the night stop breaks
   for a night as in 4, so the plane sleeps at a maintenance base and
   gets its check. No cap on items is needed.
6. **The headless player** wraps a rotation when its own forecast
   (sim/marketSummary.ts and the hub's connections, with the curfew
   slack and the route's late-running counted as a chance of breaking)
   beats the night's hotel and check. The forecast is the player's, not
   shown on the page.

### Stage 3: thin homes

145 of 516 homes are Brutal, among them Sydney, Melbourne, Buenos Aires,
Lima, Manila and Ho Chi Minh City, and the picker features them. To be
decided with the owner once stages 1–2 are in: what makes a home thin
(few, short or small neighbours; an incumbent on the best route), how
the picker says so, and whether thin starts get a different opening
(a starting plane, contracts) or stay a test.

### Balance

Each stage gets a quick read against the reference before it's kept
(each needs the owner's approval). Stage 1 should be close to neutral
for the four test homes, which mostly fly from home. Stage 2 is the
risk: the first night stops took Toronto from $16.2M to $1.8M on 18
seeds. If Montréal or Toronto falls outside the read's noise, it goes
back for rework rather than into the game.

---

## Decided with the owner (2026-10-03)

1. **Night stops are a Gantt gesture**, not a menu: drag past the end of
   the line and the rotation wraps round. No money hint. A mid-game
   option once out-and-backs are covered: more utilisation and better
   connections for those who want them.
2. **Crew bases and maintenance bases are distinct investments**, opened
   on the Crews and Mtc tabs and marked on the Airports tab. Basing a
   plane doesn't make an airport a hub; hub value stays connections.
3. **Maintenance bases are abstract**: no hangar detail.
4. **Home starts with both**, inside the starting cost.
5. **Desktop is the target;** the browser and mobile pass is dropped.

---

## Carried

- **Booking curves** (fare classes stand in with a booking order).
- **Montréal's slide** since week fourteen's stage 3, inside the noise.
- **Colour-blind red/green**; a changelog; the other well-known rival
  codes; a rebasing plane drawn at its old base; innovation
  prerequisites between innovations.
- **The `?` shortcuts card** is built on branch `cloud/shortcuts-card`,
  waiting for its pull request.
- **The airport tags and home stories**, for the owner to correct.
