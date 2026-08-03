import aircraftTypesData from '../../data/aircraft-types.json';
import { flightResult, type EconomyAircraftType } from './economy';
import { MIN_TURN_MINUTES, legsServingMarket, marketKey } from './schedule';
import { rollDailyWeather, isAirportClosed } from './weather';
import { routeConnectivityMultiplier } from './airports';
import { rollTotalDelayMinutes } from './delays';
import { rollCompetitorRouteOpenings } from './competitors';
import { rollDailyFuelPrice } from './fuel';
import { rollDailyMarketDemand, actualDailyDemand } from './marketDemand';
import { checkMissions } from './missions';
import { rollDailyCrew, rollDailyMechanicalGroundings, maintenanceAgeFactor, cabinServiceShare } from './crew';
import {
  payExecutiveBonuses,
  executiveDelayMultiplier,
  executiveNpsBonus,
  executiveMaintenanceMultiplier,
  executiveFreeMarketing,
} from './executives';
import { CANCELLATION_NPS_SCORE } from './nps';
import { resolveTargetIfDue } from './targets';
import { applyDailyLoanInterest } from './loans';
import { flightSatisfactionScore } from './nps';
import { applyDailyReputationChange, REPUTATION_FLOOR } from './reputation';
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
    // A CCO covers the first slice of the marketing bill (sim/executives.ts).
    // The *spend* still counts in full toward stimulation and booking
    // share — the airline is still doing the marketing, it just isn't
    // paying for all of it — so only the charge is reduced.
    const chargedMarketing = Math.max(0, totalMarketingSpend - executiveFreeMarketing(state));
    state.cash -= chargedMarketing;
    state.todayCost += chargedMarketing;
    state.todayCostByCategory.marketing += chargedMarketing;
    state.todayMargin -= chargedMarketing;

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
    // Rolled after the crew pass so a tail already grounded for crew
    // isn't grounded twice and counted under two causes.
    rollDailyMechanicalGroundings(state);

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
        : state.mechanicalGroundedTails.includes(leg.tail)
          ? 'mechanical'
          : isAirportClosed(state, leg.origin)
            ? 'weather'
            : null;
      if (cause === null) continue;

      state.cancellationsByCause[cause] += 1;
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
    // Cancelled at rollover for one of the three causes above, so it
    // simply never departs.
    if (state.groundedTails.includes(leg.tail)) continue;
    if (state.mechanicalGroundedTails.includes(leg.tail)) continue;
    if (isAirportClosed(state, leg.origin)) continue;
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
      maintenanceAgeFactor(state) * executiveMaintenanceMultiplier(state),
    );
    state.rngSeed = nextSeed;
    state.delayMinutesByCause.age += delayBreakdown.age;
    state.delayMinutesByCause.weather += delayBreakdown.weather;
    state.delayMinutesByCause.knockOn += delayBreakdown.knockOn;
    // A flight-ops COO scales the whole rolled delay down. Applied to
    // the summed total rather than to each cause, so the per-cause
    // attribution the On-Time panel reports stays the raw picture of
    // *why* flights run late, with the executive's effect visible as the
    // gap between that and what actually happened.
    const delayMinutes = Math.round(
      (delayBreakdown.age + delayBreakdown.weather + delayBreakdown.knockOn) * executiveDelayMultiplier(state),
    );

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
      // Locked in at departure — see ActiveFlight's note on why these
      // aren't re-read from state.routeSettings at arrival.
      fare: routeSettings.fare,
      marketingSpend: routeSettings.marketingSpend,
    };
    state.activeFlights.push(activeFlight);
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

        {
          const marketFrequency = legsServingMarket(flight.origin, flight.dest, state.schedule);
          const key = marketKey(flight.origin, flight.dest);
          const spilloverAvailable = state.spilloverByMarket[key] ?? 0;
          const result = flightResult(
            { origin: flight.origin, dest: flight.dest, blockMinutes },
            type,
            state.fuelPriceIndex,
            state.fuelEfficiencyMultiplier,
            actualDailyDemand(state, flight.origin, flight.dest),
            routeConnectivityMultiplier(state, flight.origin, flight.dest),
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
