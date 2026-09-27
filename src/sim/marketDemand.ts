import { MARKET_PAIR_TABLE, potentialDailyDemand } from './demand';
import { marketKey } from './schedule';
import { reliabilityDemandFactor, trailingMarketOtp } from './routeOtp';
import { dailySeatsByMarket, hungerBoost, hungerByAirport } from './serviceLevel';
import { executiveMarketBuildingMultiplier } from './executives';
import { recessionFactor } from './shocks';
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


/** Potential demand including however much global growth has accumulated so far. */
export function currentPotentialDemand(state: SimState, origin: string, dest: string): number {
  return potentialDailyDemand(origin, dest) * potentialMultiplier(state);
}

/**
 * What every market's gravity-model potential is multiplied by today:
 * demand growth so far, and a recession's fall while one runs
 * (sim/shocks.ts).
 */
export function potentialMultiplier(state: SimState): number {
  return state.demandGrowthMultiplier * recessionFactor(state);
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
  const seatsByMarket = dailySeatsByMarket(state);
  // Worked out once, before any market moves, so every market is judged
  // on the same morning's service.
  const hunger = hungerByAirport(state, seatsByMarket);
  const multiplier = potentialMultiplier(state);
  const marketBuilding = executiveMarketBuildingMultiplier(state);

  for (const { origin, dest, key, basePotential } of MARKET_PAIR_TABLE) {
    // currentPotentialDemand(), from the pair's precomputed potential.
    const potential = basePotential * multiplier;
    const floor = Math.min(VIRGIN_MARKET_PDEW, potential);
    const current = state.marketDemand[key] ?? floor;

    const seatsOffered = seatsByMarket.get(key) ?? 0;

    // How reliably the player has flown this market lately (sim/routeOtp.ts):
    // above the neutral line it speeds growth up, below it slows growth,
    // and far enough below it reverses it. Neutral on a market the player
    // doesn't fly or has barely flown yet. Only needed where seats are
    // offered (the branches below), so only worked out there.
    const reliability = seatsOffered > 0 ? reliabilityDemandFactor(trailingMarketOtp(state, origin, dest).otp) : 0;

    let next: number;
    if (seatsOffered > 0 && reliability >= 0) {
      const rate =
        STIMULATION_RATE *
        serviceSaturation(seatsOffered, potential) *
        reliability *
        // A route to places nobody serves builds faster (sim/serviceLevel.ts).
        hungerBoost(hunger, origin, dest) *
        // A market-building CCO speeds every market up (sim/executives.ts).
        marketBuilding;
      next = current + (potential - current) * rate;
    } else if (seatsOffered > 0) {
      // Unreliable enough to lose passengers: the same slide toward the
      // floor an abandoned market gets, at up to the same speed.
      next = current + (floor - current) * DECAY_RATE * -reliability;
    } else {
      next = current + (floor - current) * DECAY_RATE;
    }

    // Never above potential, never below the floor — the growth and decay
    // terms above already approach both asymptotically, but clamping
    // keeps a future rate change from being able to overshoot either.
    // A market sitting exactly at its floor isn't stored: actualDailyDemand()
    // reads a missing key as the floor, so the save holds only markets
    // someone has moved, not one entry for every pair on the map.
    const clamped = Math.min(potential, Math.max(floor, next));
    if (clamped === floor) delete state.marketDemand[key];
    else state.marketDemand[key] = clamped;
  }
}
