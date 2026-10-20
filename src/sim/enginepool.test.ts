import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { ENGINE_SHOP_DAYS, ENGINE_WAIT_DAYS, engineBook, engineFault, enginePoolCostPerDay, engineSupport, pbhPerHour, powerByHourFee, rollEngineDay, sparesHeld, sparesReady } from './enginePool';
import { changeSpareEngines, engineReadouts, setEngineSupport } from './playerActions';

// Run with `npm run enginepooltest`: engine support by class. Ad hoc waits for
// a lease engine; own spares are back in a day while the engine goes to the
// shop and rejoins the pool, at a holding cost a day; power by the hour is
// back in a day for a fee per flight hour. Each plan keeps a book.
const state = startHeadlessGame('YYZ', 1, createPlayer('steady'));
const classCode = state.aircraft[0].typeCode;
delete state.enginePool;
assert.equal(engineSupport(state, classCode), 'adhoc', 'a new class starts ad hoc');
const none = engineFault(state, classCode, 2, 0, 1000);
assert.deepEqual(none, { days: 2 + ENGINE_WAIT_DAYS, shopCost: 0 });
assert.equal(engineBook(state, classCode)?.daysWaited, ENGINE_WAIT_DAYS);
assert.equal(engineBook(state, classCode)?.lostValue, ENGINE_WAIT_DAYS * 1000);

// Own spares.
assert.equal(changeSpareEngines(state, classCode, 1).ok, false, 'a spare for a class not on own spares');
assert.equal(setEngineSupport(state, 'WIDEBODY', 'pool').ok, false, 'a plan for a class not in the fleet');
assert.equal(setEngineSupport(state, classCode, 'pool').ok, true);
assert.equal(sparesHeld(state, classCode), 1, 'own spares starts with one');
assert.equal(engineBook(state, classCode)?.faults, 0, 'a new plan starts a new book');
assert.ok(enginePoolCostPerDay(state) > 0);

const swapped = engineFault(state, classCode, 5, 0, 1000);
assert.equal(swapped.days, 1);
assert.ok(swapped.shopCost > 0);
assert.equal(sparesReady(state, classCode), 0);
assert.equal(engineBook(state, classCode)?.daysSaved, 5 + ENGINE_WAIT_DAYS - 1);
assert.equal(changeSpareEngines(state, classCode, -1).ok, false, 'gave back an engine in the shop');
assert.equal(engineFault(state, classCode, 2, 0).days, 2 + ENGINE_WAIT_DAYS, 'one spare covered two faults');

rollEngineDay(state, ENGINE_SHOP_DAYS * 1440);
assert.equal(sparesReady(state, classCode), 1, 'engine did not rejoin the pool');
assert.equal(changeSpareEngines(state, classCode, -1).ok, true);
assert.equal(enginePoolCostPerDay(state), 0);
assert.equal(engineSupport(state, classCode), 'pool', 'giving back the last spare keeps the plan');

// Power by the hour: back in a day, no shop bill, paid by the hour flown.
assert.equal(powerByHourFee(state, classCode, 120), 0, 'no fee off the plan');
setEngineSupport(state, classCode, 'pbh');
assert.equal(powerByHourFee(state, classCode, 120), 2 * pbhPerHour(classCode));
assert.deepEqual(engineFault(state, classCode, 3, 0), { days: 1, shopCost: 0 });
assert.equal(engineBook(state, classCode)?.spent, 2 * pbhPerHour(classCode));

// Leaving own spares with one in the shop gives it back when it's done.
setEngineSupport(state, classCode, 'pool');
engineFault(state, classCode, 1, 0);
setEngineSupport(state, classCode, 'adhoc');
assert.equal(sparesHeld(state, classCode), 1, 'the one in the shop is still paid for');
rollEngineDay(state, ENGINE_SHOP_DAYS * 1440);
assert.equal(sparesHeld(state, classCode), 0, 'given back once out of the shop');

const readout = engineReadouts(state).find((entry) => entry.classCode === classCode)!;
assert.equal(readout.plan, 'adhoc');
assert.ok(readout.hoursPerDay > 0 && readout.faultsPerYear > 0);
assert.ok(JSON.parse(JSON.stringify(state.enginePool)), 'the pool survives a save');
console.log('engine support ok');
