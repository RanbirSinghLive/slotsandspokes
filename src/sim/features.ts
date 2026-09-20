/**
 * Systems that are built but parked while the core loop (schedule, watch
 * the day run, read the P&L, adjust) gets right. A switch here turns the
 * whole system off inside the sim, not just its UI: hiding a tab alone
 * would leave its rules still grounding aircraft and charging money with
 * no way for the player to see why.
 *
 * Flip a flag to `true` to bring the system back exactly as it was.
 */

/**
 * Crews: pilots, cabin crew and mechanics, hiring, training lines, reserve
 * depth, crew-caused groundings, and the payroll. Off means aircraft always
 * have someone to fly them, no salaries are charged, and the crew slice of
 * block-hour cost stays inside block-hour cost (see sim/economy.ts).
 */
export const CREWS_ENABLED = false;

/**
 * Fuel price swings: a mean-reverting random walk on the fuel share of
 * block-hour cost. Off pins the index at its baseline of 1, so fuel is a
 * steady cost rather than noise the player can't act on.
 */
export const FUEL_PRICE_MOVES = false;

/**
 * Airport slots: the two slot-controlled fields (YYZ, LGA) gating how many
 * departures you may add there. Off means no airport is slot-controlled,
 * so nothing gates route building and there is nothing to buy.
 */
export const SLOTS_ENABLED = false;

/**
 * Authored missions: one-off objectives that pay Reputation. Off means none
 * ever complete, so nothing announces one and Reputation never moves from
 * this source.
 */
export const MISSIONS_ENABLED = false;
