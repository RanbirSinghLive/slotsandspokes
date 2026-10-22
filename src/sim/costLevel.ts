import type { SimState } from './state';

/**
 * How dear it is to run an airline, as a multiple of the prices the
 * game's rate cards and fees are written in. Every running cost and fee
 * the player and the rivals pay is multiplied by it where it is defined:
 * leases, the non-fuel part of flying (crew time, wear, handling and
 * landing fees), slots, overhead, crews, maintenance, stations, executives,
 * innovations, licences and chargers. Fees that are counted in days of a
 * plane's lease (returns, swaps, ferries, refits, expedited repairs) follow
 * the lease.
 *
 * Kept as the written price: fuel, because the price index is a number
 * players know from the news and it stays inside its historical range;
 * fares, which are revenue; hedge premiums, a share of the fuel they
 * cover; and the care paid per stranded passenger, a published rule.
 *
 * Fares stay where real tickets are, so this is what sets an airline's
 * margin: at 1.5 a grown long-haul network runs near a real airline's 5%,
 * where at 1 it ran near 27% and growth paid at any cost. At 2 a widebody
 * route no longer covers its lease.
 */
export const COST_LEVEL = 1.5;

/**
 * Multiply every price a save locked in by `factor`: the leases on planes
 * in the fleet and on their way, the lessor's shelf, the price caps on
 * standing orders, and the fees on slot pairs held. A save written at
 * another cost level takes today's prices this way when it loads
 * (ui/save.ts). Everything else is priced fresh each day.
 */
export function repriceToCostLevel(state: SimState, factor: number): void {
  const reprice = (price: number) => Math.round((price * factor) / 10) * 10;
  for (const aircraft of state.aircraft) aircraft.leaseCostPerDay = reprice(aircraft.leaseCostPerDay);
  for (const lease of state.inboundLeases ?? []) lease.leasePricePerDay = reprice(lease.leasePricePerDay);
  for (const listing of state.market?.listings ?? []) listing.leasePricePerDay = reprice(listing.leasePricePerDay);
  for (const order of Object.values(state.market?.orders ?? {})) {
    if (order.maxRatePerDay !== undefined) order.maxRatePerDay = reprice(order.maxRatePerDay);
  }
  // Slot fees are quoted to the nearest $5 (sim/slots.ts).
  for (const fees of Object.values(state.slotsHeld ?? {})) {
    for (let index = 0; index < fees.length; index++) fees[index] = Math.round((fees[index] * factor) / 5) * 5;
  }
}
