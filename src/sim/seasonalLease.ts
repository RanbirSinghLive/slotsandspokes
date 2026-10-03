import { dayIndex } from './clock';
import { startReturn } from './fleetTiming';
import { legsServingMarket, marketKey } from './schedule';
import type { SimState } from './state';

/**
 * Seasonal capacity (WEEK-FOURTEEN.md, stage 5): a plane leased for the
 * peak, SEASON_DAYS from its delivery, at SEASONAL_PREMIUM on the shelf's
 * rate. It comes from the same shelf, is delivered the same way, and
 * flies like any other plane. When the season is over its flights come
 * off and it goes back to the lessor by itself, with no return fee. So a
 * summer's or a winter's extra flying can be bought without a standing
 * lease the quiet months would have to carry, but at a price.
 */

export const SEASON_DAYS = 90;
export const SEASONAL_PREMIUM = 1.3;

/**
 * At rollover, after the day's deliveries (sim/fleetTiming.ts): planes
 * whose season is over lose their flights (a market left with none loses
 * its settings, as when a rotation is removed by hand) and start back to
 * the lessor. Planes in the air or grounded finish first and go the next
 * morning after.
 */
export function endSeasonalLeases(state: SimState): string[] {
  const today = dayIndex(state);
  const ended: string[] = [];
  for (const aircraft of state.aircraft) {
    if (aircraft.seasonalUntilDay === undefined || aircraft.seasonalUntilDay > today || aircraft.returningOnDay !== undefined) continue;
    if (aircraft.status !== 'ground' || state.aogs.some((event) => event.tail === aircraft.tail)) continue;
    const legs = state.schedule.filter((leg) => leg.tail === aircraft.tail);
    state.schedule = state.schedule.filter((leg) => leg.tail !== aircraft.tail);
    for (const leg of legs) {
      if (legsServingMarket(leg.origin, leg.dest, state.schedule) === 0) delete state.routeSettings[marketKey(leg.origin, leg.dest)];
    }
    startReturn(state, aircraft);
    ended.push(aircraft.tail);
  }
  return ended;
}
