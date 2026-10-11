import { adoptBlockedReason, completeInnovation, INNOVATIONS, innovationById, isAdopted, type InnovationId } from './innovations';
import type { SimState } from './state';

/**
 * The R&D shop: innovations are researched, not bought.
 *
 * Money feeds it. The player sets a daily budget (RD_BUDGETS) and picks one
 * project to work on; each rollover the budget is spent and turns into
 * points on that project. A project is a step in a chain (sim/innovations.ts's
 * `needs`); some steps do nothing by themselves and only open the next one.
 *
 * Good operations speed it up: the day's on-time share scales the points
 * a dollar buys (researchSpeed()), since operating knowledge leads to
 * breakthroughs. It never replaces the money, and poor days slow it.
 *
 * The ladder still decides what is on offer (innovationOpen()); the shop
 * decides how fast it arrives.
 */

/** Dollars a day at each budget level; level 0 is off. */
export const RD_BUDGETS = [0, 1_000, 3_000, 6_000, 12_000];
/** On-time share at which research runs at normal speed, and how much each point above or below moves it. */
export const RD_NORMAL_OTP = 0.75;
export const RD_OTP_SLOPE = 2.5;
export const RD_SPEED_MIN = 0.75;
export const RD_SPEED_MAX = 1.5;

type Outcome = { ok: true; message: string } | { ok: false; reason: string };

export function rdBudgetLevel(state: SimState): number {
  return state.rd?.budgetLevel ?? 0;
}

export function rdBudgetPerDay(state: SimState): number {
  return RD_BUDGETS[rdBudgetLevel(state)] ?? 0;
}

export function rdActive(state: SimState): string | null {
  return state.rd?.active ?? null;
}

export function rdPointsOn(state: SimState, id: string): number {
  return state.rd?.points[id] ?? 0;
}

/** How much of the project is done, 0 to 1. */
export function rdProgress(state: SimState, id: InnovationId): number {
  const cost = innovationById(id)?.oneOffPrice ?? 0;
  if (isAdopted(state, id)) return 1;
  return cost > 0 ? Math.min(1, rdPointsOn(state, id) / cost) : 0;
}

/** Points per dollar from the day's on-time share; 1 on a day with no arrivals. */
export function researchSpeed(state: SimState): number {
  if (state.todayFlightsArrived <= 0) return 1;
  const otp = state.todayFlightsOnTime / state.todayFlightsArrived;
  return Math.max(RD_SPEED_MIN, Math.min(RD_SPEED_MAX, 1 + (otp - RD_NORMAL_OTP) * RD_OTP_SLOPE));
}

function rdState(state: SimState): NonNullable<SimState['rd']> {
  state.rd ??= { budgetLevel: 0, active: null, points: {} };
  return state.rd;
}

export function setRdBudget(state: SimState, level: number): Outcome {
  if (!Number.isInteger(level) || level < 0 || level >= RD_BUDGETS.length) return { ok: false, reason: 'No such budget.' };
  rdState(state).budgetLevel = level;
  return { ok: true, message: level === 0 ? 'R&D off.' : `R&D budget $${RD_BUDGETS[level].toLocaleString()}/day.` };
}

/** Work on this project, turning a budget on if none is set. */
export function startResearch(state: SimState, id: InnovationId): Outcome {
  const project = innovationById(id);
  if (!project) return { ok: false, reason: 'Unknown project.' };
  const blocked = adoptBlockedReason(state, project);
  if (blocked) return { ok: false, reason: blocked };
  const rd = rdState(state);
  rd.active = id;
  if (rd.budgetLevel === 0) rd.budgetLevel = 1;
  return { ok: true, message: `Researching ${project.name}.` };
}

/** The next unfinished step that this one opens, if it is open now. */
function nextStepAfter(state: SimState, id: InnovationId): InnovationId | null {
  const next = INNOVATIONS.find((project) => project.needs === id && !isAdopted(state, project.id) && !adoptBlockedReason(state, project));
  return next?.id ?? null;
}

/**
 * One day's research, at rollover before the day's counters reset: spend the
 * budget on the active project if there is cash for it. Returns the dollars
 * spent, which the caller charges as a running cost.
 */
export function researchDay(state: SimState): number {
  const rd = state.rd;
  if (!rd || !rd.active) return 0;
  const project = innovationById(rd.active as InnovationId);
  if (!project || isAdopted(state, project.id)) {
    rd.active = null;
    return 0;
  }
  const budget = rdBudgetPerDay(state);
  if (budget <= 0 || state.cash < budget) return 0;
  const left = project.oneOffPrice - (rd.points[project.id] ?? 0);
  // The last day of a project pays only for the points still missing.
  const speed = researchSpeed(state);
  const spend = Math.min(budget, Math.ceil(left / speed));
  rd.points[project.id] = (rd.points[project.id] ?? 0) + spend * speed;
  if ((rd.points[project.id] ?? 0) >= project.oneOffPrice) {
    completeInnovation(state, project.id);
    rd.active = nextStepAfter(state, project.id);
  }
  return spend;
}
