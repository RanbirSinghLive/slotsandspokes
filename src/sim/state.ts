import aircraftTypesData from '../../data/aircraft-types.json';
import type { Shock } from './shocks';
import { startingSimMinute } from './clock';
import type { ScheduleLeg } from './schedule';
import { leaseAircraft } from './leasing';
import { revealReach } from './reach';
import { loadCompetitorRoutes, type CompetitorOffering } from './competitors';
import type { WeatherEvent } from './weather';
import type { DelayBreakdown } from './delays';
import type { HubStyle } from './hubStyle';
import type { AogEvent } from './aog';
import { createMarket, ensureRivalFleets, type MarketState } from './market';
import { FUEL_PRICE_BASELINE } from './fuel';
import type { FuelHedge } from './fuelPrice';
import type { TargetCommitment, TargetResult } from './targets';
import { createCrewPools, type CrewPools, type PendingHire, type PendingTraining, type TrainingLine } from './crew';
import { createExecutiveSlots, type ExecutiveSlots } from './executives';

export type AircraftStatus = 'ground' | 'airborne';

/** One rival route closure: which airline, which market (marketKey), and when. */
export type RivalClosure = { code: string; market: string; closedAtMinute: number };

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
   * The flat daily lease on this aircraft (its class's rate from
   * sim/leasing.ts at the moment it was leased), charged every day at
   * rollover (see step.ts). Every aircraft is leased; there is no owning.
   */
  leaseCostPerDay: number;
  /**
   * Zero for anything leased (sim/leasing.ts)
   * and never updated after — a deliberate simplification, not an
   * oversight: an aircraft doesn't get older as sim days pass, it's just
   * "however old it was when it joined the fleet," for now. Feeds one of
   * step.ts's three delay causes (age, weather, knock-on) — an older
   * airframe rolls worse on-time odds and a longer worst case when it
   * isn't, on top of whatever weather or cascading lateness it's also
   * carrying.
   */
  ageYears: number;
  /**
   * Week six's utilisation pivot: the airport this aircraft is based at,
   * assigned explicitly rather than inferred from wherever its first
   * route happened to start. A rotation begins and ends at its base, so
   * this is what makes continuity automatic — and it lets an airline fly
   * a multi-leg loop like YUL-YFC-YQM-YFC-YQM-YUL without accidentally
   * basing itself at every airport along the way.
   *
   * Null on an aircraft that hasn't been given one yet; such an airframe
   * can't be worked until it has.
   */
  baseAirport: string | null;
};

/** How one leg went, once it has landed. */
export type LegResult = {
  /** Minutes after its scheduled time that it left. */
  departLateMinutes: number;
  /** Minutes after its scheduled arrival that it landed (0 or less: on the dot or early). */
  arriveLateMinutes: number;
  onTime: boolean;
  /** The delay rolled for it, by cause (sim/delays.ts). */
  delayByCause: DelayBreakdown;
  passengers: number;
  /** Seats the plane had, for the flight's load factor. Optional: results from before it was kept have none. */
  seats?: number;
  margin: number;
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
  /** When this flight was scheduled to leave, as an absolute simMinute. `departMinute` minus this is how late it left. */
  scheduledDepartMinute: number;
  /**
   * The delay rolled at departure, by cause (sim/delays.ts), before a
   * flight-ops executive scales it. Kept so hovering the plane on the map
   * can say *why* it's late, not just that it is.
   */
  delayByCause: DelayBreakdown;
  /** The delay actually added to this flight's arrival: `delayByCause` summed, after the executive. */
  delayMinutes: number;
  /**
   * This flight's fare, copied from its market's RouteSettings at the
   * moment it departs (see step.ts) — not re-read at arrival, so a change
   * the player makes mid-flight doesn't retroactively affect one already
   * in the air. Together with `origin`/`dest` (to look up who's competing)
   * and `legsServingMarket` (recomputed fresh at arrival, since adding a
   * frequency mid-flight *should* immediately split demand differently),
   * that's everything sim/economy.ts needs. Flights saved before marketing
   * was removed also carry a `marketingSpend`, which nothing reads.
   */
  fare: number;
};

/**
 * Week two's "Pricing" and "Commercial" levers, one entry per *market*
 * (an origin-dest pair, either direction — see `marketKey()`), not per
 * individual scheduled leg. Fare is deliberately a route-level decision:
 * a market with two daily frequencies still has exactly one fare, not two
 * independently adjustable ones, to keep the game's decision space
 * manageable. Saves from before marketing was removed also carry a
 * `marketingSpend` here, which nothing reads.
 */
/** A way of pricing a market against its rivals (sim/pricing.ts). */
export type FareStance = 'undercut' | 'match' | 'premium';

export type RouteSettings = {
  fare: number;
  /**
   * Whether this market's fare was set by hand, rather than following the
   * airline-wide policy (`SimState.farePolicyMultiplier`, sim/pricing.ts).
   * `applyFarePolicy()` re-prices every market where this is false and
   * leaves the rest alone — so changing policy sweeps the network without
   * clobbering the handful of routes deliberately priced differently.
   */
  fareIsOverridden: boolean;
  /**
   * How this market is priced against its rivals, re-applied every day
   * (sim/pricing.ts's stanceFare()), or null to follow the policy.
   * Setting a fare by hand clears it. Missing in saves from before stances
   * existed, which reads the same as null.
   */
  fareStance?: FareStance | null;
  /**
   * Extra scheduled ground time after every flight on this market, on top
   * of MIN_TURN_MINUTES (sim/turnBuffer.ts). Slack that soaks up a late
   * arrival before it makes the next departure late, paid for in aircraft
   * time: each minute here is a minute of the usable day the plane can't
   * spend flying.
   */
  turnBufferMinutes: number;
};

export type SimState = {
  simMinute: number;
  /** The airport the player chose to start from (sim/homes.ts). The map centres on it. */
  homeAirport: string;
  /**
   * Airports the player can see and use (fog by reach, sim/reach.ts).
   * Only ever grows. Everything else is hidden on the map and cannot be
   * a route's endpoint.
   */
  knownAirports: string[];
  cash: number;
  aircraft: Aircraft[];
  activeFlights: ActiveFlight[];
  /**
   * The airline's daily-repeating schedule. Empty in a new game; rotations
   * are added by sim/rotations.ts's applyRotation(). step() reads departure
   * times from here every tick, so a change is live on the next minute.
   */
  schedule: ScheduleLeg[];
  /**
   * One RouteSettings entry per market currently served, keyed by
   * marketKey(origin, dest) — a plain object (not a Map) so `state` keeps
   * surviving JSON.parse(JSON.stringify(state)) unchanged, per CLAUDE.md.
   * ui/routeBuilder.ts creates a new entry here (the policy fare)
   * whenever a leg is added to a market that didn't
   * already have one; adding a second frequency to an existing market
   * reuses the same entry rather than creating a second one.
   */
  routeSettings: Record<string, RouteSettings>;
  /**
   * Week four's competitor AI (sim/competitors.ts): every competitor
   * route currently in service, seeded from `data/competitors.json` and
   * grown over time by `rollCompetitorRouteOpenings()` (called once per
   * simulated day from step.ts's day-rollover, alongside the weather
   * roll). This array only ever grows —
   * competitors don't retire routes in this pass. Read by
   * `sim/choiceModel.ts` (via `bookingShare()`/`trafficShare()`) for
   * live competitive pressure, and by `render/competition.ts` for the
   * map layer and the "a competitor just opened a route" flash
   * (`CompetitorOffering.openedAtMinute` is what that flash compares
   * against `state.simMinute`).
   */
  competitorRoutes: CompetitorOffering[];
  /**
   * Active weather by airport IATA code — a plain object, not a Map, same
   * JSON-round-trip reasoning as `routeSettings`. Absent key means clear
   * skies; see sim/weather.ts's `rollDailyWeather()` for how entries
   * appear, spread to nearby airports, and expire.
   */
  weatherByAirport: Record<string, WeatherEvent>;
  completedToday: string[];
  /**
   * How each leg that landed today went, by legId, recorded on arrival
   * (sim/step.ts): the flight's own record vanishes when it lands, and the
   * aircraft view (ui/inspector/aircraft.ts) shows a plane's whole day.
   * Cleared at rollover. Optional so older saves load: absent means none.
   */
  todayLegResults?: Record<string, LegResult>;
  /**
   * Legs cancelled during the day by the 22:00 curfew (sim/curfew.ts), so
   * the departure loop stops trying to fly them. Reset at rollover. The
   * day-start causes (crew, mechanical, weather) don't need this: they
   * ground a whole tail or airport, which the departure loop checks directly.
   */
  cancelledToday: string[];
  todayRevenue: number;
  todayCost: number;
  todayMargin: number;
  /**
   * Week five's Reputation mechanic (sim/reputation.ts): today's own
   * departed/on-time/NPS-point counts, reset to zero at day-rollover same
   * as `todayRevenue` and friends above — *not* the lifetime totals below,
   * which barely move day to day once a game has run a while. Read (and
   * only then reset) by `applyDailyReputationChange()` at the *start* of
   * the next day's rollover, so Reputation reacts to how yesterday
   * actually went rather than a slow-moving lifetime average.
   */
  todayFlightsDeparted: number;
  /**
   * On-Time is judged at arrival (sim/delays.ts's isOnTimeArrival), so
   * its denominator is arrivals, not departures: a flight that departs
   * late in the evening and lands after midnight counts toward the day it
   * lands. `todayFlightsDeparted` above stays as Reputation's sample size.
   */
  todayFlightsArrived: number;
  todayFlightsOnTime: number;
  todayNpsPoints: number;
  /**
   * Lifetime counters (never reset, unlike the todayX fields above) behind
   * the "on-time performance" HUD stat next to Cash: every flight that
   * lands increments `flightsArrivedTotal`, and `flightsOnTimeTotal` only
   * when it landed within ON_TIME_GRACE_MINUTES of its scheduled arrival —
   * see step.ts's arrival loop for where "on time" is decided.
   */
  flightsArrivedTotal: number;
  flightsOnTimeTotal: number;
  /**
   * The same arrived/on-time counters as `flightsArrivedTotal`/
   * `flightsOnTimeTotal` above, just split out per market
   * (`marketKey(origin, dest)`) instead of one whole-airline total — the
   * On-Time panel's per-route breakdown (`ui/onTime.ts`). Lazily created
   * the first time a market's first flight ever lands, same "create on
   * first use" shape `routeSettings` uses. Deliberately *not* deleted if
   * every leg on a market is later removed (unlike `routeSettings`,
   * which only tracks currently-active levers): a market's past
   * reliability is still real history worth keeping, even for a route
   * you've since dropped. Positioning legs don't count here either, same
   * reasoning as the whole-airline totals — they're not serving a
   * market.
   */
  onTimeByMarket: Record<string, { arrived: number; onTime: number }>;
  /**
   * Today's arrivals and on-time arrivals per market, reset at rollover
   * after sim/routeOtp.ts copies them into `onTimeHistoryByMarket` — the
   * same today-then-history shape `todayRevenueByMarket` uses.
   */
  todayOnTimeByMarket: Record<string, { arrived: number; onTime: number; cancelled: number }>;
  /**
   * Each finished day's arrivals and on-time arrivals per market, oldest
   * first, capped at PNL_HISTORY_MAX_DAYS (sim/routeOtp.ts), plus that
   * day's cancellations. What the route view's reliability bars read, and
   * what reliability's effect on demand growth (sim/marketDemand.ts) is
   * judged on.
   */
  onTimeHistoryByMarket: Record<string, { arrived: number[]; onTime: number[]; cancelled: number[] }>;
  /**
   * Today's passengers and seats flown per market (sim/loadFactor.ts),
   * reset at rollover once copied into the histories below. Optional:
   * saves from before load factor was kept start empty.
   */
  todayLoadByMarket?: Record<string, { passengers: number; seats: number }>;
  /** Each finished day's passengers and seats flown per market, oldest first, capped at PNL_HISTORY_MAX_DAYS. */
  loadHistoryByMarket?: Record<string, { passengers: number[]; seats: number[] }>;
  /** The same for the whole network, so a route since closed still counts for the days it flew. */
  loadHistory?: { passengers: number[]; seats: number[] };
  /** The day each milestone on the ladder was met, by id (sim/ladder.ts). Optional: older saves have met none. */
  milestonesMet?: Record<string, number>;
  /** The shock running now, or the last one until another starts (sim/shocks.ts's activeShock() says which). Optional: older saves have none. */
  shock?: Shock | null;
  /**
   * Week five's second HUD quality signal (see sim/nps.ts and
   * WEEK-FIVE.md's "Reputation" design): the running sum of every revenue
   * flight's `flightSatisfactionScore()` at the moment it departs.
   * Divided by `npsScoredFlightsTotal` (departures plus cancellations)
   * to get the lifetime average NPS shown in the sidebar. A lifetime average rather
   * than a trailing window, same "simplest first pass" shape the On-Time
   * stat already has; a more reactive trailing-window version is a real
   * future refinement, not this one.
   */
  npsPointsTotal: number;
  /**
   * Week five's second resource besides Cash (sim/reputation.ts): an
   * unbounded running score, moved up or down once per simulated day by
   * `applyDailyReputationChange()` based on that day's On-Time percentage
   * and average NPS (see `todayFlightsDeparted`/`todayFlightsOnTime`/
   * `todayNpsPoints` above). Starts at 0 — a brand-new airline with no
   * track record yet, not already "good" or "bad." Executives spend
   * it until thread 3 of WEEK-TEN.md replaces it with NPS.
   */
  reputation: number;
  /**
   * Lifetime minutes of arrival delay attributed to each of step.ts's
   * three delay causes (age, weather, knock-on) — the On-Time panel's
   * "top delay codes" ranking. A single flight's delay is the sum of
   * all three, so a flight with more than one active cause adds to more
   * than one bucket. Revenue flights only, same scope as
   * `onTimeByMarket` above — a positioning move's delay doesn't say
   * anything about route service quality.
   */
  delayMinutesByCause: { age: number; weather: number; knockOn: number; congestion: number };
  /**
   * Week four's spill-and-recapture (sim/economy.ts's `flightResult()`):
   * how many recoverable passengers are currently waiting, per market,
   * for a later flight on that same market today to pick up — deposited
   * by an earlier, seat-capped flight's overflow, drawn down by a later
   * flight with spare room. Reset to `{}` at day-rollover (step.ts),
   * same as `todayRevenue` and friends: unclaimed spill doesn't carry
   * into tomorrow, since nobody's actually holding a seat for anyone —
   * a passenger who couldn't fly today needed to rebook, which stays out
   * of scope. Positioning legs never touch this; they don't serve a
   * market, same reasoning as `onTimeByMarket` above.
   */
  spilloverByMarket: Record<string, number>;
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
  /**
   * Week five's runway forecast (sim/forecast.ts): the last
   * CASH_HISTORY_MAX_DAYS days' worth of closing Cash balances, oldest
   * first, recorded once per simulated day at the top of step.ts's
   * day-rollover — before that day's own charges apply, so each entry is
   * genuinely "yesterday's closing balance." Capped at a rolling window
   * (older entries shifted out) rather than kept for the whole game, both
   * because a whole-game history would grow `SimState` unboundedly and
   * because a forecast should react to the *recent* trend, not a game
   * that's been profitable for months averaging out a rough current week.
   */
  cashHistory: number[];
  /**
   * The last PNL_HISTORY_MAX_DAYS days' final `todayRevenue`, `todayCost`
   * and `todayMargin`, oldest first — recorded at the same moment as
   * `cashHistory` above (sim/pnlHistory.ts's recordDailyPnlHistory(),
   * called right beside recordDailyCashHistory() in step.ts's
   * day-rollover), so each entry is a genuinely finished day, not one
   * still being added to. This is what answers "is the network actually
   * getting better," which a single day's numbers alone can't: one good
   * or bad day is noise, a week of them is a trend.
   */
  revenueHistory: number[];
  costHistory: number[];
  marginHistory: number[];
  /**
   * Same-day accumulation as `todayRevenue`/`todayCost` above, split by
   * market (`marketKey(origin, dest)`, sim/schedule.ts) instead of summed
   * across the whole airline — filled in step.ts's arrival loop, right
   * beside the network-wide totals. Deliberately narrower than those: only
   * a flight's own fuel/block/departure economics (sim/economy.ts's
   * flightResult()) are attributed to a market. Leases, slots, overhead and crew
   * are airline-wide costs a plane's day is shared across, with no
   * honest way to hand one market its "share" of a lease payment, so they
   * stay out — same reasoning the dev tools' cost tree already uses to
   * keep a single flight's numbers free of them.
   */
  todayRevenueByMarket: Record<string, number>;
  todayCostByMarket: Record<string, number>;
  /**
   * Rolling PNL_HISTORY_MAX_DAYS-day window of the two fields above, same
   * recording moment as `revenueHistory`/`costHistory` — one entry per
   * day for every market currently in the schedule, zero if it flew
   * nothing that day, so "yesterday" always means yesterday rather than
   * "the last day this route flew." This is what lets a route's own card
   * show its trend instead of only the network's. A market's margin is
   * just `revenueHistoryByMarket[key][i] - costHistoryByMarket[key][i]`;
   * nothing else feeds it, so it isn't stored a third time.
   */
  revenueHistoryByMarket: Record<string, number[]>;
  costHistoryByMarket: Record<string, number[]>;
  /**
   * The market's fuel price index (sim/fuel.ts, sim/fuelPrice.ts): 1.0
   * is baseline, and a flight's fuel-sensitive cost slice scales with it.
   * Moves daily, spikes with a fuel shock (sim/shocks.ts). Rivals pay it;
   * the player pays it unless hedged (`airlineFuelPrice()`).
   */
  fuelPriceIndex: number;
  /** The fuel price's random walk, as a log-deviation from the baseline (sim/fuelPrice.ts). Absent in an older save: read as 0. */
  fuelWalk?: number;
  /** The market fuel price at each of the last 90 rollovers, oldest first, for the chart. */
  fuelPriceHistory?: number[];
  /** The latest fuel hedge bought, running or ended (sim/fuelPrice.ts), or absent if none ever was. */
  fuelHedge?: FuelHedge;
  /**
   * A multiplier on the fuel-sensitive slice of every flight's cost, 1.0
   * meaning no mitigation — lower is better (less fuel burned for the
   * same flying). Winglet retrofits (sim/innovations.ts) turn it down.
   */
  fuelEfficiencyMultiplier: number;
  /**
   * Innovations adopted (sim/innovations.ts), in the order adopted.
   * Optional: absent in a save made before innovations existed.
   */
  adoptedInnovations?: string[];
  /**
   * Week six's market stimulation model (sim/marketDemand.ts): how many
   * people actually fly each market on an average day right now, keyed by
   * `marketKey(origin, dest)` — a plain object, not a Map, same
   * JSON-round-trip reasoning as `routeSettings`. This is the number that
   * books passengers; `potentialDailyDemand()` (sim/demand.ts) is only the
   * ceiling it grows toward. Populated for every pair by the first
   * day-rollover; before that, readers fall back to the virgin floor.
   */
  marketDemand: Record<string, number>;
  /**
   * Accumulated global growth in *potential* demand — 1 at the start of a
   * game, drifting up ~2%/year (sim/marketDemand.ts). Multiplied into
   * every market's gravity-model potential, so the ceiling markets grow
   * toward is itself slowly rising rather than fixed. Deliberately one
   * global figure rather than per market: nothing varies growth by
   * geography yet, and 45 near-identical numbers would be 45 chances to
   * drift apart for no gain.
   */
  demandGrowthMultiplier: number;
  /**
   * Week six's cost attribution: the same dollars `todayCost` already
   * totals, split by where they went. Reset to zero at day-rollover
   * alongside `todayCost` itself, and **guaranteed to sum to it** — every
   * place that adds to `todayCost` adds to exactly one category here too.
   */
  /**
   * Week six's airline-wide fare policy (sim/pricing.ts): a multiplier on
   * `recommendedFare()` applied to every market not individually
   * overridden. 1 means "charge exactly what's recommended." One number
   * prices the whole network, which is what stops fare-setting from being
   * the same slider-drag repeated once per market.
   */
  farePolicyMultiplier: number;
  /**
   * Week six's C-suite (sim/executives.ts): four slots, each holding at
   * most one appointment. Paid for in Reputation, which makes the C-suite
   * unreachable until the airline has been good at something.
   */
  executives: ExecutiveSlots;
  /**
   * Week six's crew model (sim/crew.ts): headcount pools, never named
   * individuals. Pilots are tiered because type ratings gate the fleet
   * ladder; cabin crew and mechanics are untiered.
   */
  crew: CrewPools;
  /** Recruitment ordered and paid for, not yet turned up — the lead time is the mechanic. */
  pendingHires: PendingHire[];
  /** Pilots currently away upgrading a tier. Already removed from `crew`, since losing their capacity is the real cost. */
  pendingTraining: PendingTraining[];
  /**
   * Week eight: funded training pipelines — see sim/crew.ts's
   * TrainingLine. Run once per day inside rollDailyCrew().
   */
  trainingLines: TrainingLine[];
  /**
   * How much crew the player chooses to carry above the bare operating
   * minimum, 1 meaning none at all. Cost is linear in this; protection
   * against a bad disruption day is a threshold — which is what makes it
   * a real decision rather than a slider with an obvious best setting.
   */
  reserveDepth: number;
  /**
   * Tails that couldn't be crewed today, recomputed each day-rollover by
   * `rollDailyCrew()`. step.ts refuses to depart their legs, and every
   * leg they were scheduled to fly counts as a cancellation.
   */
  groundedTails: string[];
  /**
   * Slot pairs held at each airport (sim/slots.ts), keyed by IATA: one
   * entry per pair, holding the daily fee locked in when it was taken.
   */
  slotsHeld: Record<string, number[]>;
  /**
   * How each hub is run (sim/hubStyle.ts), keyed by IATA. Only airports
   * the player has changed appear; everything else is Rolling.
   */
  hubStyles: Record<string, HubStyle>;
  /**
   * Planes out of service with an AOG (sim/aog.ts) — multi-day
   * unscheduled maintenance. Kept separate from crew groundings above so
   * cancellations are attributed to the right cause.
   */
  aogs: AogEvent[];
  /** The shared lessor's shelf (sim/market.ts): what's listed and when the next of each class arrives. */
  market: MarketState;
  /** Each rival airline's fleet, one class code per plane, keyed by airline code (sim/market.ts). */
  competitorFleets: Record<string, string[]>;
  /**
   * Routes rivals closed recently, so an airline doesn't reopen a market it
   * just gave up on (sim/pressure.ts's recentlyClosedByRival()). Pruned
   * once past the cooldown. Optional so older saves load: absent means none.
   */
  rivalClosures?: RivalClosure[];
  /**
   * Lifetime cancellations by cause — the same shape (and the same
   * purpose) as `delayMinutesByCause`. Each cause has a different answer
   * available to the player: crew shortages are answered by reserve
   * depth, mechanical events by maintenance staffing and younger
   * airframes, curfew by slack in the day, and weather by nothing at all.
   * `position` is a leg whose plane was parked at another airport when it
   * was due (stranded by an earlier disruption); optional so older saves
   * load, absent meaning none.
   */
  cancellationsByCause: { crew: number; mechanical: number; weather: number; curfew: number; position?: number };
  /**
   * Week six's cancellations: legs that should have operated today and
   * didn't. `flightsScheduled*` counts what was on the books, so
   * Completion Factor is `completed / scheduled` — the separate reliability
   * axis from On-Time, which only ever describes flights that did operate.
   */
  flightsScheduledTotal: number;
  flightsCancelledTotal: number;
  todayFlightsScheduled: number;
  todayFlightsCancelled: number;
  /**
   * How many flights NPS has been scored over — departures *plus*
   * cancellations, since a cancelled flight has a very unhappy passenger
   * attached to it and would otherwise vanish from the average entirely.
   * Deliberately a separate denominator from `flightsArrivedTotal`,
   * which On-Time uses.
   */
  npsScoredFlightsTotal: number;
  todayNpsScoredFlights: number;
  /**
   * Week six's targets (sim/targets.ts): the service standard the player
   * has publicly committed to, or null when none is running. Carries its
   * own window-scoped departure/on-time/NPS counters, which step.ts
   * increments alongside the today- and lifetime-scoped ones.
   */
  activeTarget: TargetCommitment | null;
  /**
   * How the last commitment turned out, kept after it resolves so the UI
   * can report it rather than having a promise silently disappear. Null
   * until one has ever run to completion.
   */
  lastTargetResult: TargetResult | null;
  todayCostByCategory: {
    /** Fuel, after the price index and winglet retrofits. */
    fuel: number;
    /** The non-fuel half of block-hour cost — crew, maintenance, overhead. */
    blockNonFuel: number;
    /** Flat per-departure charges. */
    departure: number;
    /** Daily lease cost, summed across every leased airframe. */
    lease: number;
    /** Daily crew salaries, everyone on the books whether or not they flew. */
    crew: number;
    /** Daily funding of every training line, spent whether or not the line is efficient yet. */
    training: number;
    /** Daily fees on every slot pair held (sim/slots.ts). */
    slots: number;
    /** Paying to expedite AOG repairs (sim/aog.ts). */
    maintenance: number;
    /** Network overhead (sim/overhead.ts), which grows with the square of the fleet. */
    overhead: number;
    /** Running costs of adopted innovations (sim/innovations.ts). Absent in an older save until its first rollover. */
    innovations?: number;
  };
};

// Only one aircraft type exists so far, so every aircraft record uses it.
const aircraftType = (aircraftTypesData as { code: string }[])[0];

/**
 * Starting capital for a genuinely new interactive game — enough to carry
 * the starting plane's lease and a few more while routes ramp up. A
 * pure game-balance number, not derived from anything.
 */
export const STARTING_CASH = 500_000;

/**
 * One leased propeller already parked and based at the player's
 * home city, so the first thing a new player does is draw a route on the
 * map. The home city is chosen at the start of a game (sim/homes.ts);
 * Montréal is the default for anything that doesn't choose.
 */
export const DEFAULT_HOME_AIRPORT = 'YUL';
const STARTING_PLANES = 1;

/** The one plane a new game starts with (a propeller), leased and parked at `homeIata`. */
export function createStartingFleet(homeIata: string): Aircraft[] {
  const aircraft: Aircraft[] = [];
  for (let i = 0; i < STARTING_PLANES; i++) {
    leaseAircraft({ simMinute: 0, aircraft }, aircraftType.code, homeIata);
  }
  return aircraft;
}

/**
 * The state an actual new game starts from — one starting propeller
 * plane (createStartingFleet() above), zero schedule, zero routes.
 * Nothing flies and nothing earns until the player draws a route
 * (ui/routeBuilder.ts); more aircraft are leased from the map menu
 * (ui/mapMenu.ts). The browser and the headless runner both start here.
 */
export function createNewGameState(rngSeed: number = Date.now(), homeIata: string = DEFAULT_HOME_AIRPORT): SimState {
  const state: SimState = {
    // Home midnight, not UTC midnight: the airline's day runs on home time
    // (sim/clock.ts). chooseHome() resets it when the player picks a city.
    simMinute: startingSimMinute(homeIata),
    homeAirport: homeIata,
    knownAirports: [],
    cash: STARTING_CASH,
    aircraft: createStartingFleet(homeIata),
    activeFlights: [],
    schedule: [],
    routeSettings: {},
    competitorRoutes: loadCompetitorRoutes(),
    weatherByAirport: {},
    completedToday: [],
    todayLegResults: {},
    cancelledToday: [],
    todayRevenue: 0,
    todayCost: 0,
    todayMargin: 0,
    todayFlightsDeparted: 0,
    todayFlightsArrived: 0,
    todayFlightsOnTime: 0,
    todayNpsPoints: 0,
    flightsArrivedTotal: 0,
    flightsOnTimeTotal: 0,
    onTimeByMarket: {},
    todayOnTimeByMarket: {},
    onTimeHistoryByMarket: {},
    npsPointsTotal: 0,
    reputation: 0,
    delayMinutesByCause: { age: 0, weather: 0, knockOn: 0, congestion: 0 },
    spilloverByMarket: {},
    rngSeed,
    cashHistory: [],
    revenueHistory: [],
    costHistory: [],
    marginHistory: [],
    todayRevenueByMarket: {},
    todayCostByMarket: {},
    revenueHistoryByMarket: {},
    costHistoryByMarket: {},
    fuelPriceIndex: FUEL_PRICE_BASELINE,
    fuelEfficiencyMultiplier: 1,
    adoptedInnovations: [],
    marketDemand: {},
    demandGrowthMultiplier: 1,
    farePolicyMultiplier: 1,
    executives: createExecutiveSlots(),
    crew: createCrewPools(),
    pendingHires: [],
    trainingLines: [],
    pendingTraining: [],
    reserveDepth: 1.15,
    groundedTails: [],
    slotsHeld: {},
    hubStyles: {},
    aogs: [],
    market: { listings: [], nextArrivalDay: {}, nextListingId: 1 },
    competitorFleets: {},
    rivalClosures: [],
    cancellationsByCause: { crew: 0, mechanical: 0, weather: 0, curfew: 0 },
    flightsScheduledTotal: 0,
    flightsCancelledTotal: 0,
    todayFlightsScheduled: 0,
    todayFlightsCancelled: 0,
    npsScoredFlightsTotal: 0,
    todayNpsScoredFlights: 0,
    activeTarget: null,
    lastTargetResult: null,
    todayCostByCategory: { fuel: 0, blockNonFuel: 0, departure: 0, lease: 0, crew: 0, training: 0, slots: 0, maintenance: 0, overhead: 0, innovations: 0 },
  };
  revealReach(state);
  openMarket(state);
  return state;
}

/** Stock the lessor's opening shelf and give the incumbent rivals the fleets they already fly (sim/market.ts). */
function openMarket(state: SimState): void {
  [state.market, state.rngSeed] = createMarket(state.rngSeed);
  ensureRivalFleets(state);
}
