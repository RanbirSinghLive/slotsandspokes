# airgame — Week eleven (polish, then the product)

Handoff document. Week ten (goals and progression: the ladder,
innovations, NPS, executives, fuel and hedging, crews by type, fleet
timing, rivals on the ladder) lives in `WEEK-TEN.md`; read this one
first. **Draft**: the owner annotates it from play, and the order
changes with them.

**State at handoff:** save key `airgame-save-v46`. Every WEEK-TEN
thread is done. The game has direction now, but it reads like a
manual: panels explain themselves in full sentences, the ticker
narrates, and the map was cluttered with airport names (taken off
already: `20249bf`, codes only, the name is in the airport view).

---

## The idea, in one paragraph

First make what exists feel like an **airline operations centre**:
terse, number-first copy; explanations moved out of the panel and into
(i) tooltips; state you can read at a glance (timelines, grids,
stamps) instead of sentences. Then give the player the first real
**product** decisions: what goes inside the plane (cabins), what the
ticket includes (bags), and how hard the planes are flown (speed
against fuel). Those only mean something once passengers differ by
market, so the product thread starts by making the business, leisure
and VFR mix real.

---

## Decisions (settled with the owner)

1. **Polish first**, all ten items of thread 1, starting with the copy
   pass (item 2) and tooltips (item 3).
2. **A product builder** (thread 2): cabins, bag fees, and a speed
   choice, built on a per-market passenger mix.
3. **Airport names stay off the map**; the inspector names airports.

### Out of scope

- Seasons, rival personalities, airport deals, missed connections (the
  owner's graded lists; candidates for week twelve).
- Balance retuning beyond what threads 1–2 force (the "too easy past the
  start" finding stays open; see Carried forward).
- Per-passenger simulation (CLAUDE.md).

---

## Thread 1: polish the current experience

Ten items, in this order. Each is UI only unless it says otherwise, so
headless output must stay byte-identical.

### The copy style (applies to every item)

The game speaks like an airline ops centre, not like an explainer.

- **Numbers and codes first, noun phrases, no narration.**
  "AOG YUL · C-P002 · hydraulics · back in 3d", not "C-P002 is
  grounded at YUL with a hydraulics fault and will be back in about
  three days."
- **State in the panel, rules in the (i).** A line says what *is*; how
  the game works goes in a tooltip.
- **A small set of short forms**, each explained in a tooltip wherever
  it appears: AOG, CNX (cancelled), OTP (on-time), LF (load factor),
  NPS, `d` for days, `k`/`M` for money in running text.
- **No second-person storytelling** ("you're turning away…",
  "so far it has…"), no hedges ("if nothing else changes"), no colons
  chaining clauses.
- **Ticker lines carry a tag**: AOG, CREW, RIVAL, LESSOR, FUEL, GOAL,
  FLEET.

Keep it learnable: the owner is learning the domain too, so a short
form is only used where its tooltip is one hover away.

### Items

2. **The ops copy pass.** Ticker, alerts, stat cards and the inspector
   views rewritten in the style above.
3. **Explanations to tooltips.** Sentences that explain a mechanic
   (fuel's walk, the Routes view's intro, "Margins are estimated with
   your own economics", "4 of 4 markets follow this", the ladder's
   descriptions) move into (i) tooltips.

   **Status: 2 and 3 done.** Ticker lines carry a tag (kept apart from
   the text, ready for item 8); alerts, cards, every inspector view, the
   ring's hints, the route builder, Head office, and the sim's action and
   refusal messages rewritten. Explanations moved into (i) marks
   (`info()`, `lineWithInfo()`, `heading(text, explanation)`); the
   milestone descriptions sit in an (i) beside each name. Innovations
   gained a one-line `summary`. The executives' flavour text stays, on
   purpose: it is the game's character. The style is now a rule in
   CLAUDE.md. Headless output byte-identical.

1. **An airport hover card**: name, level, departures a day, waiting
   to fly. It replaces the names taken off the map.
   **Done:** `ui/airportTooltip.ts`, shown from main.ts's render() like
   the flight card: name, level and departures (and connections), demand
   and service, passengers turned away, and weather. Off while the
   Competition overlay is on, whose own card covers airports.
7. **Today's bar reads as unfinished.** Ghost or hatch today's bar
   until the day closes, and head each chart with yesterday's figure,
   so every morning doesn't open on "Revenue $0, margin −$14,790".
   **Done:** today's bar is hatched (a CSS mask keeps its colour), each
   header reads yesterday ("$10,787 yday"), and today's running figure is
   in the header's and the bar's tooltips.
5. **The Lessor as a grid**: one row per class with a count, the
   next arrival ("2d"), and a lock icon for a locked class, its unlock
   condition in the tooltip.
   **Done:** a CSS grid (class with its icon, listed, ages, next), a
   locked class a lock and its (i) across the number columns.
4. **Rotations as a timeline**: one row per plane, its day drawn as
   bars across 06:00–22:00, replacing the Window and Uses columns.
   **Done:** flights as labelled blocks inside each rotation's span,
   idle planes as empty rows, a now line, click a span for its route,
   × on hover (two clicks) to remove.
8. **Clickable ticker lines**: each tag coloured, and clicking a line
   opens what it names (carried forward from week eight).
   **Done:** tags coloured by category, lines with a target are buttons
   opening it, the scroll pauses under the pointer.
9. **Milestones as stamps**: a short stamp when one is earned
   ("MILESTONE · FIRST IN"), and the Goals view as a ladder of badges.
   **Done:** `ui/stamp.ts` lands a tilted stamp over the map for each
   milestone met or tier climbed, queued so two at once both show. The
   Goals view's milestones are badges (a bar filling toward each, a met
   one stamped with its day), the ladder a row of rungs.
6. **Tighter stat cards**: one number and one arrow ("▲ $50k"), the
   comparison in the tooltip; Runway in days or "Stable"; the Head
   office card a fuel sparkline.
   **Done:** trends read "▲ +$52k" (the comparison in the tooltip),
   Runway "Stable" or "~12 days", and the Head office card carries the
   last 30 days of fuel as a sparkline, scaled to at least a fifth of the
   average so a wobble doesn't read as a spike.
10. **An ops board strip** under the clock: flown / to go / late /
    cancelled today, the late count a link to the worst route.
    **Done:** `ui/opsBoard.ts`: DEP · AIR · TO GO · LATE · CNX, LATE
    opening the route with the most late landings today, CNX the
    On-time tab.

**Thread 1 status: all ten items done.** Headless output byte-identical
throughout (UI and copy only).

---

## Thread 2: the product (paused)

**Paused by the owner: an idea for now, not scheduled.** If it comes
back: call it "the product", and spread it where each decision is made
rather than one builder screen: the passenger mix shown in the route
and airport views, a cabin layout per aircraft class in the Fleet tab,
fare families (Basic, Standard, Flex) beside Fare policy instead of a
bare bag fee, and cruise speed at Head office beside fuel.

**What the model has today** (checked for the owner): three passenger
segments exist in `sim/choiceModel.ts`, business 20%, leisure 50%, VFR
30%, each weighing fare and frequency differently. But:

- the split is **the same on every market** (NYC–Boston is as
  leisure-heavy as Toronto–Orlando);
- all three **pay the same fare** and sit in the same all-economy cabin
  (25, 75, 150 or 300 seats);
- they differ only in how they react to fare and frequency, and nothing
  shows the split to the player.

So the segments are real in booking share and invisible everywhere
else. Real mixes vary a great deal by route: short trunk routes between
business centres carry a much larger business share than a route to a
sun destination, and routes to diaspora cities are heavy in VFR. A
cabin choice only matters once that varies.

### Slice 1: the passenger mix by market

Each market gets its own business/leisure/VFR split from tags on the
airports (hand-authored, public knowledge: a business centre, a leisure
destination, a large diaspora link). The airport and route views show
the mix. The recommended fare can then skew by mix, as
`sim/schedule.ts`'s comment has long said it should. Headless numbers
move; rebalance to within noise before slice 2.

### Slice 2: cabins

Each plane gets a cabin layout. A class's all-economy count is its
floor space: business takes about 2.5 economy seats, premium economy
about 1.3.

- Business travellers buy business at a multiple of the fare, some
  leisure and VFR trade up to premium economy, the rest fly economy.
- Each cabin fills and caps on its own.
- Changing a plane's layout takes it out of service for some days
  (the thread-12 timing dance).

Rivals fly a sensible layout for their markets, so a premium cabin on a
business route is an edge until a rival matches it.

### Slice 3: bag fees

A fee per passenger (none / checked bag / all bags). It adds revenue and
costs NPS, and leisure and VFR feel it more than business. Designed in
weeks five to seven and never built.

### Slice 4: speed against fuel (the "engine boost")

**Plan note:** engines aren't really upgraded for speed. What airlines
choose is the **cost index**, how fast to fly against how much fuel to
burn. An airline-wide setting, slow/normal/fast: fast shortens block
times (more turns fit in a day, better on-time) and burns more fuel.
Changing it re-times existing rotations, so it applies at the next
rollover and the route planner re-packs. Pairs with the fuel price and
hedging from week ten.

**Philosophy check:** each product choice is an edge rivals can copy
(a cabin) or a trade with a cost (bags cost NPS, speed costs fuel);
none is a permanent free bonus.

---

## Thread 3: the map surface, four corners

The layers were three unlabelled icon dropdowns (a folded map, a globe,
a pin), each with its own selection rule, crammed into the clock bar,
with a legend and a rival picker popping up elsewhere. Rework: each
corner of the map has one job.

- **Top left, Now:** date and time, speeds, the ops board, and the
  alerts under them.
- **Top right, Lens:** one always-visible row of labelled buttons,
  Network · Profit · On-time · Demand · Rivals. One lens at a time, one
  click, keys 1–5. The lens's legend and its own filter (which rival)
  sit directly under it. Folds the Demand/Competition overlays and the
  map modes into one idea; showing Demand and Rivals together is given up.
- **Bottom left, Where:** zoom in, zoom out, back to home, and the
  airport filter (All · Yours · Contested) as a visible three-way switch.
- **Bottom right, Fleet:** the plane pools, as now.

UI only: headless output must stay byte-identical.

**Status: done.** As planned, plus: the corners that move live in
`#map-surface`, a map-sized box, so CSS container queries rearrange
them by the map's width (the side panel eats as much as a small window
does): below 980px the lens drops under the clock bar, below 720px it
moves to the bottom left above the zoom buttons, below 520px both rise
above the fleet bars. The hide-panel button stays in the clock bar
until the inspector is reworked. `MAP_MODES` (the old dropdown's list)
is gone.

---

## Thread 4: the side panel as screens with a rail

Things were buried: the fleet list reachable only from the map's fleet
bars, the rivals list only from a lens chip, four cryptic tab icons
fighting the inspector's breadcrumb, and the Network page half overview,
half fleet screen. Rework, settled with the owner:

- **A rail** down the panel's left edge, top-aligned (it reads as a
  menu and lines up with the breadcrumb), always visible, even with the
  panel hidden, where clicking an item slides the panel open to it:
  Overview · Routes & fares · Airports · Fleet · Crews · Rivals · Money ·
  Goals · Head office, then Game and hide/show at the foot. Replaces the
  tab icons and the stray hide-panel button.
- **Each screen one job:** Overview is the cards, Last 7 days and today;
  Routes & fares gets Fare policy on top and the On-time tab's
  cancellations as a Reliability section (the tab goes); Fleet gets
  every plane, the rotations timeline and the Lessor; **Crews** is new,
  every base's crews by class with hire and retrain; Game is save/load.
- **Status dots** on the rail: where to dig before clicking (a plane
  grounded, a route losing, a milestone met, a new executive or
  innovation available).
- **A jump box** (`/` or ⌘K): type an airport, a tail, a rival, a route
  or a screen and go.
- **Linking:** hovering a row in a list highlights it on the map; back
  and forward beside the breadcrumb; jump chips at the top of long views.

UI only: headless output must stay byte-identical.

**Slice 1 done:** the rail, and the screens rearranged. Sections that
update themselves wait in a hidden `#panel-parts` and are adopted by
the screen that shows them. Along the way: the Routes table's column
headings never re-sorted (a Routes selection compared equal whatever
its sort), now fixed.

**Slice 2 done:** the status dots, worked out twice a second in
`ui/rail.ts`.

**Slice 3 done:** the jump box, also on the rail as Jump.

**Slice 4 done:** hover-linking (`ui/mapLink.ts`, marks drawn by the same
`markRoutesOf()` as the selection), Forward beside Back, and jump chips
on any view with three or more sections. **Thread 4 done.**

---

## Thread 5: the map's own read-outs (asked for by the owner)

- **A P&L strip in the top-left corner**: the last several days as small
  bars, green for a profitable day and red for a loss, today's running
  margin as a number at the end; hovering opens the full Revenue, Cost
  and Margin chart.
- **The route builder's confirm step in the ring**: instead of the
  wordy popover with Add stop / Add Rotation / Cancel buttons, the
  confirm step is the next round of the action ring at the destination,
  with its own icons (confirm, add a stop, cancel) and a compact summary
  card under it. Clicking away cancels, as it does while choosing.

UI only: headless output must stay byte-identical.

**Status: done.** Plus, asked for while building it: the clock bar
shrinks to what it holds (a content-sized grid, with the alerts under it
in one `#now-corner` column), since stretching to the map's width it ran
into the lens; on a map under 880px the lens moves to the bottom left.
Enter confirms a route as the ring's ✓ does.

- **The Demand lens made usable** (asked for after): every city pair's
  arc, the pips and the hunger rings together looked busy and answered
  nothing. Now one circle per airport, sized Tiny to Huge by the people
  waiting, teal where underserved and grey where well served, an amber
  rim where you turn passengers away; lines only for the hovered or
  selected airport's six biggest markets. **Done.**
- **Rivals in the fog hidden** (asked for after): a rival whose every
  route has an end in the fog is left out of the Rivals lens's chips, the
  Rivals screen, the jump box and the ticker's lessor lines, since the
  map doesn't draw those routes either (`rivalsInSight()`, sim/reach.ts).
  **Done.**
- **No more "where to fly next" hints** (asked for after): with the
  Demand lens showing the facts, the game stops choosing for the player.
  Gone: the airport view's list, the suggested new spokes on a hovered
  hub, and the hub planner's new-spoke moves. The headless player ranks
  markets itself by potential demand, what a player reads off the lens.
  **Done**, headless byte-identical.

---

## Thread 6: contracts (the balance lever)

Asked for by the owner as the balance tool for weak homes (Halifax busts
5 of 6): route incentives for underserved airports, like the US
Essential Air Service or a province's route-development fund, sized by
the play-through and by how weak the starting city is.

- **Offers.** A contract is for one market: fly it at least once a day
  each way, and the government pays so much a day for a term (90–150
  days) and sends riders who wouldn't otherwise fly (civil servants,
  medical travel). Offered at the start and every 45 days, for markets
  from your network to an underserved airport in reach, by seed. Unclaimed
  for 30 days, an offer lapses. It starts the day you first fly the
  market.
- **Size by weakness.** A home's strength is its best markets within a
  Propeller's reach, from the data (not the headless-rated difficulty,
  which would feed back on itself); weaker than the median home, the
  offers are bigger and more of them. Each also varies by seed.
- **Strict terms.** Contract riders and the daily payment both scale by
  the route's performance against higher bars than ordinary passengers:
  full at 85% on-time, 97% completion and NPS +15, nothing at 65%, 85%
  and −5. Taxpayers' money buys reliability.
- **The snap-back.** When the term ends, the riders and the payment stop
  and the market's built-up demand drops by 40%: a subsidised route is
  weaker than it looked. Taking one is a bet on building something that
  survives it.
- **Where it shows:** the ticker (CONTRACT), Head office's contracts list,
  the route and airport views, and the Office dot.
- **The headless player** takes contracts: an offered or running
  contract market scores its riders on top of its demand.

Measured with `npm run balance` before and after, and `npm run homes`
re-run. The sim changes, so headless output moves.

**Status: built.** As planned, with what measuring taught:

- **Half the pay is guaranteed.** Fully performance-paid, a starting
  fleet of old planes on a packed day (about 20% on-time) earned
  nothing and Halifax went under as if there were no contracts; now half
  is guaranteed for flying it both ways, half earned. The riders stay
  fully strict. Bars loosened to reachable: full at 80% on-time, 95%
  completion, NPS +10; nothing at 45%, 80%, −10; judged over 14 days.
- **Renewal.** A term averaging 50% performance renews at 75% size, up
  to three times, before the snap-back: one term was too short to build
  anything that survives it.
- **Small communities only** (under 800,000): at the start every
  airport is "starved", New York included.
- **Their own random stream**, so a game that takes no contract plays
  exactly as before (Montréal seed 1 is still $18,908,006).
- **The headless player** takes offers worth $3,000 a day or more (a
  small one at a strong home cost Montréal its opening), keeps the
  route's last round trip for the term, and pads its plane's turns when
  it pays under half.

Measured (`npm run balance`), steady medians before → after: YUL $17.2M
→ $17.2M, YYZ $38.5M → $36.6M, BOS $14.0M → $14.0M, PHL $56.9M →
$56.9M, LHR $68.3M → $71.0M; Halifax busts 5/6 → 4/6 (mean $1.3M, best
$5.3M). Halifax sitter 4/6 → 2/6 busts (median $3.6M), bold 6/6 → 4/6
(best $12.2M). Homes re-rated: 70 Standard, 26 Hard, 73 Brutal (12
changed; the rating plays the unattended player, which takes none).

**Renamed to just "contracts"** (asked for after), and a new offer's
ticker line stands out: first in the ticker, bright, its tag pulsing,
until clicked (opening Head office) or 90 seconds pass.

**Still open:** the steady player over-expands at a thin home, leasing
to eight planes on Halifax's markets with contract cash and bleeding
$30k a day; its growth rule was tuned on big homes.

---

## Thread 7: the Crews screen as a crew planning board (asked for by the owner)

The Crews screen said what each base has today, and nothing about what's
coming: a plane on its way needs crews that take a week to hire, and the
player had to work out the timing. Rework it as a crew planner's board:

- **A 30-day horizon** across the top: each inbound plane's entry into
  service (EIS), each batch of crews joining, each plane going back.
- **Each inbound plane a line**: its EIS day, the crews it needs, what's
  joining by then, and if short, the last day a hire still arrives in
  time ("hire by day 29"), or how late one would be, with conversion
  offered where it's sooner or there are reserve crews.
- **Each class a roster bar** per base: crews on hand, joining (hatched),
  the minimum and comfortable marks, and a status chip (SHORT, TIGHT, OK,
  RESERVE +N). Airline words: type rating, conversion, reserve.
- **Planes going back** show the crews they'll free.
- **The Crews dot** lights amber when an inbound plane will arrive short.

A read-out in the sim (`crewPlan()`, sim/crewPlan.ts) with no rule
change, so headless output stays byte-identical.

**Status: done.** Plus a SHORT AT EIS chip, which beats today's roster
when a plane on its way would arrive short, and an amber mark on the bar
for the need at EIS. The per-plane allowance is now one constant,
`CREWS_PER_NEW_PLANE`, shared by the lease's crew advice and the planner.

---

## Carried forward

- **Balance:** past the start, a careful player's year runs $14M–$69M
  and doesn't bust; Halifax busts 5 of 6. Revisit after thread 2, since
  cabins and bags move revenue.
- **A lessor listing when a class unlocks** (so an earned class isn't
  met with an empty shelf).
- From week eight: the hub planner inside the airport view, a cost
  breakdown under Last 7 days.
- The owner's week-twelve candidates: seasons, rival personalities
  that can fail, airport deals, missed connections.

## Open questions for the owner

- **Cabins per plane or per fleet?** Per plane is more realistic and
  more fiddly; per class is one decision each.
- **How hard should bag fees bite NPS?**
- **Is the cost index a setting, or also an innovation** (a
  performance programme that makes "fast" cheaper)?

## Playtest notes

*(The owner adds findings from play here.)*
