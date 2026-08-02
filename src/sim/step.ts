import aircraftTypesData from '../../data/aircraft-types.json';
import { flightResult, legCostBreakdown, type EconomyAircraftType } from './economy';
import { MIN_TURN_MINUTES, legsServingMarket, marketKey } from './schedule';
import { rollDailyWeather } from './weather';
import { rollTotalDelayMinutes } from './delays';
import { rollCompetitorRouteOpenings } from './competitors';
import { rollDailyFuelPrice } from './fuel';
import { rollDailyMarketDemand, actualDailyDemand } from './marketDemand';
import { checkMissions } from './missions';
import { rollDailyCrew, maintenanceAgeFactor, cabinServiceShare } from './crew';
import { CANCELLATION_NPS_SCORE } from './nps';
import { resolveTargetIfDue } from './targets';
import { applyDailyLoanInterest } from './loans';
import { flightSatisfactionScore } from './nps';
import { applyDailyReputationChange } from './reputation';
import { recordDailyCashHistory } from './forecast';
import type { SimState, ActiveFlight } from './state';

const MINUTES_PER_DAY = 1440;

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
 *   3. Position (week three): same gate as a scheduled departure above,
 *      but against `state.positioningLegs` instead — one-time repositioning
 *      moves the M10 route builder queues up when a route gets assigned to
 *      a tail that isn't standing at its origin (see PositioningLeg in
 *      sim/schedule.ts). Removed from the queue the moment it departs,
 *      since it never repeats.
 *   4. Arrive: any ActiveFlight whose arrival minute has been reached
 *      lands — its aircraft flips back to ground at the destination and
 *      records when (`groundSinceMinute`, for the next leg's turn-time
 *      check). A positioning flight's cost (fuel + departure, no revenue —
 *      it isn't serving a market) is applied the same as a revenue flight's
 *      full economics (sim/economy.ts) would be, and the flight is removed
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
 * matching against `state.simMinute % MINUTES_PER_DAY` makes every leg fire
 * again at the same local-to-the-schedule time on day 1, day 2, and so on.
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
export function step(state: SimState): void {
  const minuteOfDay = state.simMinute % MINUTES_PER_DAY;
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
    // Week five's runway forecast (sim/forecast.ts): same "read it before
    // today's own charges touch Cash" timing as the reputation call just
    // above — this is what makes each entry "yesterday's closing balance."
    recordDailyCashHistory(state);

    state.completedToday = [];
    state.todayRevenue = 0;
    state.todayCost = 0;
    state.todayMargin = 0;
    // Week six's cost attribution — reset in lockstep with todayCost
    // above, since these five are exactly that number split up.
    state.todayCostByCategory = { fuel: 0, blockNonFuel: 0, departure: 0, marketing: 0, lease: 0, crew: 0 };
    state.todayFlightsScheduled = 0;
    state.todayFlightsCancelled = 0;
    state.todayNpsScoredFlights = 0;
    state.todayFlightsDeparted = 0;
    state.todayFlightsOnTime = 0;
    state.todayNpsPoints = 0;
    // Spill-and-recapture's shared pool (sim/economy.ts's flightResult())
    // is scoped to one day: unclaimed spill doesn't carry into tomorrow,
    // since nobody's actually holding a seat for anyone.
    state.spilloverByMarket = {};

    // Marketing spend (week two's "Commercial" panel) is a per-day, per-
    // market cost, not a per-flight one — charged once here rather than in
    // the arrival loop below, since a market can have zero, one, or many
    // flights land on a given day and the spend doesn't scale with that.
    const totalMarketingSpend = Object.values(state.routeSettings).reduce(
      (total, settings) => total + settings.marketingSpend,
      0,
    );
    state.cash -= totalMarketingSpend;
    state.todayCost += totalMarketingSpend;
    state.todayCostByCategory.marketing += totalMarketingSpend;
    state.todayMargin -= totalMarketingSpend;

    // Fleet Market lease cost (week three) — same "flat per-day charge"
    // shape as marketing spend above, not tied to whether the aircraft
    // actually flew that day. 0 for every owned aircraft, so this is a
    // no-op for the headless runner's fully-owned fleet.
    const totalLeaseCost = state.aircraft.reduce((total, aircraft) => total + aircraft.leaseCostPerDay, 0);
    state.cash -= totalLeaseCost;
    state.todayCost += totalLeaseCost;
    state.todayCostByCategory.lease += totalLeaseCost;
    state.todayMargin -= totalLeaseCost;

    // Week six's crew model (sim/crew.ts): deliver recruitment and
    // training that has come due, pay every head on the books, then roll
    // today's disruption and work out which aircraft can actually be
    // crewed. Must run after the todayCost reset above, since it charges
    // salary into it.
    rollDailyCrew(state);

    // Cancellations. Everything on the schedule that has an aircraft is a
    // scheduled departure; the ones whose aircraft couldn't be crewed
    // today never operate. Counted once here rather than discovered leg
    // by leg later, so Completion Factor is known for the whole day up
    // front and the departure loop below just declines to fly them.
    for (const leg of state.schedule) {
      if (!state.aircraft.some((a) => a.tail === leg.tail)) continue; // no aircraft assigned — not really scheduled
      state.todayFlightsScheduled += 1;
      state.flightsScheduledTotal += 1;
      if (!state.groundedTails.includes(leg.tail)) continue;

      state.todayFlightsCancelled += 1;
      state.flightsCancelledTotal += 1;
      // A cancelled flight still has an unhappy passenger attached, so it
      // scores for NPS — over its own denominator, since it never
      // departed and mustn't distort On-Time.
      state.npsPointsTotal += CANCELLATION_NPS_SCORE;
      state.todayNpsPoints += CANCELLATION_NPS_SCORE;
      state.npsScoredFlightsTotal += 1;
      state.todayNpsScoredFlights += 1;
    }

    // Weather (sim/weather.ts) is a daily-scale event, not a per-minute
    // one — origination, spread, and expiry all happen once here rather
    // than being checked on every tick.
    rollDailyWeather(state, state.simMinute);

    // Week four's competitor AI (sim/competitors.ts): once a day, each
    // competitor airline has a small independent chance to open one new
    // route. Same daily cadence as weather, for the same reason — this
    // is a day-scale event, not something worth re-checking every minute.
    rollCompetitorRouteOpenings(state, state.simMinute);

    // Week six's fuel price mechanic (sim/fuel.ts): same daily cadence as
    // weather and the competitor AI above — fuel prices move day to day
    // in this model, not minute to minute.
    rollDailyFuelPrice(state);

    // Week six's market stimulation (sim/marketDemand.ts): markets grow
    // toward their potential where they're actually flown and decay back
    // toward the floor where they aren't. Same daily cadence as the rolls
    // above, but unlike them entirely deterministic — no random draws.
    rollDailyMarketDemand(state);

    // Week five's loan mechanic (sim/loans.ts): compound interest on every
    // outstanding loan, once a day, same cadence as weather and the
    // competitor AI above. Charged to each loan's own balance, not to Cash
    // directly — see applyDailyLoanInterest()'s own comment for why.
    applyDailyLoanInterest(state);
  }

  for (const leg of state.schedule) {
    if (minuteOfDay < leg.departMinute) continue; // not due yet today

    const alreadyHandledToday =
      state.completedToday.includes(leg.legId) || state.activeFlights.some((f) => f.legId === leg.legId);
    if (alreadyHandledToday) continue;

    const aircraft = state.aircraft.find((a) => a.tail === leg.tail);
    if (!aircraft) continue; // this tail isn't part of the active fleet yet
    // Couldn't be crewed today — already counted as a cancellation at
    // rollover, so it simply never departs.
    if (state.groundedTails.includes(leg.tail)) continue;
    if (aircraft.status !== 'ground' || aircraft.atAirport !== leg.origin) continue;
    if (state.simMinute < aircraft.groundSinceMinute + MIN_TURN_MINUTES) continue; // still turning around

    aircraft.status = 'airborne';
    aircraft.atAirport = null;
    aircraft.activeLegId = leg.legId;

    // On-time performance (HUD stat next to Cash) and the knock-on delay
    // cause below share the same number: this leg was due at
    // dayStart + leg.departMinute, and it can never depart *before* that
    // (the `minuteOfDay < leg.departMinute` check above rules it out), so
    // how far past it this flight is actually departing is both "how
    // late is this one" and "how much upstream pressure is still
    // carrying forward" — a late aircraft sat waiting on an earlier leg,
    // not a fresh event of its own.
    const lateAtDepartureMinutes = state.simMinute - (dayStart + leg.departMinute);
    state.flightsDepartedTotal += 1;
    state.todayFlightsDeparted += 1;
    if (lateAtDepartureMinutes === 0) {
      state.flightsOnTimeTotal += 1;
      state.todayFlightsOnTime += 1;
    }
    // A running target commitment keeps its own window-scoped copy of the
    // same counters — a promise is judged on what you deliver from the
    // moment you make it, not on a lifetime record that may be months
    // long (sim/targets.ts).
    if (state.activeTarget) {
      state.activeTarget.flightsDeparted += 1;
      if (lateAtDepartureMinutes === 0) state.activeTarget.flightsOnTime += 1;
    }

    // Same on-time question as the whole-airline counters just above,
    // just split out per market for the On-Time panel (ui/onTime.ts) —
    // lazily created the first time this market's first leg ever
    // departs, same "create on first use" shape routeSettings uses.
    const marketOnTimeKey = marketKey(leg.origin, leg.dest);
    const marketOnTime = (state.onTimeByMarket[marketOnTimeKey] ??= { departed: 0, onTime: 0 });
    marketOnTime.departed += 1;
    if (lateAtDepartureMinutes === 0) {
      marketOnTime.onTime += 1;
    }

    const weatherAtOrigin = !!state.weatherByAirport[leg.origin];
    const [delayBreakdown, nextSeed] = rollTotalDelayMinutes(
      state.rngSeed,
      aircraft.ageYears,
      weatherAtOrigin,
      lateAtDepartureMinutes,
      maintenanceAgeFactor(state),
    );
    state.rngSeed = nextSeed;
    state.delayMinutesByCause.age += delayBreakdown.age;
    state.delayMinutesByCause.weather += delayBreakdown.weather;
    state.delayMinutesByCause.knockOn += delayBreakdown.knockOn;
    const delayMinutes = delayBreakdown.age + delayBreakdown.weather + delayBreakdown.knockOn;

    // Fare and marketing spend are market-level (RouteSettings), not
    // per-leg — every leg on this market shares the same entry.
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
    );
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
      // Locked in at departure — see ActiveFlight's note on why these
      // aren't re-read from state.routeSettings at arrival.
      fare: routeSettings.fare,
      marketingSpend: routeSettings.marketingSpend,
    };
    state.activeFlights.push(activeFlight);
  }

  // Positioning legs (week three, see PositioningLeg's own comment in
  // sim/schedule.ts) depart the same way scheduled legs do above — same
  // ground/turn-time gate, same three-cause delay roll — except
  // `departMinute` here is an absolute simMinute, not a minute-of-day,
  // since a positioning move never repeats: "late at departure" is just
  // `simMinute - leg.departMinute` directly, no day-start offset needed.
  // Removed from the queue the instant it departs rather than tracked in
  // `completedToday`: once it's airborne it's fully represented by its
  // ActiveFlight, and it can never come due again.
  for (let i = state.positioningLegs.length - 1; i >= 0; i--) {
    const leg = state.positioningLegs[i];
    if (state.simMinute < leg.departMinute) continue;

    const aircraft = state.aircraft.find((a) => a.tail === leg.tail);
    if (!aircraft) continue;
    if (aircraft.status !== 'ground' || aircraft.atAirport !== leg.origin) continue;
    if (state.simMinute < aircraft.groundSinceMinute + MIN_TURN_MINUTES) continue;

    aircraft.status = 'airborne';
    aircraft.atAirport = null;
    aircraft.activeLegId = leg.legId;

    // Rolled the same way a revenue leg is, but *not* added to
    // onTimeByMarket or delayMinutesByCause (see their own doc comments
    // on SimState): a positioning move isn't serving a market, so it has
    // no route-quality story to tell.
    const weatherAtOrigin = !!state.weatherByAirport[leg.origin];
    const lateAtDepartureMinutes = state.simMinute - leg.departMinute;
    const [delayBreakdown, nextSeed] = rollTotalDelayMinutes(
      state.rngSeed,
      aircraft.ageYears,
      weatherAtOrigin,
      lateAtDepartureMinutes,
      maintenanceAgeFactor(state),
    );
    state.rngSeed = nextSeed;
    const delayMinutes = delayBreakdown.age + delayBreakdown.weather + delayBreakdown.knockOn;

    const activeFlight: ActiveFlight = {
      legId: leg.legId,
      tail: leg.tail,
      origin: leg.origin,
      dest: leg.dest,
      departMinute: state.simMinute,
      arriveMinute: state.simMinute + leg.blockMinutes + delayMinutes,
      scheduledArriveMinute: state.simMinute + leg.blockMinutes,
      fare: 0,
      marketingSpend: 0,
      isPositioning: true,
    };
    state.activeFlights.push(activeFlight);
    state.positioningLegs.splice(i, 1);
  }

  for (let i = state.activeFlights.length - 1; i >= 0; i--) {
    const flight = state.activeFlights[i];
    if (state.simMinute < flight.arriveMinute) continue;

    const aircraft = state.aircraft.find((a) => a.tail === flight.tail);
    if (aircraft) {
      aircraft.status = 'ground';
      aircraft.atAirport = flight.dest;
      aircraft.activeLegId = null;
      aircraft.groundSinceMinute = state.simMinute;

      const type = aircraftTypesByCode.get(aircraft.typeCode);
      if (type) {
        const blockMinutes = flight.arriveMinute - flight.departMinute;

        if (flight.isPositioning) {
          // No market, no passengers, no revenue — just the real fuel and
          // departure cost of moving the aircraft (sim/economy.ts's
          // legCost(), the same formula a revenue flight's cost half uses).
          const breakdown = legCostBreakdown(
            blockMinutes,
            type,
            state.fuelPriceIndex,
            state.fuelEfficiencyMultiplier,
          );
          const cost = breakdown.fuel + breakdown.blockNonFuel + breakdown.departure;
          state.cash -= cost;
          state.todayCost += cost;
          state.todayCostByCategory.fuel += breakdown.fuel;
          state.todayCostByCategory.blockNonFuel += breakdown.blockNonFuel;
          state.todayCostByCategory.departure += breakdown.departure;
          state.todayMargin -= cost;
        } else {
          const marketFrequency = legsServingMarket(flight.origin, flight.dest, state.schedule);
          const key = marketKey(flight.origin, flight.dest);
          const spilloverAvailable = state.spilloverByMarket[key] ?? 0;
          const result = flightResult(
            { origin: flight.origin, dest: flight.dest, blockMinutes },
            type,
            state.fuelPriceIndex,
            state.fuelEfficiencyMultiplier,
            actualDailyDemand(state, flight.origin, flight.dest),
            marketFrequency,
            { fare: flight.fare, marketingSpend: flight.marketingSpend },
            state.competitorRoutes,
            spilloverAvailable,
          );
          state.spilloverByMarket[key] = spilloverAvailable + result.spilloverDelta;
          state.cash += result.margin;
          state.todayRevenue += result.revenue;
          state.todayCost += result.cost;
          state.todayCostByCategory.fuel += result.costBreakdown.fuel;
          state.todayCostByCategory.blockNonFuel += result.costBreakdown.blockNonFuel;
          state.todayCostByCategory.departure += result.costBreakdown.departure;
          state.todayMargin += result.margin;
        }
      }
    }

    state.completedToday.push(flight.legId);
    state.activeFlights.splice(i, 1);
  }

  // Week six's missions (sim/missions.ts): cheap pure reads of `state`,
  // checked every tick rather than once a day so "you bought your first
  // aircraft" lands immediately instead of up to a simulated day later.
  checkMissions(state);

  state.simMinute += 1;
}
