import { classByCode } from './aircraftClasses';
import { marketKey } from './schedule';
import { networkOverheadPerDay } from './overhead';
import { slotFeesPerDayAt } from './slots';
import type { SimState } from './state';
import { scheduledLegMinutes, USABLE_DAY_MINUTES } from './utilisation';

/**
 * The costs a route causes that aren't charged to it: slot fees, plane
 * leases and network overhead. All are paid airline-wide at midnight (sim/step.ts), so a
 * route's own margin (its P&L history, sim/marketSummary.ts's day) never
 * includes them, and a route at a slot-controlled airport, or one flown by
 * half-idle planes, can look healthy while it loses money. This spreads
 * them over the routes that cause them, so the route view can show a
 * fully costed margin. It only reports: nothing here changes what is
 * charged.
 *
 * - **Slot fees** at an airport are shared among its routes by their
 *   share of the player's movements there (departures plus arrivals).
 * - **Leases** are pooled by aircraft class across the whole airline: all
 *   of a class's daily leases are spread over the minutes that class
 *   flies (block plus turn), and a route carries its minutes' share. So
 *   flying a class less puts more of its lease on each route still
 *   flying it, and a spare plane shows up as a heavier burden on the rest.
 * - **Network overhead** (sim/overhead.ts) is shared by every route's
 *   share of all the airline's flying minutes.
 */

export type SlotShare = { iata: string; share: number; perDay: number };
export type LeaseShare = {
  classCode: string;
  className: string;
  /** This class's leases, all planes, per day. */
  poolLeasePerDay: number;
  /** How much of the class's usable day its planes fly, 0–1 (above 1 when over-booked). */
  poolUse: number;
  /** This route's share of the class's flying. */
  share: number;
  perDay: number;
};

export type RouteFixedCosts = {
  slots: SlotShare[];
  slotsPerDay: number;
  lease: LeaseShare[];
  leasePerDay: number;
  /** This route's share of the airline's network overhead. */
  overheadPerDay: number;
};

export function routeFixedCosts(state: SimState, a: string, b: string): RouteFixedCosts {
  const key = marketKey(a, b);
  const onRoute = state.schedule.filter((leg) => marketKey(leg.origin, leg.dest) === key);

  const slots = [a, b].map((iata) => {
    const movements = state.schedule.filter((leg) => leg.origin === iata || leg.dest === iata).length;
    const mine = onRoute.length; // every leg on this route moves once at each end
    const share = movements > 0 ? mine / movements : 0;
    return { iata, share, perDay: share * slotFeesPerDayAt(state, iata) };
  });

  const classOf = new Map(state.aircraft.map((aircraft) => [aircraft.tail, aircraft.typeCode]));
  const classes = [...new Set(onRoute.map((leg) => classOf.get(leg.tail)).filter((code) => code !== undefined))];
  const lease = classes.map((classCode) => {
    const planes = state.aircraft.filter((aircraft) => aircraft.typeCode === classCode);
    const poolLeasePerDay = planes.reduce((sum, aircraft) => sum + aircraft.leaseCostPerDay, 0);
    const minutesOf = (legs: typeof state.schedule) =>
      legs.filter((leg) => classOf.get(leg.tail) === classCode).reduce((sum, leg) => sum + scheduledLegMinutes(state, leg), 0);
    const poolMinutes = minutesOf(state.schedule);
    const share = poolMinutes > 0 ? minutesOf(onRoute) / poolMinutes : 0;
    return {
      classCode,
      className: classByCode(classCode)?.name ?? classCode,
      poolLeasePerDay,
      poolUse: planes.length > 0 ? poolMinutes / (planes.length * USABLE_DAY_MINUTES) : 0,
      share,
      perDay: share * poolLeasePerDay,
    };
  });

  const routeMinutes = onRoute.reduce((sum, leg) => sum + scheduledLegMinutes(state, leg), 0);
  const allMinutes = state.schedule.reduce((sum, leg) => sum + scheduledLegMinutes(state, leg), 0);

  return {
    slots,
    slotsPerDay: slots.reduce((sum, slot) => sum + slot.perDay, 0),
    lease,
    leasePerDay: lease.reduce((sum, entry) => sum + entry.perDay, 0),
    overheadPerDay: allMinutes > 0 ? (routeMinutes / allMinutes) * networkOverheadPerDay(state) : 0,
  };
}
