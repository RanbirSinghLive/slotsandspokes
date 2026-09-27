import aircraftTypesData from '../../data/aircraft-types.json';
import { flightResult, type EconomyAircraftType } from './economy';
import { MIN_TURN_MINUTES, legsServingMarket, marketKey, type ScheduleLeg } from './schedule';
import { breaksCurfew, rotationStartingWith } from './curfew';
import { rollDailyWeather, isAirportClosed } from './weather';
import { rollDailyShocks } from './shocks';
import { airportLoad } from './airports';
import { connectingDemandOnMarket } from './hubs';
import { rollTotalDelayMinutes, isOnTimeArrival } from './delays';
import { rollCompetitorRouteOpenings, rollCompetitorFrequencyGrowth, rollRivalEntry, rollDailyRivalFares } from './competitors';
import { networkOverheadPerDay } from './overhead';
import { rollDailyMarketDemand, actualDailyDemand } from './marketDemand';
import { revealReach } from './reach';
import { checkMissions } from './missions';
import { rollDailyCrew, maintenanceAgeFactor, cabinServiceShare } from './crew';
import { isAog, rollDailyAogs } from './aog';
import {
  payExecutiveBonuses,
  executiveDelayMultiplier,
  executiveNpsBonus,
  executiveMaintenanceMultiplier,
} from './executives';
import { CANCELLATION_NPS_SCORE } from './nps';
import { resolveTargetIfDue } from './targets';
import { flightSatisfactionScore } from './nps';
import { applyDailyReputationChange, REPUTATION_FLOOR } from './reputation';
import { recordDailyCashHistory } from './forecast';
import { recordDailyPnlHistory } from './pnlHistory';
import { recordDailyOnTimeHistory } from './routeOtp';
import { recordDailyLoadHistory, recordFlightLoad } from './loadFactor';
import { acquireNeededSlots, settleSlotsForDay } from './slots';
import { ensureRivalFleets, rollDailyMarket } from './market';
import { dayIndex, minuteOfDay as homeMinuteOfDay } from './clock';
import { rollRivalCapacityResponse } from './rivalResponse';
import { applyFarePolicy } from './pricing';
import { closeLosingRivalRoutes } from './rivalEconomics';
import type { SimState, ActiveFlight } from './state';

const aircraftTypesByCode = new Map<string, EconomyAircraftType>(
  (aircraftTypesData as Array<EconomyAircraftType & { code: string }>).map((type) => [type.code, type]),
);

/**
 * Advance the world by exactly one simulated minute. Mutates `state` in
 * place and returns nothing, per CLAUDE.md's rule for this function — no
 * randomness, no clock reads, nothing but `state` in and `state` mutated.
 *
 * Four things happen each minute, in this order:
 *   1. Day rollover: if this is minute 0 of a new day, today's tallies
 *      (completedToday, todayRevenue, todayCost, todayMargin) reset to zero
 *      before anything else happens.
 *   2. Depart: any scheduled leg whose departure time has arrived (M9: *at
 *      or after* `departMinute`, not only the exact minute — see below),
 *      not already flown or in the air today, flown by an aircraft that's
 *      on the ground at the correct airport and past its minimum turn time
 *      (MIN_TURN_MINUTES since it last landed), takes off — it becomes an
 *      ActiveFlight with a randomly rolled arrival delay (sim/rng.ts) and
 *      its aircraft flips to airborne.
 *   3. Arrive: any ActiveFlight whose arrival minute has been reached
 *      lands — its aircraft flips back to ground at the destination and
 *      records when (`groundSinceMinute`, for the next leg's turn-time
 *      check). The flight's full economics (sim/economy.ts) are applied
 *      and the flight is removed
 *      from the active list either way.
 *
 * The reset happens at the *start* of the new day rather than the end of
 * the old one deliberately: it means that right up until the moment the
 * next day's first minute is processed, `state.todayRevenue` etc. still
 * hold the just-finished day's real totals — which is what lets something
 * outside step() (the M7 headless runner, for instance) read "yesterday's
 * numbers" cleanly between calls, instead of catching them already zeroed.
 *
 * `state.schedule` is "the daily repeating schedule" (CLAUDE.md), so
 * matching against the home-local minute of the day (sim/clock.ts) makes
 * every leg fire again at the same local time on day 1, day 2, and so on.
 * It's read from `state` rather than a shared module-level constant so
 * that the M8 schedule editor's edits — mutating a leg's `departMinute`
 * directly — take effect on the very next tick that reaches this loop.
 *
 * Why "at or after" instead of "exactly at" departMinute (M9): once delays
 * exist, an aircraft can still be airborne or mid-turnaround at the exact
 * minute its next leg was supposed to leave. An exact-match check would
 * just silently skip that leg for the rest of the day the moment it missed
 * its slot. Checking "has the scheduled time passed, and are we still
 * waiting to fly this specific leg today" instead means a late aircraft
 * departs as soon as it's actually ready — which is the whole mechanism
 * that lets one delay push a later one back, rather than the schedule
 * quietly giving up on it.
 */
/**
 * Count one scheduled flight as cancelled: toward Completion, under its
 * cause, and for NPS. A cancelled flight still has an unhappy passenger
 * attached, so it scores for NPS — over its own denominator, since it
 * never departed and mustn't distort On-Time. It also counts against its
 * route's reliability (sim/routeOtp.ts), which is what lets cancellations
 * slow that route's demand growth.
 */
function recordCancellation(state: SimState, leg: ScheduleLeg, cause: keyof SimState['cancellationsByCause']): void {
  state.cancellationsByCause[cause] = (state.cancellationsByCause[cause] ?? 0) + 1;
  state.todayFlightsCancelled += 1;
  state.flightsCancelledTotal += 1;
  state.npsPointsTotal += CANCELLATION_NPS_SCORE;
  state.todayNpsPoints += CANCELLATION_NPS_SCORE;
  state.npsScoredFlightsTotal += 1;
  state.todayNpsScoredFlights += 1;
  const market = (state.todayOnTimeByMarket[marketKey(leg.origin, leg.dest)] ??= { arrived: 0, onTime: 0, cancelled: 0 });
  market.cancelled += 1;
}

/** Whether an earlier leg of this plane's day hasn't flown or been cancelled yet. `doneToday` holds the ids that have. */
function hasEarlierLegPending(state: SimState, leg: ScheduleLeg, doneToday: Set<string>): boolean {
  return state.schedule.some(
    (other) => other.tail === leg.tail && other.departMinute < leg.departMinute && !doneToday.has(other.legId),
  );
}

/**
 * The leg ids in today's completed and cancelled lists, as a set kept from
 * one minute to the next rather than rebuilt 1,440 times a day. Both lists
 * are only ever appended to or replaced with a new array (the rollover,
 * sim/turnBuffer.ts), never edited in place, so the set stays exact by
 * reading only what was appended since last time, and starts again when
 * either list is a different array or has shrunk. Module-level, not in
 * `SimState`: it's derived, and a fresh run or a loaded save rebuilds it.
 */
let doneCache: { completed: string[]; cancelled: string[]; completedRead: number; cancelledRead: number; ids: Set<string> } | null = null;

function doneTodaySet(state: SimState): Set<string> {
  const completed = state.completedToday;
  const cancelled = state.cancelledToday;
  if (
    !doneCache ||
    doneCache.completed !== completed ||
    doneCache.cancelled !== cancelled ||
    doneCache.completedRead > completed.length ||
    doneCache.cancelledRead > cancelled.length
  ) {
    doneCache = { completed, cancelled, completedRead: 0, cancelledRead: 0, ids: new Set() };
  }
  for (; doneCache.completedRead < completed.length; doneCache.completedRead++) doneCache.ids.add(completed[doneCache.completedRead]);
  for (; doneCache.cancelledRead < cancelled.length; doneCache.cancelledRead++) doneCache.ids.add(cancelled[doneCache.cancelledRead]);
  return doneCache.ids;
}

export function step(state: SimState): void {
  // Home-local, not UTC: the airline's day starts at its home city's
  // midnight (sim/clock.ts).
  const minuteOfDay = homeMinuteOfDay(state);
  const dayStart = state.simMinute - minuteOfDay;

  if (minuteOfDay === 0) {
    // Week five's Reputation mechanic: read *yesterday's* On-Time/NPS
    // performance before todayFlightsDeparted and friends get reset just
    // below — same "read the just-finished day's real totals before
    // they're cleared" ordering this block already relies on for
    // todayRevenue/todayCost/todayMargin elsewhere in main.ts/step.ts.
    applyDailyReputationChange(state);
    // Week six's targets (sim/targets.ts): a commitment whose window has
    // elapsed is judged here, immediately after the reputation change
    // above — both move the same currency, and settling the promise on
    // the same rollover keeps the two from being read in a half-applied
    // state by anything downstream.
    resolveTargetIfDue(state);
    // Both of the above can push Reputation down — the daily quality
    // delta and a missed service target — and they're the only two
    // things that ever do unprompted (spending it is UI-gated to what
    // you can afford). Clamping once here covers both without threading
    // a helper through every module that touches the number.
    state.reputation = Math.max(REPUTATION_FLOOR, state.reputation);
    // Week five's runway forecast (sim/forecast.ts): same "read it before
    // today's own charges touch Cash" timing as the reputation call just
    // above — this is what makes each entry "yesterday's closing balance."
    recordDailyCashHistory(state);
    // Same timing, same reason: state.todayRevenue/todayCost/todayMargin
    // still hold the day that just ended, one line above where they reset.
    recordDailyPnlHistory(state);
    recordDailyOnTimeHistory(state);
    recordDailyLoadHistory(state);
    state.todayLoadByMarket = {};

    state.completedToday = [];
    state.cancelledToday = [];
    state.todayLegResults = {};
    state.todayRevenue = 0;
    state.todayCost = 0;
    state.todayMargin = 0;
    // Week six's cost attribution — reset in lockstep with todayCost
    // above, since these five are exactly that number split up.
    state.todayCostByCategory = { fuel: 0, blockNonFuel: 0, departure: 0, lease: 0, crew: 0, training: 0, slots: 0, maintenance: 0, overhead: 0 };
    // Per-market breakdown of todayRevenue/todayCost, reset in lockstep
    // with them for the same reason as todayCostByCategory above.
    state.todayRevenueByMarket = {};
    state.todayCostByMarket = {};
    state.todayOnTimeByMarket = {};
    state.todayFlightsScheduled = 0;
    state.todayFlightsCancelled = 0;
    state.todayNpsScoredFlights = 0;
    state.todayFlightsDeparted = 0;
    state.todayFlightsArrived = 0;
    state.todayFlightsOnTime = 0;
    state.todayNpsPoints = 0;
    // Spill-and-recapture's shared pool (sim/economy.ts's flightResult())
    // is scoped to one day: unclaimed spill doesn't carry into tomorrow,
    // since nobody's actually holding a seat for anyone.
    state.spilloverByMarket = {};

    // Lease cost: a flat per-day charge, not tied to whether the aircraft
    // actually flew that day. Every aircraft is leased (sim/leasing.ts).
    const totalLeaseCost = state.aircraft.reduce((total, aircraft) => total + aircraft.leaseCostPerDay, 0);
    state.cash -= totalLeaseCost;
    state.todayCost += totalLeaseCost;
    state.todayCostByCategory.lease += totalLeaseCost;
    state.todayMargin -= totalLeaseCost;

    // Network overhead (sim/overhead.ts): grows with the square of the fleet.
    const overhead = networkOverheadPerDay(state);
    state.cash -= overhead;
    state.todayCost += overhead;
    state.todayCostByCategory.overhead += overhead;
    state.todayMargin -= overhead;

    // Slot fees (sim/slots.ts): the same flat-per-day shape as the lease.
    // Anything the schedule needs and doesn't hold is taken first (a
    // backstop — the route builder already takes them), then slots nothing
    // uses any more are given back before today's fees are charged.
    acquireNeededSlots(state);
    const slotFees = settleSlotsForDay(state);
    state.cash -= slotFees;
    state.todayCost += slotFees;
    state.todayCostByCategory.slots += slotFees;
    state.todayMargin -= slotFees;

    // Week six's crew model (sim/crew.ts): deliver recruitment and
    // training that has come due, pay every head on the books, then roll
    // today's disruption and work out which aircraft can actually be
    // crewed. Must run after the todayCost reset above, since it charges
    // salary into it.
    rollDailyCrew(state);
    // AOGs (sim/aog.ts): repairs finishing, new breakdowns, and moving a
    // grounded plane's flying onto the rest of its pool. After the crew
    // pass so a tail already grounded for crew isn't grounded twice and
    // counted under two causes; before the cancellation count below, so
    // whatever couldn't be covered is counted as cancelled today.
    rollDailyAogs(state, state.simMinute);

    // Week six's C-suite: any executive bonus that has come due.
    payExecutiveBonuses(state);

    // Cancellations. Everything on the schedule that has an aircraft is a
    // scheduled departure; the ones whose aircraft couldn't be crewed
    // today never operate. Counted once here rather than discovered leg
    // by leg later, so Completion Factor is known for the whole day up
    // front and the departure loop below just declines to fly them.
    for (const leg of state.schedule) {
      if (!state.aircraft.some((a) => a.tail === leg.tail)) continue; // no aircraft assigned — not really scheduled
      state.todayFlightsScheduled += 1;
      state.flightsScheduledTotal += 1;

      // Three causes, checked in the order they'd actually stop a flight:
      // no crew to fly it, no serviceable aircraft, or nowhere to fly it
      // from. Each leg counts once, under the first that applies.
      const cause = state.groundedTails.includes(leg.tail)
        ? 'crew'
        : isAog(state, leg.tail)
          ? 'mechanical'
          : isAirportClosed(state, leg.origin)
            ? 'weather'
            : null;
      if (cause === null) continue;
      recordCancellation(state, leg, cause);
    }

    // Weather (sim/weather.ts) is a daily-scale event, not a per-minute
    // one — origination, spread, and expiry all happen once here rather
    // than being checked on every tick.
    // Shocks first (sim/shocks.ts): the weather, fuel and demand rolls below read them.
    rollDailyShocks(state);
    rollDailyWeather(state, state.simMinute);

    // Week four's competitor AI (sim/competitors.ts): once a day, each
    // competitor airline has a small independent chance to open one new
    // route. Same daily cadence as weather, for the same reason — this
    // is a day-scale event, not something worth re-checking every minute.
    ensureRivalFleets(state);
    // Rivals first withdraw from routes that keep losing money
    // (sim/rivalEconomics.ts), then grow.
    closeLosingRivalRoutes(state);
    rollCompetitorRouteOpenings(state, state.simMinute);
    rollCompetitorFrequencyGrowth(state);
    rollRivalEntry(state, state.simMinute);
    // The player's fare stances reprice against yesterday's rival fares
    // (sim/pricing.ts), then rivals reprice against the player's fares
    // (sim/competitors.ts) and move in on markets the player flies full at
    // a premium (sim/rivalResponse.ts).
    applyFarePolicy(state);
    rollDailyRivalFares(state);
    rollRivalCapacityResponse(state, state.simMinute);
    // The lessor's delivery (sim/market.ts) comes *after* the rivals have
    // grown for the day. Rivals only ever act at rollover, so an airframe
    // delivered before them would always be theirs before the player could
    // see it; delivered after, it sits on the shelf all day and the player
    // gets the first chance. First come, first served, fairly.
    rollDailyMarket(state, dayIndex(state));

    // Week six's market stimulation (sim/marketDemand.ts): markets grow
    // toward their potential where they're actually flown and decay back
    // toward the floor where they aren't. Same daily cadence as the rolls
    // above, but unlike them entirely deterministic — no random draws.
    rollDailyMarketDemand(state);
    // Backstop for fog by reach (sim/reach.ts): the menu actions that widen
    // reach reveal immediately; this catches anything that slipped past.
    revealReach(state);
  }

  // Leg ids already flown or cancelled today, and those in the air now, as
  // sets: every due leg is checked against them every minute, and a list
  // search there grows with the square of the schedule. Kept in step with
  // the lists by the three places below that add to them.
  const doneToday = doneTodaySet(state);
  const airborne = new Set(state.activeFlights.map((flight) => flight.legId));

  for (const leg of state.schedule) {
    if (minuteOfDay < leg.departMinute) continue; // not due yet today

    if (doneToday.has(leg.legId) || airborne.has(leg.legId)) continue; // already handled today

    const aircraft = state.aircraft.find((a) => a.tail === leg.tail);
    if (!aircraft) continue; // this tail isn't part of the active fleet yet
    // Cancelled at rollover for one of the three causes above, so it
    // simply never departs.
    if (state.groundedTails.includes(leg.tail)) continue;
    if (isAog(state, leg.tail)) continue;
    // A plane still in the air toward this leg's origin just runs late:
    // the leg waits for it. Checked before the in-order scan below, which
    // walks the whole schedule and would only reach the same answer.
    if (aircraft.status !== 'ground') continue;
    // A plane flies its day in order: a leg waits until every earlier leg
    // of that plane's day has flown or been cancelled. Without this, a
    // plane that started the day at the wrong airport could fly a later
    // leg first and then an overdue earlier one, ending the day back where
    // it started, every day, while its other routes never flew.
    if (hasEarlierLegPending(state, leg, doneToday)) continue;
    if (isAirportClosed(state, leg.origin)) continue;
    // Parked at another airport when this leg is due (stranded there by
    // an earlier closure or curfew): it can't fly this one, so cancel it
    // and let the plane pick up its day from the next leg that leaves
    // from where it is.
    if (aircraft.atAirport !== leg.origin) {
      state.cancelledToday.push(leg.legId);
      doneToday.add(leg.legId);
      recordCancellation(state, leg, 'position');
      continue;
    }
    if (state.simMinute < aircraft.groundSinceMinute + MIN_TURN_MINUTES) continue; // still turning around

    // The 22:00 curfew (sim/curfew.ts): a rotation that can't be back at
    // base by then, on the delay it's already carrying, is cancelled whole
    // before it leaves rather than flown into the night.
    const rotation = rotationStartingWith(state, leg);
    if (rotation && breaksCurfew(state, rotation, state.simMinute, dayStart)) {
      for (const cancelled of rotation.legs) {
        state.cancelledToday.push(cancelled.legId);
        doneToday.add(cancelled.legId);
        recordCancellation(state, cancelled, 'curfew');
      }
      continue;
    }

    aircraft.status = 'airborne';
    aircraft.atAirport = null;
    aircraft.activeLegId = leg.legId;

    // The knock-on delay cause below: this leg was due at
    // dayStart + leg.departMinute, and it can never depart *before* that
    // (the `minuteOfDay < leg.departMinute` check above rules it out), so
    // how far past it this flight is actually departing is "how much
    // upstream pressure is still carrying forward" — a late aircraft sat
    // waiting on an earlier leg, not a fresh event of its own.
    // Whether the flight counts as *on time* is decided later, when it
    // lands (see the arrival loop below).
    const lateAtDepartureMinutes = state.simMinute - (dayStart + leg.departMinute);
    // Departures still count: Reputation and service targets use them as
    // their sample size, and targets average NPS over them.
    state.todayFlightsDeparted += 1;
    if (state.activeTarget) state.activeTarget.flightsDeparted += 1;
    const marketOnTimeKey = marketKey(leg.origin, leg.dest);

    const weatherAtOrigin = !!state.weatherByAirport[leg.origin];
    const [delayBreakdown, nextSeed] = rollTotalDelayMinutes(
      state.rngSeed,
      aircraft.ageYears,
      weatherAtOrigin,
      lateAtDepartureMinutes,
      // Congestion is judged at the busier of the two ends: a full
      // airport queues its departures and holds its arrivals alike.
      Math.max(airportLoad(state, leg.origin), airportLoad(state, leg.dest)),
      maintenanceAgeFactor(state) * executiveMaintenanceMultiplier(state),
    );
    state.rngSeed = nextSeed;
    state.delayMinutesByCause.age += delayBreakdown.age;
    state.delayMinutesByCause.weather += delayBreakdown.weather;
    state.delayMinutesByCause.knockOn += delayBreakdown.knockOn;
    state.delayMinutesByCause.congestion += delayBreakdown.congestion;
    // A flight-ops COO scales the whole rolled delay down. Applied to
    // the summed total rather than to each cause, so the per-cause
    // attribution the On-Time panel reports stays the raw picture of
    // *why* flights run late, with the executive's effect visible as the
    // gap between that and what actually happened.
    const delayMinutes = Math.round(
      (delayBreakdown.age + delayBreakdown.weather + delayBreakdown.knockOn + delayBreakdown.congestion) *
        executiveDelayMultiplier(state),
    );

    // The fare is market-level (RouteSettings), not per-leg: every leg on
    // this market shares the same entry.
    const routeSettings = state.routeSettings[marketOnTimeKey];

    // Week five's NPS quality signal (sim/nps.ts): every input this needs —
    // this flight's just-rolled delay, its fare, and its aircraft's age —
    // is already known by this point in the loop, so it's scored the same
    // moment the on-time counters above are.
    const satisfactionScore = flightSatisfactionScore(
      delayMinutes,
      routeSettings.fare,
      aircraft.ageYears,
      leg.origin,
      leg.dest,
      state.competitorRoutes,
      cabinServiceShare(state.crew),
    ) + executiveNpsBonus(state);
    state.npsPointsTotal += satisfactionScore;
    state.todayNpsPoints += satisfactionScore;
    state.npsScoredFlightsTotal += 1;
    state.todayNpsScoredFlights += 1;
    if (state.activeTarget) state.activeTarget.npsPoints += satisfactionScore;

    const activeFlight: ActiveFlight = {
      legId: leg.legId,
      tail: leg.tail,
      origin: leg.origin,
      dest: leg.dest,
      departMinute: state.simMinute,
      arriveMinute: state.simMinute + leg.blockMinutes + delayMinutes,
      // What arriveMinute would be with a fully on-time departure today and
      // zero delay — the honest "should have landed by" time, for the
      // panel to compare against.
      scheduledArriveMinute: dayStart + leg.departMinute + leg.blockMinutes,
      scheduledDepartMinute: dayStart + leg.departMinute,
      delayByCause: delayBreakdown,
      delayMinutes,
      // Locked in at departure — see ActiveFlight's note on why it isn't
      // re-read from state.routeSettings at arrival.
      fare: routeSettings.fare,
    };
    state.activeFlights.push(activeFlight);
    airborne.add(activeFlight.legId);
  }

  for (let i = state.activeFlights.length - 1; i >= 0; i--) {
    const flight = state.activeFlights[i];
    if (state.simMinute < flight.arriveMinute) continue;

    const aircraft = state.aircraft.find((a) => a.tail === flight.tail);
    // What this flight carried and made, kept for today's leg results below.
    let flightPassengers = 0;
    let flightSeats = 0;
    let flightMargin = 0;
    if (aircraft) {
      aircraft.status = 'ground';
      aircraft.atAirport = flight.dest;
      aircraft.activeLegId = null;
      aircraft.groundSinceMinute = state.simMinute;

      const type = aircraftTypesByCode.get(aircraft.typeCode);
      if (type) {
        const blockMinutes = flight.arriveMinute - flight.departMinute;

        {
          // At least this flight: a route removed while its last flight
          // was in the air has no legs left on the schedule, and demand
          // per flight would be divided by zero.
          const marketFrequency = Math.max(1, legsServingMarket(flight.origin, flight.dest, state.schedule));
          const key = marketKey(flight.origin, flight.dest);
          const spilloverAvailable = state.spilloverByMarket[key] ?? 0;
          const result = flightResult(
            { origin: flight.origin, dest: flight.dest, blockMinutes },
            type,
            state.fuelPriceIndex,
            state.fuelEfficiencyMultiplier,
            actualDailyDemand(state, flight.origin, flight.dest),
            connectingDemandOnMarket(state, flight.origin, flight.dest),
            marketFrequency,
            flight.fare,
            state.competitorRoutes,
            spilloverAvailable,
          );
          state.spilloverByMarket[key] = spilloverAvailable + result.spilloverDelta;
          flightPassengers = result.pax;
          flightSeats = type.seats;
          flightMargin = result.margin;
          recordFlightLoad(state, key, result.pax, type.seats);
          state.cash += result.margin;
          state.todayRevenue += result.revenue;
          state.todayCost += result.cost;
          state.todayCostByCategory.fuel += result.costBreakdown.fuel;
          state.todayCostByCategory.blockNonFuel += result.costBreakdown.blockNonFuel;
          state.todayCostByCategory.departure += result.costBreakdown.departure;
          state.todayMargin += result.margin;
          // Same numbers, split by market — sim/pnlHistory.ts rolls these
          // into revenueHistoryByMarket/costHistoryByMarket at rollover.
          state.todayRevenueByMarket[key] = (state.todayRevenueByMarket[key] ?? 0) + result.revenue;
          state.todayCostByMarket[key] = (state.todayCostByMarket[key] ?? 0) + result.cost;
        }
      }
    }

    // On-time performance (HUD stat next to Cash), judged now that the
    // flight has actually landed: on time if it's within the grace window
    // of its scheduled arrival (sim/delays.ts). Counted into three scopes
    // at once — today (for Reputation), lifetime (the HUD), a running
    // service target's window (sim/targets.ts) — plus per market for the
    // On-Time panel (ui/onTime.ts), created on first use the way
    // routeSettings is.
    const onTime = isOnTimeArrival(flight.arriveMinute, flight.scheduledArriveMinute);
    const arrivedMarketKey = marketKey(flight.origin, flight.dest);
    const marketOnTime = (state.onTimeByMarket[arrivedMarketKey] ??= { arrived: 0, onTime: 0 });
    // Today's per-market copy feeds the route view's daily bars and
    // reliability's effect on demand (sim/routeOtp.ts).
    const marketOnTimeToday = (state.todayOnTimeByMarket[arrivedMarketKey] ??= { arrived: 0, onTime: 0, cancelled: 0 });
    state.flightsArrivedTotal += 1;
    state.todayFlightsArrived += 1;
    marketOnTime.arrived += 1;
    marketOnTimeToday.arrived += 1;
    if (state.activeTarget) state.activeTarget.flightsArrived += 1;
    if (onTime) {
      state.flightsOnTimeTotal += 1;
      state.todayFlightsOnTime += 1;
      marketOnTime.onTime += 1;
      marketOnTimeToday.onTime += 1;
      if (state.activeTarget) state.activeTarget.flightsOnTime += 1;
    }

    // How this leg went, for the aircraft view: the flight record itself
    // is gone once it lands.
    (state.todayLegResults ??= {})[flight.legId] = {
      departLateMinutes: flight.departMinute - flight.scheduledDepartMinute,
      arriveLateMinutes: flight.arriveMinute - flight.scheduledArriveMinute,
      onTime,
      delayByCause: flight.delayByCause,
      passengers: flightPassengers,
      seats: flightSeats,
      margin: flightMargin,
    };

    state.completedToday.push(flight.legId);
    state.activeFlights.splice(i, 1);
  }

  // Week six's missions (sim/missions.ts): cheap pure reads of `state`,
  // checked every tick rather than once a day so "you bought your first
  // aircraft" lands immediately instead of up to a simulated day later.
  checkMissions(state);

  state.simMinute += 1;
}
