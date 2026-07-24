export type EconomyLeg = {
  blockMinutes: number;
};

export type EconomyAircraftType = {
  seats: number;
  costPerBlockHour: number;
  costPerDeparture: number;
};

export type FlightResult = {
  pax: number;
  revenue: number;
  cost: number;
  margin: number;
};

// Deliberately crude for now, per WEEK-ONE.md: every flight fills the same
// fraction of seats at the same fare, regardless of route, day, or demand.
// Good enough to see whether cash moves in a direction the numbers explain;
// nowhere near good enough to balance the game around.
const LOAD_FACTOR = 0.75;
const AVG_FARE = 185;

/**
 * The revenue, cost, and margin for one completed flight. Applied on
 * arrival (see sim/step.ts) — a flight in the air hasn't earned or spent
 * anything yet as far as the books are concerned.
 */
export function flightResult(leg: EconomyLeg, type: EconomyAircraftType): FlightResult {
  const pax = Math.round(type.seats * LOAD_FACTOR);
  const revenue = pax * AVG_FARE;
  const cost = (leg.blockMinutes / 60) * type.costPerBlockHour + type.costPerDeparture;
  return { pax, revenue, cost, margin: revenue - cost };
}
