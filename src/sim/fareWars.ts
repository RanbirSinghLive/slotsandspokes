import { dayIndex } from './clock';
import { marketKey, recommendedFare } from './schedule';
import type { SimState } from './state';

/**
 * Fare wars as events (WEEK-FOURTEEN.md, stage 3). Rivals already answer
 * your fare every day (sim/competitors.ts); this names it when it turns
 * into a war, so it can be watched. A war starts on a market when your
 * fare and a rival's both sit under WAR_LEVEL of the going rate, and ends
 * when either climbs back over PEACE_LEVEL (the gap between the two keeps
 * one bad day from flickering it on and off), or one of you stops flying
 * the market. Nothing here changes a fare: it's the record, for the
 * ticker and the route view.
 */

export const WAR_LEVEL = 0.85;
export const PEACE_LEVEL = 0.9;
/** How many starts and ends the log keeps, for the ticker. */
const WAR_LOG_LENGTH = 10;

export type FareWar = { key: string; rival: string; startDay: number };
export type FareWarEvent = { key: string; rival: string; kind: 'start' | 'end'; day: number; days: number; outcome?: 'you left' | 'rival left' | 'fares recovered' };

/** The war running on this market, if any. */
export function fareWarOn(state: SimState, key: string): FareWar | undefined {
  return state.fareWars?.find((war) => war.key === key);
}

/** Once a day, after rivals set their fares: wars starting and ending. */
export function rollDailyFareWars(state: SimState): void {
  const today = dayIndex(state);
  const flown = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  const wars = (state.fareWars ??= []);
  const log = (state.fareWarLog ??= []);
  const record = (event: FareWarEvent) => {
    log.push(event);
    if (log.length > WAR_LOG_LENGTH) log.shift();
  };

  // Ends first: a side gone, or a fare back over the peace line.
  for (const war of [...wars]) {
    const [a, b] = war.key.split('-');
    const going = recommendedFare(a, b);
    const rival = state.competitorRoutes.find((route) => route.code === war.rival && marketKey(route.origin, route.dest) === war.key && route.dailyFrequency > 0);
    const yours = flown.has(war.key) ? state.routeSettings[war.key]?.fare : undefined;
    const outcome: FareWarEvent['outcome'] | null = !yours
      ? 'you left'
      : !rival
        ? 'rival left'
        : yours > going * PEACE_LEVEL || rival.fare > going * PEACE_LEVEL
          ? 'fares recovered'
          : null;
    if (!outcome) continue;
    wars.splice(wars.indexOf(war), 1);
    record({ key: war.key, rival: war.rival, kind: 'end', day: today, days: today - war.startDay, outcome });
  }

  // Starts: you and a rival both under the war line, with no war there yet.
  for (const route of state.competitorRoutes) {
    if (route.dailyFrequency <= 0) continue;
    const key = marketKey(route.origin, route.dest);
    if (!flown.has(key) || fareWarOn(state, key)) continue;
    const yours = state.routeSettings[key]?.fare;
    const going = recommendedFare(route.origin, route.dest);
    if (!yours || yours >= going * WAR_LEVEL || route.fare >= going * WAR_LEVEL) continue;
    wars.push({ key, rival: route.code, startDay: today });
    record({ key, rival: route.code, kind: 'start', day: today, days: 0 });
  }
}
