import airportsData from '../../data/airports.json';
import type { SimState } from './state';

/**
 * The airline's day runs on its home city's local clock.
 *
 * `simMinute` stays what CLAUDE.md says it is — minutes since the start of
 * day 0, UTC. What this module changes is where one *day* ends and the next
 * begins. The daily schedule, the 06:00–22:00 flying day, the 22:00 curfew
 * and the midnight rollover were all measured against UTC midnight, which
 * only matched real life for a home near London: from Halifax (UTC−4) the
 * first flight left at 02:00 local and the curfew fell at 18:00.
 *
 * So every "what time of day is it?" question in the sim asks this module,
 * which answers in the home airport's local time. A leg's `departMinute` is
 * therefore minutes after *home* midnight. One fixed offset per game (no
 * daylight saving, per CLAUDE.md), taken from the home airport, because
 * every plane in the fleet shares one repeating day.
 *
 * Known limit: a plane based far from home (another time zone) still flies
 * on the home clock. Per-base days would need per-leg day tracking all
 * through step(), which is a much bigger change than this fix.
 */

const MINUTES_PER_DAY = 1440;

const offsetByIata = new Map(
  (airportsData as { iata: string; utcOffsetMinutes: number }[]).map((a) => [a.iata, a.utcOffsetMinutes]),
);

/** The home airport's fixed UTC offset in minutes: −240 for Halifax, +60 for Frankfurt. */
export function homeUtcOffsetMinutes(state: SimState): number {
  return offsetByIata.get(state.homeAirport) ?? 0;
}

/** Minutes since home-local midnight, 0–1439. The `+ MINUTES_PER_DAY) % …` keeps it positive. */
export function minuteOfDay(state: SimState, minute: number = state.simMinute): number {
  const local = minute + homeUtcOffsetMinutes(state);
  return ((local % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** The simMinute at which the home-local day containing `minute` began. */
export function dayStartMinute(state: SimState, minute: number = state.simMinute): number {
  return minute - minuteOfDay(state, minute);
}

/** Which day of the game `minute` falls on, counting home-local days from 0. */
export function dayIndex(state: SimState, minute: number = state.simMinute): number {
  return Math.floor((minute + homeUtcOffsetMinutes(state)) / MINUTES_PER_DAY);
}

/**
 * Where a new game's clock starts: home-local midnight on day 0, so the
 * very first step() is a day rollover, exactly as it was when every game
 * started at UTC midnight. West of London that is a few hours after UTC
 * midnight (Halifax: minute 240). East of it, local midnight comes *before*
 * UTC midnight, so the game starts a little below zero (Frankfurt: −60) —
 * nothing in the sim minds a negative minute for that first hour.
 */
export function startingSimMinute(homeIata: string): number {
  return -(offsetByIata.get(homeIata) ?? 0);
}
