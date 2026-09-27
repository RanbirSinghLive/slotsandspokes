import { RIVAL_FARE_ADJUST_SHARE, rivalFareTarget, type CompetitorOffering } from './competitors';
import { summarizeMarket } from './marketSummary';
import { RIVAL_CLOSE_AFTER_LOSING_DAYS, RIVAL_CLOSE_GRACE_DAYS } from './pressure';
import { stanceFare } from './pricing';
import { rivalRouteDailyResult } from './rivalEconomics';
import { RESPONSE_FREQUENCY_CAP, rivalResponseChance } from './rivalResponse';
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
 * (sim/competitors.ts's rivalFareTarget()), and rivals answering a full,
 * expensive market with capacity (sim/rivalResponse.ts). That answer is a
 * daily chance in the game, so the forecast adds its expected value: each
 * day, the day's chance of a flight goes onto the busiest rival with room,
 * as a fraction of a flight, until the market is no longer full or the
 * rival reaches its cap. Without it, Premium looked better than it plays,
 * since rivals answer it with flights. Demand, schedule and fuel are held
 * where they are today. A pure read of `state`, with no random draws.
 */

/** How far ahead the forecast runs. Past this, a rival still losing money is reported as holding on. */
const FORECAST_DAYS = 180;
const MINUTES_PER_DAY = 1440;
/** A daily response chance below this is too small to keep the forecast running for. */
const MIN_RESPONSE_CHANCE = 0.001;

export type RivalOutlook = {
  airline: string;
  /** Its fare once the war has settled. */
  fare: number;
  /** What its route makes a day at that fare. */
  margin: number;
  /** Days until it closes the route, or null if it wouldn't within the forecast. */
  closesInDays: number | null;
  /** Flights a day it's expected to add in answer to a full, expensive market. */
  flightsAdded: number;
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
  const flightsBefore = new Map<CompetitorOffering, number>(onMarket.map((route) => [route, route.dailyFrequency]));
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

    // Rivals answer a full, expensive market with flights: today's chance
    // of one, as a fraction, on the busiest rival still open with room.
    const response = rivalResponseChance(work, origin, dest);
    const answering = onMarket
      .filter((route) => !closesIn.has(route) && route.dailyFrequency < RESPONSE_FREQUENCY_CAP)
      .sort((x, y) => y.dailyFrequency - x.dailyFrequency)[0];
    if (answering && response > 0) answering.dailyFrequency = Math.min(RESPONSE_FREQUENCY_CAP, answering.dailyFrequency + response);

    // Nothing left to happen: fares have stopped, no open rival is on a
    // losing run, and none is still adding capacity.
    const stillLosing = onMarket.some((route) => !closesIn.has(route) && losingDays.get(route)! > 0);
    const stillAnswering = answering !== undefined && response >= MIN_RESPONSE_CHANCE;
    if (!moved && !stillLosing && !stillAnswering) break;
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
      flightsAdded: Math.round((route.dailyFrequency - flightsBefore.get(route)!) * 10) / 10,
    })),
    responseChance: rivalResponseChance(work, origin, dest),
  };
}
