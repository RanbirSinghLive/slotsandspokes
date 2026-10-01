import { summarizeMarket } from './marketSummary';
import { marketKey } from './schedule';
import type { Aircraft, SimState } from './state';

/**
 * Cabins (WEEK-FOURTEEN.md, stage 2): a plane is all economy, or has a
 * business cabin up front. A business seat takes the room of
 * ECONOMY_SEATS_PER_BUSINESS economy seats, so a cabin costs seats; it
 * sells only to business travellers, at CABIN_PRICE of the route's base
 * fare, and they value it CABIN_VALUE times an economy seat
 * (sim/fareClasses.ts's sellSeats()). So it pays where business
 * travellers are many and willing (a business trunk) and wastes room on
 * a sun route. A Propeller can't be fitted.
 *
 * Fitting or removing one is a refit: ordered now, it starts the next
 * morning the plane is on the ground at its base, costs REFIT_LEASE_DAYS
 * of its lease, and takes it out of service for its class's REFIT_DAYS.
 * Out of service it is grounded the way an AOG is (sim/aog.ts): its
 * rotations move to spare planes of its class at its base, and what
 * doesn't fit is cancelled until it's back.
 */

export type Cabin = 'economy' | 'business';

/** Business seats as a share of the plane's economy seats. */
const BUSINESS_SEAT_SHARE = 0.08;
/** The room a business seat takes, in economy seats. */
const ECONOMY_SEATS_PER_BUSINESS = 2.5;
/** A business seat's price, as a share of the route's base fare. */
export const CABIN_PRICE = 2.2;
/** What a business traveller thinks a business seat is worth, as a share of an economy seat at the same price. */
export const CABIN_VALUE = 1.8;
/** A refit costs this many days of the plane's lease. */
const REFIT_LEASE_DAYS = 10;
/** Days out of service, by class. */
const REFIT_DAYS: Record<string, number> = { REGIONAL: 3, NARROWBODY: 4, WIDEBODY: 6 };

export type CabinLayout = { economy: number; business: number };

export function cabinOf(aircraft: Pick<Aircraft, 'cabin'>): Cabin {
  return aircraft.cabin ?? 'economy';
}

/** The seats a plane of `seats` has with `cabin` fitted. */
export function cabinLayout(seats: number, cabin: Cabin): CabinLayout {
  if (cabin === 'economy') return { economy: seats, business: 0 };
  const business = Math.round(seats * BUSINESS_SEAT_SHARE);
  return { economy: seats - Math.round(business * ECONOMY_SEATS_PER_BUSINESS), business };
}

export function canHaveBusinessCabin(typeCode: string): boolean {
  return typeCode in REFIT_DAYS;
}

export function refitDays(typeCode: string): number {
  return REFIT_DAYS[typeCode] ?? 0;
}

export function refitCost(aircraft: Aircraft): number {
  return REFIT_LEASE_DAYS * aircraft.leaseCostPerDay;
}

/** Why this plane can't be refitted to `cabin` now, or null if it can. */
export function refitBlockedReason(state: SimState, aircraft: Aircraft, cabin: Cabin): string | null {
  if (!canHaveBusinessCabin(aircraft.typeCode)) return 'A Propeller has no room for a business cabin.';
  if (cabinOf(aircraft) === cabin && !aircraft.refitPending) return `It already has ${cabin === 'business' ? 'a business cabin' : 'an all-economy cabin'}.`;
  if (aircraft.refitPending) return 'A refit is already ordered.';
  if (state.aogs.some((event) => event.tail === aircraft.tail)) return 'It is out of service.';
  if (aircraft.rebase) return 'It is ferrying to another base.';
  if (aircraft.returningOnDay !== undefined) return 'It is going back to the lessor.';
  if (state.cash < refitCost(aircraft)) return `Needs $${refitCost(aircraft).toLocaleString()} on hand.`;
  return null;
}

/** Order a refit: paid now, it starts the next morning at base (sim/aog.ts's morning pass). */
export function orderRefit(state: SimState, tail: string, cabin: Cabin): { ok: true; message: string } | { ok: false; reason: string } {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft) return { ok: false, reason: 'No such plane.' };
  const blocked = refitBlockedReason(state, aircraft, cabin);
  if (blocked) return { ok: false, reason: blocked };
  const cost = refitCost(aircraft);
  state.cash -= cost;
  state.todayCost += cost;
  state.todayCostByCategory.maintenance += cost;
  state.todayMargin -= cost;
  aircraft.refitPending = cabin;
  return { ok: true, message: `${tail} refit to ${cabin} · ${refitDays(aircraft.typeCode)}d from tomorrow · $${cost.toLocaleString()}` };
}

/** Call off a refit that hasn't started, with the money back. */
export function cancelRefit(state: SimState, tail: string): { ok: true; message: string } | { ok: false; reason: string } {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft?.refitPending) return { ok: false, reason: 'No refit is waiting.' };
  const cost = refitCost(aircraft);
  state.cash += cost;
  state.todayCost -= cost;
  state.todayCostByCategory.maintenance -= cost;
  state.todayMargin += cost;
  delete aircraft.refitPending;
  return { ok: true, message: `${tail} refit called off · $${cost.toLocaleString()} back` };
}

/**
 * What a plane's markets would make a day with `cabin` fitted, against
 * now: each market it flies summarised both ways through the game's own
 * forecast (sim/marketSummary.ts). The cabin is swapped on the plane for
 * the forecast and put back; nothing else changes.
 */
export function cabinGainPerDay(state: SimState, tail: string, cabin: Cabin): number {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft) return 0;
  const keys = [...new Set(state.schedule.filter((leg) => leg.tail === tail).map((leg) => marketKey(leg.origin, leg.dest)))];
  const marginNow = () =>
    keys.reduce((sum, key) => {
      const [a, b] = key.split('-');
      const settings = state.routeSettings[key];
      return settings ? sum + summarizeMarket(a, b, state, settings).margin : sum;
    }, 0);
  const before = marginNow();
  const had = aircraft.cabin;
  if (cabin === 'business') aircraft.cabin = 'business';
  else delete aircraft.cabin;
  const after = marginNow();
  if (had) aircraft.cabin = had;
  else delete aircraft.cabin;
  return Math.round(after - before);
}
