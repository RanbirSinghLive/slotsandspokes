import characterData from '../../data/airport-character.json';
import type { SegmentName } from './timeOfDay';

/**
 * Market character (WEEK-FOURTEEN.md, slice 1): who flies a city pair.
 * Each airport is scored 0–2 for how strongly it draws business, leisure
 * and VFR (visiting friends and relatives) travel
 * (data/airport-character.json, hand-authored). A pair's mix starts from
 * BASE_MIX, and each segment's points multiply its weight by
 * CHARACTER_PULL each, then the three are scaled back to a whole. The
 * points follow how each kind of trip works:
 *
 *   - business needs business at both ends: the smaller end's score
 *     counts twice, the gap to the bigger end only half;
 *   - leisure needs one end worth going to: the sunnier end's score,
 *     twice;
 *   - VFR needs a community at either end: the stronger end's score. So
 * Toronto–Chicago is a business trunk, Toronto–Orlando a sun route and
 * Toronto–St. John's a VFR route, and the choice model
 * (sim/choiceModel.ts) and time-of-day demand (sim/timeOfDay.ts) read
 * the pair's own mix in place of one mix for every market.
 *
 * BASE_MIX is set so the network's mix, weighted by potential demand,
 * stays close to the one mix it replaced (business 20%, leisure 50%,
 * VFR 30%): the balance moves by where the mix lands, not by how much of
 * each there is.
 */

type Character = Partial<Record<SegmentName, number>>;

const CHARACTER = characterData as unknown as Record<string, Character>;

/** The mix of a pair of ordinary airports. */
const BASE_MIX: Record<SegmentName, number> = { business: 0.19, leisure: 0.46, vfr: 0.35 };
/** How much each point of character at either end multiplies its segment's weight. */
const CHARACTER_PULL = 1.45;

const SEGMENT_NAMES: SegmentName[] = ['business', 'leisure', 'vfr'];

const cache = new Map<string, Record<SegmentName, number>>();

/** Who flies this city pair: each segment's share of its demand, adding to 1. */
export function marketMix(a: string, b: string): Record<SegmentName, number> {
  const key = a < b ? `${a}-${b}` : `${b}-${a}`;
  let mix = cache.get(key);
  if (mix) return mix;
  const score = (segment: SegmentName) => [CHARACTER[a]?.[segment] ?? 0, CHARACTER[b]?.[segment] ?? 0];
  const [b1, b2] = score('business');
  const [l1, l2] = score('leisure');
  const [v1, v2] = score('vfr');
  const points: Record<SegmentName, number> = {
    business: 2 * Math.min(b1, b2) + 0.5 * Math.abs(b1 - b2),
    leisure: 2 * Math.max(l1, l2),
    vfr: Math.max(v1, v2),
  };
  const weights = SEGMENT_NAMES.map((segment) => BASE_MIX[segment] * Math.pow(CHARACTER_PULL, points[segment]));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  mix = { business: weights[0] / total, leisure: weights[1] / total, vfr: weights[2] / total };
  cache.set(key, mix);
  return mix;
}

/** A city pair's character in a word or two, from its mix. */
export function marketCharacterWord(a: string, b: string): string {
  const mix = marketMix(a, b);
  if (mix.business >= 0.32) return 'Business trunk';
  if (mix.leisure >= 0.65) return 'Sun and leisure';
  if (mix.vfr >= 0.45) return 'Friends and family';
  if (mix.business >= 0.24) return 'Business-leaning';
  return 'Mixed';
}
