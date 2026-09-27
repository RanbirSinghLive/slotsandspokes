import { dayIndex } from './clock';
import { executiveDeliveryMultiplier, executiveReturnMultiplier } from './executives';
import { leaseAircraft } from './leasing';
import type { MarketListing } from './market';
import type { Aircraft, SimState } from './state';

/**
 * Every change to the fleet takes time (WEEK-TEN.md, thread 12), so an
 * airline has to plan its planes and crews ahead rather than react:
 *
 * - **Deliveries.** A lease takes the listing off the shelf at once (no
 *   rival can have it), but the plane is delivered LEASE_DELIVERY_DAYS
 *   later, based at the airport it was leased at. Its lease starts on
 *   delivery.
 * - **Returns.** A plane handed back (with no flights left) goes back to
 *   the lessor over RETURN_DAYS. Meanwhile it flies nothing and still
 *   costs its lease and its share of overhead, so an airline that swaps
 *   planes all the time pays for it twice.
 *
 * Crews joining take time too (sim/crews.ts). Everything pending shows on
 * the map at its airport (render/airports.ts) and in the ticker.
 */

export const LEASE_DELIVERY_DAYS = 7;
export const RETURN_DAYS = 10;

export type InboundLease = {
  typeCode: string;
  /** The airport it will be based at. */
  base: string;
  ageYears: number;
  leasePricePerDay: number;
  /** The day it's delivered and starts flying (and costing). */
  arrivesDay: number;
};

/** Days from signing a lease to the plane's delivery: shorter with a fleet programmes COO (sim/executives.ts). */
export function deliveryDays(state: SimState): number {
  return Math.max(1, Math.round(LEASE_DELIVERY_DAYS * executiveDeliveryMultiplier(state)));
}

/** Days a returned plane takes to go back to the lessor: shorter with a fleet programmes COO. */
export function returnDays(state: SimState): number {
  return Math.max(1, Math.round(RETURN_DAYS * executiveReturnMultiplier(state)));
}

/** Sign a lease on this listing, already taken off the shelf: the plane is delivered later. Returns its delivery day. */
export function orderLease(state: SimState, listing: MarketListing, base: string): number {
  const arrivesDay = dayIndex(state) + deliveryDays(state);
  (state.inboundLeases ??= []).push({
    typeCode: listing.typeCode,
    base,
    ageYears: listing.ageYears,
    leasePricePerDay: listing.leasePricePerDay,
    arrivesDay,
  });
  return arrivesDay;
}

/** Planes on their way to an airport (or anywhere), optionally of one class. */
export function inboundAt(state: SimState, base?: string, typeCode?: string): InboundLease[] {
  return (state.inboundLeases ?? []).filter((lease) => (base === undefined || lease.base === base) && (typeCode === undefined || lease.typeCode === typeCode));
}

/** Whether this plane is on its way back to the lessor. */
export function isReturning(aircraft: Aircraft): boolean {
  return aircraft.returningOnDay !== undefined;
}

/** Start handing a plane back: it leaves the fleet after the return time, costing its lease until then. Returns the day it goes. */
export function startReturn(state: SimState, aircraft: Aircraft): number {
  aircraft.returningOnDay = dayIndex(state) + returnDays(state);
  return aircraft.returningOnDay;
}

/**
 * At rollover, before the day's crewing: planes due are delivered into the
 * fleet, and planes whose return is complete leave it and go back on the
 * lessor's shelf at their age and rate.
 */
export function rollDailyFleet(state: SimState): void {
  const today = dayIndex(state);
  const due = (state.inboundLeases ?? []).filter((lease) => lease.arrivesDay <= today);
  if (due.length > 0) {
    state.inboundLeases = (state.inboundLeases ?? []).filter((lease) => lease.arrivesDay > today);
    for (const lease of due) leaseAircraft(state, lease.typeCode, lease.base, lease.ageYears, lease.leasePricePerDay);
  }
  const leaving = state.aircraft.filter((aircraft) => aircraft.returningOnDay !== undefined && aircraft.returningOnDay <= today);
  for (const aircraft of leaving) {
    state.aircraft = state.aircraft.filter((a) => a !== aircraft);
    state.market.listings.push({
      id: state.market.nextListingId++,
      typeCode: aircraft.typeCode,
      ageYears: aircraft.ageYears,
      leasePricePerDay: aircraft.leaseCostPerDay,
      listedDay: today,
    });
  }
}

export type PendingAt = {
  /** Planes on their way here, and days until the first is delivered. */
  planesIn: { count: number; days: number } | null;
  /** Crews hired or retraining here, and days until the first joins. */
  crewsIn: { count: number; days: number } | null;
  /** Planes going back from here, and days until the first has gone. */
  planesOut: { count: number; days: number } | null;
};

function soonest(items: { count: number; day: number }[], today: number): { count: number; days: number } | null {
  if (items.length === 0) return null;
  return { count: items.reduce((sum, item) => sum + item.count, 0), days: Math.max(0, Math.min(...items.map((item) => item.day)) - today) };
}

/** Everything under way at each airport, by IATA, for its signal on the map. Airports with nothing pending are left out. */
export function pendingByAirport(state: SimState): Map<string, PendingAt> {
  const today = dayIndex(state);
  const byIata = new Map<string, { planesIn: { count: number; day: number }[]; crewsIn: { count: number; day: number }[]; planesOut: { count: number; day: number }[] }>();
  const at = (iata: string) => {
    let entry = byIata.get(iata);
    if (!entry) byIata.set(iata, (entry = { planesIn: [], crewsIn: [], planesOut: [] }));
    return entry;
  };
  for (const lease of state.inboundLeases ?? []) at(lease.base).planesIn.push({ count: 1, day: lease.arrivesDay });
  for (const [iata, base] of Object.entries(state.crewBases ?? {})) {
    for (const batch of [...(base.hiring ?? []), ...(base.retraining ?? [])]) at(iata).crewsIn.push({ count: batch.count, day: batch.readyDay });
  }
  for (const aircraft of state.aircraft) {
    if (aircraft.returningOnDay !== undefined && aircraft.baseAirport) at(aircraft.baseAirport).planesOut.push({ count: 1, day: aircraft.returningOnDay });
  }
  const result = new Map<string, PendingAt>();
  for (const [iata, entry] of byIata) {
    const pending = { planesIn: soonest(entry.planesIn, today), crewsIn: soonest(entry.crewsIn, today), planesOut: soonest(entry.planesOut, today) };
    if (pending.planesIn || pending.crewsIn || pending.planesOut) result.set(iata, pending);
  }
  return result;
}
