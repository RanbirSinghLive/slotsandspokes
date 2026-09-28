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
