import aircraftTypesData from '../../data/aircraft-types.json';
import { marketMix } from './marketCharacter';
import { summarizeMarket } from './marketSummary';
import { marketKey } from './schedule';
import type { Aircraft, SimState } from './state';
import type { SegmentName } from './timeOfDay';

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
 * Premium economy (W) sits between: PREMIUM_SEAT_ROOM economy seats each,
 * sold at PREMIUM_PRICE of the fare, valued by each segment at
 * PREMIUM_VALUE. A plane's seat plan is how many J and W seats it has, the
 * rest economy, within MAX_PREMIUM_ROOM_SHARE of its room. A plane with
 * the old business-only cabin reads as the plan it always was.
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
export const ECONOMY_SEATS_PER_BUSINESS = 2.5;
/** A business seat's price, as a share of the route's base fare. */
export const CABIN_PRICE = 2.2;
/** What a business traveller thinks a business seat is worth, as a share of an economy seat at the same price. */
export const CABIN_VALUE = 1.8;
/** A refit costs this many days of the plane's lease. */
const REFIT_LEASE_DAYS = 10;
/** Days out of service, by class. */
const REFIT_DAYS: Record<string, number> = { REGIONAL: 3, NARROWBODY: 4, WIDEBODY: 6 };

/** How many business (J) and premium economy (W) seats a plane has; the rest are economy (Y). */
export type SeatPlan = { business: number; premium: number };
/** What a refit can be ordered to: a seat plan, or the old whole cabins. */
export type RefitTarget = Cabin | SeatPlan;

export type CabinLayout = { economy: number; premium: number; business: number };

/** The room a premium economy seat takes, in economy seats. */
export const PREMIUM_SEAT_ROOM = 1.5;
/** A premium seat's price, as a share of the route's base fare. */
export const PREMIUM_PRICE = 1.45;
/** What each segment thinks a premium seat is worth, as a share of an economy seat at the same price. */
export const PREMIUM_VALUE: Record<SegmentName, number> = { business: 1.3, vfr: 1.1, leisure: 1.15 };
/** The most of a plane's room the J and W seats may take: economy keeps the rest. */
const MAX_PREMIUM_ROOM_SHARE = 0.65;

export function cabinOf(aircraft: Pick<Aircraft, 'cabin' | 'seatPlan'>): Cabin {
  return aircraft.cabin ?? ((aircraft.seatPlan?.business ?? 0) > 0 ? 'business' : 'economy');
}

function legacyBusinessPlan(seats: number): SeatPlan {
  return { business: Math.round(seats * BUSINESS_SEAT_SHARE), premium: 0 };
}

/** The seats a plane of `seats` has with `plan` fitted. */
export function layoutFor(seats: number, plan: SeatPlan): CabinLayout {
  const room = Math.round(plan.business * ECONOMY_SEATS_PER_BUSINESS + plan.premium * PREMIUM_SEAT_ROOM);
  return { economy: Math.max(0, seats - room), premium: plan.premium, business: plan.business };
}

/** The seats a plane of `seats` has with `cabin` fitted. */
export function cabinLayout(seats: number, cabin: Cabin): CabinLayout {
  return layoutFor(seats, cabin === 'business' ? legacyBusinessPlan(seats) : { business: 0, premium: 0 });
}

/** A target as a seat plan for a plane of `seats`. */
export function planOfTarget(target: RefitTarget, seats: number): SeatPlan {
  if (target === 'business') return legacyBusinessPlan(seats);
  if (target === 'economy') return { business: 0, premium: 0 };
  return target;
}

export function seatsOfType(typeCode: string): number {
  return (aircraftTypesData as Array<{ code: string; seats: number }>).find((type) => type.code === typeCode)?.seats ?? 0;
}

/** The J and W seats a plane has now. */
export function seatPlanOf(aircraft: Pick<Aircraft, 'cabin' | 'seatPlan' | 'typeCode'>): SeatPlan {
  if (aircraft.seatPlan) return aircraft.seatPlan;
  return aircraft.cabin === 'business' ? legacyBusinessPlan(seatsOfType(aircraft.typeCode)) : { business: 0, premium: 0 };
}

/** A plane's seats by cabin, given the seats of its type. */
export function layoutOf(aircraft: Pick<Aircraft, 'cabin' | 'seatPlan' | 'typeCode'>, seats: number): CabinLayout {
  return layoutFor(seats, seatPlanOf(aircraft));
}

export function sameSeatPlan(a: SeatPlan, b: SeatPlan): boolean {
  return a.business === b.business && a.premium === b.premium;
}

/** Why `plan` doesn't fit a plane of `seats`, or null. */
export function seatPlanProblem(seats: number, plan: SeatPlan): string | null {
  if (!Number.isInteger(plan.business) || !Number.isInteger(plan.premium) || plan.business < 0 || plan.premium < 0) return 'Seat counts are whole numbers.';
  const room = Math.round(plan.business * ECONOMY_SEATS_PER_BUSINESS + plan.premium * PREMIUM_SEAT_ROOM);
  if (room > Math.floor(seats * MAX_PREMIUM_ROOM_SHARE)) return `J and W seats can take at most ${Math.round(MAX_PREMIUM_ROOM_SHARE * 100)}% of the room.`;
  return null;
}

/** The most J seats a plane of `seats` takes with `premium` W seats fitted, and the most W with `business` J. */
export function maxBusinessSeats(seats: number, premium: number): number {
  return Math.max(0, Math.floor((Math.floor(seats * MAX_PREMIUM_ROOM_SHARE) - premium * PREMIUM_SEAT_ROOM) / ECONOMY_SEATS_PER_BUSINESS));
}
export function maxPremiumSeats(seats: number, business: number): number {
  return Math.max(0, Math.floor((Math.floor(seats * MAX_PREMIUM_ROOM_SHARE) - business * ECONOMY_SEATS_PER_BUSINESS) / PREMIUM_SEAT_ROOM));
}

/** "12J 24W 114Y": a plane's seats by cabin. */
export function describeLayout(layout: CabinLayout): string {
  return [layout.business > 0 ? `${layout.business}J` : '', layout.premium > 0 ? `${layout.premium}W` : '', `${layout.economy}Y`].filter(Boolean).join(' ');
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

/** Why this plane can't be refitted to `target` now, or null if it can. */
export function refitBlockedReason(state: SimState, aircraft: Aircraft, target: RefitTarget): string | null {
  if (!canHaveBusinessCabin(aircraft.typeCode)) return 'A Propeller has no room for a business cabin.';
  const seats = seatsOfType(aircraft.typeCode);
  const plan = planOfTarget(target, seats);
  const problem = seatPlanProblem(seats, plan);
  if (problem) return problem;
  if (sameSeatPlan(plan, seatPlanOf(aircraft)) && !aircraft.refitPending) return 'It already has this cabin.';
  if (aircraft.refitPending) return 'A refit is already ordered.';
  if (state.aogs.some((event) => event.tail === aircraft.tail)) return 'It is out of service.';
  if (aircraft.rebase) return 'It is ferrying to another base.';
  if (aircraft.returningOnDay !== undefined) return 'It is going back to the lessor.';
  if (state.cash < refitCost(aircraft)) return `Needs $${refitCost(aircraft).toLocaleString()} on hand.`;
  return null;
}

/** Order a refit: paid now, it starts the next morning at base (sim/aog.ts's morning pass). */
export function orderRefit(state: SimState, tail: string, target: RefitTarget): { ok: true; message: string } | { ok: false; reason: string } {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft) return { ok: false, reason: 'No such plane.' };
  const blocked = refitBlockedReason(state, aircraft, target);
  if (blocked) return { ok: false, reason: blocked };
  const seats = seatsOfType(aircraft.typeCode);
  const plan = planOfTarget(target, seats);
  const cost = refitCost(aircraft);
  state.cash -= cost;
  state.todayCost += cost;
  state.todayCostByCategory.maintenance += cost;
  state.todayMargin -= cost;
  aircraft.refitPending = { ...plan };
  return { ok: true, message: `${tail} refit to ${describeLayout(layoutFor(seats, plan))} · ${refitDays(aircraft.typeCode)}d from tomorrow · $${cost.toLocaleString()}` };
}

/** A finished refit: the plane has the seats it was ordered with. */
export function applyRefit(aircraft: Aircraft, target: RefitTarget): void {
  const plan = planOfTarget(target, seatsOfType(aircraft.typeCode));
  delete aircraft.cabin;
  if (plan.business === 0 && plan.premium === 0) delete aircraft.seatPlan;
  else aircraft.seatPlan = { ...plan };
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

/** Hours of hangar work in a refit, by class: contracted out when no rated bay is free (sim/aog.ts). */
const REFIT_WORK_HOURS: Record<string, number> = { REGIONAL: 150, NARROWBODY: 250, WIDEBODY: 400 };

export function refitWorkMinutes(typeCode: string): number {
  return (REFIT_WORK_HOURS[typeCode] ?? 0) * 60;
}

/**
 * What a plane's markets would make a day with `target` fitted, against
 * now: each market it flies summarised both ways through the game's own
 * forecast (sim/marketSummary.ts). The seats are swapped on the plane for
 * the forecast and put back; nothing else changes.
 */
export function cabinGainPerDay(state: SimState, tail: string, target: RefitTarget): number {
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
  const hadCabin = aircraft.cabin;
  const hadPlan = aircraft.seatPlan;
  delete aircraft.cabin;
  aircraft.seatPlan = { ...planOfTarget(target, seatsOfType(aircraft.typeCode)) };
  const after = marginNow();
  if (hadCabin) aircraft.cabin = hadCabin;
  if (hadPlan) aircraft.seatPlan = hadPlan;
  else delete aircraft.seatPlan;
  return Math.round(after - before);
}

/**
 * Who flies the markets a type is flying now: each segment's share of
 * demand, averaged over its planes' routes weighted by flights a day.
 * Null when none of the type's planes flies.
 */
export function typeSegmentSplit(state: SimState, typeCode: string): Record<SegmentName, number> | null {
  const tails = new Set(state.aircraft.filter((a) => a.typeCode === typeCode).map((a) => a.tail));
  const total: Record<SegmentName, number> = { leisure: 0, vfr: 0, business: 0 };
  let weight = 0;
  for (const leg of state.schedule) {
    if (!tails.has(leg.tail)) continue;
    const mix = marketMix(leg.origin, leg.dest);
    for (const segment of Object.keys(total) as SegmentName[]) total[segment] += mix[segment];
    weight++;
  }
  if (weight === 0) return null;
  for (const segment of Object.keys(total) as SegmentName[]) total[segment] /= weight;
  return total;
}

/**
 * The seat plan that makes the plane's markets the most a day, tried on a
 * grid of J and W seats through the same forecast, with what it gains
 * against now. The plane's current plan is on the grid, so it never
 * recommends a loss.
 */
export function bestSeatPlan(state: SimState, tail: string): { plan: SeatPlan; gainPerDay: number } | null {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft || !canHaveBusinessCabin(aircraft.typeCode)) return null;
  const seats = seatsOfType(aircraft.typeCode);
  const current = seatPlanOf(aircraft);
  const stepsPerAxis = 8;
  const businessStep = Math.max(1, Math.ceil(maxBusinessSeats(seats, 0) / stepsPerAxis));
  const premiumStep = Math.max(1, Math.ceil(maxPremiumSeats(seats, 0) / stepsPerAxis));
  let best = { plan: current, gainPerDay: 0 };
  for (let business = 0; business <= maxBusinessSeats(seats, 0); business += businessStep) {
    for (let premium = 0; premium <= maxPremiumSeats(seats, business); premium += premiumStep) {
      const plan = { business, premium };
      if (sameSeatPlan(plan, current)) continue;
      const gainPerDay = cabinGainPerDay(state, tail, plan);
      if (gainPerDay > best.gainPerDay) best = { plan, gainPerDay };
    }
  }
  return best;
}
