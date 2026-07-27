import fleetMarketData from '../../data/fleet-market.json';

/**
 * One available airframe in the acquisition market — hand-authored, same
 * spirit as data/competitors.json: a fixed, small set of individually named
 * aircraft (not randomly generated or replenished), each either bought
 * outright or leased once, then gone from the list. Only one aircraft
 * *type* exists so far (BEH1900D, data/aircraft-types.json), so every
 * listing shares it — this models several distinct used airframes of the
 * same type, not multiple types, which stays out of scope per CLAUDE.md.
 * `ageYears` is flavor/pricing only: older airframes are simply cheaper to
 * buy or lease here, with no separate reliability or maintenance mechanic
 * attached to it.
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
