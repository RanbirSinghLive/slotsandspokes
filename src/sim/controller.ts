import { projectGroundedDay, type ProjectedLeg } from './cascade';
import { dayStartMinute } from './clock';
import { LATE_MINUTES, mandatedLeg, mandateIsActive, mandatesOf } from './mandates';
import { MIN_TURN_MINUTES, marketKey, type ScheduleLeg } from './schedule';
import { isAog } from './aog';
import { nightStopStation } from './nightStops';
import { recordCancellation } from './step';
import { rotationsForTail, type Rotation } from './utilisation';
import type { SimState } from './state';

/**
 * Controller actions: what the player can do about a late plane during the
 * day, instead of watching the delay spread (sim/cascade.ts).
 *
 * A flight's delay is rolled once, when it leaves, so nothing can change a
 * flight in the air. The decisions left are about a plane waiting on the
 * ground and the rotations it has not started. The first action is
 * **cancel a rotation**: the curfew (sim/curfew.ts) already cancels the
 * last rotation of a day that has run late, whatever it earns; cancelling
 * a cheaper one earlier resets the plane's day and lets the better one fly.
 *
 * Whole rotations only, from base, as the curfew does: a plane stranded
 * away from base by a half-cancelled rotation would have its next legs
 * cancelled as "out of position" (sim/step.ts).
 *
 * A cancellation costs what any cancellation costs (Completion, -80 NPS,
 * slot fees still paid, a priority flight failed) and gives nothing back:
 * no revenue refund, because the passengers were turned away.
 */

export type CancelRefusal = { ok: false; reason: string };

export type CancelPreview = {
  ok: true;
  /** The rotation's legs, in order. */
  legs: ScheduleLeg[];
  /** Flights the day loses to this choice, before counting any it saves. */
  flightsCancelled: number;
  /** Flights the curfew would have cancelled that now fly (the other side of the trade). */
  flightsRescued: number;
  /** Legs projected late: with nothing done, and after cancelling. */
  lateLegsBefore: number;
  lateLegsAfter: number;
  /** Total minutes projected late across the day's remaining legs. */
  lateMinutesBefore: number;
  lateMinutesAfter: number;
  /** Estimated revenue given up (recent daily revenue per flight on these markets), and the same for flights rescued. */
  revenueGivenUp: number;
  revenueRescued: number;
  /** Priority flights (sim/mandates.ts) among the legs: each fails and is charged its penalty. */
  mandatedLegs: number;
  mandatePenalty: number;
  before: ProjectedLeg[];
  after: ProjectedLeg[];
};

const REVENUE_DAYS = 7;

/** The rotations of `tail` that can be cancelled now: whole, unstarted, with the plane at their origin. */
export function cancellableRotations(state: SimState, tail: string): Rotation[] {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft || aircraft.status !== 'ground') return [];
  const handled = new Set([...state.completedToday, ...state.cancelledToday, ...(state.retimedToday ?? [])]);
  return rotationsForTail(state, tail).filter(
    (rotation) => aircraft.atAirport === rotation.legs[0].origin && rotation.legs.every((leg) => !handled.has(leg.legId)),
  );
}

/** Recent revenue a flight on this leg's market brings in: the market's average day over the flights it has a day. */
function revenuePerFlight(state: SimState, leg: ScheduleLeg): number {
  const history = (state.revenueHistoryByMarket[marketKey(leg.origin, leg.dest)] ?? []).slice(-REVENUE_DAYS);
  if (history.length === 0) return 0;
  const perDay = history.reduce((sum, value) => sum + value, 0) / history.length;
  const flightsADay = state.schedule.filter((l) => marketKey(l.origin, l.dest) === marketKey(leg.origin, leg.dest)).length;
  return flightsADay > 0 ? perDay / flightsADay : 0;
}

function lateTotals(projection: ProjectedLeg[]): { legs: number; minutes: number } {
  const flown = projection.filter((p) => !p.cancelled);
  return { legs: flown.filter((p) => !p.onTime).length, minutes: flown.reduce((sum, p) => sum + Math.max(0, p.lateMinutes), 0) };
}

function findRotation(state: SimState, legId: string): { rotation: Rotation; tail: string } | CancelRefusal {
  const leg = state.schedule.find((l) => l.legId === legId);
  if (!leg) return { ok: false, reason: 'No such flight' };
  const rotation = cancellableRotations(state, leg.tail).find((r) => r.legs[0].legId === legId);
  if (!rotation) return { ok: false, reason: 'Only a rotation not yet started, with the plane at its origin, can be cancelled' };
  return { rotation, tail: leg.tail };
}

/** What cancelling the rotation that starts with `legId` would change for its plane's day, without changing anything. */
export function previewCancelRotation(state: SimState, legId: string): CancelPreview | CancelRefusal {
  const found = findRotation(state, legId);
  if ('ok' in found) return found;
  const { rotation, tail } = found;

  const before = projectGroundedDay(state, tail);
  const after = projectGroundedDay(state, tail, new Set([legId]));
  const cancelledBefore = new Set(before.filter((p) => p.cancelled).map((p) => p.leg.legId));
  if (cancelledBefore.has(legId)) return { ok: false, reason: 'The curfew has already cancelled this rotation' };

  const rescued = after.filter((p) => !p.cancelled && cancelledBefore.has(p.leg.legId)).map((p) => p.leg);
  const lateBefore = lateTotals(before);
  const lateAfter = lateTotals(after);

  const mandates = mandatesOf(state).filter((m) => mandateIsActive(state, m) && rotation.legs.includes(mandatedLeg(state, m)!));
  return {
    ok: true,
    legs: rotation.legs,
    flightsCancelled: rotation.legs.length,
    flightsRescued: rescued.length,
    lateLegsBefore: lateBefore.legs,
    lateLegsAfter: lateAfter.legs,
    lateMinutesBefore: lateBefore.minutes,
    lateMinutesAfter: lateAfter.minutes,
    revenueGivenUp: Math.round(rotation.legs.reduce((sum, leg) => sum + revenuePerFlight(state, leg), 0)),
    revenueRescued: Math.round(rescued.reduce((sum, leg) => sum + revenuePerFlight(state, leg), 0)),
    mandatedLegs: mandates.length,
    mandatePenalty: mandates.reduce((sum, m) => sum + m.penalty, 0),
    before,
    after,
  };
}

/** Cancel the rotation that starts with `legId` today. The plane stays at base for its next one. */
export function cancelRotation(state: SimState, legId: string): { ok: true; message: string } | CancelRefusal {
  const found = findRotation(state, legId);
  if ('ok' in found) return found;
  for (const leg of found.rotation.legs) {
    state.cancelledToday.push(leg.legId);
    recordCancellation(state, leg, 'controller');
  }
  const route = [found.rotation.legs[0].origin, ...found.rotation.legs.map((leg) => leg.dest)].join('–');
  return { ok: true, message: `CNX ${found.tail} · ${route}` };
}

/**
 * **Swap a rotation onto another plane.** The late plane stays put for its
 * next rotation; a plane of the same type and base that is idle at the
 * origin flies this one instead. It only has a target when some plane's
 * day has a gap, so in a tight network the list is empty. The legs change
 * tail for today and go back at the morning rollover (`swappedToday`),
 * so a one-day fix never becomes a permanent re-roster.
 */
export const SWAP_FEE_LEASE_DAYS = 0.25;

export type SwapTarget = {
  tail: string;
  /** Flat fee for towing, fuelling and paperwork, scaled by what the plane leases for. */
  fee: number;
  /** Today's projected late minutes across both planes' remaining legs: as things stand, and after the swap. */
  lateMinutesBefore: number;
  lateMinutesAfter: number;
  /** Flights the curfew would cancel across both planes: as things stand, and after the swap. */
  curfewCancelsBefore: number;
  curfewCancelsAfter: number;
  /** Why this plane can't take it, or null when it can. */
  refusal: string | null;
};

function stateWithLegsOn(state: SimState, legIds: Set<string>, tail: string): SimState {
  return { ...state, schedule: state.schedule.map((leg) => (legIds.has(leg.legId) ? { ...leg, tail } : leg)) };
}

function dayTotals(projections: ProjectedLeg[][]): { minutes: number; cancels: number } {
  const all = projections.flat();
  return { minutes: lateTotals(all).minutes, cancels: all.filter((p) => p.cancelled).length };
}

/** Every same-type, same-base plane of the late plane, each with what taking the rotation would do or why it can't. */
export function swapTargets(state: SimState, legId: string): SwapTarget[] | CancelRefusal {
  const found = findRotation(state, legId);
  if ('ok' in found) return found;
  const { rotation, tail } = found;
  const from = state.aircraft.find((a) => a.tail === tail)!;
  const first = rotation.legs[0];
  if (first.origin !== from.baseAirport || rotation.legs[rotation.legs.length - 1].dest !== from.baseAirport) {
    return { ok: false, reason: 'Only a rotation that starts and ends at base can change plane' };
  }
  const ids = new Set(rotation.legs.map((leg) => leg.legId));
  const handled = new Set([...state.completedToday, ...state.cancelledToday, ...(state.retimedToday ?? [])]);

  const targets: SwapTarget[] = [];
  for (const other of state.aircraft) {
    if (other.tail === tail || other.typeCode !== from.typeCode || other.baseAirport !== from.baseAirport) continue;
    const base: Omit<SwapTarget, 'refusal'> = {
      tail: other.tail,
      fee: Math.round(SWAP_FEE_LEASE_DAYS * other.leaseCostPerDay),
      lateMinutesBefore: 0,
      lateMinutesAfter: 0,
      curfewCancelsBefore: 0,
      curfewCancelsAfter: 0,
    };
    const refuse = (reason: string): void => void targets.push({ ...base, refusal: reason });
    if (isAog(state, other.tail) || state.groundedTails.includes(other.tail)) refuse('Out of service');
    else if (other.status !== 'ground') refuse('In the air');
    else if (other.rebase || nightStopStation(state, other.tail) !== null) refuse('Away from base overnight');
    else if (other.atAirport !== first.origin) refuse(`At ${other.atAirport ?? 'sea'}, not ${first.origin}`);
    else if (
      rotationsForTail(state, other.tail).some(
        (r) => r.legs.some((leg) => !handled.has(leg.legId)) && r.departMinute < rotation.arriveMinute + MIN_TURN_MINUTES && r.arriveMinute + MIN_TURN_MINUTES > rotation.departMinute,
      )
    ) {
      refuse('No gap in its day');
    } else {
      const beforeA = projectGroundedDay(state, tail);
      const beforeB = projectGroundedDay(state, other.tail);
      const swapped = stateWithLegsOn(state, ids, other.tail);
      const afterA = projectGroundedDay(swapped, tail);
      const afterB = projectGroundedDay(swapped, other.tail);
      const before = dayTotals([beforeA, beforeB]);
      const after = dayTotals([afterA, afterB]);
      const target = {
        ...base,
        lateMinutesBefore: before.minutes,
        lateMinutesAfter: after.minutes,
        curfewCancelsBefore: before.cancels,
        curfewCancelsAfter: after.cancels,
      };
      if (afterB.some((p) => p.cancelled && ids.has(p.leg.legId))) targets.push({ ...target, refusal: 'Would miss the curfew too' });
      else if (after.cancels > before.cancels) targets.push({ ...target, refusal: 'Would cost its own flights' });
      else if (after.cancels === before.cancels && after.minutes >= before.minutes) targets.push({ ...target, refusal: 'Saves no time' });
      else targets.push({ ...target, refusal: null });
    }
  }
  return targets.sort((a, b) => Number(a.refusal !== null) - Number(b.refusal !== null) || a.lateMinutesAfter - b.lateMinutesAfter);
}

/** Move the rotation that starts with `legId` to `toTail` for today, for a fee. Handed back at the morning rollover. */
export function swapRotation(state: SimState, legId: string, toTail: string): { ok: true; message: string } | CancelRefusal {
  const targets = swapTargets(state, legId);
  if (!Array.isArray(targets)) return targets;
  const target = targets.find((t) => t.tail === toTail);
  if (!target) return { ok: false, reason: 'No such plane' };
  if (target.refusal) return { ok: false, reason: target.refusal };
  if (state.cash < target.fee) return { ok: false, reason: `Needs $${target.fee.toLocaleString()} on hand.` };
  const found = findRotation(state, legId);
  if ('ok' in found) return found;

  state.cash -= target.fee;
  state.todayCost += target.fee;
  state.todayCostByCategory.maintenance += target.fee;
  state.todayMargin -= target.fee;
  const swapped = (state.swappedToday ??= []);
  for (const leg of found.rotation.legs) {
    if (!swapped.some((entry) => entry.legId === leg.legId)) swapped.push({ legId: leg.legId, fromTail: leg.tail });
    leg.tail = toTail;
  }
  const route = [found.rotation.legs[0].origin, ...found.rotation.legs.map((leg) => leg.dest)].join('–');
  return { ok: true, message: `SWAP ${found.tail} → ${toTail} · ${route}` };
}

/** Morning rollover: swapped flying goes back to the plane it was scheduled on. */
export function handBackSwaps(state: SimState): void {
  for (const { legId, fromTail } of state.swappedToday ?? []) {
    const leg = state.schedule.find((l) => l.legId === legId);
    if (leg) leg.tail = fromTail;
  }
  state.swappedToday = [];
}

/**
 * Planes whose day is about to break while they wait, for the pause alert
 * (ui/callAlert.ts): the thing to decide, worst first.
 *
 * - `curfew`: the 22:00 curfew will cancel a rotation (sim/curfew.ts).
 * - `event`: a priority flight (sim/mandates.ts) is projected more than
 *   LATE_MINUTES late, so it will fail.
 * - `late`: a flight is projected LATE_CALL_MINUTES or more late.
 *
 * Only planes with something they can cancel are listed, and only once a
 * flight is overdue by OVERDUE_MINUTES, so a plane a few minutes behind
 * doesn't stop the game.
 */
export type CallKind = 'curfew' | 'event' | 'late';
export type Call = { tail: string; kind: CallKind };

export const LATE_CALL_MINUTES = 90;
const OVERDUE_MINUTES = 20;
const KIND_ORDER: CallKind[] = ['curfew', 'event', 'late'];

export function callsNeeded(state: SimState): Call[] {
  const dayStart = dayStartMinute(state);
  const handled = new Set([...state.completedToday, ...state.cancelledToday, ...(state.retimedToday ?? [])]);
  const mandatedIds = new Set<string>();
  for (const mandate of mandatesOf(state)) {
    if (!mandateIsActive(state, mandate)) continue;
    const leg = mandatedLeg(state, mandate);
    if (leg) mandatedIds.add(leg.legId);
  }

  const calls: Call[] = [];
  for (const aircraft of state.aircraft) {
    if (aircraft.status !== 'ground') continue;
    const overdue = state.schedule.some(
      (leg) => leg.tail === aircraft.tail && !handled.has(leg.legId) && state.simMinute - (dayStart + leg.departMinute) >= OVERDUE_MINUTES,
    );
    if (!overdue || cancellableRotations(state, aircraft.tail).length === 0) continue;
    const projection = projectGroundedDay(state, aircraft.tail);
    let kind: CallKind | null = null;
    if (projection.some((p) => p.cancelled)) kind = 'curfew';
    else if (projection.some((p) => mandatedIds.has(p.leg.legId) && p.lateMinutes > LATE_MINUTES)) kind = 'event';
    else if (projection.some((p) => p.lateMinutes >= LATE_CALL_MINUTES)) kind = 'late';
    if (kind) calls.push({ tail: aircraft.tail, kind });
  }
  return calls.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
