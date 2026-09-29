import aircraftTypesData from '../../data/aircraft-types.json';
import { classByCode } from './aircraftClasses';
import { crewBases, crewNeed, crewsArriving, crewsOf, CREWS_PER_NEW_PLANE } from './crews';
import { dayIndex } from './clock';
import { legCost, type EconomyAircraftType } from './economy';
import { airlineFuelPrice } from './fuelPrice';
import { marketDistanceNm } from './demand';
import { computeBlockMinutes, isAircraftTypeAllowedAt } from './schedule';
import type { Aircraft, SimState } from './state';

/**
 * Moving a plane from one crew base to another: a ferry flight with no
 * passengers, then the paperwork of a new base. It's how an airline puts
 * an airframe where the money is without handing it back and waiting for
 * another, so it has to cost enough that it isn't a free way round the
 * lessor's return fee and delivery time:
 *
 * - Only a plane with nothing scheduled, on the ground and not AOG or
 *   returning, can go, and only to another of the airline's crew bases.
 * - It pays the ferry (the flight's block and departure costs, one hop
 *   per stretch of its range) plus REBASE_FEE_LEASE_DAYS of its lease.
 * - It's away REBASE_DAYS, flying nothing and still costing its lease,
 *   and joins the new base at rollover. Crews don't move with it: the
 *   new base needs CREWS_PER_NEW_PLANE crews rated on it, like a delivery.
 */

export const REBASE_DAYS = 2;
export const REBASE_FEE_LEASE_DAYS = 3;

const typesByCode = new Map(
  (aircraftTypesData as (EconomyAircraftType & { code: string; cruiseKts: number; rangeNm: number })[]).map((t) => [t.code, t]),
);

/** Whether this plane is on its way to a new base. */
export function isRebasing(aircraft: Aircraft): boolean {
  return aircraft.rebase !== undefined;
}

/** Why this plane can't be rebased at all right now, or null when it can. */
function blockedReason(state: SimState, aircraft: Aircraft): string | null {
  if (!aircraft.baseAirport) return `${aircraft.tail} has no base yet`;
  if (aircraft.rebase) return `${aircraft.tail} ferrying to ${aircraft.rebase.to} · based there day ${aircraft.rebase.arrivesDay}`;
  if (aircraft.returningOnDay !== undefined) return `${aircraft.tail} returning to the lessor`;
  if (state.schedule.some((leg) => leg.tail === aircraft.tail)) return `${aircraft.tail} still has flights · remove them first`;
  if (state.aogs.some((event) => event.tail === aircraft.tail)) return `${aircraft.tail} AOG`;
  if (aircraft.status !== 'ground') return `${aircraft.tail} airborne`;
  return null;
}

/** The ferry's cost: block and departure for each hop its range needs. */
function ferryCost(state: SimState, aircraft: Aircraft, to: string): { cost: number; hops: number } {
  const type = typesByCode.get(aircraft.typeCode);
  const from = aircraft.baseAirport;
  if (!type || !from) return { cost: 0, hops: 1 };
  const hops = Math.max(1, Math.ceil(marketDistanceNm(from, to) / type.rangeNm));
  const block = computeBlockMinutes(from, to, type.cruiseKts);
  const cost = legCost(block, type, airlineFuelPrice(state), state.fuelEfficiencyMultiplier) + (hops - 1) * type.costPerDeparture;
  return { cost: Math.round(cost), hops };
}

export type RebaseOption = {
  to: string;
  fee: number;
  hops: number;
  arrivesDay: number;
  /** Crews rated on its class at the new base (on hand and joining) against what they'd need with it there. */
  crews: number;
  crewsNeeded: number;
  /** Why it can't go there, or null when it can. */
  blocked: string | null;
};

/**
 * Every other crew base this plane could move to, with the cost and what
 * its crews would look like there. Empty when the airline has one base.
 */
export function rebaseOptions(state: SimState, tail: string): { blocked: string | null; options: RebaseOption[] } {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft) return { blocked: 'No such plane.', options: [] };
  const blocked = blockedReason(state, aircraft);
  const arrivesDay = dayIndex(state) + REBASE_DAYS;
  const name = classByCode(aircraft.typeCode)?.name ?? aircraft.typeCode;
  const options = Object.entries(crewBases(state))
    .filter(([iata]) => iata !== aircraft.baseAirport)
    .map(([iata, base]): RebaseOption => {
      const { cost, hops } = ferryCost(state, aircraft, iata);
      const fee = cost + REBASE_FEE_LEASE_DAYS * aircraft.leaseCostPerDay;
      let reason = blocked;
      if (!reason && !isAircraftTypeAllowedAt(iata, aircraft.typeCode)) reason = `${name} too large for ${iata}`;
      if (!reason && state.cash < fee) reason = `Needs $${fee.toLocaleString()} on hand`;
      return {
        to: iata,
        fee,
        hops,
        arrivesDay,
        crews: crewsOf(base, aircraft.typeCode) + crewsArriving(base, aircraft.typeCode),
        crewsNeeded: crewNeed(state, iata, aircraft.typeCode).minimum + CREWS_PER_NEW_PLANE,
        blocked: reason,
      };
    })
    .sort((a, b) => a.fee - b.fee);
  return { blocked, options };
}

/** Send a plane to another crew base: paid now, based there after REBASE_DAYS. */
export function rebasePlane(state: SimState, tail: string, to: string): { ok: true; message: string } | { ok: false; reason: string } {
  const option = rebaseOptions(state, tail).options.find((o) => o.to === to);
  if (!option) return { ok: false, reason: `No crew base at ${to}.` };
  if (option.blocked) return { ok: false, reason: option.blocked };
  const aircraft = state.aircraft.find((a) => a.tail === tail)!;
  state.cash -= option.fee;
  state.todayCost += option.fee;
  state.todayCostByCategory.lease += option.fee;
  state.todayMargin -= option.fee;
  aircraft.rebase = { from: aircraft.baseAirport!, to, arrivesDay: option.arrivesDay };
  return {
    ok: true,
    message: `${tail} ferrying ${aircraft.baseAirport}→${to} · $${option.fee.toLocaleString()} · based at ${to} day ${option.arrivesDay}`,
  };
}

/** At rollover, with the day's deliveries: planes whose ferry is done join their new base. */
export function rollDailyRebases(state: SimState): void {
  const today = dayIndex(state);
  for (const aircraft of state.aircraft) {
    if (!aircraft.rebase || aircraft.rebase.arrivesDay > today) continue;
    aircraft.baseAirport = aircraft.rebase.to;
    aircraft.atAirport = aircraft.rebase.to;
    delete aircraft.rebase;
  }
}
