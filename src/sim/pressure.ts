import { dayIndex } from './clock';
import type { CompetitorOffering } from './competitors';
import type { SimState } from './state';

/**
 * Time pressure: the reason to keep building. Nothing here hurts a player
 * who keeps growing; it makes standing still lose ground.
 *
 * - **Rivals enter.** From day RIVAL_FIRST_ENTRY_DAY a new airline arrives
 *   every RIVAL_ENTRY_INTERVAL_DAYS, up to MAX_RIVAL_ENTRIES, on a market
 *   next to the player's network (sim/competitors.ts). They favour the
 *   markets the player already flies.
 * - **Rivals grow.** Every competitor, old or new, is more likely to open
 *   routes and add flights the longer the game has run, scaled by
 *   pressureFactor().
 * - **Rivals cut your fares** (rivalYieldFactor()). Without this a rival
 *   on your route cost nothing: markets here are seat-limited (demand in
 *   the hundreds against a 25-seat plane), so splitting the demand left
 *   every plane full, and a rival's own seats even stimulated the market
 *   to your benefit. Competition depresses what each passenger pays.
 * - **Demand keeps growing** (DAILY_DEMAND_GROWTH in sim/marketDemand.ts):
 *   the market a plane filled last month is short of seats this month.
 *
 * All constants live here so difficulty is one place to tune. They are
 * deliberately blunt: a rival on your best route takes a share of it
 * (sim/choiceModel.ts weighs frequency), and the fix is more frequency or a
 * bigger plane, which is exactly what the map already lets you do.
 */

export const RIVAL_FIRST_ENTRY_DAY = 15;
export const RIVAL_ENTRY_INTERVAL_DAYS = 20;
export const MAX_RIVAL_ENTRIES = 5;

/** A rival weights a market the player already flies this many times over one they don't. */
export const PLAYER_MARKET_WEIGHT = 3;

/** How many daily flights any competitor will run on one route. */
export const RIVAL_FREQUENCY_CAP = 4;

/** Chance per route per day, before pressure, that a competitor adds a daily flight. */
export const FREQUENCY_GROWTH_PROBABILITY_PER_DAY = 0.008;

/** Days after which rival activity has doubled. */
export const PRESSURE_RAMP_DAYS = 90;

/** 1 on day 0, 2 at PRESSURE_RAMP_DAYS, and so on without a ceiling. */
export function pressureFactor(state: SimState): number {
  const day = dayIndex(state);
  return 1 + day / PRESSURE_RAMP_DAYS;
}

/**
 * The most a rival can take off your average fare on a market, when rivals
 * fly all of its flights.
 */
export const MAX_RIVAL_YIELD_LOSS = 0.4;

/** With probability this, a new rival enters a market the player already flies (if any qualifies). */
export const RIVAL_TARGETS_PLAYER = 0.7;

/**
 * Multiplier on a flight's revenue for competition on its market. 1 with
 * no rivals; falls as rivals take a bigger share of the market's flights,
 * to 1 - MAX_RIVAL_YIELD_LOSS if the player flew nothing. The player's own
 * frequency is the counter: four rival flights against four of yours is a
 * 20% cut, against fourteen of yours about 9%.
 *
 * Frequencies are compared in the units the choice model already uses:
 * `playerLegs` is the player's legs on the market (both directions),
 * `dailyFrequency` the rival's.
 */
export function rivalYieldFactor(
  origin: string,
  dest: string,
  playerLegs: number,
  competitors: CompetitorOffering[],
): number {
  let rivalFlights = 0;
  for (const c of competitors) {
    if ((c.origin === origin && c.dest === dest) || (c.origin === dest && c.dest === origin)) {
      rivalFlights += c.dailyFrequency;
    }
  }
  if (rivalFlights === 0) return 1;
  const rivalShare = rivalFlights / (rivalFlights + Math.max(playerLegs, 0));
  return 1 - MAX_RIVAL_YIELD_LOSS * rivalShare;
}
