import { MARGIN_WINDOW_DAYS } from './networkMargin';
import type { SimState } from './state';

/**
 * Why the airline's profit a day moved: last week against the week before,
 * split into the few things that explain it. A trend arrow says that profit
 * moved; this says which of flying more, fares and loads, a fuel price, a
 * lease or a check moved it. A pure read of the daily histories the sim
 * already keeps.
 *
 * Costs that grow with flying (fuel, block-hour costs, departure fees) are
 * first scaled to this week's capacity, so flying more is one line ("flying")
 * and the rest is what each flight cost or earned, not how many there were.
 */

export type Mover = {
  /** Short ops label: "flying", "fares & loads", "fuel rate". */
  label: string;
  /** Change in profit a day, week against week before; negative hurt. */
  perDay: number;
};

export type MarginMovers = {
  /** Profit a day last week and the week before. */
  now: number;
  before: number;
  /** Every mover, biggest first; they add up to `now - before`. */
  movers: Mover[];
};

const sum = (values: number[]) => values.reduce((total, n) => total + n, 0);

const weekOf = (values: number[] | undefined, back: number): number[] => {
  const all = values ?? [];
  const end = all.length - back;
  return all.slice(Math.max(0, end - MARGIN_WINDOW_DAYS), Math.max(0, end));
};

/** A week's mean of one history, or null when the week is not fully on record. */
function weekMean(values: number[] | undefined, back: number): number | null {
  const week = weekOf(values, back);
  return week.length === MARGIN_WINDOW_DAYS ? sum(week) / MARGIN_WINDOW_DAYS : null;
}

/** Costs that move with how much is flown, split out as rates. */
const FLYING_COSTS = ['fuel', 'blockNonFuel', 'departure'] as const;

const OTHER_COST_LABELS: Record<string, string> = {
  lease: 'leases',
  crew: 'idle crews',
  slots: 'slot fees',
  maintenance: 'checks',
  overhead: 'overhead',
  innovations: 'R&D upkeep',
  executives: 'executives',
};

/** Null until two full weeks are on record. */
export function marginMovers(state: SimState): MarginMovers | null {
  const profitNow = weekMean(state.marginHistory, 0);
  const profitBefore = weekMean(state.marginHistory, MARGIN_WINDOW_DAYS);
  const revenueNow = weekMean(state.revenueHistory, 0);
  const revenueBefore = weekMean(state.revenueHistory, MARGIN_WINDOW_DAYS);
  const capacityNow = weekMean(state.seatNmHistory, 0);
  const capacityBefore = weekMean(state.seatNmHistory, MARGIN_WINDOW_DAYS);
  if (profitNow === null || profitBefore === null || revenueNow === null || revenueBefore === null) return null;
  if (capacityNow === null || capacityBefore === null || capacityNow <= 0 || capacityBefore <= 0) return null;
  const categories = state.costHistoryByCategory ?? {};
  const cost = (kind: string, back: number) => weekMean(categories[kind], back) ?? 0;

  const paidNow = weekMean(state.bonusRevenueHistory, 0) ?? 0;
  const paidBefore = weekMean(state.bonusRevenueHistory, MARGIN_WINDOW_DAYS) ?? 0;
  const baseNow = revenueNow - paidNow;
  const baseBefore = revenueBefore - paidBefore;
  const scale = capacityNow / capacityBefore;
  const flyingCostBefore = FLYING_COSTS.reduce((total, kind) => total + cost(kind, MARGIN_WINDOW_DAYS), 0);

  const movers: Mover[] = [
    { label: 'flying', perDay: (scale - 1) * (baseBefore - flyingCostBefore) },
    { label: 'fares & loads', perDay: baseNow - baseBefore * scale },
    { label: 'paid by buyers', perDay: paidNow - paidBefore },
    { label: 'fuel rate', perDay: -(cost('fuel', 0) - cost('fuel', MARGIN_WINDOW_DAYS) * scale) },
    {
      label: 'cost per flight',
      perDay: -(cost('blockNonFuel', 0) + cost('departure', 0) - (cost('blockNonFuel', MARGIN_WINDOW_DAYS) + cost('departure', MARGIN_WINDOW_DAYS)) * scale),
    },
  ];
  for (const [kind, label] of Object.entries(OTHER_COST_LABELS)) {
    movers.push({ label, perDay: -(cost(kind, 0) - cost(kind, MARGIN_WINDOW_DAYS)) });
  }
  // Whatever the histories do not name (a save that kept one kind later) stays visible rather than vanishing.
  const named = sum(movers.map((mover) => mover.perDay));
  movers.push({ label: 'other', perDay: profitNow - profitBefore - named });

  return {
    now: profitNow,
    before: profitBefore,
    movers: movers.filter((mover) => Math.abs(mover.perDay) >= 0.5).sort((x, y) => Math.abs(y.perDay) - Math.abs(x.perDay)),
  };
}
