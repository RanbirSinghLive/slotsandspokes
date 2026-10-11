import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { toleranceHeavyCheck } from './playerActions';
import { heavyCheckDueIn, heavyToleranceCost, finishHeavyCheck } from './mxChecks';
import { step } from './step';

// Run with `npm run tolerancetest`: a C check can only be pushed later
// inside its window, each push costs its fee, the total is capped, and
// the push is gone once the check is done.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
for (let minute = 0; minute < 1440; minute++) step(state);
const aircraft = state.aircraft[0];
state.cash = 1_000_000;

aircraft.daysSinceHeavyCheck = 0;
assert.equal(toleranceHeavyCheck(state, aircraft.tail, 5).ok, false, 'pushed before the window opened');

aircraft.daysSinceHeavyCheck = 26;
const before = heavyCheckDueIn(aircraft);
const cash = state.cash;
const fee = heavyToleranceCost(state, aircraft, 5);
assert.ok(fee > 0);
assert.equal(toleranceHeavyCheck(state, aircraft.tail, 5).ok, true);
assert.equal(heavyCheckDueIn(aircraft), before + 5);
assert.equal(state.cash, cash - fee);
assert.equal(toleranceHeavyCheck(state, aircraft.tail, 15).ok, false, 'went past the cap');
assert.equal(toleranceHeavyCheck(state, aircraft.tail, 7).ok, false, 'took an unlisted step');

state.executives.dom = { candidateId: 'dom-bakare', hiredAtMinute: 0 };
assert.ok(heavyToleranceCost(state, aircraft, 5) < fee, 'the Director of Maintenance did not cut the fee');

finishHeavyCheck(state, aircraft);
assert.equal(aircraft.heavyShiftDays, undefined);
console.log('tolerance ok');
