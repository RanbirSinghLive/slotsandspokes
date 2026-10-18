import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { toleranceHeavyCheck } from './playerActions';
import { heavyCheckDueIn, heavyToleranceCost, finishHeavyCheck, toleranceCapDays, toleranceWearYears, TOLERANCE_BASE_CAP_DAYS } from './mxChecks';
import { wornAge } from './mxChecks';
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

aircraft.daysSinceHeavyCheck = 86;
const before = heavyCheckDueIn(aircraft);
const cash = state.cash;
const fee = heavyToleranceCost(state, aircraft, 5);
assert.ok(fee > 0);
assert.equal(toleranceHeavyCheck(state, aircraft.tail, 5).ok, true);
assert.equal(heavyCheckDueIn(aircraft), before + 5);
assert.equal(state.cash, cash - fee);
assert.equal(toleranceHeavyCheck(state, aircraft.tail, 15).ok, false, 'went past the cap');
assert.ok(heavyToleranceCost(state, aircraft, 5) > fee, 'a second push cost no more than the first');
assert.ok(toleranceCapDays(state, aircraft) >= TOLERANCE_BASE_CAP_DAYS);
assert.equal(toleranceWearYears(aircraft), 0, 'wore before the unpushed due date');
assert.equal(toleranceHeavyCheck(state, aircraft.tail, 7).ok, false, 'took an unlisted step');

aircraft.daysSinceHeavyCheck = 92;
const wear = toleranceWearYears(aircraft);
assert.ok(wear > 0, 'a pushed check past its unpushed due date did not wear');
const worn = wornAge(aircraft);
aircraft.heavyShiftDays = 0;
assert.equal(wornAge(aircraft), worn - wear, 'wear stayed after the push ended');
aircraft.heavyShiftDays = 5;
aircraft.daysSinceHeavyCheck = 86;
const baseCap = toleranceCapDays(state, aircraft);
state.executives.dom = { candidateId: 'dom-bakare', hiredAtMinute: 0 };
assert.ok(heavyToleranceCost(state, aircraft, 5) < fee, 'the Director of Maintenance did not cut the fee');
assert.ok(toleranceCapDays(state, aircraft) > baseCap, 'the Director of Maintenance did not raise the cap');

finishHeavyCheck(state, aircraft);
assert.equal(aircraft.heavyShiftDays, undefined);
console.log('tolerance ok');
