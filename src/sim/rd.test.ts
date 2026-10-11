import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { isAdopted } from './innovations';
import { RD_BUDGETS, researchDay, researchSpeed, setRdBudget, startResearch } from './rd';
import { buildCharger, CHARGER_FEE, ELECTRIC_FUEL_FACTOR, HYBRID_FUEL_FACTOR, powertrainFuelFactor } from './powertrain';
import { planeOptions } from './playerActions';
import { LADDER } from './ladder';

// Run with `npm run rdtest`: research costs money by the day, locked projects
// refuse, the electric path goes step by step with bridge steps doing nothing,
// good on-time days speed it up, and chargers gate electric planes.
const state = startHeadlessGame('YYZ', 1, createPlayer('steady'));
state.cash = 50_000_000;

assert.equal(startResearch(state, 'electric-25').ok, false, 'started a step whose predecessor is not done');
assert.equal(startResearch(state, 'hybrid-retrofit').ok, false);

// The electric path opens with the regional tier: mark every milestone met so the ladder lets the test in.
state.milestonesMet = Object.fromEntries(LADDER.flatMap((tier) => tier.milestones.map((milestone) => [milestone.id, 1])));

// Speed follows on-time share.
state.todayFlightsArrived = 100;
state.todayFlightsOnTime = 95;
const fast = researchSpeed(state);
state.todayFlightsOnTime = 40;
const slow = researchSpeed(state);
assert.ok(fast > 1 && slow < 1 && slow >= 0.75 && fast <= 1.5, 'on-time share did not scale speed');

assert.equal(setRdBudget(state, RD_BUDGETS.length).ok, false);
assert.equal(setRdBudget(state, 2).ok, true);
assert.equal(researchDay(state), 0, 'spent with nothing active');

// A day of research spends the budget, scaled into points by on-time speed.
state.todayFlightsOnTime = 75;
assert.equal(startResearch(state, 'efficiency-study').ok, true);
const cashBefore = state.cash;
const spent = researchDay(state);
assert.equal(spent, RD_BUDGETS[2]);
state.cash = cashBefore - spent;
assert.equal(state.rd!.points['efficiency-study'], RD_BUDGETS[2], 'normal on-time share should buy one point a dollar');
assert.equal(startResearch(state, 'hybrid-certification').ok, false, 'skipped a step');
// Run it to the end: the next step follows by itself.
let days = 0;
while (!isAdopted(state, 'efficiency-study') && days++ < 200) researchDay(state);
assert.ok(isAdopted(state, 'efficiency-study'), 'step never finished');
assert.equal(state.rd!.active, 'hybrid-certification', 'chain did not move to its next step');
// Without cash for the day, nothing is spent.
state.cash = 100;
assert.equal(researchDay(state), 0);
state.cash = 50_000_000;

assert.equal(powertrainFuelFactor({}), 1);
assert.equal(powertrainFuelFactor({ powertrain: 'hybrid' }), HYBRID_FUEL_FACTOR);
assert.equal(powertrainFuelFactor({ powertrain: 'electric' }), ELECTRIC_FUEL_FACTOR);

// Finish the whole chain by giving the shop its points directly, then check what unlocks.
state.adoptedInnovations = ['efficiency-study', 'hybrid-certification'];
state.rd!.active = null;
assert.equal(isAdopted(state, 'hybrid-retrofit'), false, 'bridge steps changed the fleet by themselves');
assert.equal(buildCharger(state, 'YYZ').ok, false, 'charger built before the research');
state.adoptedInnovations.push('hybrid-retrofit', 'charging-tech');
assert.equal(buildCharger(state, 'YYZ').ok, true);
assert.equal(state.cash, 50_000_000 - CHARGER_FEE);
assert.equal(buildCharger(state, 'YYZ').ok, false, 'charger built twice');
assert.ok(!planeOptions(state, 'YYZ').some((o) => o.powertrain === 'electric'), 'electric on the menu before research');
state.adoptedInnovations.push('electric-25');
const electric = planeOptions(state, 'YYZ').find((o) => o.powertrain === 'electric');
assert.ok(electric, 'electric missing after research');
assert.ok(planeOptions(state, 'YYZ').some((o) => o.code === 'PROP' && o.powertrain === 'hybrid'), 'propeller not hybrid after hybrid research');
console.log('rd ok');
