import { recommendedFare, marketKey } from './schedule';
import { summarizeMarket } from './marketSummary';
import { addRivalFlight } from './competitors';
import { rivalSecuresCapacity } from './market';
import { inRespite, pressureFactor, recentlyClosedByRival, rivalNetworkRoom } from './pressure';
import { nextRandom } from './rng';
import { rivalSlotQuote } from './slots';
import type { SimState } from './state';

/**
 * Rivals chase the passengers the player turns away. A market the player
 * flies full *and* prices well above the going rate is two signals at
 * once — more people want to fly than the player carries, and the player
 * is charging a premium for the seats it has — and a rival's natural
 * answer is capacity: add a flight there, or open the route if it doesn't
 * fly it yet.
 *
 * Why capacity rather than price: with the player full, a cheaper rival
 * fare barely matters (sim/competitors.ts's fare response) — the player
 * still sells every seat. More rival flights do matter: they shift the
 * market's frequency share, which is what sim/pressure.ts's
 * rivalYieldFactor() turns into lower effective fares for the player.
 * So pricing high while full now invites competition, and the premium
 * erodes. Rivals still need a plane from the shared market
 * (sim/market.ts) for every flight they add, so leasing up the shelf
 * holds them off.
 */

/** A fare above this multiple of the going rate counts as expensive. */
const EXPENSIVE_FARE_SHARE = 1.1;
/** Daily chance a rival responds on an expensive, full market: this much at the line... */
const RESPONSE_CHANCE_BASE = 0.05;
/** ...plus this much per unit of fare premium above it, capped. */
const RESPONSE_CHANCE_PER_PREMIUM = 0.5;
const RESPONSE_CHANCE_MAX = 0.3;
/**
 * How many daily flights a rival will build up to when it's responding to
 * a full, expensive market — double the cap on ordinary rival growth
 * (sim/pressure.ts's RIVAL_FREQUENCY_CAP), because a premium the player
 * keeps charging keeps inviting more. Measured: at the ordinary cap of 4,
 * rivals topped out on the player's routes and pricing 60% over the going
 * rate paid again.
 */
export const RESPONSE_FREQUENCY_CAP = 8;

/** Whether this market is one rivals want to move in on, and how badly (the day's response chance; 0 when not). */
export function rivalResponseChance(state: SimState, a: string, b: string): number {
  const settings = state.routeSettings[marketKey(a, b)];
  if (!settings) return 0;
  const summary = summarizeMarket(a, b, state, settings);
  if (summary.freq === 0 || !summary.seatCapped) return 0;
  const premium = settings.fare / recommendedFare(a, b) - EXPENSIVE_FARE_SHARE;
  if (premium <= 0) return 0;
  return Math.min(RESPONSE_CHANCE_MAX, (RESPONSE_CHANCE_BASE + RESPONSE_CHANCE_PER_PREMIUM * premium) * pressureFactor(state));
}

/**
 * Once a day, from step.ts's rollover: each of the player's full,
 * expensive markets rolls for a rival response. Where a rival already
 * flies it and has room under RESPONSE_FREQUENCY_CAP, the busiest such
 * one adds a flight. Where none does — nobody flies it, or everyone there
 * is at the cap — another airline already flying to either end opens the
 * route. Either needs a plane from the market.
 */
export function rollRivalCapacityResponse(state: SimState, dayStartMinute: number): void {
  const markets = [...new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)))].sort();
  for (const key of markets) {
    // Always drawn, whatever happens, so the number of random draws a day
    // doesn't depend on which markets happen to qualify (see sim/crew.ts).
    const [roll, next] = nextRandom(state.rngSeed);
    state.rngSeed = next;
    const [a, b] = key.split('-');
    if (roll >= rivalResponseChance(state, a, b)) continue;

    const onMarket = state.competitorRoutes.filter((route) => marketKey(route.origin, route.dest) === key);
    const withRoom = onMarket.filter((route) => route.dailyFrequency < RESPONSE_FREQUENCY_CAP).sort((x, y) => y.dailyFrequency - x.dailyFrequency);
    if (withRoom.length > 0) {
      addRivalFlight(state, withRoom[0]);
      continue;
    }

    // Nobody flies it, or everyone who does is at the cap: another airline
    // already at either end opens the route, unless a rival was just
    // squeezed out of it (sim/pressure.ts's respite).
    if (inRespite(state, a, b)) continue;
    const alreadyThere = new Set(onMarket.map((route) => route.code));
    const neighbour = state.competitorRoutes.find(
      (route) =>
        !alreadyThere.has(route.code) &&
        !recentlyClosedByRival(state, route.code, a, b) &&
        rivalNetworkRoom(state, route.code) > 0 &&
        [route.origin, route.dest].some((iata) => iata === a || iata === b),
    );
    if (!neighbour) continue;
    const slotFees = rivalSlotQuote(state, a, b);
    if (slotFees === null || !rivalSecuresCapacity(state, neighbour.code, 1)) continue;
    state.competitorRoutes.push({
      airline: neighbour.airline,
      code: neighbour.code,
      origin: a,
      dest: b,
      dailyFrequency: 1,
      fare: recommendedFare(a, b),
      baseFare: recommendedFare(a, b),
      openedAtMinute: dayStartMinute,
      slotFeesPerDay: slotFees,
    });
  }
}
