import { airportLoad, dailyMovementsAt } from './airports';
import { dayIndex } from './clock';
import type { CompetitorOffering } from './competitors';
import competitorsData from '../../data/competitors.json';
import { classByCode, pluralClassName } from './aircraftClasses';
import { airlineCalled, BUSY_AIRPORT_LOAD, HOLD_DAYS, LADDER, NEARLY_FULL } from './ladder';
import { activeShock } from './shocks';
import type { SimState } from './state';

/**
 * Rivals climb the same ladder as the player (sim/ladder.ts) to lease
 * bigger aircraft (WEEK-TEN.md, thread 13): the same tiers, the same
 * milestones and thresholds, each judged on the rival's own routes. Rivals
 * are simpler airlines than the player's (no connecting passengers, no
 * NPS, no bases), so three milestones use a stated stand-in:
 *
 * - **Hub** (150 connecting a day): four or more routes from one airport.
 * - **A good name** (NPS): eight routes each flown 90 days or more.
 * - **A second base**: three or more routes from each of two airports.
 *
 * The seed incumbents (data/competitors.json) are established regional
 * airlines, so they start with Start-up met and fly Regionals; every
 * newcomer, the home-city rival included, starts from scratch on
 * Propellers. Checked once a day at rollover, and only the milestones of the
 * tier a rival is working on (up to the last tier that opens an aircraft
 * class); a milestone met stays met.
 */

type RivalCheck = (state: SimState, routes: CompetitorOffering[], code: string) => boolean;

const DAY_MINUTES = 1440;

function daysOpen(state: SimState, route: CompetitorOffering): number {
  return Math.floor((state.simMinute - route.openedAtMinute) / DAY_MINUTES);
}

/** Routes by the airport they touch. */
function routesByAirport(routes: CompetitorOffering[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const route of routes) {
    for (const iata of [route.origin, route.dest]) count.set(iata, (count.get(iata) ?? 0) + 1);
  }
  return count;
}

const RIVAL_CHECKS: Record<string, RivalCheck> = {
  'first-route': (_state, routes) => routes.length > 0,
  'route-pays': (_state, routes) => routes.some((route) => (route.profitableDays ?? 0) >= 7),
  'full-route': (_state, routes) => routes.some((route) => (route.loadFactor ?? 0) >= NEARLY_FULL),
  // An airport only this airline serves, on a route it has flown HOLD_DAYS.
  'first-in': (state, routes, code) =>
    routes.some(
      (route) =>
        daysOpen(state, route) >= HOLD_DAYS &&
        [route.origin, route.dest].some(
          (iata) =>
            !state.schedule.some((leg) => leg.origin === iata || leg.dest === iata) &&
            !state.competitorRoutes.some((other) => other.code !== code && (other.origin === iata || other.dest === iata)),
        ),
    ),
  'eight-airports': (_state, routes) => routesByAirport(routes).size >= 8,
  'hub': (_state, routes) => [...routesByAirport(routes).values()].some((count) => count >= 4),
  'weather-the-storm': (state, routes) => {
    const shock = activeShock(state);
    if (!shock || dayIndex(state) - shock.startDay < 7) return false;
    return routes.length > 0 && routes.every((route) => (route.profitableDays ?? 0) >= 7);
  },
  'fly-regional': (state, _routes, code) => (state.competitorFleets[code] ?? []).includes('REGIONAL'),
  'slot-control': (state, routes) =>
    [...routesByAirport(routes).keys()].some((iata) => {
      const all = dailyMovementsAt(state, iata);
      const theirs = routes.filter((route) => route.origin === iata || route.dest === iata).reduce((sum, route) => sum + 2 * route.dailyFrequency, 0);
      return all > 0 && airportLoad(state, iata) >= BUSY_AIRPORT_LOAD && theirs / all >= 0.6;
    }),
  'four-dominant': (_state, routes) => routes.filter((route) => route.dailyFrequency >= 4).length >= 4,
  'good-name': (state, routes) => routes.filter((route) => daysOpen(state, route) >= 90).length >= 8,
  'second-base': (_state, routes) => [...routesByAirport(routes).values()].filter((count) => count >= 3).length >= 2,
  'fly-narrowbody': (state, _routes, code) => (state.competitorFleets[code] ?? []).includes('NARROWBODY'),
};

const SEED_CODES = new Set((competitorsData as { code: string }[]).map((route) => route.code));
/**
 * The tiers these judge: up to the last that opens an aircraft class.
 * Worked out when first asked, not at load, since the ladder's module may
 * still be loading when this one is (the market imports both).
 */
function classTiers(): typeof LADDER {
  return LADDER.slice(0, LADDER.map((tier) => !!tier.opensClasses).lastIndexOf(true) + 1);
}

/** A rival's milestones met, recorded the first time it's asked about: incumbents start with Start-up's. */
function milestonesOf(state: SimState, code: string): Record<string, number> {
  const all = (state.rivalMilestones ??= {});
  if (!all[code]) {
    all[code] = {};
    if (SEED_CODES.has(code)) for (const milestone of LADDER[0].milestones) all[code][milestone.id] = 0;
  }
  return all[code];
}

/** How many tiers a rival has climbed. */
export function rivalTiersClimbed(state: SimState, code: string): number {
  const met = milestonesOf(state, code);
  let climbed = 0;
  for (const tier of LADDER) {
    const count = tier.milestones.filter((milestone) => met[milestone.id] !== undefined).length;
    if (count < tier.needed) break;
    climbed += 1;
  }
  return climbed;
}

/** Where a rival stands on the ladder, in words: "a regional carrier, 2 of 5 toward a network airline". */
export function rivalLadderInWords(state: SimState, code: string): string {
  const climbed = rivalTiersClimbed(state, code);
  const met = milestonesOf(state, code);
  const current = LADDER[climbed];
  const becameName = climbed === 0 ? 'a start-up' : airlineCalled(LADDER[climbed]);
  if (!current || !current.opensClasses) return `${becameName}, flying every class`;
  const count = current.milestones.filter((milestone) => met[milestone.id] !== undefined).length;
  const next = LADDER[climbed + 1];
  const opens = current.opensClasses.map((typeCode) => pluralClassName(classByCode(typeCode)?.name ?? typeCode)).join(', ');
  return `${becameName}: ${Math.min(count, current.needed)} of ${current.needed} milestones toward ${next ? airlineCalled(next) : 'the next tier'}, which opens ${opens}`;
}

/** Whether a rival may lease this class: the tier that opens it is climbed, as for the player (sim/ladder.ts's classOpen()). */
export function rivalClassOpen(state: SimState, code: string, typeCode: string): boolean {
  const opener = LADDER.findIndex((tier) => tier.opensClasses?.includes(typeCode));
  return opener === -1 || rivalTiersClimbed(state, code) > opener;
}

/** The biggest class a rival may lease, for its starting fleet. */
export function biggestOpenRivalClass(state: SimState, code: string, wanted: string, ladder: string[]): string {
  return ladder.slice(ladder.indexOf(wanted)).find((typeCode) => rivalClassOpen(state, code, typeCode)) ?? ladder[ladder.length - 1];
}

/** Once a day at rollover, after rival routes are judged (sim/rivalEconomics.ts): record each rival's newly met milestones. */
export function rollDailyRivalMilestones(state: SimState): void {
  const today = dayIndex(state);
  const byCode = new Map<string, CompetitorOffering[]>();
  for (const route of state.competitorRoutes) byCode.set(route.code, [...(byCode.get(route.code) ?? []), route]);
  const tiers = classTiers();
  for (const [code, routes] of byCode) {
    const met = milestonesOf(state, code);
    // Only the tier it's working on: a later tier's milestones count once
    // it gets there. Judging every tier's every day made the balance
    // report two-thirds slower (the slot-control check is costly).
    const tier = tiers[rivalTiersClimbed(state, code)];
    if (!tier) continue;
    for (const milestone of tier.milestones) {
      if (met[milestone.id] !== undefined) continue;
      if (RIVAL_CHECKS[milestone.id]?.(state, routes, code)) met[milestone.id] = today;
    }
  }
}
