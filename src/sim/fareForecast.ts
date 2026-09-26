import { RIVAL_FARE_ADJUST_SHARE, rivalFareTarget, type CompetitorOffering } from './competitors';
import { summarizeMarket } from './marketSummary';
import { RIVAL_CLOSE_AFTER_LOSING_DAYS, RIVAL_CLOSE_GRACE_DAYS } from './pressure';
import { stanceFare } from './pricing';
import { rivalRouteDailyResult } from './rivalEconomics';
import { rivalResponseChance } from './rivalResponse';
import { marketKey } from './schedule';
import type { FareStance, SimState } from './state';

/**
 * What each fare stance (sim/pricing.ts) would lead to on a contested
 * market, if nothing else changed: where your fare and the rivals' fares
 * settle, what each side makes a day there, and whether a rival would
 * close the route. It is what the route view shows, so the choice between
 * stances is a choice between visible outcomes rather than a guess.
 *
 * Worked out by running the game's own daily rules forward on a copy of
 * the market, in the order the rollover runs them (sim/step.ts): rivals
 * judged on yesterday's result (sim/rivalEconomics.ts), your stance
 * re-priced (stanceFare()), rivals answering your fare
 * (sim/competitors.ts's rivalFareTarget()). Demand, schedule, fuel and
 * rival frequencies are held where they are today, so it is a forecast
 * of the price war alone. A pure read of `state`, with no random draws.
 */

/** How far ahead the forecast runs. Past this, a rival still losing money is reported as holding on. */
const FORECAST_DAYS = 180;
const MINUTES_PER_DAY = 1440;

export type RivalOutlook = {
  airline: string;
  /** Its fare once the war has settled. */
  fare: number;
  /** What its route makes a day at that fare. */
  margin: number;
  /** Days until it closes the route, or null if it wouldn't within the forecast. */
  closesInDays: number | null;
};

export type StanceForecast = {
  stance: FareStance;
  /** Your fare once rivals have stopped moving. */
  fare: number;
  /** What this market makes you a day at the settled fares. */
  margin: number;
  rivals: RivalOutlook[];
  /** At the settled fares, the daily chance a rival adds a flight to take passengers you turn away. */
  responseChance: number;
};

export function forecastStance(state: SimState, origin: string, dest: string, stance: FareStance): StanceForecast {
  const key = marketKey(origin, dest);
  const settings = state.routeSettings[key];
  if (!settings) throw new Error(`forecastStance: ${key} has no route settings`);

  // A copy of just what the rules change: rival fares and your fare.
  const work: SimState = {
    ...state,
    competitorRoutes: state.competitorRoutes.map((route) => ({ ...route })),
    routeSettings: { ...state.routeSettings, [key]: { ...settings, fareStance: stance, fareIsOverridden: false } },
  };
  const workSettings = work.routeSettings[key];
  const onMarket = work.competitorRoutes.filter((route) => marketKey(route.origin, route.dest) === key);
  const losingDays = new Map<CompetitorOffering, number>(onMarket.map((route) => [route, route.losingDays ?? 0]));
  const closesIn = new Map<CompetitorOffering, number>();

  for (let day = 1; day <= FORECAST_DAYS; day++) {
    // Rivals are judged on the day just ended.
    for (const route of onMarket) {
      if (closesIn.has(route)) continue;
      const losing = rivalRouteDailyResult(work, route).margin < 0;
      losingDays.set(route, losing ? losingDays.get(route)! + 1 : 0);
      const daysOpen = (state.simMinute - route.openedAtMinute) / MINUTES_PER_DAY + day;
      if (daysOpen >= RIVAL_CLOSE_GRACE_DAYS && losingDays.get(route)! >= RIVAL_CLOSE_AFTER_LOSING_DAYS) closesIn.set(route, day);
    }

    // Then your stance prices against their fares, and they answer it.
    const fareBefore = workSettings.fare;
    workSettings.fare = stanceFare(work, origin, dest, stance);
    let moved = workSettings.fare !== fareBefore;
    for (const route of onMarket) {
      const next = Math.round(route.fare + (rivalFareTarget(route, workSettings.fare) - route.fare) * RIVAL_FARE_ADJUST_SHARE);
      if (next !== route.fare) moved = true;
      route.fare = next;
    }

    // Nothing left to happen: fares have stopped and no open rival is on a losing run.
    const stillLosing = onMarket.some((route) => !closesIn.has(route) && losingDays.get(route)! > 0);
    if (!moved && !stillLosing) break;
  }

  return {
    stance,
    fare: workSettings.fare,
    margin: summarizeMarket(origin, dest, work, workSettings).margin,
    rivals: onMarket.map((route) => ({
      airline: route.airline,
      fare: route.fare,
      margin: rivalRouteDailyResult(work, route).margin,
      closesInDays: closesIn.get(route) ?? null,
    })),
    responseChance: rivalResponseChance(work, origin, dest),
  };
}
