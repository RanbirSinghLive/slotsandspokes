import fleetMarketData from '../../data/fleet-market.json';

/**
 * One available airframe in the acquisition market — hand-authored, same
 * spirit as data/competitors.json: a fixed, small set of individually named
 * aircraft (not randomly generated or replenished), each either bought
 * outright or leased once, then gone from the list. Two listings per type
 * across the week-four aircraft ladder (data/aircraft-types.json) — this
 * models several distinct used airframes per type, not a type catalog of
 * its own.
 *
 * `ageYears` sets pricing here (older airframes are cheaper to buy or
 * lease) and is also copied onto the resulting `Aircraft` record at
 * acquisition (ui/fleetMarket.ts) to feed one of step.ts's three delay
 * causes — the same number doing double duty as a price signal and a
 * reliability one, not two separate fields to keep in sync.
 */
export type FleetListing = {
  registration: string;
  typeCode: string;
  ageYears: number;
  buyPrice: number;
  leasePricePerDay: number;
};

/**
 * A fresh, independent copy of the market listings — same reasoning as
 * sim/schedule.ts's loadSchedule(): each game gets its own mutable array
 * (state.fleetMarket), so buying an aircraft in one game can never remove
 * it from another's, and nothing mutates this module's own data directly.
 */
export function loadFleetMarket(): FleetListing[] {
  return (fleetMarketData as FleetListing[]).map((listing) => ({ ...listing }));
}
