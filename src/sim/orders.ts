import { LATE_MINUTES, mandateIsActive, mandatedLeg, mandatesOf, type Mandate } from './mandates';
import { dayIndex, minuteOfDayToTimeString } from './clock';
import {
  callsNeeded,
  cancelRotation,
  cancellableRotations,
  previewCancelRotation,
  revenuePerFlight,
  swapRotation,
  swapTargets,
  type Call,
} from './controller';
import type { ProjectedLeg } from './cascade';
import { projectGroundedDay } from './cascade';
import type { SimState } from './state';

/**
 * Standing orders: what the controller does about a late plane when the
 * player isn't asked (sim/controller.ts has the calls and the actions).
 *
 * - `ask`: stop and let the player decide, as before.
 * - `protect`: never raised and never cancelled for: the plane takes its
 *   delay and the curfew does what it does.
 * - `auto`: the cheaper of a swap or a cancel is made without a stop, only
 *   when it clearly pays, the way a sensible player would make it.
 *
 * A plane's own order beats the fleet default, which beats `ask`. Setting
 * these is the slow-scale decision (how much of the day-to-day to hand
 * off); the call is the fast-scale one it replaces.
 */
export type CallOrder = 'ask' | 'protect' | 'auto';
export const CALL_ORDERS: CallOrder[] = ['ask', 'protect', 'auto'];

const LOG_KEPT = 12;

export function fleetOrder(state: SimState): CallOrder {
  return state.callOrders?.fleet ?? 'ask';
}

export function orderFor(state: SimState, tail: string): CallOrder {
  return state.callOrders?.tails?.[tail] ?? fleetOrder(state);
}

/** Sets the fleet default (`tail` null) or one plane's order; a plane's order equal to the fleet default is dropped. */
export function setOrder(state: SimState, tail: string | null, order: CallOrder): void {
  const orders = (state.callOrders ??= {});
  if (tail === null) {
    orders.fleet = order;
    return;
  }
  const tails = (orders.tails ??= {});
  if (order === fleetOrder(state)) delete tails[tail];
  else tails[tail] = order;
}

/** Whether any plane could be on `auto`, so the minute step does nothing at all for a game that never set one. */
function anyAuto(state: SimState): boolean {
  const orders = state.callOrders;
  if (!orders) return false;
  return orders.fleet === 'auto' || Object.values(orders.tails ?? {}).includes('auto');
}

function atRiskEvent(state: SimState, projection: ProjectedLeg[]): Mandate | undefined {
  return mandatesOf(state).find(
    (mandate) =>
      mandateIsActive(state, mandate) &&
      projection.some((p) => p.leg === mandatedLeg(state, mandate) && p.lateMinutes > LATE_MINUTES),
  );
}

function log(state: SimState, tail: string, text: string): void {
  const entries = (state.orderLog ??= []);
  entries.push({ day: dayIndex(state), tail, text });
  if (entries.length > LOG_KEPT) entries.splice(0, entries.length - LOG_KEPT);
}

/** Hand a rotation to an idle plane when that saves a curfew cancel for less than the rotation earns. */
function trySwap(state: SimState, tail: string): string | null {
  let best: { legId: string; toTail: string; saved: number; fee: number } | null = null;
  for (const rotation of cancellableRotations(state, tail)) {
    const targets = swapTargets(state, rotation.legs[0].legId);
    if (!Array.isArray(targets)) continue;
    const worth = rotation.legs.reduce((sum, leg) => sum + revenuePerFlight(state, leg), 0);
    for (const target of targets) {
      const saved = target.curfewCancelsBefore - target.curfewCancelsAfter;
      if (target.refusal !== null || saved <= 0 || target.fee > worth || target.fee > state.cash) continue;
      if (!best || saved > best.saved || (saved === best.saved && target.fee < best.fee)) {
        best = { legId: rotation.legs[0].legId, toTail: target.tail, saved, fee: target.fee };
      }
    }
  }
  if (!best) return null;
  const done = swapRotation(state, best.legId, best.toTail);
  return done.ok ? done.message : null;
}

/** Cancel the rotation whose loss the day recovers most from, when the flights it saves are worth more than it gives up. */
function tryCancel(state: SimState, tail: string, call: Call, projection: ProjectedLeg[]): string | null {
  const event = call.kind === 'event' ? atRiskEvent(state, projection) : undefined;
  let best: { legId: string; score: number } | null = null;
  for (const rotation of cancellableRotations(state, tail)) {
    const first = rotation.legs[0];
    const preview = previewCancelRotation(state, first.legId);
    if (!preview.ok || preview.mandatedLegs > 0) continue;
    let score: number;
    if (call.kind === 'curfew') {
      if (preview.flightsRescued <= 0) continue;
      score =
        preview.revenueRescued > 0 || preview.revenueGivenUp > 0
          ? preview.revenueRescued - preview.revenueGivenUp
          : preview.flightsRescued - preview.flightsCancelled;
    } else {
      const leg = event && mandatedLeg(state, event);
      const after = leg && preview.after.find((p) => p.leg === leg);
      if (!event || !after || after.cancelled || after.lateMinutes > LATE_MINUTES) continue;
      score = event.penalty - preview.revenueGivenUp;
    }
    if (score > 0 && (!best || score > best.score)) best = { legId: first.legId, score };
  }
  if (!best) return null;
  const done = cancelRotation(state, best.legId);
  return done.ok ? done.message : null;
}

/**
 * Each minute: for every waiting plane on `auto` whose day is breaking,
 * make the swap or cancel that pays. A merely late plane (no curfew
 * cancel, no failing priority flight) is left alone: a delay is not worth
 * a cancellation's -80 NPS.
 */
export function applyStandingOrders(state: SimState): void {
  if (!anyAuto(state)) return;
  for (const call of callsNeeded(state, true)) {
    if (orderFor(state, call.tail) !== 'auto' || call.kind === 'late') continue;
    const projection = projectGroundedDay(state, call.tail);
    const stamp = (leg: string): string => {
      const found = state.schedule.find((l) => l.legId === leg);
      return found ? `${minuteOfDayToTimeString(found.departMinute)} ${found.origin}–${found.dest}` : '';
    };
    const swapped = call.kind === 'curfew' ? trySwap(state, call.tail) : null;
    if (swapped) {
      log(state, call.tail, `${swapped} · saved curfew`);
      continue;
    }
    const before = state.cancelledToday.length;
    const cancelled = tryCancel(state, call.tail, call, projection);
    if (cancelled) {
      const first = state.cancelledToday[before];
      log(state, call.tail, `${cancelled}${first ? ` · ${stamp(first)}` : ''} · ${call.kind === 'curfew' ? 'saved curfew' : 'saved event'}`);
    }
  }
}
