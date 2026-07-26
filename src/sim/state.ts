import aircraftTypesData from '../../data/aircraft-types.json';
import { loadSchedule, marketKey, recommendedFare, type ScheduleLeg } from './schedule';
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
    weatherByAirport: {},
    completedToday: [],
    todayRevenue: 0,
    todayCost: 0,
    todayMargin: 0,
    rngSeed,
  };
}
