import { executiveMaintenanceBaseMultiplier } from './executives';
import type { Outcome } from './playerActions';
import type { SimState } from './state';

/**
 * The spare engine pool. An engine fault (one of the AOG faults, sim/aog.ts)
 * leaves the plane waiting for an engine: ENGINE_WAIT_DAYS more than the
 * fault's own days, for one off the lease market. With a spare of the plane's
 * class in the pool, it is swapped in the same day (back the next morning),
 * and the pulled engine goes to the shop for ENGINE_SHOP_DAYS, paid at
 * ENGINE_SHOP_VISIT_DAYS of the spare's holding cost, then rejoins the pool.
 * Every spare costs its holding cost a day, in the shop or on the shelf, so a
 * pool only pays for a fleet big enough to break engines often.
 */
export const ENGINE_WAIT_DAYS = 4;
export const ENGINE_SHOP_DAYS = 20;
export const ENGINE_SHOP_VISIT_DAYS = 40;
export const MAX_SPARE_ENGINES = 3;
/** What one spare engine of each class costs a day to hold. */
export const ENGINE_HOLD_PER_DAY: Record<string, number> = { PROP: 60, REGIONAL: 150, NARROWBODY: 350, WIDEBODY: 750 };

export type EnginePool = {
  /** Spares held, by aircraft class. */
  spares: Record<string, number>;
  /** Engines out for a shop visit: the class and the simMinute it rejoins the pool. */
  inShop: { classCode: string; backAtMinute: number }[];
};

export function holdPerDay(classCode: string): number {
  return ENGINE_HOLD_PER_DAY[classCode] ?? ENGINE_HOLD_PER_DAY.PROP;
}

export function sparesHeld(state: SimState, classCode: string): number {
  return state.enginePool?.spares[classCode] ?? 0;
}

export function sparesInShop(state: SimState, classCode: string): number {
  return (state.enginePool?.inShop ?? []).filter((engine) => engine.classCode === classCode).length;
}

export function sparesReady(state: SimState, classCode: string): number {
  return sparesHeld(state, classCode) - sparesInShop(state, classCode);
}

export function shopVisitCost(classCode: string): number {
  return holdPerDay(classCode) * ENGINE_SHOP_VISIT_DAYS;
}

/** The pool's holding cost a day, with the maintenance executive's saving. */
export function enginePoolCostPerDay(state: SimState): number {
  const held = Object.entries(state.enginePool?.spares ?? {}).reduce((total, [classCode, count]) => total + count * holdPerDay(classCode), 0);
  return held * executiveMaintenanceBaseMultiplier(state);
}

/** Engines back from the shop rejoin the pool: run each morning. */
export function returnEngines(state: SimState, dayStartMinute: number): void {
  const pool = state.enginePool;
  if (pool) pool.inShop = pool.inShop.filter((engine) => engine.backAtMinute > dayStartMinute);
}

/**
 * An engine fault on a plane of this class: the days it is down, and the
 * shop visit's cost (0 without a spare). Takes the spare out of the pool for
 * its visit.
 */
export function engineFault(state: SimState, classCode: string, faultDays: number, dayStartMinute: number): { days: number; shopCost: number } {
  if (sparesReady(state, classCode) <= 0) return { days: faultDays + ENGINE_WAIT_DAYS, shopCost: 0 };
  state.enginePool!.inShop.push({ classCode, backAtMinute: dayStartMinute + ENGINE_SHOP_DAYS * 1440 });
  return { days: 1, shopCost: shopVisitCost(classCode) };
}

/** Add or drop a spare engine of a class. Dropping needs one on the shelf; adding needs a plane of the class. */
export function changeSpareEngines(state: SimState, classCode: string, delta: 1 | -1): Outcome<{ message: string }> {
  const held = sparesHeld(state, classCode);
  if (delta > 0) {
    if (!state.aircraft.some((aircraft) => aircraft.typeCode === classCode)) return { ok: false, reason: `No ${classCode} in the fleet.` };
    if (held >= MAX_SPARE_ENGINES) return { ok: false, reason: `Up to ${MAX_SPARE_ENGINES} spares a class.` };
  } else if (sparesReady(state, classCode) <= 0) {
    return { ok: false, reason: 'No spare on the shelf to give back.' };
  }
  const pool = (state.enginePool ??= { spares: {}, inShop: [] });
  pool.spares[classCode] = held + delta;
  if (pool.spares[classCode] === 0) delete pool.spares[classCode];
  return { ok: true, message: `${classCode} spare engines · ${held + delta} · $${(holdPerDay(classCode) * (held + delta)).toLocaleString()}/day` };
}
