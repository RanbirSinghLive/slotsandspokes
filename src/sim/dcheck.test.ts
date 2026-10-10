import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { bookDCheck, cancelBookedDCheck } from './playerActions';
import { D_WEAR_YEARS, dCheckDueIn, previewDCheckBooking, wornAge } from './mxChecks';
import { step } from './step';

// Run with `npm run dchecktest`: a D check can't be booked before its window,
// a cancelled booking leaves the plane flying, a booked one grounds it for the
// whole overhaul and resets the clock, and a plane past due wears.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
for (let day = 1; day <= 12; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}
const aircraft = state.aircraft.find((a) => a.status === 'ground' && a.atAirport === a.baseAirport && !state.aogs.some((e) => e.tail === a.tail))!;
assert.ok(aircraft, 'no parked plane to test with');

aircraft.daysSinceD = 0;
assert.equal(bookDCheck(state, aircraft.tail).ok, false, 'booked before the window opened');

aircraft.daysSinceD = 320;
assert.ok(previewDCheckBooking(state, aircraft.tail), 'no preview inside the window');
const age = wornAge(aircraft);
aircraft.daysSinceD = 365;
assert.equal(wornAge(aircraft), age + D_WEAR_YEARS, 'overdue plane did not wear');
aircraft.daysSinceD = 320;
assert.equal(bookDCheck(state, aircraft.tail).ok, true);
assert.equal(bookDCheck(state, aircraft.tail).ok, false, 'booked twice');
cancelBookedDCheck(state, aircraft.tail);
assert.equal(aircraft.dCheckBooked, undefined);

assert.equal(bookDCheck(state, aircraft.tail).ok, true);
for (let minute = 0; minute < 3 * 1440 && !state.aogs.some((e) => e.tail === aircraft.tail); minute++) step(state);
const event = state.aogs.find((e) => e.tail === aircraft.tail);
assert.ok(event?.check && event.checkKind === 'D', 'booked plane did not go into its D check');
assert.equal(event.fault, 'D check booked');
assert.equal(aircraft.dCheckBooked, undefined);
for (let minute = 0; minute < 30 * 1440 && state.aogs.some((e) => e.tail === aircraft.tail); minute++) step(state);
assert.ok(!state.aogs.some((e) => e.tail === aircraft.tail), 'D check never finished');
assert.ok(dCheckDueIn(aircraft) > 300, 'D clock did not reset');
console.log('d check ok');
