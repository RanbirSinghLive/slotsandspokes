import aircraftTypesData from '../../data/aircraft-types.json';
import { potentialDailyDemand, ALL_MARKET_PAIRS } from './demand';
import { marketKey } from './schedule';
import type { SimState } from './state';

/**
 * Week six's market stimulation model. Before this, every market carried
 * its full gravity-model demand from the moment the game started, whether
 * anyone flew it or not — so the map opened as a field of large,
 * uncontested, instantly-profitable markets, and route choice collapsed
 * into "pick the biggest number." The balance sweep (src/headless/sweep.ts)
 * found the symptom: the trunk markets were seat-capped even at 5x the
 * recommended fare, so raising price cost literally no passengers and
 * there was no optimum to find.
 *
 * The fix separates two different quantities that used to be one:
 *
 *   - **Potential** (`potentialDailyDemand()`, sim/demand.ts) — how big
 *     this city pair could get if fully served. Static geography and
 *     population, plus slow annual growth.
 *   - **Actual** (this file, stored on `SimState.marketDemand`) — how
 *     many people actually fly it today. Starts near zero on a market
 *     nobody serves, grows toward potential as airlines actually fly it,
 *     and decays back toward the floor when service stops.
 *
 * Every airline in this world starts from scratch — there are no legacy
 * incumbents sitting on mature trunk routes — so *every* market opens
 * unstimulated, and the strategic question becomes which potential is
 * worth the investment of building rather than which market is already
 * biggest.
 *
 * Note that actual demand is a property of the **market**, not of any one
 * airline: everyone flying a market contributes to growing it, and
 * everyone serving it draws from the same pool. That makes stimulation a
 * public good — open a big market early and you pay to build demand a
 * rival can later enter and share. It also means nothing here assumes a
 * single player, which keeps the model usable if competitors are ever
 * real airlines rather than AI.
 */

/**
 * What a market nobody has ever served carries. An absolute floor, not a
 * fraction of potential — deliberately. A percentage would leave the big
 * markets still far above any regional aircraft's seat count (10% of a
 * 4,600-PDEW trunk route is still hundreds of passengers per flight, so
 * still seat-capped, so still no pricing tension) while simultaneously
 * rounding the thinnest markets down to about one passenger a day. A flat
 * floor puts every market inside the same playable band at game start,
 * which is what makes a 19-seat aircraft the right tool for all of them
 * early on.
 *
 * Clamped against potential wherever it's used — a market whose potential
 * is below this floor never exceeds its own potential.
 */
export const VIRGIN_MARKET_PDEW = 10;

/**
 * How fast actual demand closes the gap to potential per day, at full
 * saturation (i.e. when seats offered match potential demand outright).
 * Real routes mature over one to three years; this is compressed hard,
 * since a simulated day is about three minutes of play and a route that
 * took a real year to build would never be seen to finish.
 *
 * The *effective* rate is this scaled by how much of the latent market is
 * actually being served (see `serviceSaturation()`), which is the whole
 * mechanism that stops a lone 19-seater from developing a Montreal-
 * Toronto-sized market: one daily flight against thousands of potential
 * passengers is a rounding error of service, so it produces a rounding
 * error of growth.
 */
const STIMULATION_RATE = 0.05;

/**
 * How fast an unserved market slides back toward `VIRGIN_MARKET_PDEW`.
 * Deliberately slower than growth: stimulation should be an investment
 * you can lose by walking away, not one that evaporates the moment a
 * schedule gap appears. Decay targets the floor rather than zero — a
 * market that was once served doesn't lose the fact that the city pair
 * exists.
 */
const DECAY_RATE = 0.015;

/**
 * Latent demand keeps growing — the "potential is not a fixed cap" half of
 * the design, and one of the three sources of time pressure (see
 * sim/pressure.ts). 0.3% a day, applied as a single global multiplier on
 * top of the gravity model rather than per market, since nothing here
 * varies growth by geography yet. That is about 1.4x after 4 months and 3x
 * after a year: it used to be 2% a year, too small to notice, so the
 * market a plane filled last month is now short of seats this month.
 */
const DAILY_DEMAND_GROWTH = 0.003;

/**
 * Seats a competitor frequency is assumed to carry. Competitors have no
 * fleet in this model — `CompetitorOffering` (sim/competitors.ts) carries
 * a frequency and a fare but no aircraft type — so their contribution to
 * stimulating a market needs a stand-in gauge. A small-regional number,
 * between the propeller and regional classes the player can buy, on the reasoning that
 * competitors here are peer startups flying comparable equipment rather
 * than mainline carriers.
 */
const COMPETITOR_ASSUMED_SEATS = 50;

const seatsByTypeCode = new Map<string, number>(
  (aircraftTypesData as { code: string; seats: number }[]).map((type) => [type.code, type.seats]),
);

/** Potential demand including however much global growth has accumulated so far. */
export function currentPotentialDemand(state: SimState, origin: string, dest: string): number {
  return potentialDailyDemand(origin, dest) * state.demandGrowthMultiplier;
}

/**
 * How many people actually fly this market on an average day right now.
 * Falls back to the virgin floor (clamped to potential) for a market that
 * has no entry yet — which is every market until the first day-rollover
 * populates them, and keeps this safe to call at any point in a tick.
 */
export function actualDailyDemand(state: SimState, origin: string, dest: string): number {
  const stored = state.marketDemand[marketKey(origin, dest)];
  if (stored !== undefined) return stored;
  return Math.min(VIRGIN_MARKET_PDEW, currentPotentialDemand(state, origin, dest));
}

/**
 * Total daily seats every airline puts into a market — the player's
 * scheduled legs at their real aircraft's gauge, plus each competitor's
 * frequency at an assumed one. This is what drives stimulation: seats,
 * not frequencies, because "is this market genuinely served" is a
 * question about capacity offered, and one daily 19-seater means
 * something very different on a 9-PDEW market than on a 4,600-PDEW one.
 */
function dailySeatsOffered(state: SimState, origin: string, dest: string): number {
  const key = marketKey(origin, dest);

  let seats = 0;
  for (const leg of state.schedule) {
    if (marketKey(leg.origin, leg.dest) !== key) continue;
    const aircraft = state.aircraft.find((a) => a.tail === leg.tail);
    if (!aircraft) continue; // a scheduled leg with no aircraft to fly it offers nothing
    seats += seatsByTypeCode.get(aircraft.typeCode) ?? 0;
  }

  for (const competitor of state.competitorRoutes) {
    if (marketKey(competitor.origin, competitor.dest) !== key) continue;
    seats += competitor.dailyFrequency * COMPETITOR_ASSUMED_SEATS;
  }

  return seats;
}

/**
 * Dollars of daily marketing that count for as much market presence as
 * one seat of daily capacity, for stimulation purposes.
 *
 * This is what makes marketing worth spending at all. Measured before
 * this existed, marketing's only effect was a small booking-share bonus
 * (sim/choiceModel.ts), and the return on it was **0.00x on nearly every
 * market** — best case 0.50x. It failed in a pincer: on a big market the
 * extra share was worthless because the flights were already seat-capped,
 * and on a small market the share gain was real but absolutely tiny (a
 * passenger or two) against a cost quoted in flat dollars. There was no
 * market size at which a flat daily fee bought enough share to pay for
 * itself, which is a structural problem, not a constant that needed
 * nudging.
 *
 * Routing it through stimulation instead fixes the shape rather than the
 * number. Because saturation divides by potential, the *same* dollar buys
 * proportionally less presence in a bigger market — so cost scales with
 * market size automatically, without a second size-dependent term. And
 * because it grows the market rather than just re-slicing it, the payoff
 * is a permanently larger market rather than a few percent of share on
 * flights that may already be full.
 *
 * Marketing still doesn't let you *carry* anyone, so over-spending on a
 * market you haven't put capacity into stays a mistake — which is the
 * right lesson, and one the Dev tab's funnel now shows directly.
 */
const MARKETING_RATE_BOOST = 1;
const MARKETING_SCALE = 200;

/**
 * How much faster marketing spend makes a market mature — a multiplier on
 * the stimulation rate, not an addition to capacity. 1 means no spend and
 * no effect; $200/day doubles the rate, $800/day roughly triples it,
 * `log2` giving the same diminishing returns the booking-share bonus
 * already uses.
 *
 * A multiplier rather than an additive "marketing buys virtual seats"
 * term because that additive version was tried first and measured
 * net-negative everywhere: a small market is already at full saturation
 * from its own aircraft so extra presence bought nothing, and a trunk
 * market is so large that any plausible daily spend is a rounding error
 * against it. The useful band was too narrow to matter. A rate multiplier
 * applies wherever a market is still *growing*, which is the whole
 * period the spend is supposed to be shortening.
 */
function marketingRateMultiplier(marketingSpend: number): number {
  return 1 + MARKETING_RATE_BOOST * Math.log2(1 + marketingSpend / MARKETING_SCALE);
}

/**
 * What fraction of the latent market is actually being served, capped at
 * 1. This is the term that makes market size matter: 19 seats against 9
 * potential passengers saturates the market outright (1.0), while the
 * same 19 seats against 4,668 is 0.4% — so the same single aircraft
 * matures a thin market in weeks and barely moves a trunk route at all.
 */
function serviceSaturation(seatsOffered: number, potential: number): number {
  if (potential <= 0) return 0;
  return Math.min(1, seatsOffered / potential);
}

/**
 * Advance every market's actual demand by one day — called once per
 * simulated day from step.ts's day-rollover, the same cadence as weather,
 * competitor openings and the fuel price roll. Fully deterministic: no
 * random draws at all, unlike its neighbors in that block. Whether a
 * market grows or decays is entirely a function of who is flying it.
 *
 * Walks every pair rather than only those currently served, because an
 * abandoned market still needs its decay applied — "nobody flies this any
 * more" is exactly the case that has to keep being processed.
 */
export function rollDailyMarketDemand(state: SimState): void {
  state.demandGrowthMultiplier *= 1 + DAILY_DEMAND_GROWTH;

  for (const [origin, dest] of ALL_MARKET_PAIRS) {
    const key = marketKey(origin, dest);
    const potential = currentPotentialDemand(state, origin, dest);
    const floor = Math.min(VIRGIN_MARKET_PDEW, potential);
    const current = state.marketDemand[key] ?? floor;

    const seatsOffered = dailySeatsOffered(state, origin, dest);
    // Marketing only counts where you actually fly — awareness of a
    // service that doesn't exist sells nothing, and the branch below
    // keeps that true without a separate check. (`routeSettings` only
    // exists for markets a route was drawn on anyway.)
    const marketingSpend = state.routeSettings[key]?.marketingSpend ?? 0;

    let next: number;
    if (seatsOffered > 0) {
      const rate =
        STIMULATION_RATE * serviceSaturation(seatsOffered, potential) * marketingRateMultiplier(marketingSpend);
      next = current + (potential - current) * rate;
    } else {
      next = current + (floor - current) * DECAY_RATE;
    }

    // Never above potential, never below the floor — the growth and decay
    // terms above already approach both asymptotically, but clamping
    // keeps a future rate change from being able to overshoot either.
    state.marketDemand[key] = Math.min(potential, Math.max(floor, next));
  }
}
