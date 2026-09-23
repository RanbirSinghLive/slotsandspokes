import leaseRatesData from '../../data/lease-rates.json';
import type { Aircraft } from './state';

/**
 * Every aircraft in the game is leased. There is no purchase price and no
 * ownership: a plane costs its class's daily rate from the day it is
 * leased, and that charge is taken with the rest of the day's costs in
 * step.ts. Buying outright (tens of millions for a narrowbody) could never
 * be reached inside the length of one game, so the choice was dropped
 * rather than left as a button nobody can press.
 *
 * A plane arrives the moment it is leased, parked at and based at the
 * airport it was leased from.
 */

export type LeaseRate = {
  typeCode: string;
  leasePricePerDay: number;
};

/** What the lessor offers today, one entry per aircraft class, smallest first, priced for the starting vintage. */
export function loadLeaseRates(): LeaseRate[] {
  return (leaseRatesData as LeaseRate[]).map((rate) => ({ ...rate, leasePricePerDay: leaseRateFor(rate.typeCode) }));
}

/**
 * How many days of a plane's lease the player must hold in cash before
 * leasing it. Rates are sized so a plane pays for itself with a couple of
 * flights a day once its market has grown, which also means a plane
 * leased with nothing behind it drains cash fast; this keeps a lease from
 * being a way to end the game by accident. It is also what unlocks the
 * classes: at 20-year-old prices the Propeller needs $79,200, the Regional
 * $306,000, the Narrowbody $828,000 and the Widebody $1.08M, so the
 * bigger classes open as the airline earns them.
 */
export const LEASE_RESERVE_DAYS = 30;

/** Cash needed on hand to lease one plane at this daily rate. */
export function cashNeededToLease(leasePricePerDay: number): number {
  return leasePricePerDay * LEASE_RESERVE_DAYS;
}

/**
 * Aircraft come from the lessor second-hand, and age is the trade the
 * player makes: an old airframe leases cheaply but is late more often
 * (sim/delays.ts's age cause), breaks down more often (sim/crew.ts's AOG
 * roll) and passengers like it less (sim/nps.ts). The rate card in
 * data/lease-rates.json is the price of a *new* airframe; age takes a
 * straight-line discount off it.
 *
 * Every airline starts on 20-year-old "classic" airframes with five years
 * of useful life left. Newer vintages are meant to be unlocked later (not
 * built yet): pricing and reliability are already functions of age, so an
 * unlock only has to offer a younger `ageYears`.
 *
 * Aircraft don't age as the game runs (see Aircraft.ageYears) — five
 * simulated years is roughly ninety hours of play — so remaining life is
 * shown, not enforced.
 */
export const STARTING_AIRCRAFT_AGE_YEARS = 20;
export const USEFUL_LIFE_YEARS = 25;
const LEASE_DISCOUNT_PER_YEAR = 0.02; // 20 years old leases at 60% of new

/** The rate card's new-airframe price for this class; 0 for an unknown class. */
function newLeaseRate(typeCode: string): number {
  return (leaseRatesData as LeaseRate[]).find((rate) => rate.typeCode === typeCode)?.leasePricePerDay ?? 0;
}

/** What one plane of this class and age costs per day. */
export function leaseRateFor(typeCode: string, ageYears: number = STARTING_AIRCRAFT_AGE_YEARS): number {
  const multiplier = Math.max(0, 1 - LEASE_DISCOUNT_PER_YEAR * ageYears);
  return Math.round((newLeaseRate(typeCode) * multiplier) / 10) * 10;
}

/**
 * The next free tail for this class: the class's first letter plus a
 * three-digit counter (`C-P001`, `C-R002`).
 */
function nextTail(typeCode: string, tailsInUse: string[]): string {
  const prefix = `C-${typeCode[0]}`;
  const numbers = tailsInUse
    .filter((tail) => tail.startsWith(prefix))
    .map((tail) => Number(tail.slice(prefix.length)))
    .filter((n) => !Number.isNaN(n));
  const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

/** Lease one plane of this class, based and parked at `baseIata`. Returns it. */
export function leaseAircraft(
  state: { simMinute: number; aircraft: Aircraft[] },
  typeCode: string,
  baseIata: string,
): Aircraft {
  const aircraft: Aircraft = {
    tail: nextTail(typeCode, state.aircraft.map((a) => a.tail)),
    typeCode,
    status: 'ground',
    atAirport: baseIata,
    activeLegId: null,
    groundSinceMinute: state.simMinute,
    leaseCostPerDay: leaseRateFor(typeCode, STARTING_AIRCRAFT_AGE_YEARS),
    ageYears: STARTING_AIRCRAFT_AGE_YEARS,
    baseAirport: baseIata,
  };
  state.aircraft.push(aircraft);
  return aircraft;
}
