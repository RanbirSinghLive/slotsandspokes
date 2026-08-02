import { marketKey } from './schedule';
import type { CompetitorOffering } from './competitors';

/**
 * Week five's second HUD "quality signal," alongside On-Time performance
 * (see WEEK-FIVE.md's "Reputation" design). Real NPS (Net Promoter Score)
 * is a survey question — this game has no passengers to survey, so this
 * derives a stand-in from three things step.ts already knows about a
 * departing flight the instant it rolls: how late it's actually going to
 * be, how its fare compares to whatever competitors serve the same
 * market, and how old the airframe flying it is. Deliberately crude, same
 * "not fit to any real study, just picked so each input moves the needle
 * the way its real-world counterpart obviously should" spirit as
 * economy.ts's LOAD_FACTOR or step.ts's own age-delay constants.
 */

// A flight that leaves exactly on time starts from a mildly positive
// baseline — real NPS surveys skew this way too; reliability is something
// promoters actively praise, not just the absence of a complaint. Falls
// off a flat point per minute of delay, floored so a catastrophic delay
// can't single-handedly overwhelm the other two components below.
const DELAY_BASELINE_POINTS = 30;
const DELAY_PENALTY_PER_MINUTE = 1;
const DELAY_FLOOR_POINTS = -50;

// How much being cheaper (or pricier) than the competition on this
// specific market is worth, in points, per fraction of the average
// competitor fare you're undercutting them by. No competitor on this
// market at all: no fare component rather than treating "no comparison
// available" as either a bonus or a penalty.
const FARE_SENSITIVITY = 100;
const FARE_CAP_POINTS = 30;

// Same shape as the delay component: a fresh airframe is a mild positive,
// an old one a mild negative, floored well short of the delay
// component's own floor — age should nudge the score, not dominate it the
// way a genuinely bad delay does.
const AGE_BASELINE_POINTS = 10;
const AGE_PENALTY_PER_YEAR = 1;
const AGE_FLOOR_POINTS = -15;

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
 * One departing flight's contribution to the lifetime NPS average
 * (`state.npsPointsTotal`, divided by `state.flightsDepartedTotal` — the
 * same revenue-flights-only denominator On-Time performance already uses,
 * since it's the same population: a positioning move isn't a passenger
 * experience worth scoring, same reasoning `onTimeByMarket` already
 * applies). Called from step.ts's departure loop, the same moment
 * `flightsOnTimeTotal` and the delay-cause breakdown are updated, since
 * every input this needs (this flight's rolled delay, its fare, its
 * aircraft's age) is already known by then.
 */
/**
 * What a cancellation scores, per cancelled flight. Flat and large rather
 * than an extension of the delay curve below, which floors at -50 even
 * for a catastrophic delay: a cancellation isn't a very late flight, it's
 * a different failure entirely — a passenger rebooked or stranded rather
 * than merely kept waiting — and it needs headroom to read as strictly
 * worse than any delay can be.
 */
export const CANCELLATION_NPS_SCORE = -80;

export function flightSatisfactionScore(
  delayMinutes: number,
  fare: number,
  ageYears: number,
  origin: string,
  dest: string,
  competitorRoutes: CompetitorOffering[],
): number {
  const delayComponent = clamp(
    DELAY_BASELINE_POINTS - delayMinutes * DELAY_PENALTY_PER_MINUTE,
    DELAY_FLOOR_POINTS,
    DELAY_BASELINE_POINTS,
  );

  const competitorFares = competitorFaresForMarket(origin, dest, competitorRoutes);
  let fareComponent = 0;
  if (competitorFares.length > 0) {
    const avgCompetitorFare = competitorFares.reduce((sum, f) => sum + f, 0) / competitorFares.length;
    const cheaperFraction = (avgCompetitorFare - fare) / avgCompetitorFare; // positive: you're cheaper
    fareComponent = clamp(cheaperFraction * FARE_SENSITIVITY, -FARE_CAP_POINTS, FARE_CAP_POINTS);
  }

  const ageComponent = clamp(AGE_BASELINE_POINTS - ageYears * AGE_PENALTY_PER_YEAR, AGE_FLOOR_POINTS, AGE_BASELINE_POINTS);

  // Real NPS is bounded to [-100, 100] by definition (100% detractors to
  // 100% promoters) — the three components above rarely sum past that on
  // their own, but this keeps the invariant true regardless.
  return clamp(delayComponent + fareComponent + ageComponent, -100, 100);
}
