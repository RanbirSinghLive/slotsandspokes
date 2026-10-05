import { endSeasonalLeases } from './seasonalLease';
import { demandFactors, rollDailyDemandEvents } from './demandEvents';
import { morningHolds, rollNightlyChecks, wornAge } from './mxChecks';
import { chargeNightStops } from './nightStops';
import { applyPendingRetimes } from './retime';
import { rollDailyFareWars } from './fareWars';
import { effectiveFareClasses } from './seatSale';
import { rollDailyBrand } from './brand';
import { ferryStrandedPlanes } from './ferry';
import { USABLE_DAY_START_MINUTE } from './utilisation';
import { crowdingWeight } from './timeOfDay';
import { cabinLayout, cabinOf } from './cabins';
import aircraftTypesData from '../../data/aircraft-types.json';
import { flightResult, type EconomyAircraftType } from './economy';
import { carryCargo, rollDailyCargo } from './cargo';
import { MIN_TURN_MINUTES, legsServingMarket, marketDepartMinutes, marketKey, type ScheduleLeg } from './schedule';
import { breaksCurfew, rotationStartingWith } from './curfew';
import { rollDailyWeather, isAirportClosed } from './weather';
import { legAirspace, rollDailyAirspace } from './airspace';
import { rollDailyShocks } from './shocks';
import { airlineFuelPrice, recordHedgedFuel, rollDailyFuelPrice } from './fuelPrice';
import { airportLoadAt } from './airports';
import { hourOf } from './hours';
import { connectingDemandOnMarket } from './hubs';
import { rollTotalDelayMinutes, isOnTimeArrival } from './delays';
import { rollCompetitorRouteOpenings, rollCompetitorFrequencyGrowth, rollRivalEntry, rollDailyRivalFares } from './competitors';
import { bookingPerks, runningCostForDay } from './innovations';
import { rollDailyFleet } from './fleetTiming';
import { rollDailyRebases } from './rebase';
import { addTally, emptyTally } from './fareClasses';
import { networkOverheadPerDay } from './overhead';
import { basesCostPerDay } from './bases';
import { rollDailyMarketDemand, actualDailyDemand } from './marketDemand';
import { revealReach } from './reach';
import { cabinCover, FATIGUE_DELAY_MULTIPLIER, legFatigue, rollDailyCrews } from './crews';
import { MAINTENANCE_AGE_FACTOR } from './aog';
import { isAog, rollDailyAogs } from './aog';
import {
  executiveSalariesPerDay,
  executiveDelayMultiplier,
  executiveNpsBonus,
  executiveMaintenanceMultiplier,
} from './executives';
import { CANCELLATION_NPS_SCORE, flightSatisfactionScore, recordFlightNps, rollTrailingNps } from './nps';
import { recordDailyCashHistory } from './forecast';
import { recordDailyPnlHistory } from './pnlHistory';
import { recordFlightSeatNm, recordDailySeatNmHistory } from './unitEconomics';
import { recordDailyOnTimeHistory } from './routeOtp';
import { recordDailyLoadHistory, recordFlightLoad } from './loadFactor';
import { checkMilestones } from './ladder';
import { acquireNeededSlots, settleSlotsForDay } from './slots';
import { ensureRivalFleets, rollDailyMarket } from './market';
import { dayIndex, minuteOfDay as homeMinuteOfDay } from './clock';
import { rollRivalCapacityResponse } from './rivalResponse';
import { applyFarePolicy } from './pricing';
import { closeLosingRivalRoutes } from './rivalEconomics';
import { rollDailyRivalMilestones } from './rivalLadder';
import type { SimState, ActiveFlight } from './state';
import { contractRiders, rollDailyContracts } from './contracts';

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
 *   2. Depart: any scheduled leg whose departure time has arrived (*at
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
 * outside step() (the headless runner, for instance) read "yesterday's
 * numbers" cleanly between calls, instead of catching them already zeroed.
 *
 * `state.schedule` is "the daily repeating schedule" (CLAUDE.md), so
 * matching against the home-local minute of the day (sim/clock.ts) makes
 * every leg fire again at the same local time on day 1, day 2, and so on.
 * It's read from `state` rather than a module-level constant, so a
 * schedule change takes effect on the very next tick.
 *
 * Why "at or after" instead of "exactly at" departMinute: an aircraft
 * can still be airborne or mid-turnaround at the exact minute its next
 * leg was supposed to leave. An exact-match check would
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
/** Whether a closure shuts one end of the leg or its detour is beyond the plane's range. */
function legBlockedByAirspace(state: SimState, leg: ScheduleLeg): boolean {
  const aircraft = state.aircraft.find((a) => a.tail === leg.tail);
  return !!aircraft && legAirspace(state, leg.origin, leg.dest, aircraft.typeCode).kind === 'blocked';
}

function recordCancellation(state: SimState, leg: ScheduleLeg, cause: keyof SimState['cancellationsByCause']): void {
  state.cancellationsByCause[cause] = (state.cancellationsByCause[cause] ?? 0) + 1;
  state.todayFlightsCancelled += 1;
  state.flightsCancelledTotal += 1;
  recordFlightNps(state, leg.origin, leg.dest, CANCELLATION_NPS_SCORE);
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
  // Through the night too, for a plane stranded by a change made overnight (midnight is the rollover's).
  if (minuteOfDay > 0 && minuteOfDay < USABLE_DAY_START_MINUTE) ferryStrandedPlanes(state);

  if (minuteOfDay === 0) {
    // The trailing NPS (sim/nps.ts) takes in the day just flown, before
    // today's counts reset below.
    rollTrailingNps(state);
    // Runway forecast (sim/forecast.ts): read before today's
    // own charges touch Cash — this is what makes each entry "yesterday's
    // closing balance."
    recordDailyCashHistory(state);
    // Same timing, same reason: state.todayRevenue/todayCost/todayMargin
    // still hold the day that just ended, one line above where they reset.
    recordDailyPnlHistory(state);
    recordDailySeatNmHistory(state);
    recordDailyOnTimeHistory(state);
    recordDailyLoadHistory(state);
    state.todayLoadByMarket = {};
    // The ladder (sim/ladder.ts), judged on the histories just recorded.
    checkMilestones(state);

    // The loyalty scheme costs a share of revenue, so it's worked out from
    // the day that just ended, before the totals reset below.
    const innovationCost = runningCostForDay(state, state.todayRevenue);

    state.completedToday = [];
    state.cancelledToday = [];
    state.mxHoldsToday = [];
    state.retimedToday = [];
    // Gantt moves held for tomorrow (sim/retime.ts) take effect with the new day.
    applyPendingRetimes(state);
    // Yesterday's fare-class sales, for the route view (sim/fareClasses.ts).
    state.yesterdayFareClasses = state.todayFareClasses ?? {};
    state.todayFareClasses = {};
    state.todayLegResults = {};
    rollDailyCargo(state);
    state.todayRevenue = 0;
    state.todayCost = 0;
    state.todayMargin = 0;
    // Cost attribution — reset in lockstep with todayCost
    // above, since these five are exactly that number split up.
    state.todayCostByCategory = { fuel: 0, blockNonFuel: 0, departure: 0, lease: 0, crew: 0, slots: 0, maintenance: 0, overhead: 0, innovations: 0, executives: 0 };
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

    // Deliveries and returns due today (sim/fleetTiming.ts), before the
    // day's leases are charged: a plane delivered today pays from today,
    // one gone back today pays nothing more.
    rollDailyFleet(state);
    // Seasonal leases whose season is over go back (sim/seasonalLease.ts).
    endSeasonalLeases(state);
    rollDailyRebases(state);

    // Lease cost: a flat per-day charge, not tied to whether the aircraft
    // actually flew that day. Every aircraft is leased (sim/leasing.ts).
    const totalLeaseCost = state.aircraft.reduce((total, aircraft) => total + aircraft.leaseCostPerDay, 0);
    state.cash -= totalLeaseCost;
    state.todayCost += totalLeaseCost;
    state.todayCostByCategory.lease += totalLeaseCost;
    state.todayMargin -= totalLeaseCost;

    // Bases away from home (sim/bases.ts): crew rooms under crew, maintenance bases under maintenance.
    const basesCost = basesCostPerDay(state);
    state.cash -= basesCost.crew + basesCost.maintenance;
    state.todayCost += basesCost.crew + basesCost.maintenance;
    state.todayCostByCategory.crew += basesCost.crew;
    state.todayCostByCategory.maintenance += basesCost.maintenance;
    state.todayMargin -= basesCost.crew + basesCost.maintenance;

    // Network overhead (sim/overhead.ts): grows with the square of the fleet.
    const overhead = networkOverheadPerDay(state);
    state.cash -= overhead;
    state.todayCost += overhead;
    state.todayCostByCategory.overhead += overhead;
    state.todayMargin -= overhead;

    // Adopted innovations' running costs (sim/innovations.ts).
    state.cash -= innovationCost;
    state.todayCost += innovationCost;
    state.todayCostByCategory.innovations = innovationCost;
    state.todayMargin -= innovationCost;

    // Executives' salaries (sim/executives.ts).
    const salaries = executiveSalariesPerDay(state);
    state.cash -= salaries;
    state.todayCost += salaries;
    state.todayCostByCategory.executives = salaries;
    state.todayMargin -= salaries;

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

    // Crews (sim/crews.ts): hires that have come due join, each base
    // shares its crews among its planes, planes it can't crew are
    // grounded, and crews left standing by are paid for.
    const standby = rollDailyCrews(state);
    state.cash -= standby;
    state.todayCost += standby;
    state.todayCostByCategory.crew += standby;
    state.todayMargin -= standby;
    // AOGs (sim/aog.ts): repairs finishing, new breakdowns, and moving a
    // grounded plane's flying onto the rest of its pool. After the crew
    // pass so a tail already grounded for crew isn't grounded twice and
    // counted under two causes; before the cancellation count below, so
    // whatever couldn't be covered is counted as cancelled today.
    // Night stops' hotels (sim/nightStops.ts), then last night's line
    // checks, judged before anyone is ferried home (sim/mxChecks.ts).
    chargeNightStops(state);
    rollNightlyChecks(state, state.simMinute);
    // A plane stranded away from base with nothing to fly from there goes home empty (sim/ferry.ts).
    ferryStrandedPlanes(state);
    rollDailyAogs(state, state.simMinute);
    // Planes with too many deferred items are held at base this morning: their first rotation cancels.
    for (const hold of morningHolds(state)) {
      for (const legId of hold.legIds) {
        const leg = state.schedule.find((l) => l.legId === legId);
        if (!leg) continue;
        state.cancelledToday.push(legId);
        recordCancellation(state, leg, 'maintenance');
      }
      (state.mxHoldsToday ??= []).push(hold.tail);
    }


    // Airspace closures (sim/airspace.ts) come before the day's cancellations,
    // which read them.
    rollDailyAirspace(state);

    // Cancellations. Everything on the schedule that has an aircraft is a
    // scheduled departure; the ones whose aircraft couldn't be crewed
    // today never operate. Counted once here rather than discovered leg
    // by leg later, so Completion Factor is known for the whole day up
    // front and the departure loop below just declines to fly them.
    for (const leg of state.schedule) {
      if (!state.aircraft.some((a) => a.tail === leg.tail)) continue; // no aircraft assigned — not really scheduled
      state.todayFlightsScheduled += 1;
      state.flightsScheduledTotal += 1;
      // Already cancelled this morning (a maintenance hold): counted once.
      if (state.cancelledToday.includes(leg.legId)) continue;

      // Three causes, checked in the order they'd actually stop a flight:
      // no crew to fly it, no serviceable aircraft, or nowhere to fly it
      // from. Each leg counts once, under the first that applies.
      const cause = state.groundedTails.includes(leg.tail)
        ? 'crew'
        : isAog(state, leg.tail)
          ? 'mechanical'
          : isAirportClosed(state, leg.origin)
            ? 'weather'
            : legBlockedByAirspace(state, leg)
              ? 'airspace'
              : null;
      if (cause === null) continue;
      // Held on the ground for the day, so it never leaves and its plane's next leg is judged from where it is.
      if (cause === 'airspace') state.cancelledToday.push(leg.legId);
      recordCancellation(state, leg, cause);
    }

    // Weather (sim/weather.ts) is a daily-scale event, not a per-minute
    // one — origination, spread, and expiry all happen once here rather
    // than being checked on every tick.
    // Shocks first (sim/shocks.ts): the weather, fuel and demand rolls below read them.
    rollDailyShocks(state);
    rollDailyFuelPrice(state);
    rollDailyWeather(state, state.simMinute);

    // Competitor AI (sim/competitors.ts): once a day, each
    // competitor airline has a small independent chance to open one new
    // route. Same daily cadence as weather, for the same reason — this
    // is a day-scale event, not something worth re-checking every minute.
    ensureRivalFleets(state);
    // Rivals first withdraw from routes that keep losing money
    // (sim/rivalEconomics.ts), then grow.
    closeLosingRivalRoutes(state);
    // Rivals climb the ladder too, judged on the routes just scored (sim/rivalLadder.ts).
    rollDailyRivalMilestones(state);
    rollCompetitorRouteOpenings(state, state.simMinute);
    rollCompetitorFrequencyGrowth(state);
    rollRivalEntry(state, state.simMinute);
    // The player's fare stances reprice against yesterday's rival fares
    // (sim/pricing.ts), then rivals reprice against the player's fares
    // (sim/competitors.ts) and move in on markets the player flies full at
    // a premium (sim/rivalResponse.ts).
    applyFarePolicy(state);
    rollDailyRivalFares(state);
    rollDailyFareWars(state);
    rollRivalCapacityResponse(state, state.simMinute);
    // The lessor's delivery (sim/market.ts) comes *after* the rivals have
    // grown for the day. Rivals only ever act at rollover, so an airframe
    // delivered before them would always be theirs before the player could
    // see it; delivered after, it sits on the shelf all day and the player
    // gets the first chance. First come, first served, fairly.
    rollDailyMarket(state, dayIndex(state));

    // Market stimulation (sim/marketDemand.ts): markets grow
    // toward their potential where they're actually flown and decay back
    // toward the floor where they aren't. Same daily cadence as the rolls
    // above, but unlike them entirely deterministic — no random draws.
    rollDailyMarketDemand(state);
    rollDailyBrand(state);
    rollDailyDemandEvents(state);
    // Contracts (sim/contracts.ts): starts, payments, endings
    // and their snap-back, after the markets have grown for the day so a
    // snap-back isn't regrown before anyone sees it.
    rollDailyContracts(state);
    // Backstop for fog by reach (sim/reach.ts): the menu actions that widen
    // reach reveal immediately; this catches anything that slipped past.
    revealReach(state);
  }

  // Leg ids already flown or cancelled today, and those in the air now, as
  // sets: every due leg is checked against them every minute, and a list
  // search there grows with the square of the schedule. Kept in step with
  // the lists by the three places below that add to them.
  // Legs moved today to a time already past wait for tomorrow (sim/retime.ts):
  // to the departure loop they're as good as done.
  const retimed = state.retimedToday ?? [];
  const doneToday = retimed.length > 0 ? new Set([...doneTodaySet(state), ...retimed]) : doneTodaySet(state);
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
    state.todayFlightsDeparted += 1;
    const marketOnTimeKey = marketKey(leg.origin, leg.dest);

    const weatherAtOrigin = !!state.weatherByAirport[leg.origin];
    const [delayBreakdown, nextSeed] = rollTotalDelayMinutes(
      state.rngSeed,
      // Deferred maintenance items wear it like extra years (sim/mxChecks.ts).
      wornAge(aircraft),
      weatherAtOrigin,
      lateAtDepartureMinutes,
      // Congestion is judged at the busier of the two ends, each in the
      // hour this flight uses it (sim/hours.ts): a full hour queues its
      // departures and holds its arrivals alike.
      Math.max(airportLoadAt(state, leg.origin, hourOf(leg.departMinute)), airportLoadAt(state, leg.dest, hourOf(leg.departMinute + leg.blockMinutes))),
      MAINTENANCE_AGE_FACTOR * executiveMaintenanceMultiplier(state),
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
    // A tired crew (sim/crews.ts) runs later still.
    const fatigue = legFatigue(state, leg);
    const delayMinutes = Math.round(
      (delayBreakdown.age + delayBreakdown.weather + delayBreakdown.knockOn + delayBreakdown.congestion) *
        executiveDelayMultiplier(state) *
        (1 + (FATIGUE_DELAY_MULTIPLIER - 1) * fatigue),
    );

    // The fare is market-level (RouteSettings), not per-leg: every leg on
    // this market shares the same entry.
    const routeSettings = state.routeSettings[marketOnTimeKey];

    // NPS quality signal (sim/nps.ts): every input this needs —
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
      // A fresh crew gives full service; a tired one less (sim/crews.ts).
      1 - fatigue,
      // A short cabin loses service points on every flight (sim/crews.ts).
      cabinCover(state, leg.tail),
    ) + executiveNpsBonus(state);
    recordFlightNps(state, leg.origin, leg.dest, satisfactionScore);

    // Flying round an airspace closure adds minutes to the flight and to
    // the time it is scheduled to land: re-filed, not late.
    const airspace = legAirspace(state, leg.origin, leg.dest, aircraft.typeCode);
    const detourMinutes = airspace.kind === 'detour' ? airspace.extraMinutes : 0;

    const activeFlight: ActiveFlight = {
      legId: leg.legId,
      tail: leg.tail,
      origin: leg.origin,
      dest: leg.dest,
      departMinute: state.simMinute,
      arriveMinute: state.simMinute + leg.blockMinutes + detourMinutes + delayMinutes,
      // What arriveMinute would be with a fully on-time departure today and
      // zero delay — the honest "should have landed by" time, for the
      // panel to compare against.
      scheduledArriveMinute: dayStart + leg.departMinute + leg.blockMinutes + detourMinutes,
      scheduledDepartMinute: dayStart + leg.departMinute,
      delayByCause: delayBreakdown,
      delayMinutes,
      // Locked in at departure — see ActiveFlight's note on why it isn't
      // re-read from state.routeSettings at arrival.
      fare: routeSettings.fare,
    };
    if (airspace.kind === 'detour') {
      activeFlight.via = airspace.via;
      activeFlight.detourMinutes = detourMinutes;
    }
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
            // The locked price under a hedge (sim/fuelPrice.ts).
            airlineFuelPrice(state),
            state.fuelEfficiencyMultiplier,
            actualDailyDemand(state, flight.origin, flight.dest),
            // Contract riders (sim/contracts.ts) are the airline's own
            // customers too, booked like connecting passengers.
            connectingDemandOnMarket(state, flight.origin, flight.dest) + contractRiders(state, flight.origin, flight.dest),
            marketFrequency,
            flight.fare,
            state.competitorRoutes,
            spilloverAvailable,
            bookingPerks(state, flight.origin, flight.dest),
            (() => {
              const scheduled = state.schedule.find((leg) => leg.legId === flight.legId);
              const departMinute = scheduled?.departMinute ?? homeMinuteOfDay(state, flight.scheduledDepartMinute);
              return {
                departMinute,
                marketDepartMinutes: marketDepartMinutes(flight.origin, flight.dest, state.schedule),
                crowding: crowdingWeight({ origin: flight.origin, dest: flight.dest, departMinute, legId: flight.legId }, state.schedule),
                season: demandFactors(state, flight.origin, flight.dest),
              };
            })(),
            effectiveFareClasses(state, key),
            cabinOf(aircraft),
          );
          addTally(((state.todayFareClasses ??= {})[key] ??= emptyTally()), result.fareClasses);
          state.spilloverByMarket[key] = spilloverAvailable + result.spilloverDelta;
          flightPassengers = result.pax;
          const layout = cabinLayout(type.seats, cabinOf(aircraft));
          flightSeats = layout.economy + layout.business;
          flightMargin = result.margin;
          recordFlightLoad(state, key, result.pax, flightSeats);
          recordFlightSeatNm(state, flight.origin, flight.dest, flightSeats);
          state.cash += result.margin;
          state.todayRevenue += result.revenue;
          state.todayCost += result.cost;
          state.todayCostByCategory.fuel += result.costBreakdown.fuel;
          recordHedgedFuel(state, result.costBreakdown.fuel);
          state.todayCostByCategory.blockNonFuel += result.costBreakdown.blockNonFuel;
          state.todayCostByCategory.departure += result.costBreakdown.departure;
          state.todayMargin += result.margin;
          // Same numbers, split by market — sim/pnlHistory.ts rolls these
          // into revenueHistoryByMarket/costHistoryByMarket at rollover.
          state.todayRevenueByMarket[key] = (state.todayRevenueByMarket[key] ?? 0) + result.revenue;
          state.todayCostByMarket[key] = (state.todayCostByMarket[key] ?? 0) + result.cost;
          // Freight in whatever hold the passengers left (sim/cargo.ts), paid
          // net of handling and counted in the same revenue and margin.
          const cargo = carryCargo(state, {
            origin: flight.origin,
            dest: flight.dest,
            seats: flightSeats,
            passengers: result.pax,
            transitMinutes: flight.arriveMinute - flight.scheduledDepartMinute,
          });
          if (cargo.revenue !== 0) {
            flightMargin += cargo.revenue;
            state.cash += cargo.revenue;
            state.todayRevenue += cargo.revenue;
            state.todayMargin += cargo.revenue;
            state.todayRevenueByMarket[key] = (state.todayRevenueByMarket[key] ?? 0) + cargo.revenue;
          }
        }
      }
    }

    // On-time performance (HUD stat next to Cash), judged now that the
    // flight has actually landed: on time if it's within the grace window
    // of its scheduled arrival (sim/delays.ts). Counted for today and the
    // lifetime (the HUD), plus per market for the On-Time panel
    // (ui/onTime.ts), created on first use the way routeSettings is.
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
    if (onTime) {
      state.flightsOnTimeTotal += 1;
      state.todayFlightsOnTime += 1;
      marketOnTime.onTime += 1;
      marketOnTimeToday.onTime += 1;
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

  state.simMinute += 1;
}
