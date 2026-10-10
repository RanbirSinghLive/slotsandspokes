import { projectGroundedDay, type ProjectedLeg } from './cascade';
import { dayStartMinute } from './clock';
import { LATE_MINUTES, mandatedLeg, mandateIsActive, mandatesOf } from './mandates';
import { marketKey, type ScheduleLeg } from './schedule';
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
