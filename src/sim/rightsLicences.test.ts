import assert from 'node:assert/strict';
import { chooseHome } from './homes';
import { gateMilestones, LADDER } from './ladder';
import { grantedCountries, legRights } from './rights';
import { buyRights, capRefusal, dropRights, EARN_DAYS, LAPSE_DAYS, licencesAllowed, rightsOffer, rollDailyRights, setupFee, weeklyCap } from './rightsLicences';
import { createNewGameState } from './state';

// Run with `npm run rightstest`: domestic rights in a foreign country are
// locked until widebodies open, need 120 earned days, cost the setup fee,
// open barred legs, cap weekly departures, and lapse when unflown.
function newState() {
  const state = createNewGameState(1, 'YUL');
  chooseHome(state, 'YUL', 'summer', 'medium');
  state.cash = 100_000_000;
  return state;
}
function openWidebodyTier(state: ReturnType<typeof newState>) {
  state.milestonesMet = {};
  for (const tier of LADDER.slice(0, 3)) for (const milestone of gateMilestones(tier)) state.milestonesMet[milestone.id] = 1;
}

// Locked before the widebody tier, even with the days earned.
{
  const state = newState();
  state.rightsProgress = { US: EARN_DAYS };
  assert.equal(rightsOffer(state, 'US').status, 'locked');
  assert.equal(licencesAllowed(state), 0);
  assert.equal(buyRights(state, 'US').ok, false);
}

// Earning, then offered, then bought.
{
  const state = newState();
  openWidebodyTier(state);
  assert.equal(licencesAllowed(state), 1);
  state.rightsProgress = { US: EARN_DAYS - 1 };
  assert.equal(rightsOffer(state, 'US').status, 'earning');
  assert.equal(buyRights(state, 'US').ok, false);
  state.rightsProgress.US = EARN_DAYS;
  assert.equal(rightsOffer(state, 'US').status, 'offered');
  assert.equal(legRights('CA', 'BOS', 'LGA').ok, false);
  const cash = state.cash;
  assert.equal(buyRights(state, 'US').ok, true);
  assert.equal(cash - state.cash, setupFee('US'));
  assert.deepEqual(grantedCountries(state), ['US']);
  assert.equal(legRights('CA', 'BOS', 'LGA', grantedCountries(state)).ok, true);
  // One licence per tier: a second is refused.
  state.rightsProgress.MX = EARN_DAYS;
  assert.equal(buyRights(state, 'MX').ok, false);
  assert.equal(weeklyCap(state, 'US'), 14);

  // Cap: two daily legs is 14 a week, a third would be 21.
  const leg = { origin: 'BOS', dest: 'LGA' };
  assert.equal(capRefusal(state, [leg, leg]), null);
  assert.ok(capRefusal(state, [leg, leg, leg]));

  // Unflown for 60 days: lapses and the earned days start again.
  for (let day = 0; day < LAPSE_DAYS; day++) {
    state.simMinute += 1440;
    rollDailyRights(state);
  }
  assert.deepEqual(grantedCountries(state), []);
  assert.equal(state.rightsProgress.US, 0);
}

// Dropping gives it back.
{
  const state = newState();
  openWidebodyTier(state);
  state.rightsProgress = { US: EARN_DAYS };
  buyRights(state, 'US');
  assert.equal(dropRights(state, 'US').ok, true);
  assert.deepEqual(grantedCountries(state), []);
}
console.log('rights licences ok');
