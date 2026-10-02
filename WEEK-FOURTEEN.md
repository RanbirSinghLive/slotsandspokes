# airgame — Week fourteen (every seat a decision)

Handoff document. Week thirteen (the timed schedule: hourly slots, time
of day, the Gantt, timed connections, the year one report, Head office
as chairs and a tech tree) lives in `WEEK-THIRTEEN.md`. The last state
before this week is tagged `pre-week-fourteen`.

**State at handoff:** save key `slotsandspokes-save`, save format 2.
Fares are one network multiplier on the going rate, a per-route slider
and three stances against rivals; every passenger on a flight pays the
same fare. Demand is a gravity ceiling grown by seats flown, chosen
between by three segments (business 20%, leisure 50%, VFR 30%, the same
on every market). Supply is four generic aircraft types, all leased,
one cabin each, with random breakdowns as the only maintenance.

---

## The idea, in one paragraph

Demand and supply meet in one question: who sits in each seat, and what
did they pay? Today every seat on every flight is the same seat sold at
the same price to the same mix of people, so pricing is a grey slider.
This week makes markets different (a business trunk is not a sun
route), gives planes a product (cabins), and makes selling the seats a
puzzle (revenue management: fare classes, booking curves, protecting
business seats), with the operation and the year given more shape
around it. Every stage keeps the game's rule: an edge is found, used and
arbitraged away.

## The review behind it

**Demand, thin where:** one traveller mix on every market; fares never
grow a market (only seats do); no seasons; connecting passengers pay the
full local fare on both legs, which overstates hub revenue; no booking
timing, so nothing to protect seats against.

**Supply, thin where:** a Widebody is cheaper per seat than a Narrowbody
in every way (lease $200 against $307 a seat-day, $54 against $59 a
seat-hour), so long-haul has no catch (one steady YUL year made $20.5M
of $30M on LHR–YUL); no product (one economy cabin); maintenance is pure
luck; planes always sleep at base, so no morning wave from the spokes;
lease only; rivals never fail.

---

## Stages

| Stage | Demand | Supply | What it feels like |
|---|---|---|---|
| **1. Know your market** (slice 1) | Market character; fair connecting fares | Type economics | Routes feel different; the revenue hill |
| **2. Revenue management** | Booking curves; fare classes (Saver, Flex, Business) | Cabins and refits | Protecting business seats, sell-outs, buy-ups |
| **3. Brand and pricing moments** | Low fares grow markets; brand position | | Brand cards, seat sales, fare wars as events |
| **4. Running the operation** | | Maintenance checks on the Gantt; night stops | A Gantt worth planning; morning banks from the spokes |
| **5. Rhythm** | Seasons; demand events | Seasonal capacity | A year with shape |
| **Later** | Overbooking | Buy or lease; type variants; rivals that can fail | |

## Slice 1: Know your market

1. **Market character** (`data/airport-character.json`, hand-authored
   from public knowledge of what each city is: a business centre, a
   leisure destination, a VFR-heavy community). Each city pair's mix of
   business, leisure and VFR comes from its two ends, and feeds the
   choice model and time-of-day demand in place of the one mix. The
   network's average mix stays near today's, so balance moves only by
   where the mix lands. The route view shows the mix as a bar and a word
   ("business trunk", "sun route", "VFR route", "mixed").
2. **Fair connecting fares.** A connecting passenger pays a share of each
   leg's fare (a through fare is far less than two local fares), so a
   hub's connections stop being worth two local passengers each. The
   size costs added in week thirteen are re-checked against it.
3. **Type economics.** The Widebody's cost per seat stops undercutting the
   Narrowbody's, so a long, thin route has a real risk.
4. **The revenue hill** on each route, in place of the grey slider: money
   a day across the fare range from the game's own forecast
   (`summarizeMarket()`), the fare as a ball to drag, rivals' fares as
   flags, the peak marked.
5. **A balance pass**, 18 seeds a home (6 proved too noisy in week
   thirteen).

## Stage 2: revenue management (owner: go, 2026-10-01)

**Settled with the owner:**

- **The hill is learned, not given.** Today it draws the game's exact
  forecast, so the best fare is known before a day is flown, against
  the game's rule that markets are learned by flying. It becomes what
  the airline has measured: dots at the fares actually flown (the margin
  really made), and between them an estimate band, wide where untried,
  narrowing with days flown nearby, widening again when the market
  shifts (a rival in or out, demand moving, a shock). The top is a best
  guess with a range. A revenue-management CCO narrows the band.
- **A network hill replaces the grey slider:** the same picture for the
  airline, summed over every route on the network policy, the network
  fare level the ball. Pricing a route by hand can beat it, and the
  network hill says by how much ("+$4.2k/day from 6 routes by hand").
  Stage 3's brand position becomes where that ball sits.

**Build order:**

1. **Fare classes in the sim:** a route's base fare sells as Saver
   (75%), Flex (100%) and Full (140%), with seat limits on Saver and
   Flex. Passengers book in order, leisure first, then VFR, then
   business, each buying the cheapest class still open if willing at
   its price; past a sold-out class some buy up and the rest spill or
   don't fly. Business arriving to an open Saver pays Saver (dilution).
   Worked out per flight in one pass (`sim/fareClasses.ts`), no booking
   simulation.
2. **The seat-map bar** in the route view: drag the Saver and Flex
   limits; under it, yesterday ("Saver sold out on 4 of 6 · 31 bought
   up · 12 business turned away · 9 business paid Saver").
3. **The headless player's default** and a balance pass (18 seeds).
4. **The learned hill.**
5. **The network hill**, the grey slider gone.
6. **Cabins:** a business cabin fitted to a plane, a few days out of
   service to refit.
7. **Connecting passengers book the cheaper classes**, which is where
   the through-fare correction parked in slice 1 belongs.

**Stage 2 status:** steps 1–3 built. Fare classes in the sim
(`sim/fareClasses.ts`, through `flightResult()`), the seat-map bar and
yesterday's line in the route view, the headless player tuning Saver
weekly. Balance (18 seeds, steady, default 20/60/20): YUL $12.2M (1/18
busts), YYZ $42.1M (1/18), PHL $53.5M, YHZ 13/18; against week
thirteen's end YUL $10.8M, YYZ $40.6M, PHL $66.7M, YHZ 13/18. A finding:
even 18 seeds swing a median by half on near-identical rules (every-seat
Flex, meant to equal slice 1, read YYZ $30.9M against $20.2M), so
balance reads are rough.

**Step 4 built:** the learned hill (dots of days flown, a band that
narrows near them and goes stale after 14 days, the estimate wrong
where untried, the top as a range; the revenue-management CCO halves
the band). On a steady YUL game at day 60 the tops read LGA–YUL
$397–450, YUL–YYZ $444–470, YOW–YUL $209–341.

**Step 5 built:** the network hill (`networkHill()` in
`sim/revenueHill.ts`, drawn by `ui/farePolicy.ts`) in place of the grey
slider. It shows every policy route's learned margin added up at each
level from 50% to 250% of the going rate. The bands combine as
independent errors, and a level is shaded where half the policy routes
would draw rivals in. The level is a ball to drag. The line below gives
the routes on policy, the likely top, and what the routes priced by hand
make against the policy fare. Both hills share one chart
(`ui/hillChart.ts`).

**Step 6 built:** cabins (`sim/cabins.ts`). A Regional, Narrowbody or
Widebody can have a business cabin: 8% of its seats, each taking 2.5
economy seats. Only business travellers buy it, at 2.2× the fare, and
they value it at 1.8×. A refit costs 10 lease-days and takes the plane
out for 3–6 days as a planned AOG. The plane's view shows a forecast for
the refit, and the headless player refits one plane at a time when it
pays back within 45 days. Probed on headless games, a cabin makes
+$2–14k a day on planes with room and loses $2–12k on full ones.
Balance (18 seeds, steady), with cabins against without:

| Home | With cabins | Without |
|---|---|---|
| YUL | $10.6M, 3/18 busts | $12.0M, 4/18 |
| YYZ | $29.9M, 0/18 | $26.4M, 2/18 |
| PHL | $46.9M, 0/18 | $70.2M, 1/18 |
| YHZ | 9/18 busts | 12/18 |

About two cabins fitted per airline on the big homes: no runaway edge,
inside the noise.

**Step 7 built:** connecting passengers book the cheapest open class
(Saver, then Flex, then Full) at its price, in place of the full base
fare (`CONNECTING_FARE_SHARE` is gone). This is the through-fare
correction parked in slice 1. Balance (18 seeds, steady), against step 6:

| Home | Step 7 | Step 6 |
|---|---|---|
| YUL | $15.5M, 1/18 busts | $10.6M, 3/18 |
| YYZ | $35.5M, 0/18 | $29.9M, 0/18 |
| PHL | $67.6M, 0/18 | $46.9M, 0/18 |
| YHZ | 16/18 busts | 9/18 |

No bust wave, unlike the flat 60% cut. Connections no longer take Flex
seats ahead of local passengers, and the headless player's weekly Saver
tuning now meets them too. Halifax has read 9–16 busts this week and
stays the open problem.

**Stage 2 is complete.**

**After stage 2, from the owner's playtest (a Chicago game bust on day
51):**

- **The route view:** shorter lines with the detail in the (i) marks; a
  key under each chart; one "Put all routes back on policy" button.
- **The planner** staggers a new plane's first rotation between the
  route's other flights. Staggering every rotation cost Montréal half
  its year on 18 seeds ($7.4M against $15.5M); the first rotation
  alone, $13.0M.
- **Crowding:** your own flights within an hour of each other, the same
  way, split one hour's passengers (`crowdingWeight()`), so spreading a
  route pays. It hasn't had a balance read.
- **A resumed game starts paused.**

## Stage 3: brand and pricing moments (owner: go, 2026-10-02)

Today a fare only splits a market; it never grows one. Your name only
moves NPS. Fare wars happen every day, a quarter of the gap at a time,
and nobody sees them. Stage 3 makes price a strategy with consequences
you can watch.

**Build order:**

1. **Low fares grow markets.** A market's growth and its ceiling follow
   the fares flown on it, seat-weighted across you and your rivals,
   against the going rate. Cheap fares build it faster and bigger (up
   to 1.3× its potential); dear ones slow it and shrink it (to 0.8×).
   Market demand belongs to everyone who flies it, so a market built
   cheaply is one a rival can enter and share.
2. **Brand position.** Where the network hill's ball sits, averaged
   over about 60 days: Low-cost (under 90% of the going rate), Mainline,
   or Premium (over 115%). Low-cost wins leisure and VFR travellers and
   loses business ones; Premium the reverse. It's slow to build and slow
   to move, so it's a moat, and a brand card shows it.
3. **Seat sales.** A route action: for 7 days Saver sells at half the
   fare and has at least 40% of the seats, and the market grows twice
   as fast. A route can run one every 30 days. Rivals may answer it.
4. **Fare wars as events.** When you and a rival keep cutting below
   each other, a war starts. It shows in the ticker and as a banner on
   the route, with the days so far and each side's money a day. It ends
   when fares settle or one side leaves.

**Defaults chosen, for the owner to change:** brand from the ball, not
picked; seat sales per route, not network-wide; booking curves stay
carried (booking order stands in).

**Step 1 built:** `sim/fareStimulus.ts`, in market growth
(`sim/marketDemand.ts`), with the route view saying when fares are
growing a market or holding it back. The one-seed headless year went
from $1.34M to $1.87M; no balance read yet.

**Step 2 built:** `sim/brand.ts`, rolled daily. The position's pull is
added to the name's edge in booking (`BookingPerks.positionEdge`). The
Fare policy panel shows it. An old save starts at Mainline, 100%.

**Step 3 built:** `sim/seatSale.ts` for the route action, the sale's seat
split in flights and forecasts, doubled growth, and rivals reading it
as a cut. The route view shows a sale's button with its forecast, and
the headless player runs a sale on an empty route when the forecast
doesn't lose money. On the one-seed headless year a single sale on day
37 moved the game onto a different path ($1.86M without, $0.44M with),
with the losses later from YUL–YYZ cancellations. One seed can't judge
it; a balance read can.

**Step 4 built:** `sim/fareWars.ts`, with ticker lines and a route
banner. Checked on a copy of the owner's Chicago save: at 70% of the
going rate on ORD–MSP, the five rivals cut from $440 toward $263 in six
days, and a war started with MD.

**Stage 3 is complete.** It hasn't had a balance read.

## Decisions for the owner

1. The airport tags: a first pass covers every airport in the data; the
   owner corrects any that read wrong.
2. Whether the week-thirteen size costs stay once connecting fares are
   fair (decided from the balance pass).

## Carried from week thirteen

- Before alpha: the browser pass; the performance check at 100×.
- Balance: thin homes (YHZ busts about two-thirds of years); the steady
  player over-expands there.
- Mobile as good as desktop; colour-blind red/green; changelog; `?`
  shortcuts card; the other well-known rival codes (AR, BR, MS, HX, NW,
  RX); a rebasing plane drawn at its old base; innovation prerequisites
  between innovations.

## Status

**Slice 1 built** (commit 953d870 and after):

- **Market character:** `data/airport-character.json` (every notable
  airport scored 0–2 business, leisure, VFR) and
  `sim/marketCharacter.ts` (business needs both ends, leisure one sunny
  end, VFR a community at either end). The network's mix, weighted by
  potential demand, is 21/50/29 against the 20/50/30 it replaced.
  Toronto–Chicago is a business trunk, Toronto–Orlando a sun route,
  Toronto–St. John's friends and family. In the choice model and
  time-of-day demand; shown as a word and a bar in the route view.
- **Widebody:** rate card $60k to $100k a day ($333 a seat against the
  Narrowbody's $307): long-haul is a bet on 300 seats, not a sure thing.
- **The revenue hill:** `sim/revenueHill.ts` (25 fares through the game's
  forecast, smoothed) drawn in the route view in place of the slider:
  the top marked, the going rate, rivals' flags, the amber stretch where
  rivals answer, the fare a ball to drag.
- **Through fares: tried and parked.** On 18 seeds a home, connecting
  passengers paying 60% of each leg's fare sent the steady player bust
  in 13–15 years of 18; 85% in 5–6; the full fare 1–2. The economy is
  balanced on connections paying twice; the correction belongs in
  stage 2, when a connecting passenger can take a cheaper fare class.
- **Balance (18 seeds, steady, connections at full fare):** YUL $11.7M
  (2/18 busts), YYZ $20.2M (1/18), PHL $58.6M, YHZ 14/18 busts; week
  thirteen ended YUL $10.8M, YYZ $40.6M, PHL $66.7M, YHZ 13/18. Toronto
  halves: it's the home best placed for long-haul, which no longer pays
  by itself. The week-thirteen size costs stay (removing them didn't
  rescue the through-fare runs and isn't needed without them).

## Playtest notes

*(The owner, and then the alpha players, add findings here.)*
