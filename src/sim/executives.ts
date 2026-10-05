import executivesData from '../../data/executives.json';
import { networkNps } from './nps';
import type { SimState } from './state';

/**
 * The executives (WEEK-TEN.md, thread 8): three chairs beside the player,
 * who is the chief executive. Named people with backgrounds, in a game
 * that is otherwise all numbers, each hired for a signing fee and a daily
 * salary in exchange for one lasting effect on a system already in the
 * game.
 *
 * **The pool widens as NPS rises** (sim/nps.ts): anyone will take a
 * journeyman's job, but the stronger candidates only talk to an airline
 * passengers rate well (`npsNeeded`, judged against the trailing network
 * NPS when hiring). Once hired, they stay if NPS falls.
 *
 * Each chair's candidates help in different ways, so hiring is a choice
 * of what the airline needs, not only of the best on offer. Letting one
 * go stops the salary; the fee isn't refunded.
 *
 * Effects are a discriminated union on `kind`, so adding one is a JSON
 * entry plus a case: authored data in JSON, the rules in real code. The
 * accessors at the bottom return the neutral value when nobody supplies
 * an effect, so callers can multiply unconditionally.
 */

export type ExecutiveRole = 'coo' | 'cfo' | 'cco';
export const EXECUTIVE_ROLES: ExecutiveRole[] = ['coo', 'cfo', 'cco'];

export const ROLE_LABELS: Record<ExecutiveRole, string> = {
  coo: 'Chief Operating Officer',
  cfo: 'Chief Financial Officer',
  cco: 'Chief Commercial Officer',
};

export type ExecutiveEffect =
  /** Multiplies every flight's rolled delay (sim/delays.ts, sim/cascade.ts). */
  | { kind: 'flight-ops'; delayMultiplier: number }
  /** Flat NPS points on every departure (sim/nps.ts). */
  | { kind: 'inflight'; npsBonus: number }
  /** Multiplies the maintenance age factor, so fewer breakdowns (sim/aog.ts). */
  | { kind: 'maintenance'; ageFactorMultiplier: number }
  /** Multiplies network overhead (sim/overhead.ts). */
  | { kind: 'overhead'; overheadMultiplier: number }
  /** Multiplies fuel hedge premiums (sim/fuelPrice.ts), and overhead a little. */
  | { kind: 'treasury'; hedgePremiumMultiplier: number; overheadMultiplier: number }
  /** Multiplies the rate of every plane leased from now on (sim/playerActions.ts). */
  | { kind: 'leasing'; leaseMultiplier: number }
  /** Multiplies how fast markets grow into your service (sim/marketDemand.ts). */
  | { kind: 'market-building'; growthMultiplier: number }
  /** Multiplies connecting passengers at every hub (sim/hubs.ts). */
  | { kind: 'connections'; connectingMultiplier: number }
  /** Multiplies every ticket's revenue (sim/innovations.ts's bookingPerks()). */
  | { kind: 'revenue'; yieldMultiplier: number }
  /** Multiplies how long leased planes take to arrive and returned ones to go (sim/fleetTiming.ts). */
  | { kind: 'load-factor'; points: number }
  | { kind: 'fleet-programmes'; deliveryMultiplier: number; returnMultiplier: number };

export type ExecutiveCandidate = {
  id: string;
  role: ExecutiveRole;
  name: string;
  background: string;
  flavor: string;
  /** The trailing network NPS the airline needs before this candidate will talk to it, or null for anyone. */
  npsNeeded: number | null;
  /** Paid once, in cash, on appointment. */
  signingFee: number;
  /** Paid every day while appointed, at rollover. */
  salaryPerDay: number;
  effect: ExecutiveEffect;
};

export type ExecutiveAppointment = {
  candidateId: string;
  hiredAtMinute: number;
};

export type ExecutiveSlots = Record<ExecutiveRole, ExecutiveAppointment | null>;

export function loadExecutives(): ExecutiveCandidate[] {
  return executivesData as ExecutiveCandidate[];
}

export function createExecutiveSlots(): ExecutiveSlots {
  return { coo: null, cfo: null, cco: null };
}

export function candidateById(id: string): ExecutiveCandidate | undefined {
  return loadExecutives().find((c) => c.id === id);
}

export function candidatesForRole(role: ExecutiveRole): ExecutiveCandidate[] {
  return loadExecutives().filter((c) => c.role === role);
}

/** Whoever currently holds `role`, or undefined if the chair is empty. */
export function appointedCandidate(state: SimState, role: ExecutiveRole): ExecutiveCandidate | undefined {
  const appointment = state.executives[role];
  return appointment ? candidateById(appointment.candidateId) : undefined;
}

/** Why this candidate can't be appointed now, or null if they can. */
export function appointBlockedReason(state: SimState, candidate: ExecutiveCandidate): string | null {
  if (state.executives[candidate.role]?.candidateId === candidate.id) return 'Already appointed.';
  if (candidate.npsNeeded !== null && networkNps(state) < candidate.npsNeeded) {
    return `Needs NPS ${candidate.npsNeeded}+`;
  }
  if (state.cash < candidate.signingFee) return `Needs $${candidate.signingFee.toLocaleString()} cash`;
  return null;
}

/**
 * Appoint a candidate for their signing fee, replacing whoever held the
 * chair: there's no refund for the one leaving, which is what stops
 * shopping between candidates being free.
 */
export function appointExecutive(state: SimState, candidateId: string): { ok: true; message: string } | { ok: false; reason: string } {
  const candidate = candidateById(candidateId);
  if (!candidate) return { ok: false, reason: 'Unknown candidate.' };
  const blocked = appointBlockedReason(state, candidate);
  if (blocked) return { ok: false, reason: blocked };
  state.cash -= candidate.signingFee;
  state.executives[candidate.role] = { candidateId: candidate.id, hiredAtMinute: state.simMinute };
  return { ok: true, message: `${candidate.name} is your ${ROLE_LABELS[candidate.role]}.` };
}

/** Let the executive in `role` go: their salary stops; the fee is gone. */
export function dismissExecutive(state: SimState, role: ExecutiveRole): { ok: true; message: string } | { ok: false; reason: string } {
  const candidate = appointedCandidate(state, role);
  if (!candidate) return { ok: false, reason: 'Nobody holds that chair.' };
  state.executives[role] = null;
  return { ok: true, message: `${candidate.name} has left.` };
}

/** Every appointed executive's salary, a day. Charged at rollover (sim/step.ts). */
export function executiveSalariesPerDay(state: SimState): number {
  return EXECUTIVE_ROLES.reduce((sum, role) => sum + (appointedCandidate(state, role)?.salaryPerDay ?? 0), 0);
}

// --- Effect accessors -------------------------------------------------

/** Every effect in force, across the chairs. */
function activeEffects(state: SimState): ExecutiveEffect[] {
  return EXECUTIVE_ROLES.map((role) => appointedCandidate(state, role)?.effect).filter(
    (effect): effect is ExecutiveEffect => effect !== undefined,
  );
}

function effectOf<K extends ExecutiveEffect['kind']>(state: SimState, kind: K): Extract<ExecutiveEffect, { kind: K }> | undefined {
  return activeEffects(state).find((effect) => effect.kind === kind) as Extract<ExecutiveEffect, { kind: K }> | undefined;
}

export function executiveDelayMultiplier(state: SimState): number {
  return effectOf(state, 'flight-ops')?.delayMultiplier ?? 1;
}

export function executiveNpsBonus(state: SimState): number {
  return effectOf(state, 'inflight')?.npsBonus ?? 0;
}

export function executiveMaintenanceMultiplier(state: SimState): number {
  return effectOf(state, 'maintenance')?.ageFactorMultiplier ?? 1;
}

export function executiveOverheadMultiplier(state: SimState): number {
  return (effectOf(state, 'overhead')?.overheadMultiplier ?? 1) * (effectOf(state, 'treasury')?.overheadMultiplier ?? 1);
}

export function executiveHedgePremiumMultiplier(state: SimState): number {
  return effectOf(state, 'treasury')?.hedgePremiumMultiplier ?? 1;
}

export function executiveLeaseMultiplier(state: SimState): number {
  return effectOf(state, 'leasing')?.leaseMultiplier ?? 1;
}

export function executiveMarketBuildingMultiplier(state: SimState): number {
  return effectOf(state, 'market-building')?.growthMultiplier ?? 1;
}

export function executiveConnectingMultiplier(state: SimState): number {
  return effectOf(state, 'connections')?.connectingMultiplier ?? 1;
}

export function executiveDeliveryMultiplier(state: SimState): number {
  return effectOf(state, 'fleet-programmes')?.deliveryMultiplier ?? 1;
}

export function executiveReturnMultiplier(state: SimState): number {
  return effectOf(state, 'fleet-programmes')?.returnMultiplier ?? 1;
}

/** Extra share of its seats a plane can sell (sim/innovations.ts's loadFactorCap()). */
export function executiveLoadFactorBonus(state: SimState): number {
  return (effectOf(state, 'load-factor')?.points ?? 0) / 100;
}

export function executiveYieldMultiplier(state: SimState): number {
  return effectOf(state, 'revenue')?.yieldMultiplier ?? 1;
}

/** A revenue-management CCO's analysts read a market better: the revenue hill's band (sim/revenueHill.ts) is this wide. */
export function executiveFareEstimateMultiplier(state: SimState): number {
  return effectOf(state, 'revenue') ? 0.5 : 1;
}

/** What an effect does, in words, for the Head office view. */
export function describeEffect(effect: ExecutiveEffect): string {
  const percent = (factor: number) => `${Math.round(Math.abs(1 - factor) * 100)}%`;
  switch (effect.kind) {
    case 'flight-ops':
      return `Delays −${percent(effect.delayMultiplier)}`;
    case 'inflight':
      return `NPS +${effect.npsBonus} per flight`;
    case 'maintenance':
      return `Tech delays as if ${percent(effect.ageFactorMultiplier)} younger`;
    case 'overhead':
      return `Overhead −${percent(effect.overheadMultiplier)}`;
    case 'treasury':
      return `Hedge premium −${percent(effect.hedgePremiumMultiplier)} · overhead −${percent(effect.overheadMultiplier)}`;
    case 'leasing':
      return `New leases −${percent(effect.leaseMultiplier)}/day`;
    case 'market-building':
      return `New-market growth +${percent(effect.growthMultiplier)}`;
    case 'connections':
      return `Connecting pax +${percent(effect.connectingMultiplier)}`;
    case 'revenue':
      return `Yield +${percent(effect.yieldMultiplier)} · fare estimates twice as sharp`;
    case 'load-factor':
      return `Seats sold +${effect.points} points`;
    case 'fleet-programmes':
      return `Deliveries −${percent(effect.deliveryMultiplier)} · returns −${percent(effect.returnMultiplier)} time`;
  }
}
