import { nextRandom } from './rng';
import type { SimState } from './state';

/**
 * Week six's fuel price mechanic. Modeled as a unitless index rather than
 * a $/gallon or $/litre figure — 1.0 is "today's baseline price," a day
 * where fuel costs twice baseline shows 2.0, and so on. An index avoids
 * needing a burn-rate (gallons per block hour) figure for every aircraft
 * type on top of the cost data data/aircraft-types.json already has:
 * instead this multiplies straight into the fuel-sensitive slice of the
 * existing costPerBlockHour figure (see FUEL_SHARE_OF_BLOCK_HOUR_COST and
 * sim/economy.ts's legCost()).
 */
export const FUEL_PRICE_BASELINE = 1;
export const FUEL_PRICE_MIN = 0.5;
export const FUEL_PRICE_MAX = 2;

// A uniform random step of up to +/-1.5% a day, pulled back toward
// baseline by 2% of however far the index has already drifted — a real
// random walk, not a straight trend, but one that can't wander off to an
// extreme and just stay there forever. That's deliberate: real jet fuel
// prices are famously hard to call day to day but do eventually revert
// toward a normal range, which is exactly the "hard but not impossible to
// guess direction" behavior the brainstormed fuel-price mechanic (see
// WEEK-SIX.md) asked for — a player watching the history chart has a
// real, if noisy, signal to read, not pure noise.
const FUEL_PRICE_DAILY_STEP = 0.015;
const FUEL_PRICE_REVERSION_STRENGTH = 0.02;

/**
 * How much of costPerBlockHour is treated as fuel-sensitive versus fixed
 * (crew, maintenance, overhead already blended into that one number) — a
 * flat fraction applied to every aircraft type alike, same "one crude
 * constant, not per-type tuning" spirit as sim/economy.ts's own
 * LOAD_FACTOR and RECAPTURE_RATE. Regional/narrowbody direct-operating-
 * cost studies commonly put fuel somewhere in the 25%-40% range; 35% is
 * the deliberately unresearched middle of that band, not fit to any one
 * type's real numbers.
 */
export const FUEL_SHARE_OF_BLOCK_HOUR_COST = 0.35;


/**
 * Recent daily closing fuel price index values, oldest first — same
 * rolling-window shape as sim/forecast.ts's CASH_HISTORY_MAX_DAYS, just a
 * longer window (60 days instead of 30): guessing which way a mean-
 * reverting series is heading benefits from seeing more of its recent
 * cycle, and an array of plain numbers costs nothing meaningful to keep
 * around for twice as long.
 */
export const FUEL_PRICE_HISTORY_MAX_DAYS = 60;

/**
 * Advance the fuel market by one day: record today's closing index into
 * history, then roll tomorrow's. Called once per simulated day from
 * step.ts's day-rollover, same daily cadence as rollDailyWeather() — fuel
 * prices don't move minute to minute in this model, only day to day.
 * Threads state.rngSeed the same way every other random draw in sim/
 * does, so a given seed reproduces the exact same fuel price history
 * every time (CLAUDE.md's determinism rule).
 */
export function rollDailyFuelPrice(state: SimState): void {
  state.fuelPriceHistory.push(state.fuelPriceIndex);
  if (state.fuelPriceHistory.length > FUEL_PRICE_HISTORY_MAX_DAYS) {
    state.fuelPriceHistory.shift();
  }

  const [roll, nextSeed] = nextRandom(state.rngSeed);
  state.rngSeed = nextSeed;
  const randomStep = (roll * 2 - 1) * FUEL_PRICE_DAILY_STEP;
  const reversion = (FUEL_PRICE_BASELINE - state.fuelPriceIndex) * FUEL_PRICE_REVERSION_STRENGTH;
  const next = state.fuelPriceIndex + randomStep + reversion;
  state.fuelPriceIndex = Math.min(FUEL_PRICE_MAX, Math.max(FUEL_PRICE_MIN, next));
}
