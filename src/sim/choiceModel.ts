import competitorsData from '../../data/competitors.json';

// The "connective piece" from WEEK-TWO.md's Layers — the standard technique
// for this is a multinomial logit: score every option a traveler could pick
// (your flight, a competitor's, or not travelling at all) with a utility
// function, then market share falls out as a softmax over those scores.
// `bookingShare` below is exactly that softmax, with "stay home" fixed at
// utility 0 (the standard reference point in this kind of model) and one
// term per competitor actually serving the market. A market with zero
// competitors collapses to the plain logistic sigmoid of your own
// utility — which is also exactly what this looked like before competitor
// data existed, so adding competitors changes nothing for a market that
// doesn't have one.

export type CompetitorOffering = {
  airline: string;
  /** Two-letter, all-caps shorthand — see sim/airline.ts's PLAYER_AIRLINE
   * for the player's own equivalent. */
  code: string;
  origin: string;
  dest: string;
  dailyFrequency: number;
  fare: number;
};

/**
 * Static, non-reactive competitor service (WEEK-TWO.md layer 3) — fixed
 * schedules and fares, authored once, never adapting to anything the
 * player does. Deliberately small: real competition only on the handful
 * of markets big enough that a second carrier would plausibly bother,
 * per WEEK-TWO.md's "Competition" note. Fictional airline names — not
 * real carriers, per CLAUDE.md's public-sources-only rule for anything
 * that could be mistaken for real-world data. Exported so
 * render/competition.ts can draw each competitor's own network without
 * duplicating this data or its shape.
 */
export const competitors = competitorsData as CompetitorOffering[];

function competitorsServingMarket(origin: string, dest: string): CompetitorOffering[] {
  return competitors.filter(
    (c) => (c.origin === origin && c.dest === dest) || (c.origin === dest && c.dest === origin),
  );
}

/**
 * A travel-purpose segment (WEEK-TWO.md layer 2, "yield mix") — the same
 * O-D demand pool splits into people with different reasons to travel, who
 * weigh price and schedule convenience differently. `shareOfDemand` is a
 * fixed percentage split applied to every market alike (the "simplest v1"
 * WEEK-TWO.md calls for — varying the split by route is a real refinement,
 * just not this one); all three must sum to 1.
 */
type Segment = {
  name: 'business' | 'leisure' | 'vfr';
  shareOfDemand: number;
  weightPrice: number;
  weightSchedule: number;
  intercept: number;
};

// Weights and intercepts are hand-picked, crude constants in the same
// spirit as `economy.ts`'s `LOAD_FACTOR`/`AVG_FARE` — not fit to any real
// survey, just picked to make each segment behave the way its real-world
// counterpart is known to: business travel is price-insensitive but
// frequency-hungry (a business traveler picks the airline with the most
// convenient departure, cost be damned); leisure is the opposite (books
// around price, doesn't care much whether there's 1 or 3 daily flights);
// VFR (visiting friends/relatives) sits in between. Intercepts are tuned
// so, blended together at today's fixed $185 fare, the result stays close
// to the single-segment v1's ~0.90 baseline rather than silently
// re-swinging the economy again on top of the previous milestone's numbers
// — the point of this pass is to make price/schedule sensitivity
// *differ* by segment, not to change today's aggregate.
const SEGMENTS: Segment[] = [
  { name: 'business', shareOfDemand: 0.2, weightPrice: 0.004, weightSchedule: 0.9, intercept: 2.8 },
  { name: 'leisure', shareOfDemand: 0.5, weightPrice: 0.016, weightSchedule: 0.25, intercept: 4.1 },
  { name: 'vfr', shareOfDemand: 0.3, weightPrice: 0.012, weightSchedule: 0.3, intercept: 3.9 },
];

/**
 * `scheduleFit` stands in for QSI (Quality of Service Index) — real
 * airline revenue-management uses exactly this term for how frequency
 * converts into passenger share. `log2` gives diminishing returns: going
 * from 1 to 2 daily frequencies matters more than going from 5 to 6. The
 * real "S-curve" effect (frequency share converting into *more than
 * proportional* passenger share) is a documented refinement on top of this
 * that v1 deliberately skips — see WEEK-TWO.md's note on it. Each offering
 * (yours, and every competitor's) gets its own utility from its own fare
 * and frequency — the softmax in `segmentBookingShare` is what turns those
 * independent scores into shares, so nothing here needs to know about the
 * other offerings to compute its own utility.
 */
function utility(segment: Segment, fare: number, dailyFrequency: number): number {
  const scheduleFit = Math.log2(1 + dailyFrequency);
  return segment.intercept - segment.weightPrice * fare + segment.weightSchedule * scheduleFit;
}

// The "Commercial" panel's marketing-spend lever (ui/commercial.ts, week
// two): daily dollars spent promoting one specific market, added as a
// bonus only to *your* utility — a competitor's offering is unaffected by
// what you spend, and "stay home" always stays at a fixed 0. `log2` again
// gives diminishing returns, same reasoning as scheduleFit above: the
// first few hundred dollars of awareness matter more than the next few
// hundred. Zero spend contributes a zero bonus, so a market nobody has
// ever put money into behaves exactly as it did before this lever existed.
const MARKETING_WEIGHT = 0.5;
const MARKETING_SCALE = 500;

function marketingBonus(marketingSpend: number): number {
  return MARKETING_WEIGHT * Math.log2(1 + marketingSpend / MARKETING_SCALE);
}

/**
 * The two softmax scores every segment-level share below is built from:
 * your own offering's score, and the summed score of every competitor
 * serving the market. Factored out once so `bookingShare` (share of the
 * whole addressable market, "stay home" included) and `trafficShare`
 * (share of *travelers only*, "stay home" excluded — see below) can't
 * drift apart on how "your score" or "competitor score" is computed.
 */
function scores(
  segment: Segment,
  fare: number,
  legsServingMarket: number,
  competitors: CompetitorOffering[],
  marketingSpend: number,
): { yourScore: number; competitorScore: number } {
  const yourScore = Math.exp(utility(segment, fare, legsServingMarket) + marketingBonus(marketingSpend));
  const competitorScore = competitors.reduce(
    (total, c) => total + Math.exp(utility(segment, c.fare, c.dailyFrequency)),
    0,
  );
  return { yourScore, competitorScore };
}

/**
 * One segment's softmax over every offering in this market: your flight,
 * every competitor serving the same market, and a fixed "stay home"
 * option at utility 0. Your share is your term over the sum of all of
 * them — standard multinomial logit. With `competitors` empty and
 * `marketingSpend` zero this is algebraically identical to the plain
 * logistic sigmoid of your own utility, which is what this whole model
 * was before competitor data and marketing spend existed.
 */
function segmentBookingShare(
  segment: Segment,
  fare: number,
  legsServingMarket: number,
  competitors: CompetitorOffering[],
  marketingSpend: number,
): number {
  const { yourScore, competitorScore } = scores(segment, fare, legsServingMarket, competitors, marketingSpend);
  const stayHomeScore = Math.exp(0);
  return yourScore / (yourScore + stayHomeScore + competitorScore);
}

/**
 * One segment's share of *travelers*, not of the whole addressable
 * market — the "stay home" term is excluded entirely, so this answers
 * "of the people who fly this market, what fraction fly you" rather than
 * "of everyone who could conceivably travel, what fraction books you."
 * That's the conventional meaning of "market share." A market with zero
 * competitors is trivially 100% by this definition (competitorScore is 0),
 * regardless of how few people actually travel there at all — booking
 * share (above) is what answers that latter question instead.
 */
function segmentTrafficShare(
  segment: Segment,
  fare: number,
  legsServingMarket: number,
  competitors: CompetitorOffering[],
  marketingSpend: number,
): number {
  const { yourScore, competitorScore } = scores(segment, fare, legsServingMarket, competitors, marketingSpend);
  return yourScore / (yourScore + competitorScore);
}

/**
 * What fraction of a market's demand books *your* flight — versus a
 * competitor's, or not travelling at all — given this flight's fare, how
 * many daily frequencies serve the market, which market this is (to look
 * up who else is serving it), and how much of the "Commercial" panel's
 * marketing-spend lever is currently allocated to it. Blended across all
 * three segments, weighted by each one's share of the demand pool.
 * `economy.ts` calls this with one flat fare for everyone (no
 * fare-by-segment lever exists), so the segments differ only in how they
 * individually react to that same fare, frequency, and marketing spend —
 * not in what they pay or what marketing they see.
 */
export function bookingShare(
  fare: number,
  legsServingMarket: number,
  originIata: string,
  destIata: string,
  marketingSpend: number,
): number {
  const marketCompetitors = competitorsServingMarket(originIata, destIata);
  return SEGMENTS.reduce(
    (total, segment) =>
      total +
      segment.shareOfDemand * segmentBookingShare(segment, fare, legsServingMarket, marketCompetitors, marketingSpend),
    0,
  );
}

/**
 * Your conventional "market share" of this route: of the people who
 * actually travel this market (direct flights only — connecting
 * itineraries aren't modeled, per WEEK-TWO.md decision 1, so this can't
 * yet account for someone connecting through a third city instead), what
 * fraction fly you rather than a direct competitor. 100% on any market
 * with no direct competitor, regardless of how thin that market is —
 * see `bookingShare` for the separate question of how many of the
 * *addressable* population travel at all.
 */
export function trafficShare(
  fare: number,
  legsServingMarket: number,
  originIata: string,
  destIata: string,
  marketingSpend: number,
): number {
  const marketCompetitors = competitorsServingMarket(originIata, destIata);
  return SEGMENTS.reduce(
    (total, segment) =>
      total +
      segment.shareOfDemand * segmentTrafficShare(segment, fare, legsServingMarket, marketCompetitors, marketingSpend),
    0,
  );
}
