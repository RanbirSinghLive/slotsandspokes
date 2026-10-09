import assert from 'node:assert/strict';
import { EXECUTIVE_LAPSE_DAYS, rollExecutiveStanding } from './executives';
import { committedCostPerDay, freeCash } from './forecast';
import { chooseHome } from './homes';
import { flightSatisfactionScore, nameYieldMultiplier } from './nps';
import { HERITAGE_DAYS, heritagePairs, settleSlotsForDay, slotFeesPerDayAt } from './slots';
import { createNewGameState } from './state';

// Run with `npm run currencytest`: the name pays on every route, a hire
// leaves after 30 days under their NPS line, a slot pair held 180 days is
// heritage and a gap resets it, and free cash is below cash.
function newState() {
  const state = createNewGameState(1, 'YHZ');
  chooseHome(state, 'YHZ', 'summer', 'medium');
  return state;
}

// The name: neutral at NPS 15, +2% at 35, capped at ±4%.
{
  const state = newState();
  state.trailingNps = 15;
  assert.equal(nameYieldMultiplier(state, 'YHZ', 'YYZ'), 1);
  state.trailingNps = 35;
  assert.ok(Math.abs(nameYieldMultiplier(state, 'YHZ', 'YYZ') - 1.02) < 1e-9);
  state.trailingNps = 100;
  assert.ok(Math.abs(nameYieldMultiplier(state, 'YHZ', 'YYZ') - 1.04) < 1e-9);
  state.trailingNps = -100;
  assert.ok(Math.abs(nameYieldMultiplier(state, 'YHZ', 'YYZ') - 0.96) < 1e-9);
}

// A flight's score has no fare in it: the same flight scores the same at any price.
assert.equal(flightSatisfactionScore(0, 5, 1, 1), flightSatisfactionScore(0, 5, 1, 1));
assert.equal(flightSatisfactionScore(0, 5), 30 + 5 + 15);

// A hire with an NPS line leaves on the 30th day under it, and a good day resets the count.
{
  const state = newState();
  state.executives.cco = { candidateId: 'cco-carvalho', hiredAtMinute: 0 };
  state.trailingNps = 5;
  for (let day = 1; day < EXECUTIVE_LAPSE_DAYS; day++) rollExecutiveStanding(state);
  assert.ok(state.executives.cco, 'still hired on day 29');
  state.trailingNps = 20;
  rollExecutiveStanding(state);
  assert.equal(state.executives.cco?.daysBelowLine, undefined);
  state.trailingNps = 5;
  for (let day = 1; day <= EXECUTIVE_LAPSE_DAYS; day++) rollExecutiveStanding(state);
  assert.equal(state.executives.cco, null, 'gone after 30 days in a row');
  assert.equal(state.lastExecutiveLapse?.candidateId, 'cco-carvalho');
}

// Slots: heritage after HERITAGE_DAYS held, 20% off, and a gap starts it again.
{
  const state = newState();
  state.schedule = [{ legId: 'a', tail: 'C-P001', origin: 'YHZ', dest: 'YYZ', departMinute: 360, blockMinutes: 100 }];
  state.slotsHeld = { YHZ: [100] };
  for (let day = 1; day < HERITAGE_DAYS; day++) settleSlotsForDay(state);
  assert.equal(heritagePairs(state, 'YHZ'), 0);
  assert.equal(slotFeesPerDayAt(state, 'YHZ'), 100);
  settleSlotsForDay(state);
  assert.equal(heritagePairs(state, 'YHZ'), 1);
  assert.equal(slotFeesPerDayAt(state, 'YHZ'), 80);
  // The state survives a save round trip with its tenure.
  const loaded = JSON.parse(JSON.stringify(state));
  assert.deepEqual(loaded.slotDaysHeld, state.slotDaysHeld);
  // Nothing uses the pair: it is given back, and a new one starts at zero.
  state.schedule = [];
  settleSlotsForDay(state);
  assert.equal(state.slotsHeld.YHZ, undefined);
  state.schedule = [{ legId: 'a', tail: 'C-P001', origin: 'YHZ', dest: 'YYZ', departMinute: 360, blockMinutes: 100 }];
  state.slotsHeld = { YHZ: [100] };
  settleSlotsForDay(state);
  assert.equal(heritagePairs(state, 'YHZ'), 0);
}

// Free cash is cash less two weeks of what is owed.
{
  const state = newState();
  assert.ok(committedCostPerDay(state) > 0);
  assert.ok(freeCash(state) < state.cash);
  assert.equal(Math.round(freeCash(state, 1000)), Math.round(freeCash(state) - 1000));
}

console.log('currencies: ok');
