import { MIN_TURN_MINUTES } from './schedule';
import type { SimState } from './state';

/**
 * Week six's pivot away from timeline scheduling: an aircraft's day is a
 * **budget**, and every rotation spends a share of it.
 *
 * The Gantt board asked the player to place legs at times and keep a
 * rotation physically continuous. That is fiddly at three aircraft and
 * unmanageable at thirty, and it made adding a frequency an exercise in
 * finding a gap rather than a commercial decision. Expressed as a
 * percentage of an aircraft instead, the same information answers the
 * questions that actually matter: how much unused aeroplane am I paying
 * for, and is 5% spare worth another airframe?
 *
 * It also expresses something the timeline model simply couldn't. A
 * rotation longer than one usable day — a genuine long-haul turn — comes
 * out above 100%, meaning it needs more than one aircraft to sustain
 * daily. On a Gantt that was an impossible schedule; here it's just a
 * number greater than one.
 *
 * **This is a planning layer, not a replacement for the simulation.**
 * step() still flies real legs at real times and still cascades delays
 * through the rest of an aircraft's day — CLAUDE.md is explicit that
 * watching that happen is the map's whole reason to exist. What changes
 * is that the player stops *authoring* the timeline; the sim derives it.
 */

/**
 * The window an aircraft can realistically be worked in, 06:00 to 22:00.
 * Not a regulatory limit — it stands in for slot hours, curfews, crew
 * duty and the simple fact that nobody schedules a 03:00 regional
 * departure. One constant doing the job of a whole duty model, in the
 * same deliberately-crude spirit as the rest of sim/.
 */
export const USABLE_DAY_START_MINUTE = 6 * 60;
export const USABLE_DAY_END_MINUTE = 22 * 60;
export const USABLE_DAY_MINUTES = USABLE_DAY_END_MINUTE - USABLE_DAY_START_MINUTE;

/**
 * What one leg costs an aircraft: its block time plus the turn it forces
 * at the far end. Charging the turn to the leg that causes it means a
 * rotation's cost is just the sum of its legs, with no separate
 * bookkeeping for the gaps between them.
 */
export function legUtilisationMinutes(blockMinutes: number): number {
  return blockMinutes + MIN_TURN_MINUTES;
}

/** That same leg as a share of one aircraft's usable day. */
export function legUtilisationShare(blockMinutes: number): number {
  return legUtilisationMinutes(blockMinutes) / USABLE_DAY_MINUTES;
}

export type AircraftUtilisation = {
  tail: string;
  typeCode: string;
  base: string | null;
  legs: number;
  minutes: number;
  /** 1 means the usable day is exactly full; above 1 means the rotation cannot be flown daily by one aircraft. */
  share: number;
};

/** How hard one aircraft is worked by the legs currently assigned to it. */
export function aircraftUtilisation(state: SimState, tail: string): AircraftUtilisation {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const legs = state.schedule.filter((leg) => leg.tail === tail);
  const minutes = legs.reduce((total, leg) => total + legUtilisationMinutes(leg.blockMinutes), 0);
  return {
    tail,
    typeCode: aircraft?.typeCode ?? '',
    base: aircraft?.baseAirport ?? null,
    legs: legs.length,
    minutes,
    share: minutes / USABLE_DAY_MINUTES,
  };
}

export type BaseUtilisation = {
  base: string;
  aircraft: AircraftUtilisation[];
  /** Total usable minutes the based fleet offers — one full day each. */
  capacityMinutes: number;
  usedMinutes: number;
  share: number;
  spareMinutes: number;
  /**
   * How much of another aircraft the spare capacity amounts to. The
   * headline number for "is it worth another airframe?" — 0.05 says you
   * are paying for 5% of a plane you aren't using, 0.9 says you nearly
   * have room for a whole extra rotation.
   */
  spareAircraft: number;
};

/**
 * Utilisation pooled by base, which is the level the decision actually
 * lives at. Frequencies belong to a base rather than to a named tail
 * (agreed directly): per-tail figures can't answer "have I got a spare
 * aeroplane's worth of gaps scattered across the fleet", and that is the
 * question the whole pivot exists to make answerable.
 *
 * An aircraft with no base assigned is pooled under `null` and reported
 * separately — it can't fly a rotation until it has one.
 */
export function utilisationByBase(state: SimState): BaseUtilisation[] {
  const byBase = new Map<string, AircraftUtilisation[]>();

  for (const aircraft of state.aircraft) {
    const key = aircraft.baseAirport ?? '';
    const list = byBase.get(key) ?? [];
    list.push(aircraftUtilisation(state, aircraft.tail));
    byBase.set(key, list);
  }

  return [...byBase.entries()]
    .map(([base, list]) => {
      const capacityMinutes = list.length * USABLE_DAY_MINUTES;
      const usedMinutes = list.reduce((total, a) => total + a.minutes, 0);
      return {
        base,
        aircraft: list,
        capacityMinutes,
        usedMinutes,
        share: capacityMinutes > 0 ? usedMinutes / capacityMinutes : 0,
        spareMinutes: capacityMinutes - usedMinutes,
        spareAircraft: (capacityMinutes - usedMinutes) / USABLE_DAY_MINUTES,
      };
    })
    .sort((a, b) => b.usedMinutes - a.usedMinutes);
}

/**
 * Where an aircraft's legs actually start from, used to suggest a base
 * for airframes acquired before bases were a concept. The most common
 * origin among its legs; null if it flies nothing.
 */
export function impliedBase(state: SimState, tail: string): string | null {
  const counts = new Map<string, number>();
  for (const leg of state.schedule) {
    if (leg.tail !== tail) continue;
    counts.set(leg.origin, (counts.get(leg.origin) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [origin, count] of counts) {
    if (count > bestCount) {
      best = origin;
      bestCount = count;
    }
  }
  return best;
}
