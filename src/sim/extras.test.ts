import assert from 'node:assert/strict';
import { chooseHome } from './homes';
import { createNewGameState } from './state';
import {
  ancillaryNpsPenalty,
  ancillaryPerPassenger,
  ancillaryPriceDrag,
  extraBlockedReason,
  rollAncillaries,
  setAncillaryLevel,
  setExtra,
} from './ancillaries';

// Run with `npm run extrastest`: extras need online booking, add revenue,
// price drag and NPS cost, paid seats add nothing at level 2, and rivals copy.
const state = createNewGameState(7);
chooseHome(state, 'YYZ');
const [a, b] = ['YYZ', 'YUL'];

assert.equal(extraBlockedReason(state, 'seats'), 'Needs online booking.');
assert.equal(setExtra(state, 'seats', true).ok, false);

state.adoptedInnovations = ['online-booking'];
const before = { fee: ancillaryPerPassenger(state, a, b), nps: ancillaryNpsPenalty(state, a, b) };
assert.equal(before.fee, 0);
assert.ok(setExtra(state, 'seats', true).ok);
assert.ok(ancillaryPerPassenger(state, a, b) > 0, 'seats earn');
assert.ok(ancillaryNpsPenalty(state, a, b) > 0, 'seats cost NPS');
assert.ok(ancillaryPriceDrag(state, a, b).leisure > ancillaryPriceDrag(state, a, b).business, 'leisure feels seat fees most');
assert.equal(setExtra(state, 'seats', false).ok, false, 'locked after a switch');

const seatsOnly = ancillaryPerPassenger(state, a, b);
setAncillaryLevel(state, 2);
assert.ok(ancillaryPerPassenger(state, a, b) > 0);
state.extras = ['seats'];
const atLevel2 = ancillaryPerPassenger(state, a, b);
state.extras = [];
assert.equal(atLevel2, ancillaryPerPassenger(state, a, b), 'seats add nothing at level 2');
assert.ok(seatsOnly > 0);

state.ancillaryLevel = 0;
state.extras = ['priority'];
const first = ancillaryNpsPenalty(state, a, b);
for (let day = 0; day < 300; day++) rollAncillaries(state);
assert.ok(ancillaryNpsPenalty(state, a, b) < first, 'rival copy eases the NPS cost');
assert.ok(ancillaryNpsPenalty(state, a, b) > first / 2 - 1e-9, 'half is permanent');

const reloaded = JSON.parse(JSON.stringify(state));
assert.deepEqual(reloaded.extras, state.extras);
console.log('extras ok');
