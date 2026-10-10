import assert from 'node:assert/strict';
import {
  appointBlockedReason,
  appointExecutive,
  candidateById,
  chairOpensAt,
  executiveCargoMultiplier,
  executiveCrewTrainingMultiplier,
  executiveEventPenaltyMultiplier,
  executiveEventPremiumMultiplier,
  executiveMaintenanceBaseMultiplier,
  loadExecutives,
} from './executives';
import { chooseHome } from './homes';
import { crewTrainingTimeFactor } from './innovations';
import { LADDER } from './ladder';
import { createNewGameState } from './state';

// Run with `npm run executivetest`: chairs open as the airline climbs the
// ladder, a hire needs the tier its candidate asks for, and each new
// chair's effect reaches the system it names.
function newState() {
  const state = createNewGameState(1, 'YUL');
  chooseHome(state, 'YUL', 'summer', 'medium');
  state.cash = 10_000_000;
  return state;
}

// Every candidate's tier exists, and ids are unique.
const everyone = loadExecutives();
assert.equal(new Set(everyone.map((candidate) => candidate.id)).size, everyone.length);
for (const candidate of everyone) {
  if (candidate.requiresTier) assert.ok(LADDER.some((tier) => tier.id === candidate.requiresTier), candidate.id);
}

// A new airline sees the chief pilot's chair locked until it becomes a regional carrier.
{
  const state = newState();
  assert.equal(chairOpensAt(state, 'cpo'), 'Regional carrier');
  assert.equal(chairOpensAt(state, 'coo'), null);
  assert.match(appointBlockedReason(state, candidateById('cpo-solheim')!) ?? '', /Needs Regional carrier/);
  assert.equal(appointExecutive(state, 'cpo-solheim').ok, false);
  // The same hire works once the tier is climbed.
  state.milestonesMet = Object.fromEntries(LADDER[0].milestones.filter((milestone) => !milestone.extra).map((milestone) => [milestone.id, 0]));
  assert.equal(chairOpensAt(state, 'cpo'), null);
  assert.equal(appointExecutive(state, 'cpo-solheim').ok, true);
  assert.equal(executiveCrewTrainingMultiplier(state), 0.75);
  assert.equal(crewTrainingTimeFactor(state), 0.75);
}

// A save from before the new chairs has no slots for them, and nothing breaks.
{
  const state = newState();
  delete (state.executives as Partial<typeof state.executives>).hoc;
  assert.equal(executiveCargoMultiplier(state), 1);
  assert.equal(chairOpensAt(state, 'hoc'), 'International');
}

// Each new chair's effect reads as its multiplier once seated.
{
  const state = newState();
  const seat = (id: string) => {
    const candidate = candidateById(id)!;
    state.executives[candidate.role] = { candidateId: id, hiredAtMinute: 0 };
  };
  seat('dom-bakare');
  seat('hoc-lindahl');
  seat('hga-eze');
  assert.equal(executiveMaintenanceBaseMultiplier(state), 0.7);
  assert.equal(executiveCargoMultiplier(state), 1.25);
  assert.equal(executiveEventPremiumMultiplier(state), 1.5);
  assert.equal(executiveEventPenaltyMultiplier(state), 0.6);
}

console.log('executive tests passed');
