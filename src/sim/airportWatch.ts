import { dailyDeparturesAt } from './airports';
import { dayIndex } from './clock';
import { airportHours, peakHour } from './hours';
import { planHub } from './hubPlanner';
import { spokesOf } from './hubs';
import { routesFedAt } from './spokeFlows';
import { MOAT_FLOOR_DEPARTURES, MOAT_LAPSE_PER_DAY, moatDays, stationReadout, stationTier, stationUpgradeBlocked } from './stations';
import type { SimState } from './state';

/**
 * The Airports screen's watch list: the fields that want a call from the
 * player now, each with the one thing that is wrong and what fixing it is
 * worth. Every item reads a mechanic that already decides the money
 * (hours and congestion, station handling, the hub moat, hub style,
 * spoke feed, rival entry); this module only says which of them have
 * crossed the line where a decision pays. Kept in the sim so the lines
 * are tested and the headless runner could read the same list.
 *
 * Also keeps each served field's share of movements a day for a week, so
 * the screen can show which way a field is going.
 */

/** A peak hour this full starts to queue departures (sim/delays.ts congestion), and the next flight there may not fit. */
export const PEAK_WATCH_LOAD = 0.9;
/** Ground-handling minutes a departure loses before a better station is worth a look. */
export const GROUND_WATCH_MINUTES = 3;
/** Connecting passengers a day a new route would pick up before it is called out. */
export const FEED_WATCH_PASSENGERS = 20;
/** Feed ideas shown at most, biggest first: the list is for calls, not a catalogue. */
const FEED_WATCH_LIMIT = 2;
/** How far back a rival's new route at a field still counts as news. */
export const RIVAL_WATCH_DAYS = 7;
/** Days of share kept per field: today and the same day last week. */
export const SHARE_HISTORY_DAYS = 8;

export type WatchItem =
  | { kind: 'peak'; iata: string; severity: 'warn' | 'bad'; hour: number; load: number }
  | { kind: 'ground'; iata: string; severity: 'warn'; minutes: number }
  | { kind: 'moat'; iata: string; severity: 'warn'; daysLeft: number; departures: number; floor: number }
  | { kind: 'hub'; iata: string; severity: 'warn' | 'bad'; missedPerDay: number }
  | { kind: 'rival'; iata: string; severity: 'warn'; airlines: string[]; routes: number }
  | { kind: 'feed'; iata: string; severity: 'warn'; other: string; connecting: number };

/** Airports you fly from today. */
function servedAirports(state: SimState): string[] {
  const served = new Set<string>();
  for (const leg of state.schedule) {
    served.add(leg.origin);
    served.add(leg.dest);
  }
  return [...served].sort();
}

/** Your share of every airline's takeoffs and landings here in a day, 0 to 1; null where nobody flies. */
export function movementShareAt(state: SimState, iata: string): number | null {
  const hours = airportHours(state, iata);
  let mine = 0;
  let total = 0;
  for (let hour = 0; hour < 24; hour++) {
    mine += hours.mine[hour];
    total += hours.mine[hour] + hours.rivals[hour];
  }
  return total > 0 ? mine / total : null;
}

/** At rollover: today's share at every field you fly from, the oldest dropped after a week. A field you stop flying is forgotten. */
export function rollAirportShares(state: SimState): void {
  const previous = state.airportShares ?? {};
  const next: Record<string, number[]> = {};
  for (const iata of servedAirports(state)) {
    const share = movementShareAt(state, iata);
    if (share === null) continue;
    next[iata] = [...(previous[iata] ?? []), Math.round(share * 1000) / 1000].slice(-SHARE_HISTORY_DAYS);
  }
  state.airportShares = next;
}

/** Points of share gained (or lost, negative) over the week kept; null until a field has two days. */
export function shareTrend(state: SimState, iata: string): number | null {
  const history = state.airportShares?.[iata];
  if (!history || history.length < 2) return null;
  return history[history.length - 1] - history[0];
}

/** Rival routes at this field opened within RIVAL_WATCH_DAYS. */
function newRivalRoutesAt(state: SimState, iata: string): { airlines: string[]; routes: number } {
  const since = state.simMinute - RIVAL_WATCH_DAYS * 1440;
  const fresh = state.competitorRoutes.filter((route) => (route.origin === iata || route.dest === iata) && route.openedAtMinute > since && route.openedAtMinute <= state.simMinute);
  return { airlines: [...new Set(fresh.map((route) => route.code))].sort(), routes: fresh.length };
}

const SEVERITY_ORDER = { bad: 0, warn: 1 } as const;
const KIND_ORDER: Record<WatchItem['kind'], number> = { peak: 0, hub: 1, ground: 2, moat: 3, rival: 4, feed: 5 };

/** Everything on the watch list, worst first, then by kind and code so the order never wobbles. */
export function airportWatch(state: SimState): WatchItem[] {
  const items: WatchItem[] = [];
  const feeds: Extract<WatchItem, { kind: 'feed' }>[] = [];
  const known = new Set(state.knownAirports);
  // Rivals only arrive at the start of a game's first days; the seed routes are not news.
  const watchRivals = dayIndex(state) >= RIVAL_WATCH_DAYS;
  for (const iata of servedAirports(state)) {
    const peak = peakHour(airportHours(state, iata));
    if (peak.load >= PEAK_WATCH_LOAD) items.push({ kind: 'peak', iata, severity: peak.load >= 1 ? 'bad' : 'warn', hour: peak.hour, load: peak.load });

    const readout = stationReadout(state, iata);
    if (readout && readout.perDeparture.ground >= GROUND_WATCH_MINUTES && stationUpgradeBlocked(state, iata) === null) {
      items.push({ kind: 'ground', iata, severity: 'warn', minutes: readout.perDeparture.ground });
    }

    const tier = stationTier(state, iata);
    const departures = dailyDeparturesAt(state, iata);
    if (tier !== 'contract' && moatDays(state, iata) > 0 && departures < MOAT_FLOOR_DEPARTURES[tier]) {
      items.push({
        kind: 'moat',
        iata,
        severity: 'warn',
        daysLeft: Math.ceil(moatDays(state, iata) / MOAT_LAPSE_PER_DAY),
        departures,
        floor: MOAT_FLOOR_DEPARTURES[tier],
      });
    }

    // A hub style or one more frequency only means something with two spokes to connect.
    if (spokesOf(state, iata).size >= 2) {
      const plan = planHub(state, iata);
      if (plan.urgency !== 'none') items.push({ kind: 'hub', iata, severity: plan.urgency === 'act' ? 'bad' : 'warn', missedPerDay: plan.missedPerDay });
      const [idea] = routesFedAt(state, iata, 1, (other) => known.has(other));
      if (idea && idea.connecting >= FEED_WATCH_PASSENGERS) feeds.push({ kind: 'feed', iata, severity: 'warn', other: idea.other, connecting: idea.connecting });
    }

    if (watchRivals) {
      const rivals = newRivalRoutesAt(state, iata);
      if (rivals.routes > 0) items.push({ kind: 'rival', iata, severity: 'warn', ...rivals });
    }
  }
  feeds.sort((a, b) => b.connecting - a.connecting || a.iata.localeCompare(b.iata));
  items.push(...feeds.slice(0, FEED_WATCH_LIMIT));
  return items.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.iata.localeCompare(b.iata),
  );
}

/**
 * Dismissing a watch item: the player has seen it and made the call, so
 * it leaves the list until it gets meaningfully worse (or bigger, for an
 * opportunity). Without this a problem the player chose to live with, a
 * full peak they are happy to queue in, sits on the list and in the rail
 * dot for ever, and the list stops meaning "wants a call now".
 */

/** One item's identity across days: its kind and field, and the other end for a feed idea. */
export function watchKey(item: WatchItem): string {
  return item.kind === 'feed' ? `feed:${item.iata}:${item.other}` : `${item.kind}:${item.iata}`;
}

/** The one number that says how big an item is, bigger meaning it wants the call more (fewer moat days left is worse). */
function watchMeasure(item: WatchItem): number {
  switch (item.kind) {
    case 'peak':
      return item.load;
    case 'hub':
      return item.missedPerDay;
    case 'ground':
      return item.minutes;
    case 'moat':
      return item.daysLeft;
    case 'rival':
      return item.routes;
    case 'feed':
      return item.connecting;
  }
}

/** A peak this many points fuller than when dismissed comes back. */
export const WATCH_RETURN_PEAK_POINTS = 5;
/** Money missed or connections offered this many times what they were come back. */
export const WATCH_RETURN_GROWTH = 1.5;
/** Ground minutes this many more a departure come back. */
export const WATCH_RETURN_GROUND = 1;
/** A draining moat comes back once, when this few days are left. */
export const WATCH_RETURN_MOAT_DAYS = 3;

/** Whether an item that was dismissed has moved far enough to want the call again. */
function returnsFromDismissal(item: WatchItem, dismissed: { severity: 'warn' | 'bad'; measure: number }): boolean {
  if (SEVERITY_ORDER[item.severity] < SEVERITY_ORDER[dismissed.severity]) return true;
  const now = watchMeasure(item);
  switch (item.kind) {
    case 'peak':
      // In whole points, as the row shows it, so 92% to 97% counts however the fractions round.
      return Math.round(now * 100) >= Math.round(dismissed.measure * 100) + WATCH_RETURN_PEAK_POINTS;
    case 'hub':
    case 'feed':
      return now >= dismissed.measure * WATCH_RETURN_GROWTH;
    case 'ground':
      return now >= dismissed.measure + WATCH_RETURN_GROUND;
    case 'moat':
      return dismissed.measure > WATCH_RETURN_MOAT_DAYS && now <= WATCH_RETURN_MOAT_DAYS;
    case 'rival':
      return now > dismissed.measure;
  }
}

/** Whether this item is set aside right now. */
export function isWatchDismissed(state: SimState, item: WatchItem): boolean {
  const dismissed = state.watchDismissed?.[watchKey(item)];
  return dismissed !== undefined && !returnsFromDismissal(item, dismissed);
}

/** Take an item off the watch list until it gets worse. */
export function dismissWatchItem(state: SimState, item: WatchItem): void {
  state.watchDismissed = { ...state.watchDismissed, [watchKey(item)]: { severity: item.severity, measure: watchMeasure(item) } };
}

/** Put a dismissed item back on the list. */
export function restoreWatchItem(state: SimState, item: WatchItem): void {
  if (!state.watchDismissed) return;
  const { [watchKey(item)]: _restored, ...rest } = state.watchDismissed;
  state.watchDismissed = rest;
}

/**
 * At rollover: forget a dismissal once its item is gone from the list (so
 * if it comes back later it is news again) or has come back by getting
 * worse (so it stays back even if it eases a little).
 */
export function pruneWatchDismissed(state: SimState): void {
  const dismissed = state.watchDismissed;
  if (!dismissed || Object.keys(dismissed).length === 0) return;
  const kept: NonNullable<SimState['watchDismissed']> = {};
  for (const item of airportWatch(state)) {
    const entry = dismissed[watchKey(item)];
    if (entry && !returnsFromDismissal(item, entry)) kept[watchKey(item)] = entry;
  }
  state.watchDismissed = kept;
}
