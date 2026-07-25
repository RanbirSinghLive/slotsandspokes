// The "connective piece" from WEEK-TWO.md's Layers — the standard technique
// for this is a multinomial logit: score every option a traveler could pick
// (your flight, a competitor's, or not travelling at all) with a utility
// function, then market share falls out as a softmax over those scores.
// Yield-mix segments (WEEK-TWO.md layer 2) and competitor offerings (layer
// 3) don't exist yet, so this v1 only ever scores *your* flight against a
// fixed "stay home" option pinned at utility 0 — the standard reference
// point in this kind of model. With just one real alternative plus that
// baseline, the softmax collapses to the plain logistic sigmoid, which is
// what `bookingShare` below actually computes; it'll need to become a real
// softmax over multiple offerings once competitors exist.
const INTERCEPT = 3.5;
const WEIGHT_PRICE = 0.01;
const WEIGHT_SCHEDULE = 0.5;

/**
 * What fraction of a market's demand actually book a flight, versus not
 * travelling at all, given this flight's fare and how many daily
 * frequencies serve the market. Both weights and the intercept are
 * hand-picked, crude constants in the same spirit as `economy.ts`'s
 * `LOAD_FACTOR`/`AVG_FARE` — picked so today's fixed $185 fare and typical
 * 1-2 daily frequencies land in the high-0.8s/low-0.9s, leaving headroom
 * to fall as fare rises (once a real pricing lever exists) and to rise as
 * frequency does (already true today, via the M10 route builder).
 *
 * `scheduleFit` stands in for QSI (Quality of Service Index) — real
 * airline revenue-management uses exactly this term for how frequency
 * share converts into passenger share. `log2` gives diminishing returns:
 * going from 1 to 2 daily frequencies matters more than going from 5 to 6.
 * The real "S-curve" effect (frequency share converting into *more than
 * proportional* passenger share) is a documented refinement on top of this
 * that v1 deliberately skips — see WEEK-TWO.md's note on it.
 */
export function bookingShare(fare: number, legsServingMarket: number): number {
  const scheduleFit = Math.log2(1 + legsServingMarket);
  const utility = INTERCEPT - WEIGHT_PRICE * fare + WEIGHT_SCHEDULE * scheduleFit;
  return 1 / (1 + Math.exp(-utility));
}
