import { dayIndex } from './clock';
import type { CompetitorOffering } from './competitors';
import type { SimState } from './state';

/**
 * Time pressure: the reason to keep building. Nothing here hurts a player
 * who keeps growing; it makes standing still lose ground.
 *
 * - **Rivals enter.** From day RIVAL_FIRST_ENTRY_DAY new airlines arrive,
 *   up to MAX_RIVAL_ENTRIES, more often the more money the player's
 *   network leaves on the table (sim/attractiveness.ts), on a market next
 *   to the player's network (sim/competitors.ts). They go after the player
 *   markets with the most on the table, and so do existing rivals' new
 *   routes.
 * - **Rivals grow.** Every competitor, old or new, is more likely to open
 *   routes and add flights the longer the game has run, scaled by
 *   pressureFactor().
 * - **Rivals cut your fares** (rivalYieldFactor()). Without this a rival
 *   on your route cost nothing: markets here are seat-limited (demand in
 *   the hundreds against a 25-seat plane), so splitting the demand left
 *   every plane full, and a rival's own seats even stimulated the market
 *   to your benefit. Competition depresses what each passenger pays.
 * - **Demand keeps growing** (DAILY_DEMAND_GROWTH in sim/marketDemand.ts):
 *   the market a plane filled last month is short of seats this month.
 *
 * All constants live here so difficulty is one place to tune. They are
 * deliberately blunt: a rival on your best route takes a share of it
 * (sim/choiceModel.ts weighs frequency), and the fix is more frequency or a
 * bigger plane, which is exactly what the map already lets you do.
 */

export const RIVAL_FIRST_ENTRY_DAY = 15;
export const MAX_RIVAL_ENTRIES = 5;

/**
 * Profit attracts entry (CLAUDE.md, the game's philosophy). From
 * RIVAL_FIRST_ENTRY_DAY, each day's chance of a new airline arriving is
 * this much per dollar a day left on the table across the player's
 * network (sim/attractiveness.ts): $100k a day is a 5% daily chance, a new
 * airline every three weeks or so. A lean network leaves little on the
 * table and draws few.
 */
export const RIVAL_ENTRY_CHANCE_PER_DOLLAR = 0.05 / 100_000;
/** The most likely a new airline gets on any one day, however much is on the table. */
export const MAX_RIVAL_ENTRY_CHANCE_PER_DAY = 0.1;
/**
 * Money on the table on the player's markets within an existing rival's
 * reach multiplies its daily chance of opening a route by
 * 1 + money / this: $200k a day in reach doubles it.
 */
export const RIVAL_OPENING_MONEY_SCALE = 200_000;

/** How many daily flights any competitor will run on one route. */
export const RIVAL_FREQUENCY_CAP = 4;
/**
 * Rivals close routes that lose money (sim/rivalEconomics.ts). A new route
 * isn't judged until it has run this long, because a market starts small
 * and grows as it's served: measured, half of new rival routes pay within
 * about 12 days and 90% within 43 to 116.
 */
export const RIVAL_CLOSE_GRACE_DAYS = 60;
/**
 * ...and then closes after losing money this many days in a row. Long
 * enough to ride out a bad patch (fuel, or the player moving in):
 * measured, routes that did pay had losing runs of up to about 33 days.
 */
export const RIVAL_CLOSE_AFTER_LOSING_DAYS = 30;
/**
 * An airline won't reopen a market it closed for this long. Without it,
 * measured from London, rivals closed 209 routes in three years and
 * reopened 193 of them within 90 days: a big market that loses money
 * looks just as attractive the day after closing. Long enough for demand
 * growth to have changed the answer.
 */
export const RIVAL_REOPEN_COOLDOWN_DAYS = 180;

/**
 * The most routes one rival airline will fly. Without a cap, pressure
 * made openings ever more likely and networks grew without limit
 * (measured, from London one rival reached 65 routes in three years).
 * By the end of year one most rivals fly 8 to 15, so this starts to bite
 * in year two.
 */
export const RIVAL_MAX_ROUTES_PER_AIRLINE = 20;

/**
 * How much room airline `code` has left to grow, 0 to 1: 1 with no
 * routes, 0 at RIVAL_MAX_ROUTES_PER_AIRLINE. Multiplies its chance of
 * opening a route, so openings slow as its network fills up rather than
 * stopping dead at the cap. Closures (sim/rivalEconomics.ts) free room
 * again, so a full-size airline trades losing routes for new ones.
 */
export function rivalNetworkRoom(state: SimState, code: string): number {
  const routes = state.competitorRoutes.filter((route) => route.code === code).length;
  return Math.max(0, 1 - routes / RIVAL_MAX_ROUTES_PER_AIRLINE);
}

/**
 * After any rival closes a market, no rival opens it for this long: word
 * gets round that it's a losing market. It is what Undercut buys (sim/pricing.ts):
 * squeezing a rival out costs money for a month or more, and this is the
 * stretch of the market to yourself that pays for it. Without it, another
 * airline walked straight in (WEEK-NINE.md's finding).
 */
export const RIVAL_SQUEEZED_RESPITE_DAYS = 90;

/** Whether any rival closed the a–b market within RIVAL_SQUEEZED_RESPITE_DAYS, so none opens it yet. */
export function inRespite(state: SimState, a: string, b: string): boolean {
  const market = [a, b].sort().join('-');
  const since = state.simMinute - RIVAL_SQUEEZED_RESPITE_DAYS * 1440;
  return (state.rivalClosures ?? []).some((closure) => closure.market === market && closure.closedAtMinute >= since);
}

/** Days left of a market's respite, or 0 when none is running. */
export function respiteDaysLeft(state: SimState, a: string, b: string): number {
  const market = [a, b].sort().join('-');
  const latest = Math.max(-Infinity, ...(state.rivalClosures ?? []).filter((closure) => closure.market === market).map((closure) => closure.closedAtMinute));
  if (!Number.isFinite(latest)) return 0;
  return Math.max(0, Math.ceil((latest + RIVAL_SQUEEZED_RESPITE_DAYS * 1440 - state.simMinute) / 1440));
}

/** Whether airline `code` closed the a–b market within RIVAL_REOPEN_COOLDOWN_DAYS. */
export function recentlyClosedByRival(state: SimState, code: string, a: string, b: string): boolean {
  const market = [a, b].sort().join('-');
  const since = state.simMinute - RIVAL_REOPEN_COOLDOWN_DAYS * 1440;
  return (state.rivalClosures ?? []).some(
    (closure) => closure.code === code && closure.market === market && closure.closedAtMinute >= since,
  );
}

/** Chance per route per day, before pressure, that a competitor adds a daily flight. */
export const FREQUENCY_GROWTH_PROBABILITY_PER_DAY = 0.008;

/** Days after which rival activity has doubled. */
export const PRESSURE_RAMP_DAYS = 90;

/** A fleet this big starts drawing rivals' attention, beyond what time alone brings. */
export const ATTENTION_FROM_PLANES = 12;
/** Each this many planes beyond it adds as much again to rival activity. */
export const ATTENTION_PER_PLANES = 10;

/**
 * How active rivals are: 1 on day 0, 2 at PRESSURE_RAMP_DAYS, and so on
 * without a ceiling; and more again for a big airline, since profit is a
 * signal rivals read and a big network is the loudest one (CLAUDE.md):
 * each ATTENTION_PER_PLANES planes past ATTENTION_FROM_PLANES adds as much
 * again. Moats still discount what a rival sees on any one market
 * (sim/attractiveness.ts); this is how often they come looking.
 */
export function pressureFactor(state: SimState): number {
  const day = dayIndex(state);
  const size = Math.max(0, state.aircraft.length - ATTENTION_FROM_PLANES) / ATTENTION_PER_PLANES;
  return (1 + day / PRESSURE_RAMP_DAYS) * (1 + size);
}

/**
 * The most a rival can take off your average fare on a market, when rivals
 * fly all of its flights.
 */
export const MAX_RIVAL_YIELD_LOSS = 0.4;

/** With probability this, a new rival enters a market the player already flies (if any qualifies). */
export const RIVAL_TARGETS_PLAYER = 0.7;

/**
 * Multiplier on a flight's revenue for competition on its market. 1 with
 * no rivals; falls as rivals take a bigger share of the market's flights,
 * to 1 - MAX_RIVAL_YIELD_LOSS if the player flew nothing. The player's own
 * frequency is the counter: four rival flights against four of yours is a
 * 20% cut, against fourteen of yours about 9%.
 *
 * Frequencies are compared in the units the choice model already uses:
 * `playerLegs` is the player's legs on the market (both directions),
 * `dailyFrequency` the rival's.
 */
export function rivalYieldFactor(
  origin: string,
  dest: string,
  playerLegs: number,
  competitors: CompetitorOffering[],
): number {
  let rivalFlights = 0;
  for (const c of competitors) {
    if ((c.origin === origin && c.dest === dest) || (c.origin === dest && c.dest === origin)) {
      rivalFlights += c.dailyFrequency;
    }
  }
  if (rivalFlights === 0) return 1;
  const rivalShare = rivalFlights / (rivalFlights + Math.max(playerLegs, 0));
  return 1 - MAX_RIVAL_YIELD_LOSS * rivalShare;
}
