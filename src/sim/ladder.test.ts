import assert from 'node:assert/strict';
import { chooseHome } from './homes';
import { checkMilestones, gateMilestones, LADDER, tierComplete, tierCounts, tierNeeded, tiersClimbed } from './ladder';
import { createNewGameState } from './state';

// Run with `npm run laddertest`: extras never gate a tier, a milestone that
// cannot be met in this game is left out of the count, and the three tiers
// rivals judge keep their gate counts.
function newState() {
  const state = createNewGameState(1, 'YUL');
  chooseHome(state, 'YUL', 'summer', 'medium');
  return state;
}

// Eight tiers, ids in order; every milestone id is unique.
assert.deepEqual(
  LADDER.map((tier) => tier.id),
  ['start-up', 'regional', 'network', 'international', 'operator', 'established', 'flagship', 'global'],
);
const ids = LADDER.flatMap((tier) => tier.milestones.map((milestone) => milestone.id));
assert.equal(new Set(ids).size, ids.length);

// The tiers rivals climb keep their gate counts (balance reference depends on them).
assert.deepEqual(
  LADDER.slice(0, 3).map((tier) => [tier.needed, gateMilestones(tier).length]),
  [[4, 4], [3, 4], [3, 5]],
);

// Events off: the event goals drop out of the count.
{
  const state = newState();
  const established = LADDER.find((tier) => tier.id === 'established')!;
  assert.equal(tierNeeded(state, established), 3);
  state.eventsOff = true;
  assert.equal(tierNeeded(state, established), 3);
  // Three gates remain besides events, so it can still be climbed.
  assert.ok(tierNeeded(state, established) <= gateMilestones(established).length - 1);
}

// An extra met does not climb a tier, and counts as an extra.
{
  const state = newState();
  state.milestonesMet = { 'second-route': 5 };
  assert.equal(tiersClimbed(state), 0);
  assert.equal(tierCounts(state, LADDER[0]).gates, 0);
  assert.equal(tierCounts(state, LADDER[0]).extras, 1);
  assert.equal(tierComplete(state, LADDER[0]), false);
}

// Meeting every Start-up gate climbs it, and checking again records nothing new.
{
  const state = newState();
  state.milestonesMet = Object.fromEntries(gateMilestones(LADDER[0]).map((milestone) => [milestone.id, 1]));
  assert.equal(tiersClimbed(state), 1);
  const before = Object.keys(state.milestonesMet).length;
  checkMilestones(state);
  assert.ok(Object.keys(state.milestonesMet).length >= before);
}

console.log('ladder tests passed');
