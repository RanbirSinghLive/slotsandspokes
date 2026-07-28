import aircraftTypesData from '../../data/aircraft-types.json';
import { loadSchedule, marketKey, recommendedFare, type PositioningLeg, type ScheduleLeg } from './schedule';
import { loadFleetMarket, type FleetListing } from './fleetMarket';
import type { WeatherEvent } from './weather';

export type AircraftStatus = 'ground' | 'airborne';

export type Aircraft = {
  tail: string;
  typeCode: string;
  status: AircraftStatus;
  atAirport: string | null;
  activeLegId: string | null;
  /**
   * The simMinute this aircraft last became grounded — 0 at the start of the
   * world, updated every time it lands. step() (M9) won't let it depart on
   * its next leg until MIN_TURN_MINUTES after this, even if that leg's
   * scheduled departure time has already passed: a late arrival still needs
   * a real turnaround, not an instant one, which is what lets one delay
   * push the next leg's departure back rather than only "catching up"
   * instantly.
   */
  groundSinceMinute: number;
  /**
   * Week three's Fleet Market: whether this airframe was bought outright
   * or leased. Acquisition-only for this pass — no sell-back or early
   * lease-end — so this never changes after ui/fleetMarket.ts creates the
   * record.
   */
  ownership: 'owned' | 'leased';
  /**
   * 0 for an owned aircraft. For a leased one, the flat daily cost
   * (`FleetListing.leasePricePerDay` at the moment it was leased) charged
   * every day at rollover (see step.ts), the same "flat recurring cost"
   * shape `RouteSettings.marketingSpend` already has.
   */
  leaseCostPerDay: number;
  /**
   * Copied from `FleetListing.ageYears` at acquisition (ui/fleetMarket.ts)
   * and never updated after — a deliberate simplification, not an
   * oversight: an aircraft doesn't get older as sim days pass, it's just
   * "however old it was when it joined the fleet," for now. Feeds one of
   * step.ts's three delay causes (age, weather, knock-on) — an older
   * airframe rolls worse on-time odds and a longer worst case when it
   * isn't, on top of whatever weather or cascading lateness it's also
   * carrying.
   */
  ageYears: number;
};

export type ActiveFlight = {
  legId: string;
  tail: string;
  origin: string;
  dest: string;
  departMinute: number;
  arriveMinute: number;
  /**
   * What arriveMinute would have been with zero delay and an on-time
   * departure — i.e., the honest "should have landed by" time. Comparing
   * this to the real arriveMinute (both computed in step.ts at the moment
   * this flight departs) is how the fleet panel explains *why* a flight is
   * running late, without the UI layer needing to redo any day-boundary math.
   */
  scheduledArriveMinute: number;
  /**
   * This flight's fare and marketing spend, both copied from its market's
   * RouteSettings at the moment it departs (see step.ts) — not re-read at
   * arrival, so a change the player makes mid-flight doesn't retroactively
   * affect one already in the air. Together with `origin`/`dest` (to look
   * up who's competing) and `legsServingMarket` (recomputed fresh at
   * arrival, since adding a frequency mid-flight *should* immediately
   * split demand differently), these are everything sim/economy.ts needs.
   */
  fare: number;
  marketingSpend: number;
  /**
   * Set only on a flight step.ts created from a PositioningLeg (week
   * three) — a one-time repositioning move with no market to sell seats
   * on. step.ts's arrival handling checks this to charge the flight's real
   * operating cost (fuel + departure, sim/economy.ts's legCost()) without
   * running the passenger/revenue side of flightResult() at all, rather
   * than pretending it has a market it doesn't.
   */
  isPositioning?: boolean;
};

/**
 * Week two's "Pricing" and "Commercial" levers, one entry per *market*
 * (an origin-dest pair, either direction — see `marketKey()`), not per
 * individual scheduled leg. Fare is deliberately a route-level decision:
 * a market with two daily frequencies still has exactly one fare, not two
 * independently adjustable ones, to keep the game's decision space
 * manageable as more levers (marketing spend today, more later — see
 * ui/commercial.ts) get added to this same record.
 */
export type RouteSettings = {
  fare: number;
  /**
   * Daily dollars spent promoting this specific market — a flat cost
   * charged once per day (see step.ts's day-rollover handling), not per
   * flight, since it's a market-level decision, not a leg-level one. Feeds
   * a diminishing-returns bonus into sim/choiceModel.ts's booking share;
   * 0 means no spend and no effect, same as before this lever existed.
   */
  marketingSpend: number;
};

export type SimState = {
  simMinute: number;
  cash: number;
  aircraft: Aircraft[];
  activeFlights: ActiveFlight[];
  /**
   * This game's own copy of the daily schedule — a fresh array from
   * sim/schedule.ts's loadSchedule(), independent of any other game's copy
   * and of the unedited template. step() reads departure times from here,
   * not from a module-level constant, specifically so the M8 schedule
   * editor's edits actually change what the sim does: mutate
   * `state.schedule[i].departMinute` and the very next tick sees it.
   */
  schedule: ScheduleLeg[];
  /**
   * One RouteSettings entry per market currently served, keyed by
   * marketKey(origin, dest) — a plain object (not a Map) so `state` keeps
   * surviving JSON.parse(JSON.stringify(state)) unchanged, per CLAUDE.md.
   * ui/routeBuilder.ts creates a new entry here (recommendedFare() default,
   * zero marketing spend) whenever a leg is added to a market that didn't
   * already have one; adding a second frequency to an existing market
   * reuses the same entry rather than creating a second one.
   */
  routeSettings: Record<string, RouteSettings>;
  /**
   * One-time repositioning moves, queued but not yet flown — see
   * PositioningLeg's own comment (sim/schedule.ts) for why these live
   * separately from `schedule` rather than as ScheduleLeg entries. step()
   * flies them the same way it flies a scheduled leg (weather, delay, real
   * fuel/departure cost) and removes each one the moment it departs, since
   * a positioning move by definition never repeats.
   */
  positioningLegs: PositioningLeg[];
  /**
   * Week three's Fleet Market: airframes still available to buy or lease
   * (see sim/fleetMarket.ts's FleetListing). ui/fleetMarket.ts removes a
   * listing from here the moment it's acquired — acquisition-only, no
   * sell-back this pass, so this array only ever shrinks.
   */
  fleetMarket: FleetListing[];
  /**
   * Active weather by airport IATA code — a plain object, not a Map, same
   * JSON-round-trip reasoning as `routeSettings`. Absent key means clear
   * skies; see sim/weather.ts's `rollDailyWeather()` for how entries
   * appear, spread to nearby airports, and expire.
   */
  weatherByAirport: Record<string, WeatherEvent>;
  completedToday: string[];
  todayRevenue: number;
  todayCost: number;
  todayMargin: number;
  /**
   * Lifetime counters (never reset, unlike the todayX fields above) behind
   * the "on-time performance" HUD stat next to Cash: every scheduled leg
   * that actually departs increments `flightsDepartedTotal`, and
   * `flightsOnTimeTotal` only when it left at or before its scheduled
   * minute — see step.ts's departure loop for where "on time" is decided.
   * Positioning legs don't count either way; they're not real service.
   */
  flightsDepartedTotal: number;
  flightsOnTimeTotal: number;
  /**
   * The entire state of sim/rng.ts's seeded random number generator. Not
   * used yet — nothing under sim/ calls nextRandom() until the M9 delay
   * mechanic exists — but it lives here, in `state`, from the start rather
   * than as a module-level variable, so that whenever step() does start
   * asking "how late is this flight," the answer stays deterministic and
   * reproducible: same state in, same state out, same as every other field
   * here.
   */
  rngSeed: number;
};

// Only one aircraft type exists so far, so every aircraft record uses it.
const aircraftType = (aircraftTypesData as { code: string }[])[0];

function earliestLegFor(tail: string, legs: ScheduleLeg[]): ScheduleLeg {
  const legsForTail = legs.filter((leg) => leg.tail === tail);
  const [first] = [...legsForTail].sort((a, b) => a.departMinute - b.departMinute);
  if (!first) {
    throw new Error(`No scheduled legs found for tail ${tail}`);
  }
  return first;
}

/**
 * Build the state the world starts in at simMinute 0. Each requested tail
 * starts on the ground wherever its earliest scheduled leg departs from —
 * that's what WEEK-ONE.md means by "start it somewhere overnight."
 *
 * Only `tails` come to life as Aircraft records. step() matches schedule
 * legs against `state.aircraft` by tail, so a leg belonging to a tail that
 * isn't in `tails` simply never finds an aircraft to apply to and is
 * silently skipped. That's how M4 runs "one aircraft" out of the full
 * three-aircraft schedule without step() needing any special-case logic —
 * M5 turns the rest on by passing more tails here.
 *
 * `rngSeed` defaults to a fixed constant rather than something like
 * `Date.now()` — a default that changes every run would make two calls to
 * createInitialState produce different worlds for no reason you asked for,
 * which is exactly what determinism is supposed to rule out. Pass a
 * different seed explicitly (the M7 headless runner will want to, to
 * compare different random delay patterns run over run).
 *
 * Not used by main.ts any more — the interactive game starts from
 * createNewGameState() below, with zero fleet and zero schedule (week
 * three's Fleet Market). This one stays exactly as it was purely so
 * src/headless/run.ts (M7's balance-tuning tool) keeps simulating a full,
 * known 3-aircraft/12-leg network without needing to route through a
 * purchase flow it has no use for.
 */
export function createInitialState(tails: string[], rngSeed: number = 1): SimState {
  const schedule = loadSchedule();

  const aircraft: Aircraft[] = tails.map((tail) => {
    const firstLeg = earliestLegFor(tail, schedule);
    return {
      tail,
      typeCode: aircraftType.code,
      status: 'ground',
      atAirport: firstLeg.origin,
      activeLegId: null,
      groundSinceMinute: 0,
      ownership: 'owned',
      leaseCostPerDay: 0,
      // A brand-new airframe for the headless runner's fixed fleet — age
      // 0 is also the delay model's baseline, so this reproduces its
      // pre-age-mechanic numbers rather than silently shifting them.
      ageYears: 0,
    };
  });

  const routeSettings: Record<string, RouteSettings> = {};
  for (const leg of schedule) {
    const key = marketKey(leg.origin, leg.dest);
    if (!routeSettings[key]) {
      routeSettings[key] = { fare: recommendedFare(leg.origin, leg.dest), marketingSpend: 0 };
    }
  }

  return {
    simMinute: 0,
    cash: 0,
    aircraft,
    activeFlights: [],
    schedule,
    routeSettings,
    positioningLegs: [],
    fleetMarket: [], // no Fleet Market needed for a headless balance run
    weatherByAirport: {},
    completedToday: [],
    todayRevenue: 0,
    todayCost: 0,
    todayMargin: 0,
    flightsDepartedTotal: 0,
    flightsOnTimeTotal: 0,
    rngSeed,
  };
}

/**
 * Starting capital for a genuinely new interactive game — enough to buy
 * one Fleet Market airframe outright with a little left over, or lease two
 * or three while routes ramp up. A pure game-balance number, not derived
 * from anything.
 */
export const STARTING_CASH = 500_000;

/**
 * The state an actual new game starts from (week three's Fleet Market) —
 * zero aircraft, zero schedule, zero routes. Nothing flies and nothing
 * earns until the player buys or leases a first aircraft from
 * `fleetMarket` (ui/fleetMarket.ts) and draws a route for it
 * (ui/routeBuilder.ts); wherever that first aircraft gets based is
 * whatever the player picks at the moment of purchase, which is what
 * makes this also double as "choosing a home airport" without needing a
 * separate step for it.
 *
 * Distinct from createInitialState() above on purpose — that one exists
 * only to keep the headless runner's known, fully-formed test network
 * exactly as it always was; this one is the real "New Game" entry point.
 */
export function createNewGameState(rngSeed: number = Date.now()): SimState {
  return {
    simMinute: 0,
    cash: STARTING_CASH,
    aircraft: [],
    activeFlights: [],
    schedule: [],
    routeSettings: {},
    positioningLegs: [],
    fleetMarket: loadFleetMarket(),
    weatherByAirport: {},
    completedToday: [],
    todayRevenue: 0,
    todayCost: 0,
    todayMargin: 0,
    flightsDepartedTotal: 0,
    flightsOnTimeTotal: 0,
    rngSeed,
  };
}
