import { MIN_TURN_MINUTES, marketKey, type ScheduleLeg } from './schedule';
import { hubWaitMinutes } from './hubStyle';
import type { SimState } from './state';
import { AIRCRAFT_CLASSES } from './aircraftClasses';

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
 * The extra scheduled ground time after a flight on this market — the
 * player's per-route turn buffer (RouteSettings.turnBufferMinutes,
 * sim/turnBuffer.ts). Zero for a market with no settings yet, which is
 * every market until its first rotation is committed.
 */
export function turnBufferMinutes(state: SimState, origin: string, dest: string): number {
  return state.routeSettings[marketKey(origin, dest)]?.turnBufferMinutes ?? 0;
}

/**
 * Scheduled ground time after a flight beyond the physical minimum: its
 * route's turn buffer, plus the destination's hub wait when that airport
 * runs banked (sim/hubStyle.ts). Both are slack the planner pays for in
 * aircraft time.
 */
export function extraTurnMinutes(state: SimState, origin: string, dest: string): number {
  return turnBufferMinutes(state, origin, dest) + hubWaitMinutes(state, dest);
}

/** The whole scheduled turn after a flight: the physical minimum plus any buffer and hub wait. */
export function scheduledTurnMinutes(state: SimState, origin: string, dest: string): number {
  return MIN_TURN_MINUTES + extraTurnMinutes(state, origin, dest);
}

/**
 * What one leg costs an aircraft: its block time plus the turn it forces
 * at the far end, buffer included. Charging the turn to the leg that
 * causes it means a rotation's cost is just the sum of its legs, with no
 * separate bookkeeping for the gaps between them — and it means a turn
 * buffer is paid for in exactly the currency it trades against: minutes
 * of the usable day the plane can't spend flying.
 */
export function legUtilisationMinutes(blockMinutes: number, turnBuffer = 0): number {
  return blockMinutes + MIN_TURN_MINUTES + turnBuffer;
}

/** `legUtilisationMinutes` for a leg already on the schedule, reading its route's buffer from `state`. */
function scheduledLegMinutes(state: SimState, leg: ScheduleLeg): number {
  return legUtilisationMinutes(leg.blockMinutes, extraTurnMinutes(state, leg.origin, leg.dest));
}

/**
 * A plane's whole cycle can be at most a day (24 hours).
 */
const MINUTES_PER_DAY = 1440;

/**
 * Whether a tail's legs are one long-haul round trip: exactly two legs
 * that take longer than the usable day but still fit in 24 hours.
 * Intercontinental flights (Toronto to London is 6.9 hours each way, Dallas
 * to London 9) cannot be squeezed into the 06:00 to 22:00 window, so a
 * plane that does nothing else may run one round trip a day around the
 * clock: leave at 06:00, be back before the next 06:00. The plane is
 * fully used by it, so it counts as exactly one full usable day rather
 * than the 140% its clock time would suggest (which would raise a false
 * over-booked alarm on a plane doing precisely what it should).
 */
export function isLongHaulRoundTrip(legCount: number, rawMinutes: number): boolean {
  return legCount === 2 && rawMinutes > USABLE_DAY_MINUTES && rawMinutes <= MINUTES_PER_DAY;
}

/** Minutes a tail's legs cost it, with a long-haul round trip counted as one full day. */
export function effectiveTailMinutes(legCount: number, rawMinutes: number): number {
  return isLongHaulRoundTrip(legCount, rawMinutes) ? USABLE_DAY_MINUTES : rawMinutes;
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
  const rawMinutes = legs.reduce((total, leg) => total + scheduledLegMinutes(state, leg), 0);
  const minutes = effectiveTailMinutes(legs.length, rawMinutes);
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
      // Grounded planes (AOG) add no capacity until they're back.
      const capacityMinutes = list.filter((a) => !isGrounded(state, a.tail)).length * USABLE_DAY_MINUTES;
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
 * One of the four aircraft-class pools: every plane of a class, optionally
 * only those based at one airport. This is the level a player decides at
 * ("do I need another Regional here"), since a rotation can only be flown
 * by a plane of some class based at its base.
 */
export type ClassPool = {
  code: string;
  name: string;
  planes: number;
  /** Of `planes`, how many are grounded by an AOG (sim/aog.ts) and so add no capacity. */
  grounded: number;
  capacityMinutes: number;
  usedMinutes: number;
  /** Used over capacity, 0 when there are no planes. Above 1 means over-booked. */
  share: number;
};

/**
 * A hypothetical change to one pool's bookings and size: what a hover
 * preview says an action *would* do (sim/playerActions.ts). Negative frees
 * time.
 * Never applied to state; only ever added on top of a read.
 */
export type PoolEffect = {
  base: string;
  classCode: string;
  /** Change in booked minutes. */
  minutes: number;
  /** Change in planes, so a lease can preview a pool growing. Each plane adds one usable day. */
  planes?: number;
};

/** Grounded by an AOG (sim/aog.ts). Read straight off state to keep this module free of an import cycle with it. */
function isGrounded(state: SimState, tail: string): boolean {
  return state.aogs.some((event) => event.tail === tail);
}

export function utilisationPools(state: SimState, base?: string): ClassPool[] {
  return AIRCRAFT_CLASSES.map((cls) => {
    const planes = state.aircraft.filter((a) => a.typeCode === cls.code && (base === undefined || a.baseAirport === base));
    // A grounded plane's flying still counts (it's still on the schedule,
    // waiting to be covered), but its day doesn't: that's what pushes a pool
    // past 100% while an AOG lasts.
    const grounded = planes.filter((a) => isGrounded(state, a.tail)).length;
    const usedMinutes = planes.reduce((total, a) => total + aircraftUtilisation(state, a.tail).minutes, 0);
    const capacityMinutes = (planes.length - grounded) * USABLE_DAY_MINUTES;
    return {
      code: cls.code,
      name: cls.name,
      planes: planes.length,
      grounded,
      capacityMinutes,
      usedMinutes,
      share: capacityMinutes > 0 ? usedMinutes / capacityMinutes : 0,
    };
  });
}

/**
 * The fullest class pool at each base, keyed by airport. What the ring on
 * the map shows: one number that says "something here is running out",
 * with the per-class detail one click away in the airport's view. Planes
 * with no base are left out, since they cannot fly a rotation yet.
 */
export function worstPoolShareByBase(state: SimState, effects: PoolEffect[] = []): Map<string, number> {
  const pools = new Map<string, { used: number; capacity: number }>();
  for (const aircraft of state.aircraft) {
    if (!aircraft.baseAirport) continue;
    const key = `${aircraft.baseAirport}|${aircraft.typeCode}`;
    const pool = pools.get(key) ?? { used: 0, capacity: 0 };
    pool.used += aircraftUtilisation(state, aircraft.tail).minutes;
    if (!isGrounded(state, aircraft.tail)) pool.capacity += USABLE_DAY_MINUTES;
    pools.set(key, pool);
  }

  for (const effect of effects) {
    const key = `${effect.base}|${effect.classCode}`;
    const pool = pools.get(key) ?? { used: 0, capacity: 0 };
    pool.used += effect.minutes;
    pool.capacity += (effect.planes ?? 0) * USABLE_DAY_MINUTES;
    pools.set(key, pool);
  }

  const worst = new Map<string, number>();
  for (const [key, pool] of pools) {
    const base = key.split('|')[0];
    if (pool.capacity <= 0) continue;
    worst.set(base, Math.max(worst.get(base) ?? 0, pool.used / pool.capacity));
  }
  return worst;
}

/**
 * One rotation: a run of an aircraft's legs that leaves its base and comes
 * back to it. This is the unit the player actually builds (see
 * ui/routeBuilder.ts) and, since week seven's phase C, the unit they
 * remove — but it is deliberately *not* stored on SimState. A rotation is
 * fully recoverable from the legs themselves, and inventing a stored
 * `Rotation[]` alongside `schedule` would mean two representations of the
 * same fact that could drift apart. Derived, not persisted.
 */
export type Rotation = {
  tail: string;
  legs: ScheduleLeg[];
  /** Airports in order, base first and base last on a closed rotation. */
  airports: string[];
  departMinute: number;
  arriveMinute: number;
  /** Block plus turn across the whole rotation — what it spends of an aircraft. */
  minutes: number;
  share: number;
  /**
   * False when the run never makes it back to base — only reachable from a
   * hand-edited save or a base changed out from under existing legs, since
   * the route builder always closes the loop. Still listed, because legs
   * the player can't see are legs they can't remove.
   */
  closed: boolean;
};

function buildRotation(state: SimState, tail: string, legs: ScheduleLeg[], base: string): Rotation {
  const last = legs[legs.length - 1];
  const minutes = effectiveTailMinutes(legs.length, legs.reduce((total, leg) => total + scheduledLegMinutes(state, leg), 0));
  return {
    tail,
    legs,
    airports: [legs[0].origin, ...legs.map((leg) => leg.dest)],
    departMinute: legs[0].departMinute,
    arriveMinute: last.departMinute + last.blockMinutes,
    minutes,
    share: minutes / USABLE_DAY_MINUTES,
    closed: last.dest === base,
  };
}

/**
 * An aircraft's day split into rotations, in departure order. The split
 * point is simply "this leg lands at the base" — which works because the
 * route builder packs each rotation to end there, so consecutive rotations
 * never interleave.
 */
export function rotationsForTail(state: SimState, tail: string): Rotation[] {
  const legs = state.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
  if (legs.length === 0) return [];

  const aircraft = state.aircraft.find((a) => a.tail === tail);
  // Falling back to the first leg's origin keeps an unbased tail's legs
  // groupable rather than collapsing them all into one run.
  const base = aircraft?.baseAirport ?? legs[0].origin;

  const rotations: Rotation[] = [];
  let current: ScheduleLeg[] = [];
  for (const leg of legs) {
    current.push(leg);
    if (leg.dest === base) {
      rotations.push(buildRotation(state, tail, current, base));
      current = [];
    }
  }
  if (current.length > 0) rotations.push(buildRotation(state, tail, current, base));
  return rotations;
}

/** Every rotation the airline flies, grouped by tail in fleet order. */
export function allRotations(state: SimState): Rotation[] {
  return state.aircraft.flatMap((aircraft) => rotationsForTail(state, aircraft.tail));
}

/**
 * The failure mode that replaces the Gantt's broken-chain errors (week
 * seven, phase C). Continuity and turn time can no longer go wrong — a
 * rotation starts and ends at its base and is packed with turns built in —
 * so the only way to over-commit an aircraft now is to ask it to fly more
 * than a day's worth, which is a number rather than a shape.
 *
 * Lives here rather than in validateSchedule() because the utilisation
 * model is what defines "too much", and because schedule.ts importing this
 * module would close an import cycle (this module already imports
 * MIN_TURN_MINUTES from there).
 */
export function utilisationProblems(state: SimState): string[] {
  const problems: string[] = [];
  for (const aircraft of state.aircraft) {
    const utilisation = aircraftUtilisation(state, aircraft.tail);
    if (utilisation.legs === 0) continue;

    if (utilisation.share > 1) {
      problems.push(
        `${aircraft.tail} is scheduled for ${Math.round(utilisation.share * 100)}% of a usable day — more than one aircraft can fly. ` +
          `Remove a rotation, or lease another plane.`,
      );
    }
  }
  return problems;
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
