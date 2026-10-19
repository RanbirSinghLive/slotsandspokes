import executivesData from '../../data/executives.json';
import { networkNps } from './nps';
import { LADDER, tiersClimbed } from './ladder';
import { classRank } from './aircraftClasses';
import type { SimState } from './state';

/**
 * The executives: three chairs beside the player, who is the chief
 * executive (Operations, Commercial, Finance), and a fourth board seat that
 * opens at Network airline and takes anyone. Named people with
 * backgrounds, in a game that is otherwise all numbers, each hired for a
 * signing fee and a daily salary in exchange for one lasting effect on a
 * system already in the game.
 *
 * **Each one is worth more to some fleets than others.** A candidate's
 * `classWeights` say how strongly their effect lands on each aircraft
 * class, smallest first: the line maintenance chief is at full strength on
 * propellers and fades on widebodies, the inflight director does nothing
 * on a propeller with no cabin crew. Effects felt per flight use the
 * flight's plane; the rest use the fleet's average. So the right hire
 * moves as the airline flies bigger planes, and three chairs for twelve
 * people means there is always someone you go without.
 * `executiveWorthPerDay()` estimates what a candidate would earn the
 * airline as it is today, which is what the Office reads to say who fits.
 *
 * **The pool widens as NPS rises** (sim/nps.ts): anyone will take a
 * journeyman's job, but the stronger candidates only talk to an airline
 * passengers rate well (`npsNeeded`, judged against the trailing network
 * NPS when hiring). Once hired, they must be kept: a hire whose NPS
 * line the airline stays under for EXECUTIVE_LAPSE_DAYS in a row leaves
 * (`rollExecutiveStanding()`), salary and fee gone.
 *
 * Salaries are a base plus a share per plane, so a chair is never free
 * value to a big airline. Letting one go stops the salary; the fee isn't
 * refunded.
 *
 * Effects are a discriminated union on `kind`, so adding one is a JSON
 * entry plus a case: authored data in JSON, the rules in real code. The
 * accessors at the bottom return the neutral value when nobody supplies
 * an effect, so callers can multiply unconditionally.
 */

/** The chairs a candidate belongs to. */
export type ExecutiveRole = 'coo' | 'cco' | 'cfo';
export const EXECUTIVE_ROLES: ExecutiveRole[] = ['coo', 'cco', 'cfo'];
/** Where an executive can sit: their own chair, or the board seat. */
export type ExecutiveSeat = ExecutiveRole | 'board';
export const EXECUTIVE_SEATS: ExecutiveSeat[] = ['coo', 'cco', 'cfo', 'board'];
/** The ladder tier (sim/ladder.ts) that opens the board seat. */
export const BOARD_SEAT_TIER = 'network';

export const ROLE_LABELS: Record<ExecutiveSeat, string> = {
  coo: 'Operations',
  cco: 'Commercial',
  cfo: 'Finance',
  board: 'Board seat',
};

export type ExecutiveEffect =
  /** Multiplies every flight's rolled delay (sim/delays.ts, sim/cascade.ts). */
  | { kind: 'flight-ops'; delayMultiplier: number }
  /** Flat NPS points on every departure (sim/nps.ts). */
  | { kind: 'inflight'; npsBonus: number }
  /** Multiplies the maintenance age factor, so fewer breakdowns (sim/aog.ts). */
  | { kind: 'maintenance'; ageFactorMultiplier: number }
  /** Multiplies network overhead (sim/overhead.ts) and slot fees (sim/slots.ts). */
  | { kind: 'overhead'; overheadMultiplier: number; slotFeeMultiplier?: number }
  /** Multiplies fuel hedge premiums (sim/fuelPrice.ts), and overhead a little. */
  | { kind: 'treasury'; hedgePremiumMultiplier: number; overheadMultiplier: number }
  /** Multiplies the rate of every plane leased from now on (sim/playerActions.ts), and how long leased planes take to arrive and returned ones to go (sim/fleetTiming.ts). */
  | { kind: 'leasing'; leaseMultiplier: number; deliveryMultiplier?: number; returnMultiplier?: number }
  /** Multiplies how fast markets grow into your service (sim/marketDemand.ts). */
  | { kind: 'market-building'; growthMultiplier: number }
  /** Multiplies connecting passengers at every hub (sim/hubs.ts), and freight revenue (sim/cargo.ts). */
  | { kind: 'connections'; connectingMultiplier: number; cargoMultiplier?: number }
  /** Multiplies every ticket's revenue (sim/innovations.ts's bookingPerks()). */
  | { kind: 'revenue'; yieldMultiplier: number }
  /** Multiplies how long hiring and retraining crews take (sim/innovations.ts's crewTrainingTimeFactor()). */
  | { kind: 'crew-programmes'; trainingTimeMultiplier: number }
  /** Multiplies what every maintenance base costs a day (sim/bases.ts's mxCostPerDay()), and what pushing a C check later costs (sim/mxChecks.ts). */
  | { kind: 'maintenance-bases'; costMultiplier: number; toleranceCostMultiplier?: number; toleranceExtraDays?: number }
  /** Multiplies the premium an event pays and the penalty for failing one (sim/mandates.ts). */
  | { kind: 'events'; premiumMultiplier: number; penaltyMultiplier: number };

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
  /** Paid every day while appointed, at rollover, before the per-plane share. */
  salaryPerDay: number;
  /** Added to the salary for every plane in the fleet. */
  salaryPerPlane: number;
  /** How strongly the effect lands on each aircraft class, smallest first (sim/aircraftClasses.ts), 0 to 1. */
  classWeights: number[];
  effect: ExecutiveEffect;
};

export type ExecutiveAppointment = {
  candidateId: string;
  hiredAtMinute: number;
  /** Days in a row the network NPS has been under this hire's line. Absent when it hasn't. */
  daysBelowLine?: number;
};

/** Days in a row under their NPS line before a hire walks. */
export const EXECUTIVE_LAPSE_DAYS = 30;

/** Each seat's appointment. The board seat is optional: a save from before it has none. */
export type ExecutiveSlots = Record<ExecutiveRole, ExecutiveAppointment | null> & { board?: ExecutiveAppointment | null };

export function loadExecutives(): ExecutiveCandidate[] {
  return executivesData as ExecutiveCandidate[];
}

const CANDIDATES_BY_ID = new Map(loadExecutives().map((candidate) => [candidate.id, candidate]));

export function createExecutiveSlots(): ExecutiveSlots {
  return { coo: null, cco: null, cfo: null, board: null };
}

export function candidateById(id: string): ExecutiveCandidate | undefined {
  return CANDIDATES_BY_ID.get(id);
}

export function candidatesForRole(role: ExecutiveRole): ExecutiveCandidate[] {
  return loadExecutives().filter((c) => c.role === role);
}

/** Whoever currently holds `seat`, or undefined if it is empty. */
export function appointedCandidate(state: SimState, seat: ExecutiveSeat): ExecutiveCandidate | undefined {
  const appointment = state.executives[seat];
  return appointment ? candidateById(appointment.candidateId) : undefined;
}

/** The seat a candidate holds, or null. */
export function seatOf(state: SimState, candidateId: string): ExecutiveSeat | null {
  return EXECUTIVE_SEATS.find((seat) => state.executives[seat]?.candidateId === candidateId) ?? null;
}

/** The tier that opens a seat, by name; null once it is open. Only the board seat waits. */
export function seatOpensAt(state: SimState, seat: ExecutiveSeat): string | null {
  if (seat !== 'board') return null;
  const index = LADDER.findIndex((tier) => tier.id === BOARD_SEAT_TIER);
  return tiersClimbed(state) >= index ? null : (LADDER[index]?.name ?? null);
}

/** What a candidate costs a day for this airline: the base plus the per-plane share. */
export function executiveSalary(state: SimState, candidate: ExecutiveCandidate): number {
  return candidate.salaryPerDay + (candidate.salaryPerPlane ?? 0) * state.aircraft.length;
}

/** Why this candidate can't be appointed to `seat` now, or null if they can. */
export function appointBlockedReason(state: SimState, candidate: ExecutiveCandidate, seat: ExecutiveSeat = candidate.role): string | null {
  const held = seatOf(state, candidate.id);
  if (held) return held === seat ? 'Already appointed.' : `Sits in ${ROLE_LABELS[held]}`;
  if (seat !== 'board' && seat !== candidate.role) return `Not a ${ROLE_LABELS[seat]} candidate`;
  const opensAt = seatOpensAt(state, seat);
  if (opensAt) return `Needs ${opensAt}`;
  if (candidate.npsNeeded !== null && networkNps(state) < candidate.npsNeeded) {
    return `Needs NPS ${candidate.npsNeeded}+`;
  }
  if (state.cash < candidate.signingFee) return `Needs $${candidate.signingFee.toLocaleString()} cash`;
  return null;
}

/**
 * Appoint a candidate for their signing fee to their own chair, or to the
 * board seat, replacing whoever held it: there's no refund for the one
 * leaving, which is what stops shopping between candidates being free.
 */
export function appointExecutive(state: SimState, candidateId: string, seat?: ExecutiveSeat): { ok: true; message: string } | { ok: false; reason: string } {
  const candidate = candidateById(candidateId);
  if (!candidate) return { ok: false, reason: 'Unknown candidate.' };
  const target = seat ?? candidate.role;
  const blocked = appointBlockedReason(state, candidate, target);
  if (blocked) return { ok: false, reason: blocked };
  state.cash -= candidate.signingFee;
  state.executives[target] = { candidateId: candidate.id, hiredAtMinute: state.simMinute };
  return { ok: true, message: `${candidate.name} appointed · ${ROLE_LABELS[target]}` };
}

/** Let the executive in `seat` go: their salary stops; the fee is gone. */
export function dismissExecutive(state: SimState, seat: ExecutiveSeat): { ok: true; message: string } | { ok: false; reason: string } {
  const candidate = appointedCandidate(state, seat);
  if (!candidate) return { ok: false, reason: 'Nobody holds that seat.' };
  state.executives[seat] = null;
  return { ok: true, message: `${candidate.name} has left.` };
}

/**
 * Each rollover, count the days an appointed executive's NPS line has
 * gone unmet; at EXECUTIVE_LAPSE_DAYS in a row they leave (recorded in
 * `lastExecutiveLapse` for the ticker). Journeymen have no line and stay.
 */
export function rollExecutiveStanding(state: SimState): void {
  const nps = networkNps(state);
  for (const seat of EXECUTIVE_SEATS) {
    const appointment = state.executives[seat];
    const candidate = appointedCandidate(state, seat);
    if (!appointment || !candidate || candidate.npsNeeded === null) continue;
    if (nps >= candidate.npsNeeded) {
      delete appointment.daysBelowLine;
      continue;
    }
    appointment.daysBelowLine = (appointment.daysBelowLine ?? 0) + 1;
    if (appointment.daysBelowLine >= EXECUTIVE_LAPSE_DAYS) {
      state.executives[seat] = null;
      state.lastExecutiveLapse = { candidateId: candidate.id, simMinute: state.simMinute };
    }
  }
}

/** Every appointed executive's salary, a day. Charged at rollover (sim/step.ts). */
export function executiveSalariesPerDay(state: SimState): number {
  return EXECUTIVE_SEATS.reduce((sum, seat) => {
    const candidate = appointedCandidate(state, seat);
    return sum + (candidate ? executiveSalary(state, candidate) : 0);
  }, 0);
}

/**
 * Candidates from the seven chairs older saves had, mapped to whoever does
 * their job now. Run on load (ui/save.ts): each old holder goes to the new
 * person's chair if it is free, else to the board seat if that is free,
 * else leaves. Safe to run again.
 */
const RETIRED_CANDIDATES: Record<string, string> = {
  'coo-fleet': 'cfo-adeyemi',
  'coo-director-ops': 'coo-flightops',
  'cfo-treasurer': 'cfo-adeyemi',
  'cco-sato': 'cco-mensah',
  'cco-alliances': 'cco-carvalho',
  'cpo-malhotra': 'cpo-solheim',
  'dom-aaltonen': 'dom-bakare',
  'hoc-karimova': 'cco-carvalho',
  'hoc-lindahl': 'cco-carvalho',
  'hga-eze': 'hga-fontaine',
};

export function migrateExecutives(state: SimState): void {
  const old = state.executives as unknown as Record<string, ExecutiveAppointment | null | undefined>;
  const seated = Object.entries(old)
    .filter((entry): entry is [string, ExecutiveAppointment] => !!entry[1])
    .map(([seat, appointment]) => ({ seat, appointment: { ...appointment, candidateId: RETIRED_CANDIDATES[appointment.candidateId] ?? appointment.candidateId } }))
    .sort((a, b) => a.appointment.hiredAtMinute - b.appointment.hiredAtMinute);
  const next = createExecutiveSlots();
  // Who was already where they belong keeps the seat; everyone else is placed after, earliest hire first.
  const placed = new Set<string>();
  for (const { seat, appointment } of seated) {
    const candidate = candidateById(appointment.candidateId);
    if (!candidate || placed.has(candidate.id)) continue;
    if ((seat === candidate.role || seat === 'board') && !next[seat as ExecutiveSeat]) {
      next[seat as ExecutiveSeat] = appointment;
      placed.add(candidate.id);
    }
  }
  for (const { appointment } of seated) {
    const candidate = candidateById(appointment.candidateId);
    if (!candidate || placed.has(candidate.id)) continue;
    const seat: ExecutiveSeat | null = !next[candidate.role] ? candidate.role : !next.board ? 'board' : null;
    if (!seat) continue;
    next[seat] = appointment;
    placed.add(candidate.id);
  }
  state.executives = next;
}

// --- Strength by aircraft class -----------------------------------------

/** How strongly a candidate's effect lands on one plane of `typeCode`'s class, 0 to 1. */
export function classStrength(candidate: ExecutiveCandidate, typeCode: string): number {
  const rank = Math.max(0, classRank(typeCode));
  return candidate.classWeights[rank] ?? candidate.classWeights[candidate.classWeights.length - 1] ?? 1;
}

/** The same across today's fleet, averaged plane by plane; a fleet of none reads as the smallest class. */
export function fleetStrength(state: SimState, candidate: ExecutiveCandidate): number {
  if (state.aircraft.length === 0) return candidate.classWeights[0] ?? 1;
  return state.aircraft.reduce((sum, aircraft) => sum + classStrength(candidate, aircraft.typeCode), 0) / state.aircraft.length;
}

// --- Effect accessors -------------------------------------------------

type Active<K extends ExecutiveEffect['kind']> = { candidate: ExecutiveCandidate; effect: Extract<ExecutiveEffect, { kind: K }> };

/** Every seated executive with an effect of `kind`: one, as each kind belongs to one candidate. */
function activeOf<K extends ExecutiveEffect['kind']>(state: SimState, kind: K): Active<K> | undefined {
  for (const seat of EXECUTIVE_SEATS) {
    const candidate = appointedCandidate(state, seat);
    if (candidate?.effect.kind === kind) return { candidate, effect: candidate.effect as Extract<ExecutiveEffect, { kind: K }> };
  }
  return undefined;
}

/**
 * A multiplier at the strength the airline gets it: on one plane's class
 * when `typeCode` is given, else across the fleet. Neutral (1) when the
 * effect is absent or the multiplier is.
 */
function scaled(state: SimState, active: { candidate: ExecutiveCandidate } | undefined, multiplier: number | undefined, typeCode?: string): number {
  if (!active || multiplier === undefined) return 1;
  const strength = typeCode ? classStrength(active.candidate, typeCode) : fleetStrength(state, active.candidate);
  return 1 + (multiplier - 1) * strength;
}

/** Delay multiplier on a flight by `typeCode` (or the fleet's average without one). */
export function executiveDelayMultiplier(state: SimState, typeCode?: string): number {
  const active = activeOf(state, 'flight-ops');
  return scaled(state, active, active?.effect.delayMultiplier, typeCode);
}

/** NPS points the inflight director adds to a flight by `typeCode`. */
export function executiveNpsBonus(state: SimState, typeCode?: string): number {
  const active = activeOf(state, 'inflight');
  if (!active) return 0;
  return active.effect.npsBonus * (typeCode ? classStrength(active.candidate, typeCode) : fleetStrength(state, active.candidate));
}

export function executiveMaintenanceMultiplier(state: SimState, typeCode?: string): number {
  const active = activeOf(state, 'maintenance');
  return scaled(state, active, active?.effect.ageFactorMultiplier, typeCode);
}

export function executiveOverheadMultiplier(state: SimState): number {
  const control = activeOf(state, 'overhead');
  const treasury = activeOf(state, 'treasury');
  return scaled(state, control, control?.effect.overheadMultiplier) * scaled(state, treasury, treasury?.effect.overheadMultiplier);
}

/** What the cost controller leaves of slot fees (sim/slots.ts). */
export function executiveSlotFeeMultiplier(state: SimState): number {
  const active = activeOf(state, 'overhead');
  return scaled(state, active, active?.effect.slotFeeMultiplier);
}

/** Whether a treasury CFO sits in a seat: the banks write the longest fuel hedges only then (sim/fuelPrice.ts). */
export function hasTreasuryCfo(state: SimState): boolean {
  return activeOf(state, 'treasury') !== undefined;
}

export function executiveHedgePremiumMultiplier(state: SimState): number {
  const active = activeOf(state, 'treasury');
  return scaled(state, active, active?.effect.hedgePremiumMultiplier);
}

/** What a new lease's rate is multiplied by, for a plane of `typeCode`. */
export function executiveLeaseMultiplier(state: SimState, typeCode?: string): number {
  const active = activeOf(state, 'leasing');
  return scaled(state, active, active?.effect.leaseMultiplier, typeCode);
}

export function executiveDeliveryMultiplier(state: SimState): number {
  const active = activeOf(state, 'leasing');
  return scaled(state, active, active?.effect.deliveryMultiplier);
}

export function executiveReturnMultiplier(state: SimState): number {
  const active = activeOf(state, 'leasing');
  return scaled(state, active, active?.effect.returnMultiplier);
}

export function executiveMarketBuildingMultiplier(state: SimState): number {
  const active = activeOf(state, 'market-building');
  return scaled(state, active, active?.effect.growthMultiplier);
}

export function executiveConnectingMultiplier(state: SimState): number {
  const active = activeOf(state, 'connections');
  return scaled(state, active, active?.effect.connectingMultiplier);
}

export function executiveCargoMultiplier(state: SimState): number {
  const active = activeOf(state, 'connections');
  return scaled(state, active, active?.effect.cargoMultiplier);
}

export function executiveYieldMultiplier(state: SimState, typeCode?: string): number {
  const active = activeOf(state, 'revenue');
  return scaled(state, active, active?.effect.yieldMultiplier, typeCode);
}

/** A revenue manager's analysts read a market better: the revenue hill's band (sim/revenueHill.ts) narrows by up to half. */
export function executiveFareEstimateMultiplier(state: SimState): number {
  const active = activeOf(state, 'revenue');
  return scaled(state, active, active ? 0.5 : undefined);
}

/** What the chief pilot leaves of the time retraining takes; hiring is the crew academy's (sim/innovations.ts). */
export function executiveCrewTrainingMultiplier(state: SimState): number {
  const active = activeOf(state, 'crew-programmes');
  return scaled(state, active, active?.effect.trainingTimeMultiplier);
}

export function executiveMaintenanceBaseMultiplier(state: SimState): number {
  const active = activeOf(state, 'maintenance-bases');
  return scaled(state, active, active?.effect.costMultiplier);
}

/** What pushing a C check later costs, on a plane of `typeCode`. */
export function executiveToleranceMultiplier(state: SimState, typeCode?: string): number {
  const active = activeOf(state, 'maintenance-bases');
  return scaled(state, active, active?.effect.toleranceCostMultiplier, typeCode);
}

/** Days the heavy maintenance director adds to how far a C check can be pushed, on a plane of `typeCode`. */
export function executiveToleranceExtraDays(state: SimState, typeCode?: string): number {
  const active = activeOf(state, 'maintenance-bases');
  if (!active) return 0;
  const strength = typeCode ? classStrength(active.candidate, typeCode) : fleetStrength(state, active.candidate);
  return Math.round((active.effect.toleranceExtraDays ?? 0) * strength);
}

export function executiveEventPremiumMultiplier(state: SimState): number {
  const active = activeOf(state, 'events');
  return scaled(state, active, active?.effect.premiumMultiplier);
}

export function executiveEventPenaltyMultiplier(state: SimState): number {
  const active = activeOf(state, 'events');
  return scaled(state, active, active?.effect.penaltyMultiplier);
}

// --- Worth --------------------------------------------------------------

/** Days of history the worth estimate averages over. */
const WORTH_WINDOW_DAYS = 7;
/** A market younger than this many days of history still counts as building, for the market builder. */
const YOUNG_MARKET_DAYS = 60;

function recentAverage(history: number[] | undefined): number {
  const days = (history ?? []).slice(-WORTH_WINDOW_DAYS);
  return days.length ? days.reduce((sum, value) => sum + value, 0) / days.length : 0;
}

/**
 * Roughly what a candidate would add to the airline's day as it flies now,
 * in dollars, before their salary: last week's revenue or cost in the line
 * their effect touches, times the share of it their effect plausibly moves,
 * at the strength today's fleet gets it. An estimate for comparing
 * candidates, not a forecast: the shares are set so a hire that suits
 * the fleet earns a few times their salary and one that doesn't, less.
 */
export function executiveWorthPerDay(state: SimState, candidate: ExecutiveCandidate): number {
  const strength = fleetStrength(state, candidate);
  const revenue = recentAverage(state.revenueHistory);
  const cost = (kind: string) => recentAverage(state.costHistoryByCategory?.[kind]);
  const effect = candidate.effect;
  let worth = 0;
  switch (effect.kind) {
    case 'maintenance':
      // Tech delays and AOG days: missed connections, refunds, spare lift.
      worth = revenue * 0.1 * (1 - effect.ageFactorMultiplier);
      break;
    case 'flight-ops':
      worth = revenue * 0.1 * (1 - effect.delayMultiplier);
      break;
    case 'maintenance-bases':
      worth = cost('maintenance') * 0.6 * (1 - effect.costMultiplier);
      break;
    case 'crew-programmes':
      worth = cost('crew') * 0.1 * (1 - effect.trainingTimeMultiplier) + revenue * 0.01 * (1 - effect.trainingTimeMultiplier);
      break;
    case 'market-building': {
      let young = 0;
      for (const [key, history] of Object.entries(state.revenueHistoryByMarket)) {
        if (history.length < YOUNG_MARKET_DAYS) young += recentAverage(state.revenueHistoryByMarket[key]);
      }
      worth = young * 0.4 * (effect.growthMultiplier - 1);
      break;
    }
    case 'inflight':
      worth = revenue * 0.004 * effect.npsBonus;
      break;
    case 'revenue':
      worth = revenue * (effect.yieldMultiplier - 1);
      break;
    case 'connections':
      worth = revenue * 0.2 * (effect.connectingMultiplier - 1) + (state.yesterdayCargoRevenue ?? 0) * ((effect.cargoMultiplier ?? 1) - 1);
      break;
    case 'overhead':
      worth = cost('overhead') * (1 - effect.overheadMultiplier) + cost('slots') * (1 - (effect.slotFeeMultiplier ?? 1));
      break;
    case 'treasury':
      worth = cost('fuel') * 0.03 + cost('overhead') * (1 - effect.overheadMultiplier);
      break;
    case 'leasing':
      // Only new leases get the rate, so about half the bill turns over within a hire.
      worth = cost('lease') * 0.5 * (1 - effect.leaseMultiplier) + revenue * 0.005;
      break;
    case 'events':
      worth = recentAverage(state.bonusRevenueHistory) * ((effect.premiumMultiplier - 1) + (1 - effect.penaltyMultiplier)) * 0.5;
      break;
  }
  return Math.round(worth * strength);
}

/** Worth less salary: what a candidate would net the airline a day. */
export function executiveNetPerDay(state: SimState, candidate: ExecutiveCandidate): number {
  return executiveWorthPerDay(state, candidate) - executiveSalary(state, candidate);
}

/** How much better a candidate must net than a seat's holder before the Office calls it a better fit. */
const BETTER_FIT_MARGIN = 1.5;

/**
 * Whether a seat wants a look, for the Office and the rail: `empty` when
 * nobody sits there and someone open to the airline would net a profit;
 * `underwater` when the holder costs more than they earn; `better` names
 * a candidate who would net clearly more (and more than BETTER_FIT_MARGIN
 * × the holder's net) and is open to the airline now, cash aside.
 */
export function seatAdvice(state: SimState, seat: ExecutiveSeat): { empty: boolean; underwater: boolean; better: ExecutiveCandidate | null } {
  if (seatOpensAt(state, seat)) return { empty: false, underwater: false, better: null };
  const holder = appointedCandidate(state, seat);
  const holderNet = holder ? executiveNetPerDay(state, holder) : 0;
  const pool = seat === 'board' ? loadExecutives() : candidatesForRole(seat);
  let better: ExecutiveCandidate | null = null;
  let bestNet = holder ? Math.max(holderNet * BETTER_FIT_MARGIN, holderNet + 500) : 0;
  for (const candidate of pool) {
    if (candidate.id === holder?.id || seatOf(state, candidate.id)) continue;
    if (candidate.npsNeeded !== null && networkNps(state) < candidate.npsNeeded) continue;
    const net = executiveNetPerDay(state, candidate);
    if (net > bestNet) {
      bestNet = net;
      better = candidate;
    }
  }
  return { empty: !holder && better !== null, underwater: !!holder && holderNet < 0, better };
}

/** What an effect does, in words, for the Office, at full strength. */
export function describeEffect(effect: ExecutiveEffect): string {
  const percent = (factor: number) => `${Math.round(Math.abs(1 - factor) * 100)}%`;
  switch (effect.kind) {
    case 'flight-ops':
      return `Delays −${percent(effect.delayMultiplier)}`;
    case 'inflight':
      return `NPS +${effect.npsBonus} per flight`;
    case 'maintenance':
      return `Tech delays and AOG −${percent(effect.ageFactorMultiplier)}`;
    case 'overhead':
      return `Overhead −${percent(effect.overheadMultiplier)}` + (effect.slotFeeMultiplier ? ` · slot fees −${percent(effect.slotFeeMultiplier)}` : '');
    case 'treasury':
      return `Hedge premium −${percent(effect.hedgePremiumMultiplier)} · 180d hedges · overhead −${percent(effect.overheadMultiplier)}`;
    case 'leasing':
      return `New leases −${percent(effect.leaseMultiplier)}/day` + (effect.deliveryMultiplier ? ` · deliveries −${percent(effect.deliveryMultiplier)} time` : '');
    case 'market-building':
      return `New-market growth +${percent(effect.growthMultiplier)}`;
    case 'connections':
      return `Connecting pax +${percent(effect.connectingMultiplier)}` + (effect.cargoMultiplier ? ` · freight +${percent(effect.cargoMultiplier)}` : '');
    case 'revenue':
      return `Yield +${percent(effect.yieldMultiplier)} · sharper fare reads`;
    case 'crew-programmes':
      return `Retraining −${percent(effect.trainingTimeMultiplier)} time`;
    case 'maintenance-bases':
      return `Base running costs −${percent(effect.costMultiplier)}` + (effect.toleranceCostMultiplier ? ` · C-check push −${percent(effect.toleranceCostMultiplier)}` : '') + (effect.toleranceExtraDays ? ` · push +${effect.toleranceExtraDays}d` : '');
    case 'events':
      return `Event pay +${percent(effect.premiumMultiplier)} · penalties −${percent(effect.penaltyMultiplier)}`;
  }
}
