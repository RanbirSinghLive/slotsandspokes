import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { nightStopStation } from './nightStops';
import { applyPendingRetimes, commitRetime } from './retime';
import { step } from './step';
import { rotationsForTail } from './utilisation';

// Run with `npm run overnighttest`: a round trip whose return leg lands after
// midnight flies every day. Landing was once recorded against the new day, so
// that day's own departure of the same leg counted as already flown and the
// plane flew about one round trip every two and a half days.
const state = startHeadlessGame('YYZ', 4, createPlayer('bold'));
const aircraft = state.aircraft[0];
const base = aircraft.baseAirport!;
const other = state.schedule.find((leg) => leg.tail === aircraft.tail && leg.dest !== base)?.dest ?? state.schedule[0].dest;

// Two 9 hour legs: out 06:00, back 15:30, landing 00:30 the next day.
state.schedule = [
  { legId: 'T-1', tail: aircraft.tail, origin: base, dest: other, departMinute: 360, blockMinutes: 540 },
  { legId: 'T-2', tail: aircraft.tail, origin: other, dest: base, departMinute: 930, blockMinutes: 540 },
] as typeof state.schedule;

let departures = 0;
let airborne = false;
const days = 12;
for (let minute = 0; minute < 1440 * days; minute++) {
  step(state);
  const flying = state.activeFlights.some((flight) => flight.tail === aircraft.tail);
  if (flying && !airborne) departures++;
  airborne = flying;
}
// Two legs a day for 12 days is 24; allow for weather and breakdowns, but a plane losing every other day would sit near 10.
assert.ok(departures >= 18, `a daily round trip over midnight flew only ${departures} legs in ${days} days`);
console.log(`ok: ${departures} legs in ${days} days`);

// The same round trip moved to leave at 18:00: the flight back is stored as 03:30, a night stop's shape, but it is one rotation and no night stop.
const evening = startHeadlessGame('YYZ', 4, createPlayer('bold'));
const plane = evening.aircraft[0];
evening.schedule = [
  { legId: 'E-1', tail: plane.tail, origin: base, dest: other, departMinute: 360, blockMinutes: 540 },
  { legId: 'E-2', tail: plane.tail, origin: other, dest: base, departMinute: 930, blockMinutes: 540 },
] as typeof evening.schedule;
const moved = commitRetime(evening, ['E-1', 'E-2'], plane.tail, 18 * 60, { forceDeferred: true });
assert.ok(moved.ok, moved.ok ? '' : moved.reason);
applyPendingRetimes(evening);
const [back, out] = evening.schedule.filter((leg) => leg.tail === plane.tail).sort((a, b) => a.departMinute - b.departMinute);
assert.equal(out.departMinute, 18 * 60);
assert.equal(back.departMinute, 18 * 60 + 540 + 30 - 24 * 60, 'flight back is stored a day earlier');
assert.equal(nightStopStation(evening, plane.tail), null);
const rotations = rotationsForTail(evening, plane.tail);
assert.equal(rotations.length, 1);
assert.equal(rotations[0].legs[0].legId, 'E-1');
assert.ok(rotations[0].arriveMinute > 24 * 60);

let eveningDepartures = 0;
let eveningAirborne = false;
for (let minute = 0; minute < 1440 * days; minute++) {
  step(evening);
  const flying = evening.activeFlights.some((flight) => flight.tail === plane.tail);
  if (flying && !eveningAirborne) eveningDepartures++;
  eveningAirborne = flying;
}
assert.ok(eveningDepartures >= 18, `an evening round trip flew only ${eveningDepartures} legs in ${days} days`);
console.log(`ok: evening start ${eveningDepartures} legs in ${days} days`);
