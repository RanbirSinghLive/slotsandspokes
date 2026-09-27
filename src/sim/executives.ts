import executivesData from '../../data/executives.json';
import type { SimState } from './state';

/**
 * Week six's C-suite: four slots — CEO, COO, CFO, CCO — each holding at
 * most one appointment, paid for in **Reputation** rather than cash.
 *
 * That currency choice is the design. Reputation is earned slowly by
 * running a good airline (on-time, completion factor, NPS) and until now
 * had exactly one spender, the tech tree. Executives make it a genuine
 * second: two of the four convert Reputation into *cash*, so a
 * well-regarded airline can borrow against its own standing rather than
 * a bank's. It also means the C-suite is unreachable early — you have to
 * have been good at something first.
 *
 * WEEK-SIX.md carried an open question for weeks: "what do a COO's,
 * CFO's, CCO's and CEO's bonuses actually *modify*?" — and flagged that
 * nothing in the codebase had an obvious "operations quality" lever
 * waiting for a multiplier. That's no longer true. Crew, maintenance,
 * delays, NPS and market growth all now exist as real systems with real
 * numbers, so each executive can attach to something that was already
 * there rather than needing a stat invented for them to modify.
 *
 * Effects are a discriminated union on `kind`, so adding a new one is a
 * JSON entry plus a case — the same split between authored data and real
 * code that sim/missions.ts uses, and for the same reason.
 */

export type ExecutiveRole = 'ceo' | 'coo' | 'cfo' | 'cco';
export const EXECUTIVE_ROLES: ExecutiveRole[] = ['ceo', 'coo', 'cfo', 'cco'];

export const ROLE_LABELS: Record<ExecutiveRole, string> = {
  ceo: 'Chief Executive',
  coo: 'Chief Operating Officer',
  cfo: 'Chief Financial Officer',
  cco: 'Chief Commercial Officer',
};

export type ExecutiveEffect =
  /** Pays the airline a lump sum once a year, larger each time. */
  | { kind: 'annual-bonus'; amount: number; escalation: number }
  /** The same, monthly. */
  | { kind: 'monthly-bonus'; amount: number; escalation: number }
  /** Multiplies how fast markets grow into your service — a CCO who builds markets. */
  | { kind: 'market-building'; growthMultiplier: number }
  /** Multiplies every flight's rolled delay — a COO who came up through operations. */
  | { kind: 'flight-ops'; delayMultiplier: number }
  /** Flat NPS points on every departure — a COO who came up through the cabin. */
  | { kind: 'inflight'; npsBonus: number }
  /** Multiplies the maintenance age factor down — a COO who came up through engineering. */
  | { kind: 'maintenance'; ageFactorMultiplier: number };

export type ExecutiveCandidate = {
  id: string;
  role: ExecutiveRole;
  name: string;
  background: string;
  flavor: string;
  reputationCost: number;
  effect: ExecutiveEffect;
};

/**
 * One filled slot. `payoutsMade` and `nextPayoutMinute` are only
 * meaningful for the two bonus-paying effects; they sit on every
 * appointment rather than in a separate structure because one shape is
 * simpler than two and the unused fields cost nothing.
 */
export type ExecutiveAppointment = {
  candidateId: string;
  hiredAtMinute: number;
  payoutsMade: number;
  nextPayoutMinute: number;
};

export type ExecutiveSlots = Record<ExecutiveRole, ExecutiveAppointment | null>;

const MINUTES_PER_DAY = 1440;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;

export function loadExecutives(): ExecutiveCandidate[] {
  return executivesData as ExecutiveCandidate[];
}

export function createExecutiveSlots(): ExecutiveSlots {
  return { ceo: null, coo: null, cfo: null, cco: null };
}

export function candidateById(id: string): ExecutiveCandidate | undefined {
  return loadExecutives().find((c) => c.id === id);
}

export function candidatesForRole(role: ExecutiveRole): ExecutiveCandidate[] {
  return loadExecutives().filter((c) => c.role === role);
}

/** Whoever currently holds `role`, or undefined if the slot is empty. */
export function appointedCandidate(state: SimState, role: ExecutiveRole): ExecutiveCandidate | undefined {
  const appointment = state.executives[role];
  return appointment ? candidateById(appointment.candidateId) : undefined;
}

/** Every effect currently in force, across all four slots. */
function activeEffects(state: SimState): ExecutiveEffect[] {
  return EXECUTIVE_ROLES.map((role) => appointedCandidate(state, role)?.effect).filter(
    (effect): effect is ExecutiveEffect => effect !== undefined,
  );
}

function payoutIntervalMinutes(effect: ExecutiveEffect): number | null {
  if (effect.kind === 'monthly-bonus') return DAYS_PER_MONTH * MINUTES_PER_DAY;
  if (effect.kind === 'annual-bonus') return DAYS_PER_YEAR * MINUTES_PER_DAY;
  return null;
}

/**
 * Appoint `candidate`, replacing whoever held the slot. Charged in
 * Reputation; the UI checks affordability first.
 *
 * Replacing costs the new appointment's full price — there's no refund
 * for the outgoing executive, which is what stops slot-shopping being
 * free. A replaced bonus-payer also loses its accumulated escalation,
 * since `payoutsMade` starts from zero: seniority is the incumbent's,
 * not the chair's.
 */
export function appointExecutive(state: SimState, candidate: ExecutiveCandidate): void {
  state.reputation -= candidate.reputationCost;
  const interval = payoutIntervalMinutes(candidate.effect);
  state.executives[candidate.role] = {
    candidateId: candidate.id,
    hiredAtMinute: state.simMinute,
    payoutsMade: 0,
    nextPayoutMinute: interval === null ? Number.MAX_SAFE_INTEGER : state.simMinute + interval,
  };
}

/**
 * Pay out any executive bonus that has come due. Called once per
 * simulated day from step.ts's day-rollover.
 *
 * Bonuses escalate: each payout multiplies the last by the effect's
 * `escalation`, so an executive kept on gets steadily more valuable and
 * replacing one resets that progress. Credited straight to Cash without
 * touching `todayCost` — this is income, not a negative cost, and
 * folding it into the cost categories would corrupt the invariant that
 * they sum to `todayCost`.
 */
export function payExecutiveBonuses(state: SimState): void {
  for (const role of EXECUTIVE_ROLES) {
    const appointment = state.executives[role];
    if (!appointment) continue;
    const candidate = candidateById(appointment.candidateId);
    if (!candidate) continue;

    const interval = payoutIntervalMinutes(candidate.effect);
    if (interval === null || state.simMinute < appointment.nextPayoutMinute) continue;

    const effect = candidate.effect as { amount: number; escalation: number };
    const amount = effect.amount * Math.pow(effect.escalation, appointment.payoutsMade);
    state.cash += amount;
    state.todayRevenue += amount;
    state.todayMargin += amount;

    appointment.payoutsMade += 1;
    appointment.nextPayoutMinute = state.simMinute + interval;
  }
}

/** What the next bonus from this appointment will pay, for the UI to show before it lands. */
export function nextPayoutAmount(state: SimState, role: ExecutiveRole): number | null {
  const appointment = state.executives[role];
  const candidate = appointedCandidate(state, role);
  if (!appointment || !candidate) return null;
  if (candidate.effect.kind !== 'annual-bonus' && candidate.effect.kind !== 'monthly-bonus') return null;
  return candidate.effect.amount * Math.pow(candidate.effect.escalation, appointment.payoutsMade);
}

// --- Effect accessors -------------------------------------------------
//
// Each returns the neutral value when no executive supplies that effect,
// so callers can multiply or add unconditionally rather than branching.

/** Multiplies every flight's rolled delay. 1 when no flight-ops COO is appointed. */
export function executiveDelayMultiplier(state: SimState): number {
  const effect = activeEffects(state).find((e) => e.kind === 'flight-ops');
  return effect?.kind === 'flight-ops' ? effect.delayMultiplier : 1;
}

/** Flat NPS points added to every departure. 0 when no inflight COO is appointed. */
export function executiveNpsBonus(state: SimState): number {
  const effect = activeEffects(state).find((e) => e.kind === 'inflight');
  return effect?.kind === 'inflight' ? effect.npsBonus : 0;
}

/** Multiplies the maintenance age factor. 1 when no maintenance COO is appointed. */
export function executiveMaintenanceMultiplier(state: SimState): number {
  const effect = activeEffects(state).find((e) => e.kind === 'maintenance');
  return effect?.kind === 'maintenance' ? effect.ageFactorMultiplier : 1;
}

/** How much faster markets grow into your service (sim/marketDemand.ts). 1 when no market-building CCO is appointed. */
export function executiveMarketBuildingMultiplier(state: SimState): number {
  const effect = activeEffects(state).find((e) => e.kind === 'market-building');
  return effect?.kind === 'market-building' ? effect.growthMultiplier : 1;
}
