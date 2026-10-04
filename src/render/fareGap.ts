import { isOpsView } from './opsView';
import { marketKey, recommendedFare } from '../sim/schedule';
import type { SimState } from '../sim/state';

/** Within this share of the going rate counts as level with it. */
const LEVEL_BAND = 0.03;

/**
 * The glyph Ops view appends to a route's label: ▲ your fare is above the
 * going rate, ▼ below it, ≈ within a few percent. It compares the same two
 * numbers the route inspector's "% of the going rate" reads: the fare set on
 * the market and `recommendedFare()`. Empty outside Ops view, and where the
 * route has no fare set yet.
 */
export function fareGapSuffix(state: SimState, origin: string, dest: string): string {
  if (!isOpsView()) return '';
  const fare = state.routeSettings[marketKey(origin, dest)]?.fare;
  if (fare === undefined) return '';
  const ratio = fare / recommendedFare(origin, dest);
  if (ratio > 1 + LEVEL_BAND) return ' ▲';
  if (ratio < 1 - LEVEL_BAND) return ' ▼';
  return ' ≈';
}
