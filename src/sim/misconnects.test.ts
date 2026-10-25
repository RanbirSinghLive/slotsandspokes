import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { connectingFlowsAt } from './hubs';
import { MISCONNECT_COST_PER_PASSENGER, MISCONNECT_DAYS, missedConnections, misconnectsAt, rollMisconnects, settleMisconnects } from './misconnects';
import { step } from './step';
import type { ActiveFlight, SimState } from './state';

// Run with `npm test -- misconnects`: a flight on time into a hub misses
// nothing, one very late misses its connecting passengers' onward flights,
// the airline pays to rebook them, and the hub keeps a week's count.

const player = createPlayer('steady');
const state = startHeadlessGame('PHL', 1, player);
for (let day = 1; day <= 60; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}

/** A leg in the air, landing `lateMinutes` after it should. */
const flyingLeg = (leg: (typeof state.schedule)[number], lateMinutes: number): ActiveFlight => {
  const scheduledArriveMinute = state.simMinute + leg.blockMinutes;
  return {
    legId: leg.legId,
    tail: leg.tail,
    origin: leg.origin,
    dest: leg.dest,
    departMinute: state.simMinute,
    arriveMinute: scheduledArriveMinute + lateMinutes,
    scheduledArriveMinute,
    scheduledDepartMinute: state.simMinute,
    delayByCause: { age: 0, weather: 0, knockOn: 0, congestion: 0, ground: 0 },
    delayMinutes: lateMinutes,
    fare: 100,
  };
};

// A leg into a hub whose connecting passengers are booked onward on another plane: four hours late, later than any connection's window, misses them.
const leg = state.schedule.find(
  (candidate) =>
    connectingFlowsAt(state, candidate.dest).some((flow) => flow.a === candidate.origin || flow.b === candidate.origin) &&
    missedConnections(state, flyingLeg(candidate, 240), 50).passengers > 0,
);
assert.ok(leg, 'no late leg into a hub misses a connection after 60 days');
const flying = (lateMinutes: number) => flyingLeg(leg, lateMinutes);

assert.equal(missedConnections(state, flying(0), 50).passengers, 0, 'an on-time flight misses nothing');
const late = missedConnections(state, flying(240), 50);
assert.ok(late.passengers > 0 && late.onward.length > 0, `four hours late missed nothing: ${JSON.stringify(late)}`);
assert.ok(late.passengers <= 50, 'never more than the flight carried');
assert.ok(missedConnections(state, flying(240), 2).passengers <= 2, 'capped at the flight load');

// Settling pays the rebooking, marks NPS down and counts at the hub.
const copy: SimState = structuredClone(state);
const cashBefore = copy.cash;
const npsBefore = copy.todayNpsPoints;
const missedBefore = misconnectsAt(copy, leg.dest);
settleMisconnects(copy, flying(240), 50);
assert.ok(Math.abs(cashBefore - copy.cash - late.passengers * MISCONNECT_COST_PER_PASSENGER) < 0.01, 'rebooking paid');
assert.equal(misconnectsAt(copy, leg.dest) - missedBefore, late.passengers, 'counted at the hub');
assert.equal(copy.misconnectLog?.at(-1)?.passengers, late.passengers);
assert.equal(copy.misconnectLog?.at(-1)?.lateMinutes, 240);
if (copy.todayNpsScoredFlights > 0) assert.ok(copy.todayNpsPoints < npsBefore, 'the late flight scores lower');
assert.deepEqual(JSON.parse(JSON.stringify(copy)).misconnectDaysByHub, copy.misconnectDaysByHub, 'the count survives a save');

// The week rolls: today's still counted for MISCONNECT_DAYS days, then all forgotten.
const today = copy.misconnectDaysByHub![leg.dest].at(-1)!;
for (let day = 1; day < MISCONNECT_DAYS; day++) rollMisconnects(copy);
assert.equal(misconnectsAt(copy, leg.dest), today, 'still in the week');
rollMisconnects(copy);
assert.equal(misconnectsAt(copy, leg.dest), 0, 'gone after a week');
assert.equal(copy.misconnectDaysByHub?.[leg.dest], undefined);

console.log(`misconnects ok: ${leg.origin}→${leg.dest} 4h late misses ${late.passengers} pax to ${late.onward.join(', ')}`);
