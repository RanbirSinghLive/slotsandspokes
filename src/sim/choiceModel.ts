import type { CompetitorOffering } from './competitors';
import { recommendedFare } from './schedule';

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
//
// Week four (M14): competitor service used to be static, non-reactive
// data (fixed schedules and fares, authored once, never adapting to
// anything). `bookingShare()`/`trafficShare()` below now take a live
// `competitorRoutes` list instead of reading a fixed import directly, so
// they reflect `state.competitorRoutes` — which the competitor AI
// (`sim/competitors.ts`) can grow over time — rather than only ever
// seeing `data/competitors.json`'s seed routes.

function competitorsServingMarket(
  origin: string,
  dest: string,
  allCompetitorRoutes: CompetitorOffering[],
): CompetitorOffering[] {
  return allCompetitorRoutes.filter(
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
/**
 * The fare, in dollars, that price sensitivity was tuned around. Fares
 * are not judged in absolute dollars: a $1,200 ticket to London is a
 * normal price and a $1,200 ticket to Ottawa is absurd, so what a traveler
 * reacts to is the fare *relative to the going rate for that trip*
 * (`recommendedFare()`, sim/schedule.ts), rescaled to this reference so
 * the segment weights below mean what they always did. Before this, the
 * price term used raw dollars, which was fine while every market was a
 * short hop (fares of $200 to $350) and wiped out nearly all bookings on
 * anything long: at $1,577 the leisure segment's utility was -21.
 */
const REFERENCE_FARE = 280;

/** `fare` re-expressed on the reference scale: unchanged for a market priced at REFERENCE_FARE, doubled for one priced at twice the going rate. */
function relativeFare(fare: number, goingRate: number): number {
  return (fare * REFERENCE_FARE) / goingRate;
}

function utility(segment: Segment, fare: number, dailyFrequency: number, goingRate: number): number {
  const scheduleFit = Math.log2(1 + dailyFrequency);
  return segment.intercept - segment.weightPrice * relativeFare(fare, goingRate) + segment.weightSchedule * scheduleFit;
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
  goingRate: number,
  brandEdge: number,
): { yourScore: number; competitorScore: number } {
  const yourScore = Math.exp(utility(segment, fare, legsServingMarket, goingRate));
  // Your name against theirs (sim/nps.ts's brandEdge()): a better NPS
  // makes each rival's offer look that much worse, which moves passengers
  // between airlines without changing how many travel at all.
  const competitorScore = competitors.reduce(
    (total, c) => total + Math.exp(utility(segment, c.fare, c.dailyFrequency, goingRate) - brandEdge),
    0,
  );
  return { yourScore, competitorScore };
}

/**
 * One segment's softmax over every offering in this market: your flight,
 * every competitor serving the same market, and a fixed "stay home"
 * option at utility 0. Your share is your term over the sum of all of
 * them — standard multinomial logit. With `competitors` empty this is
 * algebraically identical to the plain logistic sigmoid of your own
 * utility.
 */
function segmentBookingShare(
  segment: Segment,
  fare: number,
  legsServingMarket: number,
  competitors: CompetitorOffering[],
  goingRate: number,
  brandEdge: number,
): number {
  const { yourScore, competitorScore } = scores(segment, fare, legsServingMarket, competitors, goingRate, brandEdge);
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
  goingRate: number,
  brandEdge: number,
): number {
  const { yourScore, competitorScore } = scores(segment, fare, legsServingMarket, competitors, goingRate, brandEdge);
  return yourScore / (yourScore + competitorScore);
}

/**
 * What fraction of a market's demand books *your* flight — versus a
 * competitor's, or not travelling at all — given this flight's fare, how
 * many daily frequencies serve the market, and which market this is (to
 * look up who else is serving it). Blended across all three segments,
 * weighted by each one's share of the demand pool. `economy.ts` calls this
 * with one flat fare for everyone (no fare-by-segment lever exists), so
 * the segments differ only in how they react to that same fare and
 * frequency, not in what they pay.
 */
export function bookingShare(
  fare: number,
  legsServingMarket: number,
  originIata: string,
  destIata: string,
  competitorRoutes: CompetitorOffering[],
  /** How far your NPS on this market pulls passengers from a typical rival, in utility (sim/nps.ts's brandEdge()). */
  brandEdge: number,
): number {
  const marketCompetitors = competitorsServingMarket(originIata, destIata, competitorRoutes);
  const goingRate = recommendedFare(originIata, destIata);
  return SEGMENTS.reduce(
    (total, segment) =>
      total +
      segment.shareOfDemand *
        segmentBookingShare(segment, fare, legsServingMarket, marketCompetitors, goingRate, brandEdge),
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
  competitorRoutes: CompetitorOffering[],
  /** How far your NPS on this market pulls passengers from a typical rival, in utility (sim/nps.ts's brandEdge()). */
  brandEdge: number,
): number {
  const marketCompetitors = competitorsServingMarket(originIata, destIata, competitorRoutes);
  const goingRate = recommendedFare(originIata, destIata);
  return SEGMENTS.reduce(
    (total, segment) =>
      total +
      segment.shareOfDemand *
        segmentTrafficShare(segment, fare, legsServingMarket, marketCompetitors, goingRate, brandEdge),
    0,
  );
}

/**
 * What fraction of a market's demand books this one rival route: the same
 * softmax as `bookingShare`, seen from the rival's side. Its score over
 * everyone's — every rival on the market (itself included), the player
 * if the player flies it (`playerLegs` > 0), and "stay home". Used to
 * estimate whether a rival route pays (sim/rivalEconomics.ts).
 */
export function rivalBookingShare(
  route: CompetitorOffering,
  playerFare: number,
  playerLegs: number,
  competitorRoutes: CompetitorOffering[],
  /** The player's brand edge on this market (sim/nps.ts), which counts against every rival when the player flies it. */
  brandEdge: number,
): number {
  const marketCompetitors = competitorsServingMarket(route.origin, route.dest, competitorRoutes);
  const goingRate = recommendedFare(route.origin, route.dest);
  return SEGMENTS.reduce((total, segment) => {
    const edge = playerLegs > 0 ? brandEdge : 0;
    const rivalScore = Math.exp(utility(segment, route.fare, route.dailyFrequency, goingRate) - edge);
    const allRivals = marketCompetitors.reduce(
      (sum, c) => sum + Math.exp(utility(segment, c.fare, c.dailyFrequency, goingRate) - edge),
      0,
    );
    const playerScore =
      playerLegs > 0 ? Math.exp(utility(segment, playerFare, playerLegs, goingRate)) : 0;
    const stayHomeScore = Math.exp(0);
    return total + segment.shareOfDemand * (rivalScore / (allRivals + playerScore + stayHomeScore));
  }, 0);
}
