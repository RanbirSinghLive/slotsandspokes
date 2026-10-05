import { classByCode, pluralClassName } from './aircraftClasses';
import { dayIndex } from './clock';
import { airlineCalled, LADDER, tiersClimbed } from './ladder';
import { formatNps, networkNps } from './nps';
import { marketKey } from './schedule';
import { difficultySettings } from './difficulty';
import type { SimState } from './state';

/**
 * The year one report (WEEK-TWELVE.md, thread 4): the airline's year,
 * read off the state at day 365 or at game over, and on demand from the
 * Game screen. A read-out with no rules of its own; ui/yearReport.ts
 * shows it. What it adds up per route comes from the running totals
 * kept at each rollover (`SimState.marketTotals`, sim/pnlHistory.ts).
 */

export type RouteResult = { market: string; margin: number; passengers: number };

export type YearReport = {
  home: string;
  days: number;
  cash: number;
  /** Cash now against the starting cash. */
  gained: number;
  fleet: { name: string; count: number }[];
  planes: number;
  routes: number;
  flightsPerDay: number;
  passengers: number;
  onTime: number | null;
  completion: number | null;
  nps: string;
  /** What the airline has become on the ladder, in words ("a regional carrier"), or null before the first tier. */
  standing: string | null;
  milestones: number;
  /** The year's best and worst routes by total margin (each needs a week flown), null when there are none. */
  best: RouteResult | null;
  worst: RouteResult | null;
  /** One line to share. */
  shareLine: string;
  /** The day the passenger and route totals start from: after day 1 for a save from before they were kept. */
  totalsSinceDay: number;
};

/** The shortest a route must have flown to count as best or worst: a new one hasn't had its chance. */
const MIN_ROUTE_DAYS = 7;

export function yearReport(state: SimState): YearReport {
  const days = dayIndex(state);
  const totals = state.marketTotals ?? {};
  const routes = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  // A route counts once it has a week of history or isn't flown any more.
  const ranked = Object.entries(totals)
    .filter(([key]) => !routes.has(key) || (state.revenueHistoryByMarket[key]?.length ?? 0) >= MIN_ROUTE_DAYS)
    .map(([market, total]) => ({ market, margin: Math.round(total.revenue - total.cost), passengers: Math.round(total.passengers) }))
    .sort((a, b) => b.margin - a.margin);
  const passengers = Object.values(totals).reduce((sum, total) => sum + total.passengers, 0);

  const byClass = new Map<string, number>();
  for (const aircraft of state.aircraft) byClass.set(aircraft.typeCode, (byClass.get(aircraft.typeCode) ?? 0) + 1);
  const fleet = [...byClass.entries()].map(([code, count]) => {
    const name = classByCode(code)?.name ?? code;
    return { name: count === 1 ? name : pluralClassName(name), count };
  });

  const climbed = tiersClimbed(state);
  const standing = climbed > 0 ? airlineCalled(LADDER[climbed - 1]) : null;
  const gained = state.cash - difficultySettings(state).startingCash;
  const scheduled = state.flightsScheduledTotal;
  const report: YearReport = {
    home: state.homeAirport,
    days,
    cash: state.cash,
    gained,
    fleet,
    planes: state.aircraft.length,
    routes: routes.size,
    flightsPerDay: state.schedule.length,
    passengers: Math.round(passengers),
    onTime: state.flightsArrivedTotal > 0 ? state.flightsOnTimeTotal / state.flightsArrivedTotal : null,
    completion: scheduled > 0 ? (scheduled - state.flightsCancelledTotal) / scheduled : null,
    nps: state.npsScoredFlightsTotal > 0 ? formatNps(networkNps(state)) : '—',
    standing,
    milestones: Object.keys(state.milestonesMet ?? {}).length,
    best: ranked[0] ?? null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    shareLine: '',
    totalsSinceDay: state.marketTotalsSinceDay ?? days,
  };
  report.shareLine =
    `Slots & Spokes · ${state.homeAirport} · day ${days}: ${short(state.cash)} cash, ${report.planes} plane${report.planes === 1 ? '' : 's'}, ` +
    `${report.routes} route${report.routes === 1 ? '' : 's'}, ${short(report.passengers, '')} passengers` +
    (standing ? `, ${standing}` : '');
  return report;
}

/** $12.3M, $480k, $9: money (or a count, with no sign) at a glance. */
function short(value: number, sign = '$'): string {
  const size = Math.abs(value);
  const minus = value < 0 ? '−' : '';
  if (size >= 1_000_000) return `${minus}${sign}${(size / 1_000_000).toFixed(1)}M`;
  if (size >= 1_000) return `${minus}${sign}${Math.round(size / 1_000)}k`;
  return `${minus}${sign}${Math.round(size)}`;
}
