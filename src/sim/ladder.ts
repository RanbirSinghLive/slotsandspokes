import airportsData from '../../data/airports.json';
import { airportLoad, dailyMovementsAt } from './airports';
import { dayIndex } from './clock';
import { connectingPassengersThrough } from './hubs';
import { marketLoadFactor } from './loadFactor';
import { networkAirports } from './reach';
import { routeFixedCosts } from './routeCosts';
import { marketKey } from './schedule';
import { hungerByAirport } from './serviceLevel';
import { activeShock } from './shocks';
import type { SimState } from './state';

/**
 * The ladder (WEEK-TEN.md, thread 2): what a good airline builds, in
 * tiers. Each milestone names an edge or a moat the player can act on
 * (CLAUDE.md, the game's philosophy), and a tier is reached by meeting
 * enough of the one before it. Reaching a tier opens what it lists: bigger
 * aircraft and airline programmes (innovations). Open-ended: the last tier
 * is round the world, and there is no win screen.
 *
 * Checked once a day at rollover (checkMilestones()), after the day's
 * P&L, load and on-time histories are recorded. A milestone met stays met,
 * even if the airline later falls back: it's a record of what was built,
 * and taking an aircraft class away again would be absurd.
 *
 * A pure read of `state` apart from recording what's newly met, so the
 * headless runner and the browser see the same ladder.
 */

export type Progress = { current: number; target: number; unit: string };

export type Milestone = {
  id: string;
  name: string;
  /** What to do, in words the player can act on. */
  description: string;
  /** Whether it's met now. */
  met: (state: SimState) => boolean;
  /** How close the airline is, for the Goals view. Null when there's nothing to count. */
  progress: (state: SimState) => Progress | null;
};

export type Tier = {
  id: string;
  name: string;
  /** How many of this tier's milestones reach the next tier. */
  needed: number;
  milestones: Milestone[];
  /** What reaching the next tier opens, in words (WEEK-TEN.md, thread 2's slices 2 and 3 make these real). */
  opens: string[];
};

type Located = { iata: string; lat: number; lon: number };
const airportByIata = new Map((airportsData as Located[]).map((airport) => [airport.iata, airport]));

// --- Helpers over the airline ------------------------------------------------

/** Every market the airline flies, as [a, b]. */
function markets(state: SimState): [string, string][] {
  const keys = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  return [...keys].map((key) => key.split('-') as [string, string]);
}

/** Last week's own margin on a market, per day, or null with less than a week flown. */
function lastWeekMargin(state: SimState, key: string): number | null {
  const revenue = (state.revenueHistoryByMarket[key] ?? []).slice(-7);
  const cost = (state.costHistoryByMarket[key] ?? []).slice(-7);
  if (revenue.length < 7) return null;
  return revenue.reduce((sum, r, i) => sum + r - cost[i], 0) / 7;
}

/** The biggest connecting flow at any one airport, passengers a day. */
function biggestHub(state: SimState): number {
  let best = 0;
  for (const iata of networkAirports(state)) best = Math.max(best, connectingPassengersThrough(state, iata));
  return best;
}

/**
 * The continent an airport is on, roughly, by longitude: the Americas,
 * Europe and Africa, or Asia and Oceania. Enough to say whether a route
 * crosses an ocean.
 */
function continentOf(iata: string): string {
  const lon = airportByIata.get(iata)?.lon ?? 0;
  if (lon < -25) return 'Americas';
  if (lon < 60) return 'Europe and Africa';
  return 'Asia and Oceania';
}

/**
 * How far round the world the airline's network reaches from home, in
 * degrees of longitude, and whether a passenger could go all the way round
 * and back. Walks the network from home, giving each airport an unwrapped
 * longitude (its parent's plus the shortest east-west step of the route
 * between them). Reaching an airport already visited at a longitude a
 * whole turn away means a loop of routes that goes round the globe: a
 * passenger can fly to it, round it, and home the way they came.
 */
export function roundTheWorld(state: SimState): { spanDegrees: number; complete: boolean } {
  const neighbours = new Map<string, Set<string>>();
  for (const [a, b] of markets(state)) {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)!.add(b);
    neighbours.get(b)!.add(a);
  }
  const home = state.homeAirport;
  const unwrapped = new Map<string, number>([[home, airportByIata.get(home)?.lon ?? 0]]);
  const queue = [home];
  let complete = false;
  while (queue.length > 0) {
    const here = queue.shift()!;
    const hereLon = unwrapped.get(here)!;
    for (const next of neighbours.get(here) ?? []) {
      const rawLon = airportByIata.get(next)?.lon ?? 0;
      let step = rawLon - (airportByIata.get(here)?.lon ?? 0);
      if (step > 180) step -= 360;
      if (step < -180) step += 360;
      const nextLon = hereLon + step;
      const seen = unwrapped.get(next);
      if (seen === undefined) {
        unwrapped.set(next, nextLon);
        queue.push(next);
      } else if (Math.abs(seen - nextLon) > 180) {
        complete = true;
      }
    }
  }
  const lons = [...unwrapped.values()];
  const span = complete ? 360 : Math.max(...lons) - Math.min(...lons);
  return { spanDegrees: Math.min(360, span), complete };
}

// --- The ladder -----------------------------------------------------------------

/** Congestion at which an airport counts as busy, for slot control. */
const BUSY_AIRPORT_LOAD = 0.75;
/**
 * Load factor that counts as nearly full. Planes sell at most
 * sim/economy.ts's LOAD_FACTOR (75%) of their seats, so a full route
 * shows about 76%; this is nearly there.
 */
const NEARLY_FULL = 0.72;
/**
 * Connecting passengers a day through one airport for the two hub
 * milestones. The connecting model runs large for big cities: a careful
 * airline from Montréal connects about 150 a day by day 60 and 600 by day
 * 120; London about 1,000 by day 15.
 */
const HUB_PASSENGERS = 150;
const BIG_HUB_PASSENGERS = 750;
/**
 * The lifetime NPS, and the flights it's judged over, that count as a good
 * name. A careful airline on old airframes ends its first year at 14–17,
 * dragged down by its early days, so this asks for better than that.
 */
const GOOD_NPS = 18;
const GOOD_NPS_MIN_FLIGHTS = 1000;
/** Days a route has to be flown to count as holding a city (the P&L history's length, sim/pnlHistory.ts). */
const HOLD_DAYS = 30;

export const LADDER: Tier[] = [
  {
    id: 'start-up',
    name: 'Start-up',
    needed: 4,
    opens: ['Regional aircraft on the lessor'],
    milestones: [
      {
        id: 'first-route',
        name: 'Wheels up',
        description: 'Fly your first route.',
        met: (state) => state.flightsArrivedTotal > 0,
        progress: (state) => ({ current: Math.min(1, state.flightsArrivedTotal), target: 1, unit: 'flight landed' }),
      },
      {
        id: 'route-pays',
        name: 'Pays its way',
        description: 'Run a route that makes money for a week after its share of slots, leases and overhead.',
        met: (state) =>
          markets(state).some(([a, b]) => {
            const margin = lastWeekMargin(state, marketKey(a, b));
            if (margin === null) return false;
            const fixed = routeFixedCosts(state, a, b);
            return margin - fixed.slotsPerDay - fixed.leasePerDay - fixed.overheadPerDay > 0;
          }),
        progress: () => null,
      },
      {
        id: 'full-route',
        name: 'Standing room only',
        description: `Fly a route ${Math.round(NEARLY_FULL * 100)}% full over a week: as near full as planes get.`,
        met: (state) => markets(state).some(([a, b]) => (marketLoadFactor(state, a, b).factor ?? 0) >= NEARLY_FULL),
        progress: (state) => ({
          current: Math.round(Math.max(0, ...markets(state).map(([a, b]) => marketLoadFactor(state, a, b).factor ?? 0)) * 100),
          target: Math.round(NEARLY_FULL * 100),
          unit: '% full, best route',
        }),
      },
      {
        id: 'first-in',
        name: 'First in',
        description: `Hold a city that is starved for service, with no rival there, on a route flown for ${HOLD_DAYS} days.`,
        met: (state) => {
          const hunger = hungerByAirport(state);
          const rivalAirports = new Set(state.competitorRoutes.flatMap((route) => [route.origin, route.dest]));
          return markets(state).some(([a, b]) => {
            if ((state.revenueHistoryByMarket[marketKey(a, b)] ?? []).length < HOLD_DAYS) return false;
            return [a, b].some((iata) => iata !== state.homeAirport && !rivalAirports.has(iata) && (hunger.get(iata) ?? 0) >= 0.75);
          });
        },
        progress: () => null,
      },
    ],
  },
  {
    id: 'regional',
    name: 'Regional carrier',
    needed: 3,
    opens: ['Narrowbody aircraft on the lessor', 'Innovation: online booking'],
    milestones: [
      {
        id: 'eight-airports',
        name: 'On the map',
        description: 'Serve 8 airports.',
        met: (state) => networkAirports(state).size >= 8,
        progress: (state) => ({ current: networkAirports(state).size, target: 8, unit: 'airports' }),
      },
      flyTheClass('fly-regional', 'Growing up', 'REGIONAL', 'Regional'),
      {
        id: 'hub',
        name: 'A hub, not a spoke',
        description: `Connect ${HUB_PASSENGERS} passengers a day through one of your airports.`,
        met: (state) => biggestHub(state) >= HUB_PASSENGERS,
        progress: (state) => ({ current: Math.round(biggestHub(state)), target: HUB_PASSENGERS, unit: 'connecting a day' }),
      },
      {
        id: 'weather-the-storm',
        name: 'Weather the storm',
        description: 'Make money every day for a week while a shock is on.',
        met: (state) => {
          const shock = activeShock(state);
          if (!shock || dayIndex(state) - shock.startDay < 7) return false;
          const lastWeek = state.marginHistory.slice(-7);
          return lastWeek.length === 7 && lastWeek.every((margin) => margin > 0);
        },
        progress: () => null,
      },
    ],
  },
  {
    id: 'network',
    name: 'Network airline',
    needed: 3,
    opens: ['Widebody aircraft on the lessor', 'Innovations: loyalty scheme, winglet retrofits'],
    milestones: [
      {
        id: 'slot-control',
        name: 'Slot control',
        description: 'Fly 60% of the takeoffs and landings at a busy airport.',
        met: (state) =>
          [...networkAirports(state)].some((iata) => {
            const all = dailyMovementsAt(state, iata);
            const yours = state.schedule.filter((leg) => leg.origin === iata || leg.dest === iata).length;
            return all > 0 && airportLoad(state, iata) >= BUSY_AIRPORT_LOAD && yours / all >= 0.6;
          }),
        progress: () => null,
      },
      {
        id: 'four-dominant',
        name: 'Shuttle service',
        description: 'Fly four routes four or more times a day each way.',
        met: (state) => dominantRoutes(state) >= 4,
        progress: (state) => ({ current: dominantRoutes(state), target: 4, unit: 'routes' }),
      },
      {
        id: 'good-name',
        name: 'A good name',
        description: `Keep an NPS of ${GOOD_NPS} or better over at least ${GOOD_NPS_MIN_FLIGHTS.toLocaleString()} flights.`,
        met: (state) => state.npsScoredFlightsTotal >= GOOD_NPS_MIN_FLIGHTS && lifetimeNps(state) >= GOOD_NPS,
        progress: (state) => ({ current: Math.round(lifetimeNps(state)), target: GOOD_NPS, unit: 'NPS' }),
      },
      {
        id: 'second-base',
        name: 'A second base',
        description: 'Base planes at two airports.',
        met: (state) => new Set(state.aircraft.map((aircraft) => aircraft.baseAirport).filter(Boolean)).size >= 2,
        progress: (state) => ({
          current: new Set(state.aircraft.map((aircraft) => aircraft.baseAirport).filter(Boolean)).size,
          target: 2,
          unit: 'bases',
        }),
      },
      flyTheClass('fly-narrowbody', 'Mainline', 'NARROWBODY', 'Narrowbody'),
    ],
  },
  {
    id: 'international',
    name: 'International',
    needed: 2,
    opens: ['Innovation: codeshare-style feed'],
    milestones: [
      {
        id: 'ocean-crossing',
        name: 'Across the water',
        description: 'Fly a route to another continent.',
        met: (state) => markets(state).some(([a, b]) => continentOf(a) !== continentOf(b)),
        progress: () => null,
      },
      {
        id: 'big-hub',
        name: 'A real hub',
        description: `Connect ${BIG_HUB_PASSENGERS} passengers a day through one of your airports.`,
        met: (state) => biggestHub(state) >= BIG_HUB_PASSENGERS,
        progress: (state) => ({ current: Math.round(biggestHub(state)), target: BIG_HUB_PASSENGERS, unit: 'connecting a day' }),
      },
    ],
  },
  {
    id: 'global',
    name: 'Global',
    needed: 1,
    opens: [],
    milestones: [
      {
        id: 'round-the-world',
        name: 'Round the world',
        description: 'Let a passenger fly all the way round the globe on your network and back home.',
        met: (state) => roundTheWorld(state).complete,
        progress: (state) => ({ current: Math.round(roundTheWorld(state).spanDegrees), target: 360, unit: '° of longitude' }),
      },
    ],
  },
];

/** A milestone for putting a class into service: a plane of it flying a route. */
function flyTheClass(id: string, name: string, typeCode: string, className: string): Milestone {
  const flying = (state: SimState) => {
    const tails = new Set(state.aircraft.filter((aircraft) => aircraft.typeCode === typeCode).map((aircraft) => aircraft.tail));
    return state.schedule.some((leg) => tails.has(leg.tail));
  };
  return {
    id,
    name,
    description: `Put a ${className} into service on a route.`,
    met: flying,
    progress: () => null,
  };
}

function dominantRoutes(state: SimState): number {
  const legs = new Map<string, number>();
  for (const leg of state.schedule) {
    const key = marketKey(leg.origin, leg.dest);
    legs.set(key, (legs.get(key) ?? 0) + 1);
  }
  // Legs count both directions; four a day each way is eight legs.
  return [...legs.values()].filter((count) => count >= 8).length;
}

function lifetimeNps(state: SimState): number {
  return state.npsScoredFlightsTotal > 0 ? state.npsPointsTotal / state.npsScoredFlightsTotal : 0;
}

// --- Where the airline stands ------------------------------------------------

const allMilestones = LADDER.flatMap((tier) => tier.milestones);

/** The day each milestone was met, by id. Optional in the save: older games have met none. */
function metDays(state: SimState): Record<string, number> {
  return state.milestonesMet ?? {};
}

export function isMilestoneMet(state: SimState, id: string): boolean {
  return metDays(state)[id] !== undefined;
}

/**
 * How many tiers the airline has climbed: 0 while it's working on the
 * first. A tier counts as climbed when enough of its milestones are met,
 * and only if every tier below it was.
 */
export function tiersClimbed(state: SimState): number {
  let climbed = 0;
  for (const tier of LADDER) {
    const met = tier.milestones.filter((milestone) => isMilestoneMet(state, milestone.id)).length;
    if (met < tier.needed) break;
    climbed++;
  }
  return climbed;
}

/** The tier the airline is working on, or null once it has climbed them all. */
export function currentTier(state: SimState): Tier | null {
  return LADDER[tiersClimbed(state)] ?? null;
}

/** Everything the climbed tiers have opened, in order. */
export function openedSoFar(state: SimState): string[] {
  return LADDER.slice(0, tiersClimbed(state)).flatMap((tier) => tier.opens);
}

/**
 * Once a day at rollover: record every milestone met for the first time
 * today, with the day. Returns their ids, newest news first for the ticker.
 */
export function checkMilestones(state: SimState): string[] {
  const met = (state.milestonesMet ??= {});
  const today = dayIndex(state);
  const newlyMet: string[] = [];
  for (const milestone of allMilestones) {
    if (met[milestone.id] !== undefined) continue;
    if (milestone.met(state)) {
      met[milestone.id] = today;
      newlyMet.push(milestone.id);
    }
  }
  return newlyMet;
}

export function milestoneById(id: string): Milestone | undefined {
  return allMilestones.find((milestone) => milestone.id === id);
}

export function tierOf(id: string): Tier | undefined {
  return LADDER.find((tier) => tier.milestones.some((milestone) => milestone.id === id));
}
