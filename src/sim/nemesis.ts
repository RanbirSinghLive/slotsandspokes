import { dayIndex } from './clock';
import { fareWarOn } from './fareWars';
import { legsServingMarket, marketKey } from './schedule';
import type { SimState } from './state';

/**
 * The nemesis: the rival airline that has taken the most from the player's
 * routes lately, named so the long game has a face and a target. Nothing
 * here changes a fare, a route or a rival's behaviour; it only reads who
 * the rivals' presence has cost the player and sets one goal, to out-fly
 * that airline and hold the lead.
 *
 * Each day, every market the player flew counts a share of yesterday's
 * revenue against each rival flying it: the rival's share of the market's
 * flights, doubled-down by half again while a fare war runs there. That
 * estimate of money taken piles up in `rivalGrudge` and fades 1% a day, so
 * a rival that moves on is forgotten and a new one can take its place.
 *
 * Out-flying is routes: the player flies at least LEAD_ROUTES more routes
 * than the nemesis, and at least LEAD_RATIO times as many, for HOLD_DAYS in a row. Winning retires that rival as a
 * nemesis for good and the grudge starts over; a bigger rival then rises.
 * Rivals under MIN_RIVAL_ROUTES are not worth beating.
 */

/** Estimated dollars taken before a rival can be named. */
export const NAMING_GRUDGE = 150_000;
/** A challenger must hold this multiple of the nemesis's grudge to replace it. */
const REPLACE_FACTOR = 1.25;
const GRUDGE_KEPT_PER_DAY = 0.99;
const WAR_WEIGHT = 1.5;

/** Routes the player must fly beyond the nemesis, and for how many days running. */
export const LEAD_ROUTES = 3;
export const HOLD_DAYS = 60;
/** ...and the player's routes must be this multiple of theirs. */
export const LEAD_RATIO = 1.5;
/** Fewest routes a rival needs to count as a nemesis worth beating. */
export const MIN_RIVAL_ROUTES = 3;

export type Nemesis = {
  code: string;
  airline: string;
  sinceDay: number;
  /** Consecutive days the player has led by LEAD_ROUTES. */
  leadDays?: number;
};

/** Estimated money each rival took from the player's routes yesterday. */
function takenYesterday(state: SimState): Map<string, number> {
  const taken = new Map<string, number>();
  const flown = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  for (const key of flown) {
    const revenue = state.revenueHistoryByMarket[key]?.slice(-1)[0] ?? 0;
    if (revenue <= 0) continue;
    const [a, b] = key.split('-');
    const yours = Math.max(1, legsServingMarket(a, b, state.schedule) / 2);
    for (const route of state.competitorRoutes) {
      if (route.dailyFrequency <= 0 || marketKey(route.origin, route.dest) !== key) continue;
      const share = route.dailyFrequency / (route.dailyFrequency + yours);
      const war = fareWarOn(state, key)?.rival === route.code ? WAR_WEIGHT : 1;
      taken.set(route.code, (taken.get(route.code) ?? 0) + revenue * share * war);
    }
  }
  return taken;
}

export function routesOf(state: SimState, code: string): number {
  return state.competitorRoutes.filter((route) => route.code === code && route.dailyFrequency > 0).length;
}

export function playerRoutes(state: SimState): number {
  return new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest))).size;
}

/** Once a day at rollover, after the day's revenue is recorded and fare wars are updated. */
export function rollDailyRivalry(state: SimState): { named?: Nemesis; beaten?: Nemesis } {
  const grudge = (state.rivalGrudge ??= {});
  for (const code of Object.keys(grudge)) grudge[code] *= GRUDGE_KEPT_PER_DAY;
  for (const [code, amount] of takenYesterday(state)) grudge[code] = (grudge[code] ?? 0) + amount;

  const result: { named?: Nemesis; beaten?: Nemesis } = {};
  const beaten = (state.nemesesBeaten ??= []);
  const today = dayIndex(state);

  // The current nemesis: still flying, still ahead of them, or beaten.
  let current = state.nemesis;
  if (current && routesOf(state, current.code) === 0) current = state.nemesis = undefined;
  if (current) {
    const mine = playerRoutes(state);
    const lead = mine - routesOf(state, current.code) >= LEAD_ROUTES && mine >= routesOf(state, current.code) * LEAD_RATIO && routesOf(state, current.code) >= MIN_RIVAL_ROUTES;
    current.leadDays = lead ? (current.leadDays ?? 0) + 1 : 0;
    if (current.leadDays >= HOLD_DAYS) {
      beaten.push(current.code);
      grudge[current.code] = 0;
      result.beaten = current;
      current = state.nemesis = undefined;
    }
  }

  // Who has taken the most among rivals worth naming.
  let top: { code: string; amount: number } | null = null;
  for (const [code, amount] of Object.entries(grudge)) {
    if (beaten.includes(code) || routesOf(state, code) < MIN_RIVAL_ROUTES) continue;
    if (!top || amount > top.amount) top = { code, amount };
  }
  if (top && top.amount >= NAMING_GRUDGE && top.code !== current?.code && (!current || top.amount >= (grudge[current.code] ?? 0) * REPLACE_FACTOR)) {
    const airline = state.competitorRoutes.find((route) => route.code === top!.code)?.airline ?? top.code;
    state.nemesis = { code: top.code, airline, sinceDay: today };
    result.named = state.nemesis;
  }
  return result;
}

export type NemesisStatus = {
  nemesis: Nemesis;
  /** Estimated dollars taken, faded over time. */
  grudge: number;
  theirRoutes: number;
  yourRoutes: number;
  /** Days of the lead held so far, of HOLD_DAYS. */
  leadDays: number;
};

export function nemesisStatus(state: SimState): NemesisStatus | null {
  const nemesis = state.nemesis;
  if (!nemesis) return null;
  return {
    nemesis,
    grudge: state.rivalGrudge?.[nemesis.code] ?? 0,
    theirRoutes: routesOf(state, nemesis.code),
    yourRoutes: playerRoutes(state),
    leadDays: nemesis.leadDays ?? 0,
  };
}
