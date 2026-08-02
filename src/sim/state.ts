import aircraftTypesData from '../../data/aircraft-types.json';
import { loadSchedule, marketKey, recommendedFare, type PositioningLeg, type ScheduleLeg } from './schedule';
import { loadFleetMarket, type FleetListing } from './fleetMarket';
import { loadCompetitorRoutes, type CompetitorOffering } from './competitors';
import type { WeatherEvent } from './weather';
import type { Loan } from './loans';
import { FUEL_PRICE_BASELINE } from './fuel';
import type { TargetCommitment, TargetResult } from './targets';
import { createCrewPools, crewRequirement, type CrewPools, type PendingHire, type PendingTraining } from './crew';
import { createExecutiveSlots, type ExecutiveSlots } from './executives';
import { isSlotControlled } from './airports';

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
   * Whether this market's fare was set by hand, rather than following the
   * airline-wide policy (`SimState.farePolicyMultiplier`, sim/pricing.ts).
   * `applyFarePolicy()` re-prices every market where this is false and
   * leaves the rest alone — so changing policy sweeps the network without
   * clobbering the handful of routes deliberately priced differently.
   */
  fareIsOverridden: boolean;
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
   * Week four's competitor AI (sim/competitors.ts): every competitor
   * route currently in service, seeded from `data/competitors.json` and
   * grown over time by `rollCompetitorRouteOpenings()` (called once per
   * simulated day from step.ts's day-rollover, alongside the weather
   * roll). Unlike `fleetMarket` above, this array only ever grows —
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
  todayFlightsOnTime: number;
  todayNpsPoints: number;
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
   * The same departed/on-time counters as `flightsDepartedTotal`/
   * `flightsOnTimeTotal` above, just split out per market
   * (`marketKey(origin, dest)`) instead of one whole-airline total — the
   * On-Time panel's per-route breakdown (`ui/onTime.ts`). Lazily created
   * the first time a market's first leg ever departs, same "create on
   * first use" shape `routeSettings` uses. Deliberately *not* deleted if
   * every leg on a market is later removed (unlike `routeSettings`,
   * which only tracks currently-active levers): a market's past
   * reliability is still real history worth keeping, even for a route
   * you've since dropped. Positioning legs don't count here either, same
   * reasoning as the whole-airline totals — they're not serving a
   * market.
   */
  onTimeByMarket: Record<string, { departed: number; onTime: number }>;
  /**
   * Week five's second HUD quality signal (see sim/nps.ts and
   * WEEK-FIVE.md's "Reputation" design): the running sum of every revenue
   * flight's `flightSatisfactionScore()` at the moment it departs.
   * Divided by `flightsDepartedTotal` above — deliberately the *same*
   * denominator On-Time performance uses, since it's the same population
   * (revenue departures only; positioning moves don't count here either,
   * same reasoning `onTimeByMarket` already documents) — to get the
   * lifetime average NPS shown in the sidebar. A lifetime average rather
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
   * track record yet, not already "good" or "bad." Nothing spends this
   * yet; it exists so a future tech tree has something real to draw down.
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
  delayMinutesByCause: { age: number; weather: number; knockOn: number };
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
   * Week five's failure state (see WEEK-FIVE.md): outstanding loans, taken
   * via ui/loans.ts's pop-up whenever Cash drops to zero or below. Each
   * loan's balance compounds daily (sim/loans.ts's
   * applyDailyLoanInterest(), called from step.ts's day-rollover) until
   * it's repaid in full and removed. Capped at MAX_LOANS (20) outstanding
   * at once — needing a 21st while already at that cap is what
   * sim/loans.ts's isInsolvent() calls game over.
   */
  loans: Loan[];
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
   * Week six's fuel price mechanic (sim/fuel.ts): a unitless index where
   * 1.0 is baseline — a flight's fuel-sensitive cost slice (see
   * legCost()) scales directly with this. Moved by a slow random walk,
   * rolled once per simulated day (rollDailyFuelPrice(), called from
   * step.ts's day-rollover), not read or written anywhere else.
   */
  fuelPriceIndex: number;
  /**
   * Recent daily closing fuelPriceIndex values, oldest first — same
   * rolling-window shape as cashHistory above, just a longer window (see
   * FUEL_PRICE_HISTORY_MAX_DAYS). This is the "anyone looking to guess
   * direction" history the Executive panel's fuel chart reads directly,
   * with no smoothing or forecasting applied on top — the point is to
   * show the real, noisy signal and let the player do the guessing.
   */
  fuelPriceHistory: number[];
  /**
   * A multiplier on the fuel-sensitive slice of every flight's cost, 1.0
   * meaning "no mitigation adopted yet" — lower is better (less fuel
   * burned for the same flying). Nothing sets this below 1.0 yet; it
   * exists so a future tech tree's fuel-efficiency initiatives have
   * something real to turn down, same "exists so a future tech tree has
   * something real to draw down" reasoning `reputation` above already
   * has.
   */
  fuelEfficiencyMultiplier: number;
  /**
   * Week six's tech tree (sim/techTree.ts): IDs of every TechNode unlocked
   * so far, in whatever order the player bought them — a plain string
   * array, not a Set, same JSON-round-trip reasoning every other
   * collection on this type already follows. `fuelEfficiencyMultiplier`
   * above is the actual effect; this is just the record of what's been
   * paid for, so the UI can show locked/unlocked state and so a node is
   * never charged for twice.
   */
  unlockedTechNodeIds: string[];
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
   *
   * Loan interest is deliberately absent: it compounds onto each loan's
   * own balance rather than being charged out of Cash (see sim/loans.ts),
   * so it was never part of `todayCost` and including it here would break
   * that sum.
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
   * its second real spender alongside the tech tree — and makes it
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
   * Slots purchased at each slot-controlled airport, keyed by IATA — a
   * plain object, same JSON-round-trip reasoning as `routeSettings`. Only
   * LGA and YYZ are controlled on this map (see data/airports.json's
   * `slotsTotal`), matching the two fields that really are coordinated in
   * life; everywhere else grows without asking.
   */
  slotsOwned: Record<string, number>;
  /**
   * Tails grounded today by an unscheduled maintenance event, kept
   * separate from crew groundings above so cancellations can be
   * attributed to the right cause. Rolled after the crew pass, and never
   * for a tail already grounded for crew.
   */
  mechanicalGroundedTails: string[];
  /**
   * Lifetime cancellations by cause — the same shape (and the same
   * purpose) as `delayMinutesByCause`. Three causes, each with a
   * different answer available to the player: crew shortages are
   * answered by reserve depth, mechanical events by maintenance
   * staffing and younger airframes, and weather by nothing at all.
   */
  cancellationsByCause: { crew: number; mechanical: number; weather: number };
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
   * Deliberately a separate denominator from `flightsDepartedTotal`,
   * which On-Time still uses.
   */
  npsScoredFlightsTotal: number;
  todayNpsScoredFlights: number;
  /**
   * Week six's missions (sim/missions.ts): ids of every mission whose
   * condition has been met and whose Reputation has been paid out. A
   * plain string array, same JSON-round-trip reasoning as
   * `unlockedTechNodeIds`, and the thing ui/ticker.ts diffs to announce a
   * completion the moment it happens.
   */
  completedMissionIds: string[];
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
    /** Fuel, after the price index and any tech tree efficiency upgrades. */
    fuel: number;
    /** The non-fuel half of block-hour cost — crew, maintenance, overhead. */
    blockNonFuel: number;
    /** Flat per-departure charges. */
    departure: number;
    /** Daily marketing spend, summed across every market. */
    marketing: number;
    /** Daily lease cost, summed across every leased airframe. */
    lease: number;
    /** Daily crew salaries, everyone on the books whether or not they flew. */
    crew: number;
  };
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
      routeSettings[key] = {
        fare: recommendedFare(leg.origin, leg.dest),
        fareIsOverridden: false,
        marketingSpend: 0,
      };
    }
  }

  const state: SimState = {
    simMinute: 0,
    cash: 0,
    aircraft,
    activeFlights: [],
    schedule,
    routeSettings,
    positioningLegs: [],
    fleetMarket: [], // no Fleet Market needed for a headless balance run
    // Same competitive landscape the real game starts with, growing the
    // same way over time (step()'s day-rollover doesn't know or care
    // that this is the headless runner) — the balance-tuning tool should
    // face the same competitive pressure a real playthrough does.
    competitorRoutes: loadCompetitorRoutes(),
    weatherByAirport: {},
    completedToday: [],
    todayRevenue: 0,
    todayCost: 0,
    todayMargin: 0,
    todayFlightsDeparted: 0,
    todayFlightsOnTime: 0,
    todayNpsPoints: 0,
    flightsDepartedTotal: 0,
    flightsOnTimeTotal: 0,
    onTimeByMarket: {},
    npsPointsTotal: 0,
    reputation: 0,
    delayMinutesByCause: { age: 0, weather: 0, knockOn: 0 },
    spilloverByMarket: {},
    rngSeed,
    loans: [],
    cashHistory: [],
    fuelPriceIndex: FUEL_PRICE_BASELINE,
    fuelPriceHistory: [],
    fuelEfficiencyMultiplier: 1,
    unlockedTechNodeIds: [],
    marketDemand: {},
    demandGrowthMultiplier: 1,
    farePolicyMultiplier: 1,
    executives: createExecutiveSlots(),
    crew: createCrewPools(),
    pendingHires: [],
    pendingTraining: [],
    reserveDepth: 1.15,
    groundedTails: [],
    slotsOwned: {},
    mechanicalGroundedTails: [],
    cancellationsByCause: { crew: 0, mechanical: 0, weather: 0 },
    flightsScheduledTotal: 0,
    flightsCancelledTotal: 0,
    todayFlightsScheduled: 0,
    todayFlightsCancelled: 0,
    npsScoredFlightsTotal: 0,
    todayNpsScoredFlights: 0,
    completedMissionIds: [],
    activeTarget: null,
    lastTargetResult: null,
    todayCostByCategory: { fuel: 0, blockNonFuel: 0, departure: 0, marketing: 0, lease: 0, crew: 0 },
  };

  // Staff this fixture to its own reserve target. Unlike a real new game
  // — which starts with no crew on purpose, since hiring into a fleet is
  // part of the mechanic (sim/crew.ts) — this one exists to be a fully
  // formed, working airline for the balance tools. Left unstaffed, every
  // aircraft would be grounded and the headless runner would simulate an
  // airline that never flies.
  const requirement = crewRequirement(state);
  state.crew.pilotsByTier = [...requirement.targetPilotsByTier] as [number, number, number];
  state.crew.cabinCrew = requirement.targetCabinCrew;
  state.crew.mechanics = requirement.targetMechanics;

  // Same reasoning as the crew above: this fixture's schedule already
  // flies from slot-controlled airports, so it needs to hold the slots
  // for them or the balance tools would model an airline permanently over
  // capacity. A real new game owns none, because buying them is the
  // mechanic (sim/airports.ts).
  for (const leg of state.schedule) {
    if (!isSlotControlled(leg.origin)) continue;
    state.slotsOwned[leg.origin] = (state.slotsOwned[leg.origin] ?? 0) + 1;
  }

  return state;
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
    competitorRoutes: loadCompetitorRoutes(),
    weatherByAirport: {},
    completedToday: [],
    todayRevenue: 0,
    todayCost: 0,
    todayMargin: 0,
    todayFlightsDeparted: 0,
    todayFlightsOnTime: 0,
    todayNpsPoints: 0,
    flightsDepartedTotal: 0,
    flightsOnTimeTotal: 0,
    onTimeByMarket: {},
    npsPointsTotal: 0,
    reputation: 0,
    delayMinutesByCause: { age: 0, weather: 0, knockOn: 0 },
    spilloverByMarket: {},
    rngSeed,
    loans: [],
    cashHistory: [],
    fuelPriceIndex: FUEL_PRICE_BASELINE,
    fuelPriceHistory: [],
    fuelEfficiencyMultiplier: 1,
    unlockedTechNodeIds: [],
    marketDemand: {},
    demandGrowthMultiplier: 1,
    farePolicyMultiplier: 1,
    executives: createExecutiveSlots(),
    crew: createCrewPools(),
    pendingHires: [],
    pendingTraining: [],
    reserveDepth: 1.15,
    groundedTails: [],
    slotsOwned: {},
    mechanicalGroundedTails: [],
    cancellationsByCause: { crew: 0, mechanical: 0, weather: 0 },
    flightsScheduledTotal: 0,
    flightsCancelledTotal: 0,
    todayFlightsScheduled: 0,
    todayFlightsCancelled: 0,
    npsScoredFlightsTotal: 0,
    todayNpsScoredFlights: 0,
    completedMissionIds: [],
    activeTarget: null,
    lastTargetResult: null,
    todayCostByCategory: { fuel: 0, blockNonFuel: 0, departure: 0, marketing: 0, lease: 0, crew: 0 },
  };
}
