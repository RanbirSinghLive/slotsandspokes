import { acceptMandate, LATE_MINUTES, mandateIsActive, mandatedLeg, mandatesOf, type Mandate } from './mandates';
import { marketKey } from './schedule';
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
 * Route priority: what the controller does about a late plane when the
 * player isn't asked (sim/controller.ts has the calls and the actions).
 *
 * The player says once, per route, what matters:
 * - `keep`: never cancelled by the controller; the plane takes its delay.
 * - `normal`: the default.
 * - `expendable`: the first to go when a day breaks.
 *
 * The fleet policy is `priority` (the sim settles a breaking day by those
 * ranks, with no stop) or `ask` (stop and let the player decide). Setting
 * the ranks is the slow-scale decision; the call it replaces is the
 * fast-scale one.
 */
export type RoutePriority = 'keep' | 'normal' | 'expendable';
export const ROUTE_PRIORITIES: RoutePriority[] = ['normal', 'keep', 'expendable'];
export type CallPolicy = 'priority' | 'ask';

const LOG_KEPT = 12;
const RANK: Record<RoutePriority, number> = { expendable: 0, normal: 1, keep: 2 };

export function routePriority(state: SimState, a: string, b: string): RoutePriority {
  return state.routePriority?.[marketKey(a, b)] ?? 'normal';
}

export function setRoutePriority(state: SimState, a: string, b: string, priority: RoutePriority): void {
  const ranks = (state.routePriority ??= {});
  if (priority === 'normal') delete ranks[marketKey(a, b)];
  else ranks[marketKey(a, b)] = priority;
}

/** The next priority in the cycle normal → keep → expendable → normal, for one-tap icons. */
export function nextRoutePriority(priority: RoutePriority): RoutePriority {
  return ROUTE_PRIORITIES[(ROUTE_PRIORITIES.indexOf(priority) + 1) % ROUTE_PRIORITIES.length];
}

/** Absent means `priority`, except a save that explicitly chose ask. */
export function callPolicy(state: SimState): CallPolicy {
  if (state.callPolicy) return state.callPolicy;
  const legacy = (state as { callOrders?: { fleet?: string } }).callOrders;
  return legacy?.fleet === 'ask' ? 'ask' : 'priority';
}

export function setCallPolicy(state: SimState, policy: CallPolicy): void {
  state.callPolicy = policy;
}

/** A rotation is as protected as its most protected leg, and expendable only when every leg is. */
export function rotationPriority(state: SimState, rotation: { legs: { origin: string; dest: string }[] }): RoutePriority {
  const ranks = rotation.legs.map((leg) => routePriority(state, leg.origin, leg.dest));
  if (ranks.includes('keep')) return 'keep';
  return ranks.every((rank) => rank === 'expendable') ? 'expendable' : 'normal';
}

/** Whether any route out of this airport is marked keep, so a storm there isn't waived. */
export function airportHasKeepRoute(state: SimState, iata: string): boolean {
  return state.schedule.some((leg) => (leg.origin === iata || leg.dest === iata) && routePriority(state, leg.origin, leg.dest) === 'keep');
}

function atRiskEvent(state: SimState, projection: ProjectedLeg[]): Mandate | undefined {
  return mandatesOf(state).find(
    (mandate) =>
      mandateIsActive(state, mandate) &&
      projection.some((p) => p.leg === mandatedLeg(state, mandate) && p.lateMinutes > LATE_MINUTES),
  );
}

function log(state: SimState, a: string, b: string, text: string): void {
  const entries = (state.priorityLog ??= []);
  entries.push({ day: dayIndex(state), a, b, text });
  if (entries.length > LOG_KEPT) entries.splice(0, entries.length - LOG_KEPT);
}

function stamp(state: SimState, legId: string): string {
  const found = state.schedule.find((l) => l.legId === legId);
  return found ? `${minuteOfDayToTimeString(found.departMinute)} ${found.origin}–${found.dest}` : '';
}

/** Hand a rotation to an idle plane when that saves a curfew cancel for less than the rotation earns. */
function trySwap(state: SimState, tail: string): { message: string; legId: string } | null {
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
  return done.ok ? { message: done.message, legId: best.legId } : null;
}

/**
 * Cancel the lowest-priority rotation that recovers the day. Keep routes are
 * never cut. An expendable rotation goes whenever its loss saves a flight;
 * a normal one only when the flights it saves are worth more than it gives
 * up. Among equals, the cut that recovers most.
 */
function tryCancel(state: SimState, tail: string, call: Call, projection: ProjectedLeg[]): { message: string; legId: string } | null {
  const event = call.kind === 'event' ? atRiskEvent(state, projection) : undefined;
  let best: { legId: string; rank: number; score: number } | null = null;
  for (const rotation of cancellableRotations(state, tail)) {
    const priority = rotationPriority(state, rotation);
    if (priority === 'keep') continue;
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
      if (priority === 'expendable') score = Math.max(score, 1e-6);
    } else {
      const leg = event && mandatedLeg(state, event);
      const after = leg && preview.after.find((p) => p.leg === leg);
      if (!event || !after || after.cancelled || after.lateMinutes > LATE_MINUTES) continue;
      score = event.penalty - preview.revenueGivenUp;
      if (priority === 'expendable') score = Math.max(score, 1e-6);
    }
    const rank = RANK[priority];
    if (score > 0 && (!best || rank < best.rank || (rank === best.rank && score > best.score))) best = { legId: first.legId, rank, score };
  }
  if (!best) return null;
  const done = cancelRotation(state, best.legId);
  return done.ok ? { message: done.message, legId: best.legId } : null;
}

/** An offered request on a route marked keep is taken without a card, when its flight is on the schedule. */
function acceptKeepEvents(state: SimState): void {
  for (const mandate of mandatesOf(state)) {
    if (mandate.status !== 'offered' || routePriority(state, mandate.origin, mandate.dest) !== 'keep' || !mandatedLeg(state, mandate)) continue;
    if (acceptMandate(state, mandate.id).ok) log(state, mandate.origin, mandate.dest, `Request accepted · ${mandate.origin}–${mandate.dest}`);
  }
}

/**
 * Every few minutes, with the `priority` policy: take requests offered on
 * keep routes, and for every waiting plane whose day is breaking make the
 * swap or cancel the ranks and the money call for. A merely late plane (no
 * curfew cancel, no failing request) is left alone: a delay is not worth a
 * cancellation's -80 NPS.
 */
export function applyPriorityPolicy(state: SimState): void {
  if (callPolicy(state) !== 'priority' || state.simMinute % 5 !== 0) return;
  acceptKeepEvents(state);
  for (const call of callsNeeded(state, true)) {
    if (call.kind === 'late') continue;
    const projection = projectGroundedDay(state, call.tail);
    const saved = call.kind === 'curfew' ? 'saved curfew' : 'saved request';
    const swapped = call.kind === 'curfew' ? trySwap(state, call.tail) : null;
    if (swapped) {
      const leg = state.schedule.find((l) => l.legId === swapped.legId);
      if (leg) log(state, leg.origin, leg.dest, `${swapped.message} · ${saved}`);
      continue;
    }
    const cancelled = tryCancel(state, call.tail, call, projection);
    const leg = cancelled && state.schedule.find((l) => l.legId === cancelled.legId);
    if (cancelled && leg) log(state, leg.origin, leg.dest, `${cancelled.message} · ${stamp(state, cancelled.legId)} · ${saved}`);
  }
}
