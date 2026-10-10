import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { ENGINE_SHOP_DAYS, ENGINE_WAIT_DAYS, engineFault, enginePoolCostPerDay, returnEngines, sparesReady } from './enginePool';
import { changeSpareEngines } from './playerActions';

// Run with `npm run enginepooltest`: an engine fault with no spare waits for a
// lease engine; with one it is back in a day, the engine goes to the shop and
// rejoins the pool, and the pool costs its holding cost a day.
const state = startHeadlessGame('YYZ', 1, createPlayer('steady'));
const classCode = state.aircraft[0].typeCode;
const none = engineFault(state, classCode, 2, 0);
assert.deepEqual(none, { days: 2 + ENGINE_WAIT_DAYS, shopCost: 0 });

assert.equal(changeSpareEngines(state, 'WIDEBODY', 1).ok, false, 'held a spare for a class not in the fleet');
assert.equal(changeSpareEngines(state, classCode, 1).ok, true);
assert.ok(enginePoolCostPerDay(state) > 0);
assert.equal(sparesReady(state, classCode), 1);

const swapped = engineFault(state, classCode, 5, 0);
assert.equal(swapped.days, 1);
assert.ok(swapped.shopCost > 0);
assert.equal(sparesReady(state, classCode), 0);
assert.equal(changeSpareEngines(state, classCode, -1).ok, false, 'gave back an engine in the shop');
assert.equal(engineFault(state, classCode, 2, 0).days, 2 + ENGINE_WAIT_DAYS, 'one spare covered two faults');

returnEngines(state, ENGINE_SHOP_DAYS * 1440);
assert.equal(sparesReady(state, classCode), 1, 'engine did not rejoin the pool');
assert.equal(changeSpareEngines(state, classCode, -1).ok, true);
assert.equal(enginePoolCostPerDay(state), 0);
console.log('engine pool ok');
