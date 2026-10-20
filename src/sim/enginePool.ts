import { dayIndex } from './clock';
import { executiveMaintenanceBaseMultiplier } from './executives';
import type { Outcome } from './playerActions';
import type { SimState } from './state';

/**
 * Engine support: how each aircraft class gets an engine when one fails (an
 * engine fault, one of the AOG faults in sim/aog.ts). Every class is on one
 * of three plans, chosen by the player, so the right answer changes with the
 * fleet:
 *
 *   - Ad hoc: nothing paid until a fault, then the plane waits
 *     ENGINE_WAIT_DAYS more than the fault's own days for a lease engine.
 *   - Own spares: spares of the class are held in a pool at a holding cost a
 *     day each, in the shop or on the shelf. A fault swaps one in the same day
 *     (back the next morning), and the pulled engine goes to the shop for
 *     ENGINE_SHOP_DAYS, paid at ENGINE_SHOP_VISIT_DAYS of the holding cost,
 *     then rejoins the pool. Only pays for a fleet that breaks engines often.
 *   - Power by the hour: a fee on every flight hour the class flies, and a
 *     fault is always back the next morning with no shop bill. Cheapest for
 *     a few planes, dearest for many, since the fee grows with the flying
 *     while one spare covers a whole fleet.
 *
 * Each class keeps a book since its plan was last changed, the way the fuel
 * policy does: faults, plane-days saved or waited, money spent, and the
 * flying those days were worth.
 */
export const ENGINE_WAIT_DAYS = 4;
export const ENGINE_SHOP_DAYS = 20;
export const ENGINE_SHOP_VISIT_DAYS = 40;
export const MAX_SPARE_ENGINES = 3;
/** What one spare engine of each class costs a day to hold. */
export const ENGINE_HOLD_PER_DAY: Record<string, number> = { PROP: 60, REGIONAL: 150, NARROWBODY: 350, WIDEBODY: 750 };
/**
 * Power by the hour, a flight hour. About a plane-day of flying (10-12 h)
 * costs half a spare's holding a day, so two or three planes on it cost what
 * one spare does.
 */
export const ENGINE_PBH_PER_HOUR: Record<string, number> = { PROP: 3, REGIONAL: 7, NARROWBODY: 15, WIDEBODY: 32 };

export type EngineSupport = 'adhoc' | 'pool' | 'pbh';
export const ENGINE_SUPPORTS: EngineSupport[] = ['adhoc', 'pool', 'pbh'];

export type EngineBook = {
  sinceDay: number;
  faults: number;
  /** Plane-days back sooner than ad hoc would have been. */
  daysSaved: number;
  /** Plane-days spent waiting on a lease engine. */
  daysWaited: number;
  /** Holding, shop visits and power-by-the-hour fees. */
  spent: number;
  /** What the saved days' flying was worth, at the plane's margin on the day it failed. */
  protectedValue: number;
  /** What the waited days' flying was worth. */
  lostValue: number;
};

export type EnginePool = {
  /** Spares held, by aircraft class. */
  spares: Record<string, number>;
  /** Engines out for a shop visit: the class and the simMinute it rejoins the pool. */
  inShop: { classCode: string; backAtMinute: number }[];
  /** The plan by class. Absent: own spares when it holds any, otherwise ad hoc. */
  plans?: Record<string, EngineSupport>;
  /** Each class's book since its plan was set. */
  books?: Record<string, EngineBook>;
};

export function holdPerDay(classCode: string): number {
  return ENGINE_HOLD_PER_DAY[classCode] ?? ENGINE_HOLD_PER_DAY.PROP;
}

export function pbhPerHour(classCode: string): number {
  return ENGINE_PBH_PER_HOUR[classCode] ?? ENGINE_PBH_PER_HOUR.PROP;
}

export function engineSupport(state: SimState, classCode: string): EngineSupport {
  return state.enginePool?.plans?.[classCode] ?? (sparesHeld(state, classCode) > 0 ? 'pool' : 'adhoc');
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

function poolOf(state: SimState): EnginePool {
  return (state.enginePool ??= { spares: {}, inShop: [] });
}

function freshBook(state: SimState): EngineBook {
  return { sinceDay: dayIndex(state), faults: 0, daysSaved: 0, daysWaited: 0, spent: 0, protectedValue: 0, lostValue: 0 };
}

export function engineBook(state: SimState, classCode: string): EngineBook | undefined {
  return state.enginePool?.books?.[classCode];
}

function bookOf(state: SimState, classCode: string): EngineBook {
  const books = (poolOf(state).books ??= {});
  return (books[classCode] ??= freshBook(state));
}

/** One class's holding cost a day, with the maintenance executive's saving. */
function classHoldingPerDay(state: SimState, classCode: string): number {
  return sparesHeld(state, classCode) * holdPerDay(classCode) * executiveMaintenanceBaseMultiplier(state);
}

/** The pool's holding cost a day, with the maintenance executive's saving. */
export function enginePoolCostPerDay(state: SimState): number {
  return Object.keys(state.enginePool?.spares ?? {}).reduce((total, classCode) => total + classHoldingPerDay(state, classCode), 0);
}

/**
 * The morning: engines back from the shop rejoin the pool (or, for a class
 * no longer on own spares, are given back), and each class books the day's
 * holding cost that step.ts charges with the bases.
 */
export function rollEngineDay(state: SimState, dayStartMinute: number): void {
  const pool = state.enginePool;
  if (!pool) return;
  const back = pool.inShop.filter((engine) => engine.backAtMinute <= dayStartMinute);
  pool.inShop = pool.inShop.filter((engine) => engine.backAtMinute > dayStartMinute);
  for (const engine of back) {
    if (engineSupport(state, engine.classCode) === 'pool') continue;
    pool.spares[engine.classCode] = Math.max(0, sparesHeld(state, engine.classCode) - 1);
    if (pool.spares[engine.classCode] === 0) delete pool.spares[engine.classCode];
  }
  for (const classCode of Object.keys(pool.spares)) bookOf(state, classCode).spent += classHoldingPerDay(state, classCode);
}

/**
 * An engine fault on a plane of this class: the days it is down, and what the
 * fault costs now (a shop visit on own spares, nothing otherwise). Takes the
 * spare out of the pool for its visit, and books the fault, `dayValue` being
 * what the plane's flying makes a day.
 */
export function engineFault(state: SimState, classCode: string, faultDays: number, dayStartMinute: number, dayValue = 0): { days: number; shopCost: number } {
  const plan = engineSupport(state, classCode);
  const book = bookOf(state, classCode);
  book.faults += 1;
  const value = Math.max(0, dayValue);
  if (plan === 'pbh' || (plan === 'pool' && sparesReady(state, classCode) > 0)) {
    const shopCost = plan === 'pool' ? shopVisitCost(classCode) : 0;
    if (plan === 'pool') poolOf(state).inShop.push({ classCode, backAtMinute: dayStartMinute + ENGINE_SHOP_DAYS * 1440 });
    const saved = faultDays + ENGINE_WAIT_DAYS - 1;
    book.daysSaved += saved;
    book.protectedValue += saved * value;
    book.spent += shopCost;
    return { days: 1, shopCost };
  }
  book.daysWaited += ENGINE_WAIT_DAYS;
  book.lostValue += ENGINE_WAIT_DAYS * value;
  return { days: faultDays + ENGINE_WAIT_DAYS, shopCost: 0 };
}

/** The power-by-the-hour fee for one landed flight's airborne minutes: 0 unless its class is on the plan. Booked here, charged by the caller. */
export function powerByHourFee(state: SimState, classCode: string, airborneMinutes: number): number {
  if (engineSupport(state, classCode) !== 'pbh' || airborneMinutes <= 0) return 0;
  const fee = (airborneMinutes / 60) * pbhPerHour(classCode);
  bookOf(state, classCode).spent += fee;
  return fee;
}

/**
 * Put a class on a plan. Moving off own spares gives back the ones on the
 * shelf at once and the ones in the shop when they're done; moving onto it
 * holds one spare to start. Starts a new book.
 */
export function setEngineSupport(state: SimState, classCode: string, plan: EngineSupport): Outcome<{ message: string }> {
  if (!ENGINE_SUPPORTS.includes(plan)) return { ok: false, reason: 'No such engine plan.' };
  if (!state.aircraft.some((aircraft) => aircraft.typeCode === classCode)) return { ok: false, reason: `No ${classCode} in the fleet.` };
  if (engineSupport(state, classCode) === plan) return { ok: false, reason: 'Already on that plan.' };
  const pool = poolOf(state);
  (pool.plans ??= {})[classCode] = plan;
  if (plan === 'pool') {
    if (sparesHeld(state, classCode) === 0) pool.spares[classCode] = 1;
  } else {
    const inShop = sparesInShop(state, classCode);
    if (inShop > 0) pool.spares[classCode] = inShop;
    else delete pool.spares[classCode];
  }
  (pool.books ??= {})[classCode] = freshBook(state);
  const name = plan === 'adhoc' ? 'ad hoc' : plan === 'pool' ? `own spares · ${sparesHeld(state, classCode)}` : `power by the hour · $${pbhPerHour(classCode)}/h`;
  return { ok: true, message: `${classCode} engines · ${name}` };
}

/** Add or drop a spare engine of a class on own spares. Dropping needs one on the shelf; adding needs a plane of the class. */
export function changeSpareEngines(state: SimState, classCode: string, delta: 1 | -1): Outcome<{ message: string }> {
  const held = sparesHeld(state, classCode);
  if (delta > 0) {
    if (!state.aircraft.some((aircraft) => aircraft.typeCode === classCode)) return { ok: false, reason: `No ${classCode} in the fleet.` };
    if (engineSupport(state, classCode) !== 'pool') return { ok: false, reason: 'Spares are for a class on own spares.' };
    if (held >= MAX_SPARE_ENGINES) return { ok: false, reason: `Up to ${MAX_SPARE_ENGINES} spares a class.` };
  } else if (sparesReady(state, classCode) <= 0) {
    return { ok: false, reason: 'No spare on the shelf to give back.' };
  }
  const pool = poolOf(state);
  // Pin the plan, so giving back the last spare leaves the class on own spares (with none ready) rather than ad hoc.
  (pool.plans ??= {})[classCode] = 'pool';
  pool.spares[classCode] = held + delta;
  if (pool.spares[classCode] === 0) delete pool.spares[classCode];
  return { ok: true, message: `${classCode} spare engines · ${held + delta} · $${(holdPerDay(classCode) * (held + delta)).toLocaleString()}/day` };
}
