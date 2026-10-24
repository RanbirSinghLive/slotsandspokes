import { classByCode } from './aircraftClasses';
import { marketKey, nextLegId, sameRouteClash, type ScheduleLeg } from './schedule';
import { bankAtOrBefore, bankedArrivalMinute, hubBanksAt, nextBankMinute } from './hubStyle';
import { hourlyRoomProblem, hourOf } from './hours';
import {
  aircraftUtilisation,
  flownEveryOtherDay,
  isLongHaulRoundTrip,
  rotationsForTail,
  scheduledTurnMinutes,
  USABLE_DAY_END_MINUTE,
  USABLE_DAY_START_MINUTE,
  type PoolEffect,
  type Rotation,
} from './utilisation';
import { nightStopStation } from './nightStops';
import type { AogEvent } from './aog';
import type { Aircraft, SimState } from './state';

/**
 * Per-route turn buffer: extra scheduled ground time after every flight on
 * a market, on top of the physical MIN_TURN_MINUTES.
 *
 * Why it exists: the route builder packs every rotation at exactly the
 * minimum turn, so a plane that lands even a few minutes late departs its
 * next leg late, and the lateness compounds down the rest of its day
 * (sim/delays.ts's knock-on cause). A buffer is slack that absorbs a late
 * arrival before it reaches the next departure. It costs aircraft time —
 * every buffered turn is counted in utilisation (sim/utilisation.ts), so
 * a buffered plane fits fewer flights into its day.
 *
 * The buffer belongs to the route the plane just flew, because that's the
 * delay it protects against: a buffer on YUL–YYZ pads the turn *after*
 * each YUL–YYZ flight, whichever direction it went.
 *
 * Changing a buffer re-times the schedule, which is the one part of this
 * that isn't obvious. Every aircraft flying the route has its whole day
 * re-spaced from its first departure. If that pushes a plane past the end
 * of the usable day, one of its rotations moves to another plane of the
 * same class at the same base — the pool the day budget is really kept
 * in. If no plane in that pool has room, the change is refused, and the
 * reason is what the menu shows on the greyed-out button.
 */

/** The choices the route's ring offers, in minutes. */
export const TURN_BUFFER_CHOICES = [0, 15, 30, 45, 60];

/** Same nudge the route builder uses to dodge a same-route clash with another plane. */
const COLLISION_NUDGE_MINUTES = 5;
const MAX_COLLISION_NUDGES = 24;

export type TurnBufferPlan =
  | {
      ok: true;
      schedule: ScheduleLeg[];
      completedToday: string[];
      /** How many rotations had to move to another plane to make room. */
      moved: number;
      /** Change in booked minutes per pool, for the hover preview. */
      effects: PoolEffect[];
    }
  | { ok: false; reason: string };

/** Whether another plane's flight on this leg's route and direction leaves too close to `departMinute` (sim/schedule.ts's sameRouteClash()). */
function collides(schedule: ScheduleLeg[], leg: ScheduleLeg, departMinute: number): boolean {
  return sameRouteClash({ ...leg, departMinute }, schedule.filter((other) => other.tail !== leg.tail)) !== undefined;
}

/**
 * Re-space one aircraft's whole day: within a rotation each leg leaves one
 * block time plus one scheduled turn after the previous one. The day's
 * first rotation keeps its start. Each later one starts as soon after the
 * one before as it has room in every hour its legs use (sim/hours.ts), so
 * the day closes up behind a removed flight, and a longer turn pushes the
 * rest later, but nothing is packed into a full hour.
 *
 * At a banked base a rotation is timed to the waves (sim/hubStyle.ts): it
 * leaves on a wave, and its flight home waits at the last outstation so it
 * lands just before the next wave it can feed. Only where that costs the
 * plane at most half a cycle: a rotation that would skip a wave flies
 * rolling instead. Only the first `bankedRotations` rotations may bank,
 * so planRespace() can lower the count until the day fits. Mutates the
 * legs in `work.schedule`.
 */
function repackTail(work: SimState, tail: string, bankedRotations = Infinity): void {
  const legs = work.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
  if (legs.length === 0) return;
  const base = work.aircraft.find((aircraft) => aircraft.tail === tail)?.baseAirport;
  const banks = hubBanksAt(work, base);

  let cursor = legs[0].departMinute;
  let rotation = 0;
  for (let from = 0; from < legs.length; rotation++) {
    let to = from;
    while (to < legs.length - 1 && !(legs[to + 1].origin === base && legs[to].dest === base)) to++;
    const rotationLegs = legs.slice(from, to + 1);
    const fromBase = rotationLegs[0].origin === base;
    // The first rotation keeps its start; at a banked base, the wave at or before it, since the plane spent the night there.
    const start = (onWaves: boolean) =>
      from === 0 ? (onWaves ? bankAtOrBefore(work, base, cursor) : cursor) : fromBase ? roomyStart(work, legs, from, base, cursor, onWaves) : cursor;
    let times = placeRotation(work, rotationLegs, base, start(false), false);
    if (banks && fromBase && rotation < bankedRotations) {
      const banked = placeRotation(work, rotationLegs, base, start(true), true);
      if (rotationEnd(rotationLegs, banked) - rotationEnd(rotationLegs, times) <= banks.periodMinutes / 2) times = banked;
    }
    rotationLegs.forEach((leg, i) => (leg.departMinute = times[i]));
    const last = rotationLegs[rotationLegs.length - 1];
    cursor = last.departMinute + last.blockMinutes + scheduledTurnMinutes(work, last.origin, last.dest);
    from = to + 1;
  }
}

/**
 * Departure times for one rotation's legs from `start`, each a block and a
 * turn after the one before, nudged off another plane's flight on the
 * same route. With `onWaves`, the flight home to a banked base waits to
 * land just before a wave.
 */
function placeRotation(work: SimState, rotationLegs: ScheduleLeg[], base: string | null | undefined, start: number, onWaves: boolean): number[] {
  const times: number[] = [];
  let at = start;
  for (const leg of rotationLegs) {
    let departMinute = at;
    if (onWaves && leg.dest === base && leg.origin !== base) {
      departMinute = bankedArrivalMinute(work, base, departMinute + leg.blockMinutes) - leg.blockMinutes;
    }
    for (let nudge = 0; nudge < MAX_COLLISION_NUDGES && collides(work.schedule, leg, departMinute); nudge++) {
      departMinute += COLLISION_NUDGE_MINUTES;
    }
    times.push(departMinute);
    at = departMinute + leg.blockMinutes + scheduledTurnMinutes(work, leg.origin, leg.dest);
  }
  return times;
}

function rotationEnd(rotationLegs: ScheduleLeg[], times: number[]): number {
  return times[times.length - 1] + rotationLegs[rotationLegs.length - 1].blockMinutes;
}

/**
 * The earliest start from `cursor` (on a wave when `onWaves`) for the
 * rotation beginning at `legs[from]` that has room in every hour its legs
 * would use, searched like the route planner's (sim/rotations.ts): each
 * try clears the full hour it hit. The earliest start at all when no hour
 * fits before the day ends: an over-full hour congests, it doesn't stop
 * the re-spacing.
 */
function roomyStart(work: SimState, legs: ScheduleLeg[], from: number, base: string | null | undefined, cursor: number, onWaves: boolean): number {
  let to = from;
  while (to < legs.length - 1 && legs[to].dest !== base) to++;
  const rotation = legs.slice(from, to + 1);
  const wave = (minute: number) => (onWaves ? nextBankMinute(work, base, minute) : minute);
  const packedFrom = (start: number) => {
    let at = start;
    return rotation.map((leg) => {
      if (onWaves && leg.dest === base) at = bankedArrivalMinute(work, base, at + leg.blockMinutes) - leg.blockMinutes;
      const packed = { origin: leg.origin, dest: leg.dest, departMinute: at, blockMinutes: leg.blockMinutes };
      at += leg.blockMinutes + scheduledTurnMinutes(work, leg.origin, leg.dest);
      return packed;
    });
  };
  const earliest = wave(cursor);
  const cache = new Map();
  let start = earliest;
  for (let tries = 0; tries < 24; tries++) {
    const packed = packedFrom(start);
    const last = packed[packed.length - 1];
    if (last.departMinute + last.blockMinutes > USABLE_DAY_END_MINUTE) break;
    const problem = hourlyRoomProblem(work, packed, cache, rotation);
    if (!problem) return start;
    start = wave(start + Math.max(COLLISION_NUDGE_MINUTES, (hourOf(problem.minute) + 1) * 60 - (problem.minute % 1440)));
  }
  return earliest;
}

/**
 * Re-space a tail, timing as many of its rotations to its banked base's
 * waves as its day can take: all of them if they fit, else one fewer at a
 * time, down to none (rolling). Only a day that doesn't fit even rolling
 * is left for planRespace() to move rotations off.
 */
function repackFitting(work: SimState, tail: string): void {
  const legs = work.schedule.filter((leg) => leg.tail === tail);
  const original = legs.map((leg) => leg.departMinute);
  repackTail(work, tail);
  if (tailFits(work, tail)) return;
  const base = work.aircraft.find((aircraft) => aircraft.tail === tail)?.baseAirport;
  if (!hubBanksAt(work, base)) return;
  for (let banked = rotationsForTail(work, tail).length - 1; banked >= 0; banked--) {
    // Each try starts from the times the day had, not the last try's.
    legs.forEach((leg, i) => (leg.departMinute = original[i]));
    repackTail(work, tail, banked);
    if (tailFits(work, tail)) return;
  }
}

/** Whether this tail's day, as currently scheduled, ends inside the usable day. */
export function tailFits(work: SimState, tail: string): boolean {
  const legs = work.schedule.filter((leg) => leg.tail === tail);
  if (legs.length === 0) return true;
  // A long-haul round trip is allowed to run round the clock (see
  // isLongHaulRoundTrip()); its utilisation already counts as one full day.
  const clockMinutes = legs.reduce((total, leg) => total + leg.blockMinutes + scheduledTurnMinutes(work, leg.origin, leg.dest), 0);
  if (isLongHaulRoundTrip(legs.length, clockMinutes, flownEveryOtherDay(legs))) return true;
  const lastArrival = Math.max(...legs.map((leg) => leg.departMinute + leg.blockMinutes));
  // Both the clock and the budget: the day's last flight has to land by
  // 22:00, and the plane can't be booked past 100% of its usable day
  // (sim/utilisation.ts, which also counts the turn after that last
  // flight). Checking only the clock let cover load a plane the alert
  // strip then flagged as over-booked.
  return lastArrival <= USABLE_DAY_END_MINUTE && aircraftUtilisation(work, tail).share <= 1;
}

/**
 * A rotation partway through being flown today can't move: its plane is
 * already away from base on it, and would be stranded wherever it landed.
 */
function isInProgress(state: SimState, rotation: Rotation): boolean {
  const flown = (leg: ScheduleLeg) =>
    state.completedToday.includes(leg.legId) ||
    state.cancelledToday.includes(leg.legId) ||
    state.activeFlights.some((flight) => flight.legId === leg.legId);
  const airborne = rotation.legs.some((leg) => state.activeFlights.some((flight) => flight.legId === leg.legId));
  return airborne || (rotation.legs.some(flown) && !rotation.legs.every(flown));
}

/**
 * The planes that can take a rotation off `from`: the same class at the
 * same base, least-worked first.
 */
function coverCandidates(state: SimState, work: SimState, from: Aircraft): Aircraft[] {
  return state.aircraft
    // A plane grounded by an AOG (sim/aog.ts) can't take anyone's flying,
    // nor can one going back to the lessor or moving to another base.
    .filter(
      (a) =>
        a.tail !== from.tail &&
        a.typeCode === from.typeCode &&
        a.baseAirport === from.baseAirport &&
        a.returningOnDay === undefined &&
        a.rebase === undefined &&
        !state.aogs.some((event) => event.tail === a.tail) &&
        nightStopStation(state, a.tail) === null,
    )
    .sort((a, b) => aircraftUtilisation(work, a.tail).minutes - aircraftUtilisation(work, b.tail).minutes);
}

/**
 * Move `rotation` off `fromTail` onto another plane of the same class
 * based at the same airport, appended after that plane's own day. Tries
 * the least-worked plane first. Returns the moved legs (with their new
 * ids), or null, with nothing changed, when none of them has room.
 */
function rehome(work: SimState, state: SimState, rotation: Rotation, fromTail: string): ScheduleLeg[] | null {
  const from = state.aircraft.find((a) => a.tail === fromTail);
  if (!from || !from.baseAirport) return null;
  // A night stop's half starts or ends away from base, and a plane on a
  // night stop ends its day away (sim/nightStops.ts): neither can be
  // handed on or added behind.
  if (rotation.legs[0].origin !== from.baseAirport || rotation.legs[rotation.legs.length - 1].dest !== from.baseAirport) return null;

  const candidates = coverCandidates(state, work, from);

  // Flown or cancelled already today: either way, done for today.
  const wasHandledToday = rotation.legs.every(
    (leg) => state.completedToday.includes(leg.legId) || state.cancelledToday.includes(leg.legId),
  );

  for (const target of candidates) {
    const targetLegs = work.schedule.filter((leg) => leg.tail === target.tail);
    const lastLeg = targetLegs.reduce<ScheduleLeg | null>(
      (latest, leg) => (!latest || leg.departMinute > latest.departMinute ? leg : latest),
      null,
    );
    // Start after the target's own last flight and its turn, or at the
    // opening of the usable day on a plane with nothing scheduled;
    // repackTail() below then spaces the moved legs properly.
    let startMinute = lastLeg
      ? lastLeg.departMinute + lastLeg.blockMinutes + scheduledTurnMinutes(work, lastLeg.origin, lastLeg.dest)
      : USABLE_DAY_START_MINUTE;

    const moved: ScheduleLeg[] = [];
    for (const leg of rotation.legs) {
      const copy: ScheduleLeg = { ...leg, tail: target.tail, legId: nextLegId(target.tail, work.schedule), departMinute: startMinute };
      startMinute += 1; // keeps the moved legs in order until repackTail() spaces them
      work.schedule.push(copy);
      moved.push(copy);
    }
    repackTail(work, target.tail);

    if (tailFits(work, target.tail)) {
      // A rotation already flown (or cancelled) today under its old leg
      // ids mustn't fly today under its new ones.
      if (wasHandledToday) work.completedToday.push(...moved.map((leg) => leg.legId));
      return moved;
    }

    work.schedule = work.schedule.filter((leg) => !moved.includes(leg));
    repackTail(work, target.tail);
  }
  return null;
}

/** Booked minutes per base+class pool, for working out the preview's effects. */
function pooledMinutes(state: SimState): Map<string, number> {
  const minutes = new Map<string, number>();
  for (const aircraft of state.aircraft) {
    if (!aircraft.baseAirport) continue;
    const key = `${aircraft.baseAirport}|${aircraft.typeCode}`;
    minutes.set(key, (minutes.get(key) ?? 0) + aircraftUtilisation(state, aircraft.tail).minutes);
  }
  return minutes;
}

/**
 * Re-space every tail in `affectedTails` inside `work` (a copy of `state`
 * with the new setting already applied), moving rotations to other planes
 * in the same pool where a day overflows, and report what that does to the
 * pools. Shared by every setting that changes scheduled ground time: a
 * route's turn buffer (below) and a hub's style (sim/hubs.ts).
 */
export function planRespace(state: SimState, work: SimState, affectedTails: string[]): TurnBufferPlan {
  let moved = 0;

  for (const tail of affectedTails) {
    repackFitting(work, tail);

    while (!tailFits(work, tail)) {
      const aircraft = state.aircraft.find((x) => x.tail === tail);
      const className = classByCode(aircraft?.typeCode ?? '')?.name ?? 'aircraft';
      const base = aircraft?.baseAirport ?? '?';
      const noRoom =
        `Not enough spare ${className} time at ${base}: ${tail}'s day would run past 22:00, ` +
        `and no other ${className} based at ${base} has room for one of its rotations. ` +
        `Lease another ${className} at ${base} (tap ${base}, then Plane), or remove a flight.`;

      const rotations = rotationsForTail(work, tail);
      // Moving the only rotation would just move the problem.
      if (rotations.length <= 1) return { ok: false, reason: noRoom };
      const movable = rotations.filter((rotation) => !isInProgress(state, rotation));
      if (movable.length === 0) return { ok: false, reason: noRoom };

      // The latest one, so the plane keeps the start of its day.
      const toMove = movable.reduce((latest, rotation) => (rotation.departMinute > latest.departMinute ? rotation : latest));
      work.schedule = work.schedule.filter((leg) => !toMove.legs.includes(leg));
      if (!rehome(work, state, toMove, tail)) return { ok: false, reason: noRoom };
      moved += 1;
      repackFitting(work, tail);
    }
  }

  const before = pooledMinutes(state);
  const after = pooledMinutes(work);
  const effects: PoolEffect[] = [];
  for (const [poolKey, minutes] of after) {
    const delta = minutes - (before.get(poolKey) ?? 0);
    if (delta === 0) continue;
    const [base, classCode] = poolKey.split('|');
    effects.push({ base, classCode, minutes: delta });
  }

  return { ok: true, schedule: work.schedule, completedToday: work.completedToday, moved, effects };
}

/**
 * Move as many of `rotations` (in the order given — put the ones that
 * matter most first) off `fromTail` onto other planes in its pool as
 * fit, straight into `state`. What doesn't fit stays where it was. Used by
 * AOG cover (sim/aog.ts), where the plane they're leaving is grounded.
 *
 * Cover is for the days the plane is out, so it never re-times anyone's
 * timetable: each rotation keeps its leg ids and goes into a gap in
 * another plane's day, at its own times when the gap is there, else at
 * the nearest start that fits around that plane's flights (which stay
 * where they are), lands by 22:00 and has room in every hour it uses.
 * Returns how many moved, the ids of the legs that did, and the time each
 * was scheduled at before, so handBackCover() can restore them exactly.
 */
export function coverRotations(
  state: SimState,
  fromTail: string,
  rotations: Rotation[],
): { covered: number; movedLegIds: string[]; scheduledAt: Record<string, number> } {
  const from = state.aircraft.find((a) => a.tail === fromTail);
  let covered = 0;
  const movedLegIds: string[] = [];
  const scheduledAt: Record<string, number> = {};
  if (!from || !from.baseAirport) return { covered, movedLegIds, scheduledAt };
  for (const rotation of rotations) {
    const ids = new Set(rotation.legs.map((leg) => leg.legId));
    const legs = state.schedule.filter((leg) => leg.tail === fromTail && ids.has(leg.legId));
    if (legs.length === 0 || isInProgress(state, rotation)) continue;
    // A night stop's half starts or ends away from base (sim/nightStops.ts): it can't be handed on.
    if (legs[0].origin !== from.baseAirport || legs[legs.length - 1].dest !== from.baseAirport) continue;
    for (const host of coverCandidates(state, state, from)) {
      const delta = coverShift(state, legs, host.tail);
      if (delta === null) continue;
      for (const leg of legs) {
        scheduledAt[leg.legId] = leg.departMinute;
        leg.tail = host.tail;
        leg.departMinute += delta;
        movedLegIds.push(leg.legId);
      }
      covered += 1;
      break;
    }
  }
  return { covered, movedLegIds, scheduledAt };
}

/** How far to move cover with this little room before giving up on a plane: most of the usable day. */
const COVER_SHIFT_LIMIT_MINUTES = 16 * 60;

/**
 * The shift that fits `legs` (one rotation, still on its own plane) into
 * a gap in `hostTail`'s day without moving any of the host's flights: 0
 * when it fits at its own times, else the smallest shift in 5-minute
 * steps, earlier first on a tie. Null when none fits. A long-haul round
 * trip runs round the clock and only ever moves at its own times.
 */
function coverShift(state: SimState, legs: ScheduleLeg[], hostTail: string): number | null {
  const hostLegs = state.schedule.filter((leg) => leg.tail === hostTail);
  const busy = (leg: ScheduleLeg, shift: number) => ({ from: leg.departMinute + shift, to: leg.departMinute + shift + leg.blockMinutes + scheduledTurnMinutes(state, leg.origin, leg.dest) });
  const hostBusy = hostLegs.map((leg) => busy(leg, 0));
  // Its booked time doesn't change wherever it goes, so whether the host's day has room for it at all is one check.
  const withIt = { ...state, schedule: [...state.schedule.filter((leg) => !legs.includes(leg)), ...legs.map((leg) => ({ ...leg, tail: hostTail }))] };
  if (aircraftUtilisation(withIt, hostTail).share > 1) return null;
  const clockMinutes = legs.reduce((total, leg) => total + leg.blockMinutes + scheduledTurnMinutes(state, leg.origin, leg.dest), 0);
  const longHaul = isLongHaulRoundTrip(legs.length, clockMinutes, flownEveryOtherDay(legs));
  const others = state.schedule.filter((leg) => !legs.includes(leg));
  const cache = new Map();

  const fits = (shift: number): boolean => {
    if (!longHaul) {
      if (legs[0].departMinute + shift < USABLE_DAY_START_MINUTE) return false;
      const last = legs[legs.length - 1];
      if (last.departMinute + shift + last.blockMinutes > USABLE_DAY_END_MINUTE) return false;
    }
    // Clear of every host flight and its turn, on this day and across midnight (a host's long-haul flight back is stored a day early).
    for (const leg of legs) {
      const mine = busy(leg, shift);
      for (const day of [-24 * 60, 0, 24 * 60]) {
        if (hostBusy.some((other) => other.from < mine.to + day && mine.from + day < other.to)) return false;
      }
    }
    if (shift === 0) return true;
    // Moved off its own times: room in the hours it now uses (its own old movements count as room), and clear of your other flights on its routes.
    const moved = legs.map((leg) => ({ ...leg, departMinute: leg.departMinute + shift }));
    if (hourlyRoomProblem(state, moved, cache, legs)) return false;
    return !moved.some((leg) => sameRouteClash(leg, others));
  };

  if (fits(0)) return 0;
  if (longHaul) return null;
  for (let distance = COLLISION_NUDGE_MINUTES; distance <= COVER_SHIFT_LIMIT_MINUTES; distance += COLLISION_NUDGE_MINUTES) {
    if (fits(-distance)) return -distance;
    if (fits(distance)) return distance;
  }
  return null;
}

/**
 * A repaired plane takes back the flying that was moved off it: each
 * moved leg back on it at the time it was scheduled before the AOG, so
 * the timetable is exactly the player's again. A rotation the player has
 * changed meanwhile so it no longer fits there goes back as AOG cover
 * would place it, the repaired plane first; one that fits nowhere stays
 * where it is. A save from before cover kept times has no record of
 * them, and its legs go back the same way, nearest the time they have.
 */
export function handBackCover(state: SimState, event: AogEvent): void {
  const moved = new Set(event.movedLegIds);
  const returning = state.aircraft.find((a) => a.tail === event.tail);
  if (!returning) return;
  const hosts = new Set(state.schedule.filter((leg) => moved.has(leg.legId)).map((leg) => leg.tail));
  for (const host of hosts) {
    for (const rotation of rotationsForTail(state, host)) {
      const legs = rotation.legs.filter((leg) => moved.has(leg.legId));
      if (legs.length === 0 || isInProgress(state, rotation)) continue;
      const original = legs.map((leg) => event.scheduledAt?.[leg.legId]);
      const shift = original[0] === undefined ? null : original[0] - legs[0].departMinute;
      // The whole rotation went with one shift, so one shift brings it all back.
      const restorable = shift !== null && legs.every((leg, i) => original[i] === leg.departMinute + shift);
      if (restorable) {
        for (const leg of legs) leg.departMinute += shift;
        const fitsHome = coverShift(state, legs, returning.tail) === 0;
        if (fitsHome) {
          for (const leg of legs) leg.tail = returning.tail;
          continue;
        }
        for (const leg of legs) leg.departMinute -= shift;
      }
      // Least-worked first, which the plane just back is.
      coverRotations(state, host, [rotation]);
    }
  }
}

/** A copy of `state` safe for planRespace() to re-time: its own schedule and today's handled list. */
export function workingCopy(state: SimState, overrides: Partial<SimState>): SimState {
  return {
    ...state,
    schedule: state.schedule.map((leg) => ({ ...leg })),
    completedToday: [...state.completedToday],
    ...overrides,
  };
}

/**
 * Put a successful plan into effect. A plane with nothing scheduled that
 * just took a moved rotation starts its day at its base — the same
 * placement the route builder's commitRotation() gives a plane's first
 * rotation, and for the same reason: otherwise a plane parked elsewhere
 * would never reach its legs.
 */
export function applyRespace(state: SimState, plan: Extract<TurnBufferPlan, { ok: true }>): void {
  for (const aircraft of state.aircraft) {
    const hadNothing = !state.schedule.some((leg) => leg.tail === aircraft.tail);
    const hasSomething = plan.schedule.some((leg) => leg.tail === aircraft.tail);
    if (hadNothing && hasSomething && aircraft.status === 'ground' && aircraft.baseAirport) {
      aircraft.atAirport = aircraft.baseAirport;
    }
  }
  state.schedule = plan.schedule;
  state.completedToday = plan.completedToday;
}

/**
 * Work out what setting this market's buffer to `bufferMinutes` would do,
 * on a copy — nothing here touches `state`. The same plan drives the
 * button's enabled state, its hover preview and the change itself, so the
 * three can't disagree.
 */
export function planTurnBufferChange(state: SimState, a: string, b: string, bufferMinutes: number): TurnBufferPlan {
  const key = marketKey(a, b);
  const settings = state.routeSettings[key];
  if (!settings) return { ok: false, reason: 'Nothing flies this route.' };

  const work = workingCopy(state, {
    routeSettings: { ...state.routeSettings, [key]: { ...settings, turnBufferMinutes: bufferMinutes } },
  });
  const affectedTails = [...new Set(state.schedule.filter((leg) => marketKey(leg.origin, leg.dest) === key).map((leg) => leg.tail))];
  return planRespace(state, work, affectedTails);
}

/** Set this market's buffer and re-time the schedule to match. */
export function applyTurnBufferChange(
  state: SimState,
  a: string,
  b: string,
  bufferMinutes: number,
): { ok: true; moved: number } | { ok: false; reason: string } {
  const plan = planTurnBufferChange(state, a, b, bufferMinutes);
  if (!plan.ok) return plan;
  applyRespace(state, plan);
  state.routeSettings[marketKey(a, b)].turnBufferMinutes = bufferMinutes;
  return { ok: true, moved: plan.moved };
}
