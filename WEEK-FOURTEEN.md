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

*(Updated as slice 1 is built.)*

## Playtest notes

*(The owner, and then the alpha players, add findings here.)*
