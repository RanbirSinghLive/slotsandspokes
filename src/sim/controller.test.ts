import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { dayStartMinute } from './clock';
import { cancelRotation, cancellableRotations, previewCancelRotation } from './controller';
import { step } from './step';
import { rotationsForTail } from './utilisation';

// Run with `npm run controllertest`: cancelling a rotation of a plane that
// is running late spares the rest of its day, counts as a cancellation
// under its own cause, and can't be done twice.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
for (let day = 1; day <= 40; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}

const tail = state.aircraft.map((a) => a.tail).find((t) => rotationsForTail(state, t).length >= 2);
assert.ok(tail, 'no plane with two rotations to test with');

// Midday with nothing flown: the plane has been waiting at base for hours,
// so its whole day is late and the curfew would take its last rotation.
const aircraft = state.aircraft.find((a) => a.tail === tail)!;
const rotations = rotationsForTail(state, tail);
state.simMinute = dayStartMinute(state) + 12 * 60;
state.completedToday = [];
state.cancelledToday = [];
state.activeFlights = [];
aircraft.status = 'ground';
aircraft.atAirport = rotations[0].legs[0].origin;
aircraft.groundSinceMinute = state.simMinute - 60;

const cancellable = cancellableRotations(state, tail);
assert.equal(cancellable.length, rotations.length, 'every unstarted rotation should be cancellable');

const first = rotations[0].legs[0].legId;
const preview = previewCancelRotation(state, first);
assert.ok(preview.ok, 'preview refused: ' + (preview.ok ? '' : preview.reason));
if (preview.ok) {
  assert.ok(preview.lateMinutesAfter <= preview.lateMinutesBefore, 'cancelling made the rest of the day later');
  assert.equal(preview.flightsCancelled, rotations[0].legs.length);
}

const before = state.flightsCancelledTotal;
const done = cancelRotation(state, first);
assert.ok(done.ok, 'cancel refused');
assert.equal(state.flightsCancelledTotal - before, rotations[0].legs.length);
assert.equal(state.cancellationsByCause.controller, rotations[0].legs.length);
assert.ok(rotations[0].legs.every((leg) => state.cancelledToday.includes(leg.legId)));
assert.equal(cancelRotation(state, first).ok, false, 'a rotation can only be cancelled once');

aircraft.status = 'airborne';
assert.equal(cancellableRotations(state, tail).length, 0, 'a plane in the air has nothing to cancel');
console.log('controller cancel: ok');
