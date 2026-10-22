import { AIRCRAFT_CLASSES } from './aircraftClasses';
import { contractOn } from './contracts';
import { regionOf } from './regions';
import { flightsByGauge } from './routeYield';
import { countryOf, homeCountry } from './rights';
import { marketKey } from './schedule';
import type { SimState } from './state';

/**
 * Margin as a share of revenue, over a week, so a small airline and a large
 * one, or this week and last, compare on the same footing. A single day's
 * margin swings with which flights landed before midnight, a late buyer
 * payment or a check falling due; a week of them does not.
 *
 * Two margins, both over the last WINDOW days of finished days:
 *  - flying: the routes only (revenue less what the flights cost), the same
 *    basis as a route's own margin on the Routes page;
 *  - all-in: the whole day's profit including leases, overhead and checks.
 * The gap between them is the upkeep the routes do not carry.
 */
export const MARGIN_WINDOW_DAYS = 7;
/** Fewest finished days before a margin is worth showing. */
const MIN_DAYS = 3;

const sum = (values: number[]) => values.reduce((total, n) => total + n, 0);

/** The last `days` entries ending `back` entries before the newest. */
function window(values: number[] | undefined, days: number, back = 0): number[] {
  const all = values ?? [];
  const end = all.length - back;
  return all.slice(Math.max(0, end - days), Math.max(0, end));
}

export type NetworkMargin = {
  /** Finished days behind the figures. */
  days: number;
  /** Routes' margin over their revenue, last week. */
  flying: number;
  /** The week before, or null with less than a week of it on record. */
  previousFlying: number | null;
  /** The whole airline's profit over its revenue, last week. */
  allIn: number;
  /** The share of the week's route revenue that buyers paid rather than passengers: contract pay and event premiums. */
  paidShare: number;
  /** Revenue a day over the week, for scale. */
  revenuePerDay: number;
  /** What the routes made a day beyond the all-in figure: leases, overhead, checks. */
  upkeepPerDay: number;
};

export function networkMargin(state: SimState): NetworkMargin | null {
  const revenue = window(state.routeRevenueHistory, MARGIN_WINDOW_DAYS);
  const margin = window(state.routeMarginHistory, MARGIN_WINDOW_DAYS);
  if (revenue.length < MIN_DAYS || revenue.length !== margin.length) return null;
  const routeRevenue = sum(revenue);
  if (routeRevenue <= 0) return null;
  const flying = sum(margin) / routeRevenue;

  const earlierRevenue = sum(window(state.routeRevenueHistory, MARGIN_WINDOW_DAYS, MARGIN_WINDOW_DAYS));
  const earlierMargin = window(state.routeMarginHistory, MARGIN_WINDOW_DAYS, MARGIN_WINDOW_DAYS);
  const previousFlying = earlierMargin.length === MARGIN_WINDOW_DAYS && earlierRevenue > 0 ? sum(earlierMargin) / earlierRevenue : null;

  const days = revenue.length;
  const airlineRevenue = sum(window(state.revenueHistory, days));
  const allIn = airlineRevenue > 0 ? sum(window(state.marginHistory, days)) / airlineRevenue : flying;
  return {
    days,
    flying,
    previousFlying,
    allIn,
    paidShare: sum(window(state.bonusRevenueHistory, days)) / routeRevenue,
    revenuePerDay: routeRevenue / days,
    upkeepPerDay: (sum(margin) - sum(window(state.marginHistory, days))) / days,
  };
}

export type RouteWeek = {
  /** Margin a day over the last week, null with less than three finished days. */
  perDay: number | null;
  /** The week before, per day, or null with under a full week of it. */
  previousPerDay: number | null;
  /** Revenue a day over the last week. */
  revenuePerDay: number;
  /** Contract and event money a day inside that revenue. */
  paidPerDay: number;
  /** Revenue and cost a day over the week before, or null with under a full week of it. */
  previousRevenuePerDay: number | null;
  /** Cost a day over the last week. */
  costPerDay: number;
  previousCostPerDay: number | null;
  /** Daily margins, oldest first, for a sparkline. */
  series: number[];
};

export function routeWeek(state: SimState, key: string): RouteWeek {
  const revenue = state.revenueHistoryByMarket[key] ?? [];
  const cost = state.costHistoryByMarket[key] ?? [];
  const margins = revenue.map((r, i) => r - (cost[i] ?? 0));
  const last = window(margins, MARGIN_WINDOW_DAYS);
  const earlier = window(margins, MARGIN_WINDOW_DAYS, MARGIN_WINDOW_DAYS);
  const lastRevenue = window(revenue, MARGIN_WINDOW_DAYS);
  const paid = window(state.bonusHistoryByMarket?.[key], MARGIN_WINDOW_DAYS);
  return {
    perDay: last.length >= MIN_DAYS ? sum(last) / last.length : null,
    previousPerDay: earlier.length === MARGIN_WINDOW_DAYS ? sum(earlier) / earlier.length : null,
    revenuePerDay: lastRevenue.length > 0 ? sum(lastRevenue) / lastRevenue.length : 0,
    paidPerDay: last.length > 0 ? sum(paid) / last.length : 0,
    previousRevenuePerDay: earlier.length === MARGIN_WINDOW_DAYS ? sum(window(revenue, MARGIN_WINDOW_DAYS, MARGIN_WINDOW_DAYS)) / MARGIN_WINDOW_DAYS : null,
    costPerDay: last.length > 0 ? sum(window(cost, MARGIN_WINDOW_DAYS)) / last.length : 0,
    previousCostPerDay: earlier.length === MARGIN_WINDOW_DAYS ? sum(window(cost, MARGIN_WINDOW_DAYS, MARGIN_WINDOW_DAYS)) / MARGIN_WINDOW_DAYS : null,
    series: window(margins, MARGIN_WINDOW_DAYS * 2),
  };
}

/** A route's margin over its revenue, last week, or null with nothing to judge. */
export function routeMarginShare(week: RouteWeek): number | null {
  return week.perDay === null || week.revenuePerDay <= 0 ? null : week.perDay / week.revenuePerDay;
}

export type RouteTags = {
  /** A buyer's contract runs on this route. */
  contract: boolean;
  /** An event (mandate) is running or accepted on it. */
  event: boolean;
  /** Under two weeks of history: its numbers are still settling. */
  new: boolean;
  /** Planes on today's schedule here grounded for want of pilots or attendants (sim/crews.ts): their flights are all cancelled. */
  grounded: { tail: string; cabin: boolean }[];
};

export function routeTags(state: SimState, a: string, b: string): RouteTags {
  const key = marketKey(a, b);
  const running = contractOn(state, a, b);
  return {
    contract: running?.status === 'active',
    event: (state.mandates ?? []).some((m) => m.status === 'accepted' && marketKey(m.origin, m.dest) === key),
    new: (state.revenueHistoryByMarket[key]?.length ?? 0) < MARGIN_WINDOW_DAYS * 2,
    grounded: [...new Set(state.schedule.filter((leg) => marketKey(leg.origin, leg.dest) === key && state.groundedTails.includes(leg.tail)).map((leg) => leg.tail))].map((tail) => ({
      tail,
      cabin: state.crewDay?.cabinShortTails?.includes(tail) ?? false,
    })),
  };
}

export type Sector = 'domestic' | 'international';

/** Domestic when both ends are in the airline's home country, international otherwise. */
export function sectorOf(state: SimState, a: string, b: string): Sector {
  const home = homeCountry(state);
  return home !== undefined && countryOf(a) === home && countryOf(b) === home ? 'domestic' : 'international';
}

/** The airport a route hangs off: the end with more routes, the home airport on a tie. */
export function hubOf(state: SimState, a: string, b: string, routeCounts: Map<string, number>): string {
  const ca = routeCounts.get(a) ?? 0;
  const cb = routeCounts.get(b) ?? 0;
  if (ca !== cb) return ca > cb ? a : b;
  if (a === state.homeAirport || b === state.homeAirport) return state.homeAirport;
  return a < b ? a : b;
}

/**
 * How the Routes table can be grouped: by the hub a route hangs off, domestic
 * or international, the far end's region, the size of plane flying it
 * ("mixed" when more than one size does), or how its margin reads.
 */
export type RouteGroupBy = 'hub' | 'sector' | 'region' | 'gauge' | 'band';

/** Margin bands as group names, worst first; "too new" holds routes under 3 flown days. */
export const BAND_GROUPS = ['losing', 'thin', 'healthy', 'too new'] as const;
export const MIXED_GAUGE = 'Mixed';

const classRankByName = (name: string): number => AIRCRAFT_CLASSES.findIndex((c) => c.name === name);

function gaugeGroupOf(state: SimState, a: string, b: string): string {
  const gauges = flightsByGauge(state, a, b);
  return gauges.length === 1 ? gauges[0].name : MIXED_GAUGE;
}

function bandGroupOf(state: SimState, key: string): string {
  const share = routeMarginShare(routeWeek(state, key));
  if (share === null) return 'too new';
  return { poor: 'losing', fair: 'thin', good: 'healthy' }[marginBand(share)];
}

/** Where a group sits in the list: fixed orders for gauge and band, best margin first for the rest. */
function groupRank(by: RouteGroupBy, name: string): number {
  if (by === 'band') return BAND_GROUPS.indexOf(name as (typeof BAND_GROUPS)[number]);
  if (by === 'gauge') return name === MIXED_GAUGE ? Number.MAX_SAFE_INTEGER : classRankByName(name);
  return 0;
}

export type RouteGroup = {
  name: string;
  keys: string[];
  /** Margin a day over the last week, summed over the group's routes. */
  perDay: number;
  previousPerDay: number | null;
  /** Margin over revenue for the group, last week. */
  share: number | null;
  revenuePerDay: number;
};

/** Every flown market with its hub and sector. */
export function flownMarkets(state: SimState): { key: string; a: string; b: string; hub: string; sector: Sector; region: string }[] {
  const markets = new Map<string, { a: string; b: string }>();
  for (const leg of state.schedule) {
    const key = marketKey(leg.origin, leg.dest);
    if (!markets.has(key)) markets.set(key, { a: leg.origin, b: leg.dest });
  }
  const counts = new Map<string, number>();
  for (const { a, b } of markets.values()) {
    counts.set(a, (counts.get(a) ?? 0) + 1);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return [...markets.entries()].map(([key, { a, b }]) => {
    const hub = hubOf(state, a, b, counts);
    // A route's region is where its far end is: the end that is not the hub.
    return { key, a, b, hub, sector: sectorOf(state, a, b), region: regionOf(hub === a ? b : a) };
  });
}

/** Routes grouped (RouteGroupBy) with each group's week; best first unless the grouping has its own order. */
export function routeGroups(state: SimState, by: RouteGroupBy): RouteGroup[] {
  const groups = new Map<string, string[]>();
  for (const market of flownMarkets(state)) {
    const name =
      by === 'hub' ? market.hub
      : by === 'sector' ? market.sector
      : by === 'region' ? market.region
      : by === 'gauge' ? gaugeGroupOf(state, market.a, market.b)
      : bandGroupOf(state, market.key);
    groups.set(name, [...(groups.get(name) ?? []), market.key]);
  }
  return [...groups.entries()]
    .map(([name, keys]) => {
      const weeks = keys.map((key) => routeWeek(state, key));
      const judged = weeks.filter((week) => week.perDay !== null);
      const perDay = judged.reduce((total, week) => total + (week.perDay ?? 0), 0);
      const revenuePerDay = judged.reduce((total, week) => total + week.revenuePerDay, 0);
      const earlier = weeks.filter((week) => week.previousPerDay !== null);
      return {
        name,
        keys,
        perDay,
        previousPerDay: earlier.length === keys.length ? earlier.reduce((total, week) => total + (week.previousPerDay ?? 0), 0) : null,
        share: revenuePerDay > 0 ? perDay / revenuePerDay : null,
        revenuePerDay,
      };
    })
    .sort((x, y) => groupRank(by, x.name) - groupRank(by, y.name) || y.perDay - x.perDay);
}

/** How a margin share reads: below 0% loses money, 0–10% is thin, above is healthy. */
export function marginBand(share: number): 'poor' | 'fair' | 'good' {
  return share < 0 ? 'poor' : share < 0.1 ? 'fair' : 'good';
}

/** The flying margin for each finished day, over the 7 days ending then, oldest first: the line on the Money page. */
export function marginTrend(state: SimState): number[] {
  const revenue = state.routeRevenueHistory ?? [];
  const margin = state.routeMarginHistory ?? [];
  const out: number[] = [];
  for (let end = MIN_DAYS; end <= revenue.length; end++) {
    const from = Math.max(0, end - MARGIN_WINDOW_DAYS);
    const rev = sum(revenue.slice(from, end));
    if (rev > 0) out.push(sum(margin.slice(from, end)) / rev);
  }
  return out;
}

export type CostWeek = {
  /** Finished days behind the figures. */
  days: number;
  /** A day's average cost by kind over the last week, biggest first. */
  perDay: { kind: string; amount: number }[];
  /** Checks, engine shop visits and contracted work a day over the week (the `maintenance` kind). */
  checksPerDay: number;
  /** Days of the week on which those cost more than three times the week's daily average, and so spiked the day's profit. */
  spikeDays: number;
};

/** The week's costs by kind; null before a day has closed with kinds on record. */
export function costWeek(state: SimState): CostWeek | null {
  const kinds = Object.entries(state.costHistoryByCategory ?? {});
  const days = Math.min(MARGIN_WINDOW_DAYS, ...kinds.map(([, history]) => history.length));
  if (kinds.length === 0 || days < MIN_DAYS) return null;
  const perDay = kinds
    .map(([kind, history]) => ({ kind, amount: sum(history.slice(-days)) / days }))
    .filter((row) => row.amount > 0.5)
    .sort((x, y) => y.amount - x.amount);
  const checks = (state.costHistoryByCategory?.maintenance ?? []).slice(-days);
  const average = sum(checks) / days;
  return { days, perDay, checksPerDay: average, spikeDays: average > 0 ? checks.filter((n) => n > 3 * average).length : 0 };
}

/** Days of checks and repairs spread across each day, ending at it. */
const CHECK_SPREAD_DAYS = 7;

/**
 * Each finished day's profit with checks and repairs spread over the week
 * instead of landing on the day they were paid: the day's other revenue and
 * costs stay as they were, and its checks are replaced by the average of the
 * last CHECK_SPREAD_DAYS days'. A check day then reads as part of a steady
 * cost rather than a collapse. Cash and the books are unchanged; this is for
 * the daily bars. A save from before costs by kind were kept returns the days as they were.
 */
export function smoothedMarginHistory(state: SimState): number[] {
  const margins = state.marginHistory;
  const checks = state.costHistoryByCategory?.maintenance;
  if (!checks || checks.length !== margins.length) return [...margins];
  return margins.map((margin, i) => {
    const recent = checks.slice(Math.max(0, i - CHECK_SPREAD_DAYS + 1), i + 1);
    return margin + checks[i] - sum(recent) / recent.length;
  });
}
