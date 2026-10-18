import { canHaveBusinessCabin, layoutFor, maxBusinessSeats, maxPremiumSeats, orderRefit, planOfTarget, refitBlockedReason, sameSeatPlan, seatPlanOf, seatPlanProblem, seatsOfType, describeLayout, type SeatPlan } from './cabins';
import { summarizeMarket } from './marketSummary';
import { marketKey } from './schedule';
import type { Aircraft, CabinTemplate, SimState } from './state';

/**
 * Product: cabins for a whole fleet rather than one plane at a time
 * (sim/cabins.ts has the seats themselves).
 *
 * A template is a seat plan saved under a name for one type, so the same
 * cabin can be put on another plane without setting the seats again.
 *
 * A type's standard cabin is the one every plane of that type should have.
 * Setting it charges nothing at once: each morning, at each base, one plane
 * of the type that isn't on it is ordered a refit to it (paid then, at the
 * usual refit price), so a base never has more than one plane of a type
 * out for it. The plane flying least goes first, to cancel as little as
 * possible. A plane the player refits to something else keeps its own
 * cabin until told to follow the standard again. A plane delivered while a
 * standard is set arrives with it fitted: the lessor fits it to order.
 */

/** Templates a type may have saved. */
export const MAX_TEMPLATES_PER_TYPE = 6;
const MAX_NAME_LENGTH = 24;

type Result = { ok: true; message: string } | { ok: false; reason: string };

export function templatesFor(state: SimState, typeCode: string): CabinTemplate[] {
  return (state.cabinTemplates ?? []).filter((template) => template.typeCode === typeCode);
}

export function fleetCabinOf(state: SimState, typeCode: string): SeatPlan | null {
  return state.fleetCabins?.[typeCode] ?? null;
}

function planOf(template: CabinTemplate): SeatPlan {
  return { business: template.business, premium: template.premium };
}

/** Why `plan` can't be a template or standard for `typeCode`, or null. */
function planProblem(typeCode: string, plan: SeatPlan): string | null {
  if (!canHaveBusinessCabin(typeCode)) return 'A Propeller has no room for a cabin.';
  return seatPlanProblem(seatsOfType(typeCode), plan);
}

export function saveCabinTemplate(state: SimState, typeCode: string, plan: SeatPlan, name?: string): Result {
  const problem = planProblem(typeCode, plan);
  if (problem) return { ok: false, reason: problem };
  const existing = templatesFor(state, typeCode);
  const same = existing.find((template) => sameSeatPlan(planOf(template), plan));
  if (same) return { ok: false, reason: `Saved already as ${same.name}.` };
  if (existing.length >= MAX_TEMPLATES_PER_TYPE) return { ok: false, reason: `${MAX_TEMPLATES_PER_TYPE} templates is the most a type keeps.` };
  const id = state.nextCabinTemplateId ?? 1;
  state.nextCabinTemplateId = id + 1;
  const trimmed = (name ?? '').trim().slice(0, MAX_NAME_LENGTH);
  const layout = describeLayout(layoutFor(seatsOfType(typeCode), plan));
  (state.cabinTemplates ??= []).push({ id, name: trimmed || layout, typeCode, business: plan.business, premium: plan.premium });
  return { ok: true, message: `Template saved · ${layout}` };
}

export function deleteCabinTemplate(state: SimState, id: number): Result {
  const template = (state.cabinTemplates ?? []).find((t) => t.id === id);
  if (!template) return { ok: false, reason: 'No such template.' };
  state.cabinTemplates = state.cabinTemplates!.filter((t) => t.id !== id);
  return { ok: true, message: `Template ${template.name} deleted` };
}

export function renameCabinTemplate(state: SimState, id: number, name: string): Result {
  const template = (state.cabinTemplates ?? []).find((t) => t.id === id);
  if (!template) return { ok: false, reason: 'No such template.' };
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  if (!trimmed) return { ok: false, reason: 'A template needs a name.' };
  template.name = trimmed;
  return { ok: true, message: `Template renamed ${trimmed}` };
}

/**
 * Make `plan` the standard cabin for every plane of `typeCode`, or clear
 * it with null. Every plane of the type follows it, including those kept
 * on their own cabin before.
 */
export function setFleetCabin(state: SimState, typeCode: string, plan: SeatPlan | null): Result {
  if (plan === null) {
    if (state.fleetCabins) delete state.fleetCabins[typeCode];
    for (const aircraft of state.aircraft) if (aircraft.typeCode === typeCode) delete aircraft.ownCabin;
    return { ok: true, message: `${typeCode} standard cabin cleared · each plane keeps its own` };
  }
  const problem = planProblem(typeCode, plan);
  if (problem) return { ok: false, reason: problem };
  (state.fleetCabins ??= {})[typeCode] = { business: plan.business, premium: plan.premium };
  for (const aircraft of state.aircraft) if (aircraft.typeCode === typeCode) delete aircraft.ownCabin;
  const behind = offStandard(state, typeCode).length;
  return { ok: true, message: `${typeCode} standard ${describeLayout(layoutFor(seatsOfType(typeCode), plan))} · ${behind} to refit, one per base at a time` };
}

/** Put a plane kept on its own cabin back on its type's standard. */
export function followFleetCabin(state: SimState, tail: string): Result {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft?.ownCabin) return { ok: false, reason: 'It follows the standard already.' };
  delete aircraft.ownCabin;
  return { ok: true, message: `${tail} follows the standard cabin` };
}

/** What a refit to `plan` does to whether the plane follows its type's standard: off it, it keeps its own. */
export function noteRefitTarget(state: SimState, aircraft: Aircraft, plan: SeatPlan): void {
  const standard = fleetCabinOf(state, aircraft.typeCode);
  if (!standard || sameSeatPlan(standard, plan)) delete aircraft.ownCabin;
  else aircraft.ownCabin = true;
}

/** Whether the plane has, or is booked to get, `plan`. */
function hasOrGets(state: SimState, aircraft: Aircraft, plan: SeatPlan): boolean {
  const refit = state.aogs.find((event) => event.tail === aircraft.tail && event.refitTo);
  const seats = seatsOfType(aircraft.typeCode);
  const target = refit?.refitTo ?? aircraft.refitPending;
  if (target !== undefined) return sameSeatPlan(planOfTarget(target, seats), plan);
  return sameSeatPlan(seatPlanOf(aircraft), plan);
}

/** Planes of the type that should be on its standard and aren't, nor booked for it. */
function offStandard(state: SimState, typeCode: string): Aircraft[] {
  const standard = fleetCabinOf(state, typeCode);
  if (!standard) return [];
  return state.aircraft.filter((a) => a.typeCode === typeCode && !a.ownCabin && a.returningOnDay === undefined && !hasOrGets(state, a, standard));
}

/** Where a type stands against its standard cabin, for the Product screen. */
export type FleetCabinStatus = {
  standard: SeatPlan | null;
  planes: number;
  /** On the standard now. */
  onStandard: number;
  /** In a refit to it, or ordered one. */
  refitting: number;
  /** Waiting their turn, one per base at a time. */
  waiting: number;
  /** Kept on their own cabin. */
  own: number;
};

export function fleetCabinStatus(state: SimState, typeCode: string): FleetCabinStatus {
  const planes = state.aircraft.filter((a) => a.typeCode === typeCode);
  const standard = fleetCabinOf(state, typeCode);
  if (!standard) return { standard, planes: planes.length, onStandard: 0, refitting: 0, waiting: 0, own: 0 };
  const own = planes.filter((a) => a.ownCabin).length;
  const onStandard = planes.filter((a) => !a.ownCabin && sameSeatPlan(seatPlanOf(a), standard) && !a.refitPending && !state.aogs.some((event) => event.tail === a.tail && event.refitTo !== undefined)).length;
  const waiting = offStandard(state, typeCode).length;
  return { standard, planes: planes.length, onStandard, refitting: planes.length - own - onStandard - waiting, waiting, own };
}

/** Whether a plane of `typeCode` at `base` is out for a refit, or booked one. */
function refitUnderwayAt(state: SimState, typeCode: string, base: string): boolean {
  return state.aircraft.some(
    (a) => a.typeCode === typeCode && a.baseAirport === base && (a.refitPending !== undefined || state.aogs.some((event) => event.tail === a.tail && event.refitTo !== undefined)),
  );
}

/**
 * The morning pass (sim/aog.ts, before refits start): at each base, one
 * plane of each type behind its standard is ordered a refit to it, unless
 * one there is already in or booked for one. One that can't be refitted
 * today (out of service, ferrying, short of cash) waits for a later
 * morning.
 */
export function rollFleetCabins(state: SimState): void {
  for (const typeCode of Object.keys(state.fleetCabins ?? {})) {
    const standard = state.fleetCabins![typeCode];
    const behind = offStandard(state, typeCode);
    const bases = [...new Set(behind.map((a) => a.baseAirport).filter((base): base is string => base !== null))].sort();
    for (const base of bases) {
      if (refitUnderwayAt(state, typeCode, base)) continue;
      const legsOf = (tail: string) => state.schedule.filter((leg) => leg.tail === tail).length;
      const next = behind
        .filter((a) => a.baseAirport === base && refitBlockedReason(state, a, standard) === null)
        .sort((x, y) => legsOf(x.tail) - legsOf(y.tail) || x.tail.localeCompare(y.tail))[0];
      if (next) orderRefit(state, next.tail, standard);
    }
  }
}

/** A delivery arrives with its type's standard cabin fitted (sim/fleetTiming.ts). */
export function fitStandardOnDelivery(state: SimState, aircraft: Aircraft): void {
  const standard = fleetCabinOf(state, aircraft.typeCode);
  if (!standard || (standard.business === 0 && standard.premium === 0)) return;
  aircraft.seatPlan = { ...standard };
}

/**
 * What every plane of the type that follows the standard would make a day
 * with `plan`, against now: all of them swapped at once and their markets
 * summarised through the game's own forecast, then put back. Planes kept
 * on their own cabin are left as they are.
 */
export function typeCabinGainPerDay(state: SimState, typeCode: string, plan: SeatPlan): number {
  const planes = state.aircraft.filter((a) => a.typeCode === typeCode && !a.ownCabin);
  if (planes.length === 0) return 0;
  const tails = new Set(planes.map((a) => a.tail));
  const keys = [...new Set(state.schedule.filter((leg) => tails.has(leg.tail)).map((leg) => marketKey(leg.origin, leg.dest)))];
  if (keys.length === 0) return 0;
  const margin = () =>
    keys.reduce((sum, key) => {
      const [a, b] = key.split('-');
      const settings = state.routeSettings[key];
      return settings ? sum + summarizeMarket(a, b, state, settings).margin : sum;
    }, 0);
  const before = margin();
  const saved = planes.map((a) => ({ a, cabin: a.cabin, seatPlan: a.seatPlan }));
  for (const a of planes) {
    delete a.cabin;
    a.seatPlan = { ...plan };
  }
  const after = margin();
  for (const { a, cabin, seatPlan } of saved) {
    if (cabin) a.cabin = cabin;
    else delete a.cabin;
    if (seatPlan) a.seatPlan = seatPlan;
    else delete a.seatPlan;
  }
  return Math.round(after - before);
}

/** The plan that makes the type's markets the most a day, on the same grid as one plane's best fit (sim/cabins.ts). */
export function bestTypeSeatPlan(state: SimState, typeCode: string): { plan: SeatPlan; gainPerDay: number } | null {
  if (!canHaveBusinessCabin(typeCode)) return null;
  const seats = seatsOfType(typeCode);
  const stepsPerAxis = 8;
  const businessStep = Math.max(1, Math.ceil(maxBusinessSeats(seats, 0) / stepsPerAxis));
  const premiumStep = Math.max(1, Math.ceil(maxPremiumSeats(seats, 0) / stepsPerAxis));
  let best: { plan: SeatPlan; gainPerDay: number } | null = null;
  for (let business = 0; business <= maxBusinessSeats(seats, 0); business += businessStep) {
    for (let premium = 0; premium <= maxPremiumSeats(seats, business); premium += premiumStep) {
      const plan = { business, premium };
      const gainPerDay = typeCabinGainPerDay(state, typeCode, plan);
      if (!best || gainPerDay > best.gainPerDay) best = { plan, gainPerDay };
    }
  }
  return best;
}
