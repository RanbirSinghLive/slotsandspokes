import { dayIndex } from './clock';
import { classOpen } from './ladder';
import { listingsOf, type StandingOrder } from './market';
import { leasePlane } from './playerActions';
import type { SimState } from './state';

/**
 * A standing order is the player's way of not watching the lessor: "the
 * next Regional no older than 20 years and under $X a day". At rollover,
 * just after the day's delivery (step.ts), a matching listing is leased
 * for the home airport on the spot, through the same lease the player
 * presses, so every gate applies (class open, crew base, cash for 30
 * days of lease). A lease that can't go through leaves the order waiting,
 * and a lease that does clears it: one order buys one plane, so it can't
 * spend cash unattended.
 */

export function standingOrderOf(state: SimState, typeCode: string): StandingOrder | null {
  return state.market.orders?.[typeCode] ?? null;
}

export function setStandingOrder(state: SimState, typeCode: string, order: StandingOrder): void {
  state.market.orders = { ...(state.market.orders ?? {}), [typeCode]: order };
}

export function clearStandingOrder(state: SimState, typeCode: string): void {
  if (!state.market.orders) return;
  const { [typeCode]: _removed, ...rest } = state.market.orders;
  state.market.orders = rest;
}

/** The listing an order would take now: the youngest that fits its age and rate caps. */
export function listingForOrder(state: SimState, typeCode: string, order: StandingOrder) {
  return (
    listingsOf(state, typeCode)
      .filter((l) => l.ageYears <= order.maxAgeYears && (order.maxRatePerDay === undefined || l.leasePricePerDay <= order.maxRatePerDay))
      .sort((a, b) => a.ageYears - b.ageYears || a.id - b.id)[0] ?? null
  );
}

/** Fill every standing order a listing now satisfies. Returns the tails-to-be as ticker-ready messages. */
export function rollStandingOrders(state: SimState): string[] {
  const messages: string[] = [];
  for (const [typeCode, order] of Object.entries(state.market.orders ?? {})) {
    if (!classOpen(state, typeCode)) continue;
    const listing = listingForOrder(state, typeCode, order);
    if (!listing) continue;
    const result = leasePlane(state, state.homeAirport, typeCode, false, undefined, listing.id);
    if (!result.ok) continue;
    clearStandingOrder(state, typeCode);
    messages.push(`day ${dayIndex(state)} · ${result.message}`);
  }
  return messages;
}
