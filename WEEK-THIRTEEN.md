# airgame — Week thirteen (the timed schedule)

Handoff document. Week twelve (alpha readiness: hosting, save safety,
the tutorial, feedback, rebasing, crews from the ring) lives in
`WEEK-TWELVE.md`.

**Settled with the owner (2026-09-29):** build the whole of it now,
threads 1–5 in order, from the git tag `pre-timed-schedule` (the last
state before it, to go back to). Hours for slots, 5-minute steps for
dragging; thread 5 in; rivals keep a profile, not timetables. And, from
the owner:

- **The Gantt is the Fleet screen's existing rotations timeline**,
  edited within its size, not a new screen: planes **clustered by type,
  each group collapsible**, and **a colour per type** for the rotation
  blocks ("pucks") so types read at a glance.
- **Crews live only on the Crews screen**: the airport view's Crews
  section goes.
- **A Maintenance screen (Mtc) under Crews** takes AOGs and Expedite,
  plus the fleet's health (age, tech dispatch, AOG chance, life left).

## Status

- **Done:** the Maintenance screen, crews off the airport view.
- **Done: threads 1–2.** `sim/hours.ts`: capacity by the hour, rivals
  water-filled by profile, the hour strip on the airport view, the
  planner's hour search ("ALB 07:00 full · departs 13:10"), peak slots
  priced higher. Crew duty splits at a 2-hour wait at base, so an
  off-peak rotation doesn't cost crew hours. Balance moved (steady
  medians, year): YUL $14.8M, YYZ $49M, BOS $39M, PHL $79M, LHR $188M,
  YHZ busts 5/6: easier at big homes, harder at thin ones. The pass
  waits for threads 3 and 5, which move it again.
- **Done: thread 3.** `sim/timeOfDay.ts`: segment curves; a market's
  passengers split by each flight's hour; a schedule's time fit counts
  (at 35% strength) in the choice against rivals. Balance about where
  thread 2 left it (steady medians: YUL $10M, YYZ $46M, BOS $21M, PHL
  $76M, LHR $186M; YHZ busts 4/6). The hour search jumps by hours, so a
  year runs in about 17 s (8 s before the thread, on a smaller airline).
- **Done: thread 4.** The Fleet screen's Schedule is the Gantt: planes
  grouped by type (folding), a colour per type, rotations dragged in
  5-minute steps or onto another plane of the type, planned and priced
  live by `sim/retime.ts` (hour room, turns, curfew, slots re-priced by
  hour, margin change, crew warning); a move to a time already past
  today starts tomorrow.
- **Done: thread 5.** Connections from real times (40 min to 3 h at the
  hub, through flights on the same plane); hub style is the planner's
  waves (Banked every 3 h, Tight every 2 h from 07:00); re-timing keeps
  rotation starts; the headless player follows Plan hub's style advice
  weekly. Connection scale set so Rolling ≈ the old model on mid-game
  networks.
- **From the owner's first tries:** the drag cancels cleanly if the
  panel rebuilds under it (it used to freeze the timeline), holds the
  clock while held, shows its time on the block and a dashed outline of
  where it was, and says why when it snaps back; no drop onto an AOG
  plane. The airport hour chart has a y-axis in movements, a dashed
  line at the hour's room, and a readout of the hour under the pointer.
- **Balance, steady medians, connection scale 0.5** (0.4 and 0.6 tried):
  YUL $0.8M (3/6 busts), YYZ $37.0M (1/6), BOS $86.4M, PHL $76.4M, LHR
  $123.4M, YHZ busts 5/6. Before the project: YUL $17.2M (1/6), YYZ
  $36.6M, BOS $14.0M, PHL $56.9M, LHR $71.0M, YHZ 4/6. Big homes are now
  easier, YUL and YHZ harder. Measured cause at YUL seed 1: curfew
  cancellations up from 10 to 36 in 60 days and "not in position" from 3
  to 20, as days run later; the steady player cuts routes over
  cancellations and never grows. **Open: the balance pass**, starting
  there.
- Re-timing packs each rotation into the earliest start with room
  (`roomyStart()`), and the headless hub review uses `styleAdvice()`, not
  the whole Plan hub: a PHL year runs in 16 s (56 s with the whole plan).

**State at handoff:** save key `slotsandspokes-save`, save format 2.
Every leg already has a real time (`ScheduleLeg.departMinute`), but the
auto-packer (`sim/rotations.ts`) sets it and the player never does. An
airport's slots are a daily count rationed to an abstract peak
(`HUB_STYLES[style].peakFactor`), so a hub is "full" all day at once:
ALB on day 167 of the owner's game, 60 of 61 movements, with no way to
fit a flight in the quiet middle of the day.

**This reverses a settled decision.** On 2026-09-23 the owner ruled that
the player never authors times (the Gantt was dropped in week seven for
turning planning into gap-finding). On 2026-09-29 the owner asked to
bring timing back, as a layer a player can ignore until a hub fills.
Week seven's split still holds: **planning is rotations and shares of a
day by default, operating is real times.** What changes is that a
player *may* now reach into the times, and slots become hours.

---

## The idea, in one paragraph

Three layers, each optional over the one before. **Play dumb:** draw
routes, the game times them; nothing here asks for a time. **The game
fits it in:** when a hub's peak is full, the planner finds the first
hour that still has room and says so ("ALB peak full · fits 13:10"),
so a new flight goes off-peak by itself rather than hitting a wall.
**Optimise:** a Schedule screen (the Gantt) to move rotations between
hours and planes, because peak hours are worth more (business
travellers want them) and cost more (slots priced by the hour), and a
hub's connections come from what actually meets there. The mid-game
depth is deciding **which routes get the peak**.

## Principles

1. **Never required.** A player who never opens the Schedule can still
   grow; they just leave value on the table, like the Plan hub button.
2. **Every hour is a trade.** Peak: more demand and yield, dearer slots,
   more congestion. Off-peak: room, cheaper slots, mostly leisure
   passengers. No hour is simply better.
3. **Auto first, hand second.** The auto-packer places everything; the
   Gantt only moves what's placed, through a sim rule
   (`sim/retime.ts`), never by editing legs in the UI.
4. **The cascade stays.** Operating is unchanged: `step()` flies real
   legs and knocks delays on down a plane's day.
5. **Moats still take time.** Holding a hub's peak hours is the moat;
   an off-peak slot is easy to get and easy for a rival to match.

---

## Thread 1: see the hours (read-out, no rule change)

- **Movements by hour** at each airport: yours from leg times, rivals'
  spread over the day by a fixed profile (they have frequencies, not
  times; they bunch at the peaks like real carriers).
- **An hour strip** on the airport screen: 06–22, one bar per hour, you
  / rivals / free against the hour's capacity. ALB would show the
  morning and evening full and the middle of the day open.
- Measure (balance script): the day each home's peak first fills, and
  how much off-peak room is left then, per player kind.

## Thread 2: slots by the hour (rules)

- **Hourly capacity**: the field's daily capacity (`airportCapacityPerDay()`)
  spread evenly over the usable day's hours. Room is judged hour by
  hour, so the peak factor stops being an abstract multiplier: the peak
  is whatever the schedule makes it. Congestion delays read the load in
  the hour a leg departs or lands.
- **A slot is an hour**: the right to a movement at an airport in a
  given hour, priced from that hour's load (so a peak slot costs more),
  locked when taken as today. Rivals take slots too, peak first.
- **The auto-packer searches hours**: a rotation still starts as early
  as its plane is free, but if any airport it touches is full in that
  hour, it tries later starts (in 5-minute steps) until every leg fits
  or the day runs out. The route card says where it landed and why
  ("peak full at ALB · departs 13:10").
- **"Full" means every hour full**, not the peak.
- Save format 3: held slots become per hour, migrated from each leg's
  current time.

## Thread 3: the peak is worth having (demand)

- **Time of day in the choice model** (`sim/choiceModel.ts`): each
  segment gets a departure-time curve. Business peaks 06–09 and 16–19
  and cares a lot (`weightSchedule` 0.9 today); leisure is nearly flat
  and cares little; VFR leans to midday and evening. A departure's fit
  for its hour multiplies into `scheduleFit`, so an off-peak flight
  draws mostly price-led passengers at lower yield.
- Balance: an off-peak rotation should pay (it's how a full hub still
  grows), but clearly less than the same flight at the peak.

## Thread 4: the Schedule screen (the Gantt)

- **A rail screen, Schedule**: one row per plane, grouped by base and
  type; each rotation a block of legs with its turns; the hour strip of
  the selected airport across the top.
- **Drag a rotation** left or right in 5-minute steps: it moves whole
  (legs keep their turns). Drag it to another row of the same type to
  swap planes. While dragging: the slot hour at each airport it touches
  (green room, red full), turns, the 22:00 curfew, crew duty, and the
  day's revenue change from Thread 3, before letting go.
- **Rules in the sim** (`sim/retime.ts`): `planRetime()` checks and
  prices a move; `commitRetime()` applies it and takes or releases
  slots. The UI calls them, as the route builder calls
  `sim/rotations.ts`.
- **Found when needed**: the rail item is always there; its dot lights
  when an airport you fly has a full peak and a better slot is free
  ("ALB peak full · 3 free hours"). The Plan hub card and the route
  builder's "fits 13:10" link into it.
- Desktop first: a Gantt on a phone is a later problem (the mobile
  note in week twelve).

## Thread 5: connections from real times (the hub payoff; could)

- A connection needs an arrival and a departure at the hub within a
  window (minimum connect ~40 min, worth less the longer the wait, none
  after ~3 h), replacing the frequency-based estimate
  (`sim/hubs.ts`).
- **Hub style becomes a packing preset** (Rolling, Banked, Tight): how
  the auto-packer times a hub's rotations, not a multiplier. A player
  who builds banks by hand in the Gantt gets the same payoff.
- The biggest balance change here, which is why it's last and a
  "could": Threads 1–4 stand without it.

## The headless player

It keeps playing dumb: the auto-packer's hour search (Thread 2) is in
the planner it already uses, so it gets off-peak slots for free. Once
Thread 3 lands it gets one policy: when a hub's peak is full, swap the
lowest-yield peak rotation with the best off-peak one, once a week. That
is enough for balance numbers to describe a player who uses the Gantt a
little.

---

## Decisions for the owner

1. **Order against the alpha.** Recommended: finish week twelve's year
   one report first, invite the first players on today's model, and
   start Thread 1 alongside. Threads 2–3 change the economy, so alpha
   feedback on the early game stays useful, and players at a full hub
   become the test for Thread 4.
2. **Hour granularity.** Recommended: whole hours for slots and the
   strip (16 buckets, 06–22); 5-minute steps for dragging.
3. **Thread 5 in or out** of this milestone.
4. **Rivals' times.** Recommended: a fixed peaky profile, not real
   timed schedules for rivals (a large change for little the player
   would see).

## Risks

- **Busywork creep**: the reason the Gantt went. Guarded by Principle 1
  and by the auto-packer doing the obvious moves; if players open the
  Schedule to fix things the game should have fixed, the packer is
  wrong, not the player.
- **Balance**: hourly slots loosen full hubs (more total room); time of
  day tightens yields. Each thread gets a balance pass before the next.
- **Performance**: hourly load is asked for on every slot quote,
  including rivals'; it needs a per-day cache like
  `averageServedMovements()`.
- **Save migration** (format 3) must place every held slot in an hour.
- The tutorial and HOW-IT-WORKS gain a Schedule step and section.

## Carried from week twelve

- The browser pass; the year one report; the balance pass (steady
  over-expands at thin homes); the performance check at 100×.
- Rename the other rival codes held by well-known airlines (AR, BR, MS,
  HX, NW, RX), if the owner wants.
- Mobile as good as desktop; colour-blind red/green; changelog; `?`
  shortcuts card.

## Playtest notes

*(The owner, and then the alpha players, add findings here.)*
