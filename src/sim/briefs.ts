import { activeClosures, announcedClosures } from './airspace';
import { aogFor } from './aog';
import { calendarDayOfYear, DAYS_PER_YEAR, dayIndex, minuteOfDay } from './clock';
import { crewPlan } from './crewPlan';
import { mandateIsActive, mandatesOf } from './mandates';
import { marketKey } from './schedule';
import { marketSeasonOn } from './seasons';
import { spillingMarkets, unmetDemandByAirport } from './unmetDemand';
import type { SimState } from './state';
import { isAirportClosed } from './weather';

/**
 * The two briefs the player can read: a daily operations brief at 05:30
 * home time, and a season review every half year. This module only
 * decides *when* they are due and *what* they say; ui/briefWindow.ts
 * draws them. Nothing here changes the game's economy.
 */

/** The daily brief appears at this home-local minute (05:30). */
export const DAILY_BRIEF_MINUTE = 5 * 60 + 30;
/** Days between season reviews: half a year, so one lands as each programme starts. */
export const SEASON_REVIEW_DAYS = 182;

export type BriefSettings = {
  daily: boolean;
  season: boolean;
  /** The first season review pauses the clock so it can't scroll past at 100x. */
  seasonPause: boolean;
};

export const DEFAULT_BRIEF_SETTINGS: BriefSettings = { daily: true, season: true, seasonPause: true };

export function briefSettings(state: SimState): BriefSettings {
  return { ...DEFAULT_BRIEF_SETTINGS, ...state.briefs?.settings };
}

export function setBriefSetting(state: SimState, key: keyof BriefSettings, value: boolean): void {
  const briefs = (state.briefs ??= {});
  briefs.settings = { ...briefSettings(state), [key]: value };
}

/** True once per home day, from 05:30. The day is recorded so a reload or a second call the same day says no. */
export function dailyBriefDue(state: SimState): boolean {
  const today = dayIndex(state);
  const briefs = (state.briefs ??= {});
  if (briefs.lastDailyDay === undefined) {
    // A save from before briefs, or a fresh game: only a day that begins from here counts.
    briefs.lastDailyDay = minuteOfDay(state) >= DAILY_BRIEF_MINUTE ? today : today - 1;
    return false;
  }
  if (briefs.lastDailyDay >= today || minuteOfDay(state) < DAILY_BRIEF_MINUTE) return false;
  briefs.lastDailyDay = today;
  return true;
}

export type DailyChip = {
  kind: 'weather' | 'closure' | 'aog' | 'hold' | 'crew' | 'event' | 'late';
  /** The number shown on the chip. */
  count: number;
  /** A sentence for the tooltip. */
  tip: string;
  /** Where the chip's tap goes. */
  target: { screen: 'fleet' | 'crews' | 'maintenance' | 'routes' } | { airport: string } | null;
};

export type DailyBrief = {
  day: number;
  chips: DailyChip[];
  /** Yesterday across the network, from the on-time history. Null with no flying yet. */
  yesterday: { flown: number; onTime: number; cancelled: number } | null;
};

export function buildDailyBrief(state: SimState): DailyBrief {
  const today = dayIndex(state);
  const chips: DailyChip[] = [];

  const closedAirports = Object.keys(state.weatherByAirport ?? {}).filter((iata) => isAirportClosed(state, iata));
  const weatherAirports = Object.keys(state.weatherByAirport ?? {});
  if (weatherAirports.length > 0) {
    chips.push({
      kind: 'weather',
      count: weatherAirports.length,
      tip: `Weather at ${weatherAirports.join(', ')}${closedAirports.length ? `; closed: ${closedAirports.join(', ')}` : ''}`,
      target: { airport: closedAirports[0] ?? weatherAirports[0] },
    });
  }

  const closures = activeClosures(state);
  if (closures.length > 0) {
    chips.push({ kind: 'closure', count: closures.length, tip: `Closed airspace: ${closures.map((c) => c.name).join(', ')}`, target: null });
  }
  const announced = announcedClosures(state);
  if (announced.length > 0) {
    chips.push({ kind: 'closure', count: announced.length, tip: `Closure announced: ${announced.map((c) => `${c.name} from day ${c.startDay}`).join(', ')}`, target: null });
  }

  const downTails = state.aogs.filter((event) => !event.check && !event.refitTo).map((event) => event.tail);
  if (downTails.length > 0) {
    chips.push({
      kind: 'aog',
      count: downTails.length,
      tip: `AOG: ${downTails.map((tail) => `${tail} (${aogFor(state, tail)?.fault ?? 'fault'})`).join(', ')}`,
      target: { screen: 'maintenance' },
    });
  }

  const holds = state.mxHoldsToday ?? [];
  if (holds.length > 0) {
    chips.push({ kind: 'hold', count: holds.length, tip: `Held for maintenance this morning: ${holds.join(', ')}`, target: { screen: 'maintenance' } });
  }

  const shortBases: string[] = [];
  for (const base of crewPlan(state)) {
    const isShort = base.classes.some((cls) => cls.entries.some((entry) => entry.day <= today + 3 && entry.short > 0));
    if (isShort) shortBases.push(base.iata);
  }
  if (shortBases.length > 0) {
    chips.push({ kind: 'crew', count: shortBases.length, tip: `Crews short within 3 days at ${shortBases.join(', ')}`, target: { screen: 'crews' } });
  }

  const eventsToday = mandatesOf(state).filter((mandate) => mandate.status === 'accepted' && mandateIsActive(state, mandate));
  if (eventsToday.length > 0) {
    chips.push({
      kind: 'event',
      count: eventsToday.length,
      tip: `Events flying today: ${eventsToday.map((mandate) => `${mandate.origin}→${mandate.dest}`).join(', ')}`,
      target: { screen: 'fleet' },
    });
  }

  let flown = 0;
  let onTime = 0;
  let cancelled = 0;
  for (const history of Object.values(state.onTimeHistoryByMarket ?? {})) {
    flown += history.arrived[history.arrived.length - 1] ?? 0;
    onTime += history.onTime[history.onTime.length - 1] ?? 0;
    cancelled += history.cancelled[history.cancelled.length - 1] ?? 0;
  }
  const yesterday = flown + cancelled > 0 ? { flown, onTime, cancelled } : null;
  if (yesterday && yesterday.cancelled > 0) {
    chips.push({ kind: 'late', count: yesterday.cancelled, tip: `${yesterday.cancelled} cancelled yesterday; opens Routes by completion`, target: { screen: 'routes' } });
  }

  return { day: today, chips, yesterday };
}

/** True once a season review is due; the first call only starts the clock, so a new game or an old save gets its first review half a year on. */
export function seasonReviewDue(state: SimState): boolean {
  const briefs = (state.briefs ??= {});
  const today = dayIndex(state);
  if (briefs.lastSeasonDay === undefined) {
    briefs.lastSeasonDay = today;
    briefs.seasonBaseline = structuredClone(state.marketTotals ?? {});
    return false;
  }
  return today - briefs.lastSeasonDay >= SEASON_REVIEW_DAYS;
}

export type SeasonRow = {
  a: string;
  b: string;
  /** Revenue less the flying costs charged to the route over the last half year. */
  profit: number;
  passengers: number;
  /** Next half year's demand against the last one's, from the seasonal curves: 0.1 is 10% up. */
  outlook: number;
  /** Demand exceeds the seats offered today. */
  spilling: boolean;
  /** Still in the schedule. */
  flying: boolean;
};

export type SeasonReview = {
  day: number;
  rows: SeasonRow[];
  /** Airports with the most demand nobody carries, among those the player can see. */
  gaps: { iata: string; passengers: number }[];
  /** Total profit across the rows. */
  total: number;
};

function averageSeason(state: SimState, a: string, b: string, from: number, to: number): number {
  const today = calendarDayOfYear(state);
  let sum = 0;
  for (let offset = from; offset <= to; offset += 1) {
    sum += marketSeasonOn(a, b, (((today + offset) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR);
  }
  return sum / (to - from + 1);
}

export function buildSeasonReview(state: SimState): SeasonReview {
  const briefs = state.briefs ?? {};
  const baseline = briefs.seasonBaseline ?? {};
  const totals = state.marketTotals ?? {};
  const flying = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  const spilling = spillingMarkets(state);

  const rows: SeasonRow[] = [];
  for (const key of new Set([...Object.keys(totals), ...flying])) {
    const [a, b] = key.split('-');
    const now = totals[key] ?? { revenue: 0, cost: 0, passengers: 0 };
    const before = baseline[key] ?? { revenue: 0, cost: 0, passengers: 0 };
    const profit = now.revenue - before.revenue - (now.cost - before.cost);
    const passengers = now.passengers - before.passengers;
    if (!flying.has(key) && passengers === 0 && profit === 0) continue;
    const lastHalf = averageSeason(state, a, b, -SEASON_REVIEW_DAYS + 1, 0);
    const nextHalf = averageSeason(state, a, b, 1, SEASON_REVIEW_DAYS);
    rows.push({ a, b, profit, passengers, outlook: lastHalf > 0 ? nextHalf / lastHalf - 1 : 0, spilling: spilling.has(key), flying: flying.has(key) });
  }
  rows.sort((x, y) => y.profit - x.profit);

  const gaps = [...unmetDemandByAirport(state)]
    .map(([iata, unmet]) => ({ iata, passengers: Math.round(unmet.latent + unmet.spilled) }))
    .filter((gap) => gap.passengers > 0)
    .sort((x, y) => y.passengers - x.passengers)
    .slice(0, 3);

  return { day: dayIndex(state), rows, gaps, total: rows.reduce((sum, row) => sum + row.profit, 0) };
}

/** Records that the review has been put in front of the player and starts the next half year's tally. */
export function markSeasonReviewShown(state: SimState): void {
  const briefs = (state.briefs ??= {});
  briefs.lastSeasonDay = dayIndex(state);
  briefs.seasonBaseline = structuredClone(state.marketTotals ?? {});
}
