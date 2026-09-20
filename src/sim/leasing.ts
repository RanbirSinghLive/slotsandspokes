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

/** The rate card, one entry per aircraft class, smallest first. */
export function loadLeaseRates(): LeaseRate[] {
  return (leaseRatesData as LeaseRate[]).map((rate) => ({ ...rate }));
}

/**
 * How many days of a plane's lease the player must hold in cash before
 * leasing it. Rates are sized so a plane pays for itself with a couple of
 * flights a day once its market has grown, which also means a plane
 * leased with nothing behind it drains cash fast; this keeps a lease from
 * being a way to end the game by accident. At the $500,000 opening it lets
 * a Propeller or Regional through and holds Narrowbody and Widebody back
 * until the airline has earned its way there.
 */
export const LEASE_RESERVE_DAYS = 14;

/** Cash needed on hand to lease one plane at this daily rate. */
export function cashNeededToLease(leasePricePerDay: number): number {
  return leasePricePerDay * LEASE_RESERVE_DAYS;
}

/** What one plane of this class costs per day; 0 for an unknown class. */
export function leaseRateFor(typeCode: string): number {
  return (leaseRatesData as LeaseRate[]).find((rate) => rate.typeCode === typeCode)?.leasePricePerDay ?? 0;
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
    leaseCostPerDay: leaseRateFor(typeCode),
    // New from the lessor, and never aged: age-driven delays stay dormant.
    ageYears: 0,
    baseAirport: baseIata,
  };
  state.aircraft.push(aircraft);
  return aircraft;
}
