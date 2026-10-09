import { CABIN_SHORT_NPS_PENALTY } from './crews';
import { marketKey } from './schedule';
import type { CompetitorOffering } from './competitors';
import type { SimState } from './state';

/**
 * NPS (Net Promoter Score): how passengers rate the airline. Real NPS is
 * a survey; this game has no passengers to survey, so each flight gets a
 * stand-in score from what step.ts knows as it departs: how late it is,
 * how old the airframe is, and how fresh its crew and cabin are. A
 * cancellation scores worst of all. Price is not in it: the fare already
 * acts through the choice model, brand position and market growth, and
 * counting it here too paid one dial four times.
 *
 * Scores add up into a trailing NPS per market and for the network (the
 * second half of this file), and that is what passengers respond to: a
 * better name than a rival's wins bookings from it (sim/choiceModel.ts).
 * Deliberately crude: not fit to any real study, just picked so each
 * input moves the needle the way its real-world counterpart obviously
 * should.
 */

// A flight that leaves exactly on time starts from a mildly positive
// baseline — real NPS surveys skew this way too; reliability is something
// promoters actively praise, not just the absence of a complaint. Falls
// off a flat point per minute of delay, floored so a catastrophic delay
// can't single-handedly overwhelm the other two components below.
const DELAY_BASELINE_POINTS = 30;
const DELAY_PENALTY_PER_MINUTE = 1;
const DELAY_FLOOR_POINTS = -50;

// Same shape as the delay component: a fresh airframe is a mild positive,
// an old one a mild negative, floored well short of the delay
// component's own floor — age should nudge the score, not dominate it the
// way a genuinely bad delay does.
const AGE_BASELINE_POINTS = 10;
const AGE_PENALTY_PER_YEAR = 1;
const AGE_FLOOR_POINTS = -15;

/**
 * The fourth component: cabin service, worth up to this many points from
 * a fresh crew and nothing from a fully tired one (sim/crews.ts's
 * legFatigue()). Sized between the age nudge and the delay component:
 * service is worth more than a fresh airframe and less than getting
 * people there on time.
 */
const CABIN_SERVICE_MAX_POINTS = 15;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Every competitor fare currently on offer for this exact market (either
 * direction, same `marketKey()` the rest of the economy model already
 * uses to mean "this O-D pair, direction ignored"). A market with more
 * than one competitor averages them — this is "how does my fare compare
 * to the going rate here," not "how does it compare to any one rival."
 */
function competitorFaresForMarket(origin: string, dest: string, competitorRoutes: CompetitorOffering[]): number[] {
  const key = marketKey(origin, dest);
  return competitorRoutes.filter((c) => marketKey(c.origin, c.dest) === key).map((c) => c.fare);
}

/**
 * What a cancellation scores, per cancelled flight. Flat and large rather
 * than an extension of the delay curve below, which floors at -50 even
 * for a catastrophic delay: a cancellation isn't a very late flight, it's
 * a different failure entirely — a passenger rebooked or stranded rather
 * than merely kept waiting — and it needs headroom to read as strictly
 * worse than any delay can be.
 */
export const CANCELLATION_NPS_SCORE = -80;

/**
 * One departing flight's score, recorded by recordFlightNps() below.
 * Called from step.ts's departure loop, when every input it needs (this
 * flight's rolled delay, its fare, its aircraft's age) is known.
 */
export function flightSatisfactionScore(
  delayMinutes: number,
  ageYears: number,
  /** 0-1: how fresh the crew is (1 − its fatigue, sim/crews.ts). */
  crewFreshness = 1,
  /** 0-1: the share of the cabin teams its plane needs that it has (sim/crews.ts's cabinCover()). */
  cabinCover = 1,
): number {
  const delayComponent = clamp(
    DELAY_BASELINE_POINTS - delayMinutes * DELAY_PENALTY_PER_MINUTE,
    DELAY_FLOOR_POINTS,
    DELAY_BASELINE_POINTS,
  );

  const ageComponent = clamp(AGE_BASELINE_POINTS - ageYears * AGE_PENALTY_PER_YEAR, AGE_FLOOR_POINTS, AGE_BASELINE_POINTS);

  const cover = clamp(cabinCover, 0, 1);
  const serviceComponent = clamp(crewFreshness, 0, 1) * cover * CABIN_SERVICE_MAX_POINTS - (1 - cover) * CABIN_SHORT_NPS_PENALTY;

  // Real NPS is bounded to [-100, 100] by definition (100% detractors to
  // 100% promoters) — the components above rarely sum past that on their
  // own, but this keeps the invariant true regardless.
  return clamp(delayComponent + ageComponent + serviceComponent, -100, 100);
}

// --- The trailing score, and what it does ------------------------------------------

/**
 * How much each day's average moves the trailing NPS: a daily moving
 * average weighted 1/30, so the score reflects roughly the last month and
 * a good name takes months to build (CLAUDE.md, the game's philosophy: a
 * moat that takes a long time).
 */
export const TRAILING_NPS_WEIGHT = 1 / 30;
/** Days of the network's trailing NPS kept for its trend. */
const NPS_HISTORY_DAYS = 30;

/**
 * The NPS a typical rival earns, which yours is judged against. Rivals
 * aren't scored flight by flight: they are small start-ups with middling
 * service, and a steady airline's first-year NPS sits around 15–25.
 */
export const RIVAL_NPS = 10;
/**
 * Where a new airline's trailing NPS starts: level with a typical rival,
 * since passengers don't know it yet, good or bad. Starting lower cost a
 * careful airline about a tenth of its first year's cash in rivals'
 * markets, a penalty for being new rather than for being bad.
 */
export const STARTING_NPS = RIVAL_NPS;

/**
 * Booking utility per point of NPS ahead of a typical rival
 * (sim/choiceModel.ts). Sized so 30 points ahead is worth about what a 5%
 * fare cut is to a leisure traveller: a real pull, but one price and
 * frequency can still outweigh.
 */
export const NPS_UTILITY_PER_POINT = 0.008;

/**
 * Revenue per point of NPS above (or below) a typical rival's, on every
 * route, rival or not. The name lifts the fare a market clears at, the
 * way the CCO's yield perk does, so NPS pays from the first route
 * instead of only where a rival flies. 30 points is worth 4.5%, about
 * what NPS_UTILITY_PER_POINT is worth against a rival in fare terms.
 */
export const NAME_YIELD_PER_POINT = 0.0015;
/** The most a name adds or costs in ticket revenue. */
const NAME_YIELD_CAP = 0.06;

/** What the airline's name does to ticket revenue on this market, as a multiplier (1 = nothing). */
export function nameYieldMultiplier(state: SimState, origin: string, dest: string): number {
  const gap = marketNps(state, origin, dest) - RIVAL_NPS;
  return 1 + clamp(gap * NAME_YIELD_PER_POINT, -NAME_YIELD_CAP, NAME_YIELD_CAP);
}

/** Score one flight: into the lifetime and today's totals, and its market's day. Cancellations score too. */
export function recordFlightNps(state: SimState, origin: string, dest: string, score: number): void {
  state.npsPointsTotal += score;
  state.todayNpsPoints += score;
  state.npsScoredFlightsTotal += 1;
  state.todayNpsScoredFlights += 1;
  const day = ((state.todayNpsByMarket ??= {})[marketKey(origin, dest)] ??= { points: 0, flights: 0 });
  day.points += score;
  day.flights += 1;
}

/**
 * Fold the day just flown into the trailing scores: the network's, and
 * each market flown today. A market flown for the first time starts from
 * the network's score, since passengers already know the airline's name;
 * a market not flown today keeps its score. At rollover, before today's
 * totals reset.
 */
export function rollTrailingNps(state: SimState): void {
  const network = networkNps(state);
  if (state.todayNpsScoredFlights > 0) {
    const dayAverage = state.todayNpsPoints / state.todayNpsScoredFlights;
    state.trailingNps = network + (dayAverage - network) * TRAILING_NPS_WEIGHT;
  }
  state.npsHistory = [...(state.npsHistory ?? []), networkNps(state)].slice(-NPS_HISTORY_DAYS);
  const byMarket = (state.trailingNpsByMarket ??= {});
  for (const [key, day] of Object.entries(state.todayNpsByMarket ?? {})) {
    const before = byMarket[key] ?? network;
    byMarket[key] = before + (day.points / day.flights - before) * TRAILING_NPS_WEIGHT;
  }
  state.todayNpsByMarket = {};
}

/** The airline's trailing NPS: roughly the last month of flights. */
export function networkNps(state: SimState): number {
  return state.trailingNps ?? STARTING_NPS;
}

/** A market's trailing NPS, or the network's where the airline hasn't flown it yet. */
export function marketNps(state: SimState, origin: string, dest: string): number {
  return state.trailingNpsByMarket?.[marketKey(origin, dest)] ?? networkNps(state);
}

/** How much the airline's name on this market pulls passengers from a typical rival, in booking utility (sim/choiceModel.ts). */
export function brandEdge(state: SimState, origin: string, dest: string): number {
  return (marketNps(state, origin, dest) - RIVAL_NPS) * NPS_UTILITY_PER_POINT;
}

/** An NPS as players read it: whole points, signed ("+14", "−3", "0"). */
export function formatNps(value: number): string {
  const points = Math.round(value);
  if (points === 0) return '0';
  return points > 0 ? `+${points}` : `−${Math.abs(points)}`;
}

/**
 * What the airline's name does on this market, in words, for the route
 * view: how its NPS compares to a typical rival's, and what that means
 * for the passengers the two share. Null where no rival flies it, since
 * then the name wins nobody over from anyone.
 */
export function brandInWords(state: SimState, origin: string, dest: string, competitorRoutes: CompetitorOffering[]): string | null {
  if (competitorFaresForMarket(origin, dest, competitorRoutes).length === 0) return null;
  const gap = Math.round(marketNps(state, origin, dest) - RIVAL_NPS);
  if (Math.abs(gap) < 3) return `level with rivals (${formatNps(RIVAL_NPS)})`;
  if (gap > 0) return `+${gap} vs rivals · winning their pax`;
  return `−${-gap} vs rivals · losing pax to them`;
}
