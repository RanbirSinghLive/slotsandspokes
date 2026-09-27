/**
 * Fuel, as a unitless price index rather than a $/gallon figure: 1.0 is
 * the baseline price, 1.6 is 60% dearer. It multiplies straight into the
 * fuel-sensitive slice of every flight's cost (FUEL_SHARE_OF_BLOCK_HOUR_COST,
 * sim/economy.ts's legCost()), so no aircraft needs a burn rate of its own.
 *
 * The index moves every day and spikes with a fuel shock; the player can
 * hedge against it. Both live in sim/fuelPrice.ts.
 */
export const FUEL_PRICE_BASELINE = 1;
export const FUEL_PRICE_MAX = 2;

/**
 * How much of costPerBlockHour is treated as fuel-sensitive versus fixed
 * (crew, maintenance, overhead already blended into that one number) — a
 * flat fraction applied to every aircraft type alike, same "one crude
 * constant, not per-type tuning" spirit as sim/economy.ts's own
 * LOAD_FACTOR and RECAPTURE_RATE. Regional/narrowbody direct-operating-
 * cost studies commonly put fuel somewhere in the 25%-40% range; 35% is
 * the deliberately unresearched middle of that band, not fit to any one
 * type's real numbers.
 */
export const FUEL_SHARE_OF_BLOCK_HOUR_COST = 0.35;
