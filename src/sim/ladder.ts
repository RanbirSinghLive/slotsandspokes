import airportsData from '../../data/airports.json';
import { lastWeekMargin } from './pnlHistory';
import { hasHeavyBase, hasLineBase, mxStationList } from './bases';
import { crewBases } from './crews';
import { loadFactorCap } from './innovations';
import { mandatesOf } from './mandates';
import { countryOf, homeCountry } from './rights';
import { airportLoad, dailyMovementsAt } from './airports';
import { dayIndex } from './clock';
import { connectingPassengersThrough } from './hubs';
import { marketLoadFactor } from './loadFactor';
import { networkNps } from './nps';
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
  /**
   * An extra teaches a mechanic and counts toward a tier being complete, but
   * is not one of the tier's gate set: the tier climbs without it, and
   * rivals (sim/rivalLadder.ts) never judge it.
   */
  extra?: boolean;
  /** False when this game has no way to meet it (events switched off): it is left out of the count. */
  applies?: (state: SimState) => boolean;
  /** How close the airline is, for the Goals view. Null when there's nothing to count. */
  progress: (state: SimState) => Progress | null;
};

export type Tier = {
  id: string;
  name: string;
  /** How many of this tier's gate milestones (not extras) reach the next tier. */
  needed: number;
  milestones: Milestone[];
  /** What climbing this tier opens, in words. */
  opens: string[];
  /** Aircraft classes climbing this tier lets the player lease (sim/market.ts). */
  opensClasses?: string[];
};

type Located = { iata: string; lat: number; lon: number };
const airportByIata = new Map((airportsData as Located[]).map((airport) => [airport.iata, airport]));

// --- Helpers over the airline ------------------------------------------------

/** Every market the airline flies, as [a, b]. */
function markets(state: SimState): [string, string][] {
  const keys = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  return [...keys].map((key) => key.split('-') as [string, string]);
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


/** The milestones that gate a tier: everything but its extras. */
export function gateMilestones(tier: Tier): Milestone[] {
  return tier.milestones.filter((milestone) => !milestone.extra);
}

function appliesIn(state: SimState, milestone: Milestone): boolean {
  return milestone.applies?.(state) ?? true;
}

/** How many gate milestones reach the next tier in this game: fewer when one cannot be met here. */
export function tierNeeded(state: SimState, tier: Tier): number {
  return Math.min(tier.needed, gateMilestones(tier).filter((milestone) => appliesIn(state, milestone)).length);
}

/** Gate milestones met, and extras met, for the Goals view. */
export function tierCounts(state: SimState, tier: Tier): { gates: number; extras: number; extrasTotal: number } {
  const met = (milestone: Milestone) => isMilestoneMet(state, milestone.id);
  return {
    gates: gateMilestones(tier).filter(met).length,
    extras: tier.milestones.filter((milestone) => milestone.extra && met(milestone)).length,
    extrasTotal: tier.milestones.filter((milestone) => milestone.extra && appliesIn(state, milestone)).length,
  };
}

/** Whether every milestone of a tier that applies here, extras included, is met. */
export function tierComplete(state: SimState, tier: Tier): boolean {
  return tier.milestones.filter((milestone) => appliesIn(state, milestone)).every((milestone) => isMilestoneMet(state, milestone.id));
}

// --- More helpers over the airline ------------------------------------------

function countriesServed(state: SimState): number {
  return new Set([...networkAirports(state)].map((iata) => countryOf(iata)).filter(Boolean)).size;
}

/** Events taken on, flown or not: offered ones that lapsed do not count. */
function eventsAccepted(state: SimState): number {
  return mandatesOf(state).filter((mandate) => mandate.status === 'accepted' || mandate.status === 'ended').length;
}

/** Lanes the airline fills a need on, at half or better, from cargo goods matching (sim/cargo.ts). */
function cargoLanesFilled(state: SimState): number {
  return Object.entries(state.cargoSatisfaction ?? {}).filter(([, filled]) => filled >= 0.5).length;
}

function cabinTeamsOnRegionals(state: SimState): number {
  return Object.values(crewBases(state)).reduce((sum, base) => sum + (base.cabinByClass?.REGIONAL ?? 0), 0);
}

function awayFromHome(state: SimState, hasBase: (state: SimState, iata: string) => boolean): boolean {
  return mxStationList(state).some((iata) => iata !== state.homeAirport && hasBase(state, iata));
}

/** Days in a row the last month of margins have all been in the black. */
function profitableRun(state: SimState, days: number): boolean {
  const recent = state.marginHistory.slice(-days);
  return recent.length === days && recent.every((margin) => margin > 0);
}

function hubsOver(state: SimState, passengers: number): number {
  return [...networkAirports(state)].filter((iata) => connectingPassengersThrough(state, iata) >= passengers).length;
}

const noProgress = () => null;

// --- The ladder -----------------------------------------------------------------

/** Congestion at which an airport counts as busy, for slot control. */
export const BUSY_AIRPORT_LOAD = 0.75;
/**
 * Load factor that counts as nearly full. Planes sell at most
 * sim/economy.ts's LOAD_FACTOR (75%) of their seats, so a full route
 * shows about 76%; this is nearly there.
 */
export const NEARLY_FULL = 0.72;
/**
 * Connecting passengers a day through one airport for the two hub
 * milestones. The connecting model runs large for big cities: a careful
 * airline from Montréal connects about 150 a day by day 60 and 600 by day
 * 120; London about 1,000 by day 15.
 */
const HUB_PASSENGERS = 150;
const BIG_HUB_PASSENGERS = 750;
/**
 * The trailing NPS (sim/nps.ts, about the last month), and the flights
 * scored in all, that count as a good name. A careful airline on old
 * airframes sits at 12–17 from its fourth month, so this asks for its
 * better months, and for a thousand flights so it can't be met early.
 */
const GOOD_NPS = 15;
const GOOD_NPS_MIN_FLIGHTS = 1000;
/** Days a route has to be flown to count as holding a city (the P&L history's length, sim/pnlHistory.ts). */
export const HOLD_DAYS = 30;

export const LADDER: Tier[] = [
  {
    id: 'start-up',
    name: 'Start-up',
    needed: 4,
    opens: ['Regional aircraft on the lessor', 'Innovation: crew academy'],
    opensClasses: ['REGIONAL'],
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
      {
        id: 'second-route',
        name: 'Two routes',
        description: 'Fly two different routes at once.',
        extra: true,
        met: (state) => markets(state).length >= 2,
        progress: (state) => ({ current: Math.min(2, markets(state).length), target: 2, unit: 'routes' }),
      },
      {
        id: 'home-base-crew',
        name: 'A crew of your own',
        description: 'Have a crew based at a second airport, not just home.',
        extra: true,
        met: (state) => Object.keys(crewBases(state)).some((iata) => iata !== state.homeAirport),
        progress: noProgress,
      },
    ],
  },
  {
    id: 'regional',
    name: 'Regional carrier',
    needed: 3,
    opens: ['Narrowbody aircraft on the lessor', 'Innovations: online booking, younger airframes'],
    opensClasses: ['NARROWBODY'],
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
      {
        id: 'cabin-crew',
        name: 'Cabin crew aboard',
        description: 'Have cabin teams trained for a Regional: regional aircraft and up carry them, and a shortage hurts NPS.',
        extra: true,
        met: (state) => cabinTeamsOnRegionals(state) > 0,
        progress: noProgress,
      },
      {
        id: 'first-event',
        name: 'Special request',
        description: 'Accept an event: a priority flight on a route you already fly.',
        extra: true,
        applies: (state) => !state.eventsOff,
        met: (state) => eventsAccepted(state) >= 1,
        progress: noProgress,
      },
    ],
  },
  {
    id: 'network',
    name: 'Network airline',
    needed: 3,
    opens: ['Widebody aircraft on the lessor', 'Innovations: loyalty scheme, winglet retrofits'],
    opensClasses: ['WIDEBODY'],
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
        description: `Reach an NPS of ${GOOD_NPS} over the last month, with ${GOOD_NPS_MIN_FLIGHTS.toLocaleString()} flights flown in all.`,
        met: (state) => state.npsScoredFlightsTotal >= GOOD_NPS_MIN_FLIGHTS && networkNps(state) >= GOOD_NPS,
        progress: (state) => ({ current: Math.round(networkNps(state)), target: GOOD_NPS, unit: 'NPS' }),
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
      {
        id: 'away-line-base',
        name: 'Nights away from home',
        description: 'Open a line base at an airport that is not home: planes sleeping there get their nightly check.',
        extra: true,
        met: (state) => awayFromHome(state, hasLineBase),
        progress: noProgress,
      },
      {
        id: 'first-cargo',
        name: 'Belly freight',
        description: 'Earn from freight: match a good one airport makes with one that needs it.',
        extra: true,
        met: (state) => (state.cargoRevenueTotal ?? 0) > 0,
        progress: noProgress,
      },
    ],
  },
  {
    id: 'international',
    name: 'International',
    needed: 2,
    opens: ['Innovations: codeshare feed, spoilage management I–III'],
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
      {
        id: 'five-countries',
        name: 'Five flags',
        description: 'Serve airports in 5 countries.',
        met: (state) => countriesServed(state) >= 5,
        progress: (state) => ({ current: countriesServed(state), target: 5, unit: 'countries' }),
      },
      {
        id: 'foreign-base',
        name: 'A base abroad',
        description: 'Base a plane at an airport outside your home country. Air rights decide which routes it can fly (see the rights icon on an airport).',
        met: (state) => {
          const home = homeCountry(state);
          return state.aircraft.some((aircraft) => aircraft.baseAirport && countryOf(aircraft.baseAirport) !== home);
        },
        progress: noProgress,
      },
    ],
  },
  {
    id: 'operator',
    name: 'Operator',
    needed: 3,
    opens: [],
    milestones: [
      {
        id: 'away-heavy-base',
        name: 'A hangar away from home',
        description: 'Open a heavy base (hangar bays) at an airport that is not home.',
        met: (state) => awayFromHome(state, hasHeavyBase),
        progress: noProgress,
      },
      {
        id: 'line-and-heavy',
        name: 'Line and heavy',
        description: 'Run a line base and a hangar at the same airport.',
        met: (state) => mxStationList(state).some((iata) => hasLineBase(state, iata) && hasHeavyBase(state, iata) && iata !== state.homeAirport),
        progress: noProgress,
      },
      {
        id: 'clean-month',
        name: 'A clean month',
        description: 'Go 30 days with no breakdown or overdue heavy check grounding a plane, flying at least 3 aircraft.',
        met: (state) => state.aircraft.length >= 3 && dayIndex(state) - (state.lastAogDay ?? 0) >= 30 && dayIndex(state) >= 30,
        progress: (state) => ({
          current: Math.min(30, Math.max(0, dayIndex(state) - (state.lastAogDay ?? 0))),
          target: 30,
          unit: 'days without an AOG',
        }),
      },
      {
        id: 'train-a-type',
        name: 'Cross-trained',
        description: 'Retrain a crew for another aircraft class.',
        met: (state) => Object.values(crewBases(state)).some((base) => base.retraining.length > 0),
        progress: noProgress,
      },
      {
        id: 'ten-planes',
        name: 'Ten tails',
        description: 'Operate 10 aircraft.',
        met: (state) => state.aircraft.length >= 10,
        progress: (state) => ({ current: Math.min(10, state.aircraft.length), target: 10, unit: 'aircraft' }),
      },
    ],
  },
  {
    id: 'established',
    name: 'Established carrier',
    needed: 3,
    opens: [],
    milestones: [
      {
        id: 'matched-lane',
        name: 'Goods in, goods out',
        description: 'Fill a need on a cargo lane to half or better.',
        met: (state) => cargoLanesFilled(state) >= 1,
        progress: noProgress,
      },
      {
        id: 'five-lanes',
        name: 'A freight network',
        description: 'Fill needs on 5 cargo lanes at once.',
        met: (state) => cargoLanesFilled(state) >= 5,
        progress: (state) => ({ current: Math.min(5, cargoLanesFilled(state)), target: 5, unit: 'lanes' }),
      },
      {
        id: 'five-events',
        name: 'Always on call',
        description: 'Accept 5 events.',
        applies: (state) => !state.eventsOff,
        met: (state) => eventsAccepted(state) >= 5,
        progress: (state) => ({ current: Math.min(5, eventsAccepted(state)), target: 5, unit: 'events' }),
      },
      {
        id: 'ninety-in-the-black',
        name: 'A quarter in the black',
        description: 'Make money every day for 90 days running.',
        met: (state) => profitableRun(state, 90),
        progress: (state) => {
          let run = 0;
          for (let i = state.marginHistory.length - 1; i >= 0 && state.marginHistory[i] > 0; i--) run++;
          return { current: Math.min(90, run), target: 90, unit: 'days' };
        },
      },
    ],
  },
  {
    id: 'flagship',
    name: 'Flagship',
    needed: 3,
    opens: ['Innovations: spoilage management IV–V'],
    milestones: [
      {
        id: 'name-25',
        name: 'A name to trust',
        description: 'Reach an NPS of 25 over the last month, with 3,000 flights flown in all.',
        met: (state) => state.npsScoredFlightsTotal >= 3000 && networkNps(state) >= 25,
        progress: (state) => ({ current: Math.round(networkNps(state)), target: 25, unit: 'NPS' }),
      },
      {
        id: 'cap-80',
        name: 'Nearly full',
        description: 'Raise how much of its seats a plane can sell to 80% (spoilage management and a commercial officer).',
        met: (state) => loadFactorCap(state) >= 0.8,
        progress: (state) => ({ current: Math.round(loadFactorCap(state) * 100), target: 80, unit: '% seat cap' }),
      },
      {
        id: 'three-hubs',
        name: 'Three real hubs',
        description: `Connect ${BIG_HUB_PASSENGERS} passengers a day through each of 3 airports.`,
        met: (state) => hubsOver(state, BIG_HUB_PASSENGERS) >= 3,
        progress: (state) => ({ current: Math.min(3, hubsOver(state, BIG_HUB_PASSENGERS)), target: 3, unit: 'hubs' }),
      },
      {
        id: 'young-mixed-fleet',
        name: 'A modern mixed fleet',
        description: 'Fly 3 or more aircraft types, every plane under 8 years old.',
        met: (state) =>
          new Set(state.aircraft.map((aircraft) => aircraft.typeCode)).size >= 3 && state.aircraft.every((aircraft) => aircraft.ageYears < 8),
        progress: noProgress,
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
    const met = gateMilestones(tier).filter((milestone) => isMilestoneMet(state, milestone.id)).length;
    if (met < tierNeeded(state, tier)) break;
    climbed++;
  }
  return climbed;
}

/** The tier the airline is working on, or null once it has climbed them all. */
export function currentTier(state: SimState): Tier | null {
  return LADDER[tiersClimbed(state)] ?? null;
}

/**
 * Whether the player may lease this class: the Propeller always, each
 * bigger class once the tier that opens it is climbed.
 */
export function classOpen(state: SimState, typeCode: string): boolean {
  const opener = LADDER.findIndex((tier) => tier.opensClasses?.includes(typeCode));
  return opener === -1 || tiersClimbed(state) > opener;
}

/**
 * A tier as the airline it makes you, for a sentence: "a start-up
 * airline", "a regional carrier", "an international airline".
 */
export function airlineCalled(tier: Tier): string {
  const name = tier.name.toLowerCase();
  const noun = /(airline|carrier)$/.test(name) ? name : `${name} airline`;
  return `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;
}

/** The tier the player becomes on climbing the one that opens this class ("Regional carrier" for Regionals), or null. */
export function tierThatOpens(typeCode: string): Tier | null {
  const opener = LADDER.findIndex((tier) => tier.opensClasses?.includes(typeCode));
  return opener === -1 ? null : (LADDER[opener + 1] ?? null);
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

