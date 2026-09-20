import aircraftTypesData from '../../data/aircraft-types.json';
import { ALL_MARKET_PAIRS } from './demand';
import { actualDailyDemand, currentPotentialDemand } from './marketDemand';
import { marketKey } from './schedule';
import type { SimState } from './state';

/**
 * Unmet demand, for the map: how many people want to fly and are not
 * being carried by the player. Two different quantities, kept apart
 * because they answer different questions:
 *
 * - **Latent** is what a market could carry if fully served (its
 *   potential, sim/demand.ts) minus the seats the player puts into it.
 *   It is mostly geography: a big city pair has a huge number whatever
 *   the player does, and it says where the opportunity is. It barely
 *   moves, because a plane's seats are tiny against a big market's
 *   potential.
 * - **Spilled** is what the player is turning away today: on a market
 *   they already fly, the demand that exists right now (the stimulated
 *   "actual" figure, sim/marketDemand.ts) beyond the seats offered. It
 *   moves with every flight added or plane upsized, and it is the signal
 *   that a route needs more capacity now.
 *
 * Both are attributed half to each end of a market, since a market's
 * demand flows both ways. Competitors' seats are ignored: this is the
 * player's view of what they are not carrying.
 *
 * Pure reads of `state`, no randomness; safe to call every frame.
 */

const seatsByTypeCode = new Map<string, number>(
  (aircraftTypesData as { code: string; seats: number }[]).map((type) => [type.code, type.seats]),
);

export type AirportUnmet = { latent: number; spilled: number };

/** Daily seats the player offers in each market, keyed by marketKey(). */
function playerSeatsByMarket(state: SimState): Map<string, number> {
  const seatsByTail = new Map(state.aircraft.map((a) => [a.tail, seatsByTypeCode.get(a.typeCode) ?? 0]));
  const seats = new Map<string, number>();
  for (const leg of state.schedule) {
    const key = marketKey(leg.origin, leg.dest);
    seats.set(key, (seats.get(key) ?? 0) + (seatsByTail.get(leg.tail) ?? 0));
  }
  return seats;
}

/** Per-airport latent and spilled demand, passengers a day. */
export function unmetDemandByAirport(state: SimState): Map<string, AirportUnmet> {
  const seatsByMarket = playerSeatsByMarket(state);
  const byAirport = new Map<string, AirportUnmet>();

  const add = (iata: string, latent: number, spilled: number): void => {
    const entry = byAirport.get(iata) ?? { latent: 0, spilled: 0 };
    entry.latent += latent;
    entry.spilled += spilled;
    byAirport.set(iata, entry);
  };

  for (const [a, b] of ALL_MARKET_PAIRS) {
    const seats = seatsByMarket.get(marketKey(a, b)) ?? 0;
    const latent = Math.max(0, currentPotentialDemand(state, a, b) - seats) / 2;
    const spilled = seats > 0 ? Math.max(0, actualDailyDemand(state, a, b) - seats) / 2 : 0;
    add(a, latent, spilled);
    add(b, latent, spilled);
  }

  return byAirport;
}

/** Markets the player flies where demand today exceeds the seats offered. */
export function spillingMarkets(state: SimState): Set<string> {
  const seatsByMarket = playerSeatsByMarket(state);
  const spilling = new Set<string>();
  for (const [key, seats] of seatsByMarket) {
    const [a, b] = key.split('-');
    if (seats > 0 && actualDailyDemand(state, a, b) > seats) spilling.add(key);
  }
  return spilling;
}

/**
 * How many pips to draw for a number of passengers: a log scale, so a
 * town of a few hundred shows a pip or two and a big city fills the ring.
 * Zero for fewer than one passenger, capped at MAX_PIPS.
 */
export const MAX_PIPS = 12;
export function pipCount(passengers: number): number {
  if (passengers < 1) return 0;
  return Math.min(MAX_PIPS, Math.max(1, Math.ceil(Math.log2(1 + passengers / 10))));
}
