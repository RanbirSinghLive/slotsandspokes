import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { bookHeavyCheck, cancelBookedCheck } from './playerActions';
import { previewHeavyCheckBooking } from './mxChecks';
import { step } from './step';

// Run with `npm run checkbookingtest`: a booked C check can't be taken
// before its window opens, grounds the plane for the check the next
// morning, and a cancelled booking leaves it flying.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
for (let day = 1; day <= 12; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}
const aircraft = state.aircraft.find((a) => a.status === 'ground' && a.atAirport === a.baseAirport && !state.aogs.some((e) => e.tail === a.tail))!;
assert.ok(aircraft, 'no parked plane to test with');

aircraft.daysSinceHeavyCheck = 0;
assert.equal(bookHeavyCheck(state, aircraft.tail).ok, false, 'booked before the window opened');

aircraft.daysSinceHeavyCheck = 24;
assert.ok(previewHeavyCheckBooking(state, aircraft.tail), 'no preview inside the window');
assert.equal(bookHeavyCheck(state, aircraft.tail).ok, true);
assert.equal(bookHeavyCheck(state, aircraft.tail).ok, false, 'booked twice');
cancelBookedCheck(state, aircraft.tail);
assert.equal(aircraft.heavyCheckBooked, undefined);

assert.equal(bookHeavyCheck(state, aircraft.tail).ok, true);
for (let minute = 0; minute < 3 * 1440 && !state.aogs.some((e) => e.tail === aircraft.tail); minute++) step(state);
const event = state.aogs.find((e) => e.tail === aircraft.tail);
assert.ok(event?.check, 'booked plane did not go into its check');
assert.equal(event.fault, 'C check booked');
assert.equal(aircraft.heavyCheckBooked, undefined);
console.log('check booking ok');
