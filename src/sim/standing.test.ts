import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { clientKey, mandatesOf, requestsOff, rollDailyMandates, setRequestsOff } from './mandates';
import { pipelineItems } from './pipeline';
import { earnStanding, fadeStandings, loseStanding, standingOf, standingPayMultiplier, standingPips } from './standing';
import { step } from './step';

// Run with `npm run standingtest`: standing builds a little at a time, fades,
// is lost faster than it is earned, and a client that has it asks again with a
// better offer, past the thinning that slows everyone else's.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
for (let day = 1; day <= 40; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}

const key = clientKey(3);
assert.equal(standingOf(state, key), 0);
earnStanding(state, key, 40);
assert.equal(standingOf(state, key), 40);
assert.equal(standingPayMultiplier(state, key), 1.4);
fadeStandings(state);
assert.ok(standingOf(state, key) < 40 && standingOf(state, key) > 39, 'standing fades a little a day');
loseStanding(state, key, 100);
assert.equal(standingOf(state, key), 0, 'standing cannot go below nothing');
earnStanding(state, key, 500);
assert.equal(standingOf(state, key), 100, 'standing is capped');
assert.equal(standingPips(45), '●●○○○');
console.log('standing: ok');

// A loyal client asks again, and pays more than a stranger would.
state.mandates = [];
state.eventsOff = false;
let repeats = 0;
let strangerPremium = Infinity;
let loyalPremium = 0;
for (let i = 0; i < 400; i++) {
  state.simMinute += 1440;
  state.mandates = [];
  earnStanding(state, key, 100);
  rollDailyMandates(state);
  for (const offer of mandatesOf(state)) {
    if (offer.story === 3) {
      repeats += 1;
      loyalPremium = Math.max(loyalPremium, offer.premium);
    } else strangerPremium = Math.min(strangerPremium, offer.premium);
  }
}
assert.ok(repeats >= 10, `a full-standing client should ask again often (${repeats} in 400 days)`);
assert.ok(loyalPremium > strangerPremium, 'a loyal client pays more');
console.log(`standing repeat offers: ok · ${repeats} in 400 days · $${loyalPremium} vs $${strangerPremium}`);

// The requests switch: off lapses open offers as declined and stops new ones, the draws stay the same, and it is saved.
for (let i = 0; i < 100 && !mandatesOf(state).some((m) => m.status === 'offered'); i++) {
  state.simMinute += 1440;
  earnStanding(state, key, 100);
  rollDailyMandates(state);
}
const offered = mandatesOf(state).filter((m) => m.status === 'offered');
assert.ok(offered.length > 0, 'a loyal client has an offer open');
const seedBefore = state.mandateSeed;
setRequestsOff(state, true);
assert.ok(offered.every((m) => m.status === 'lapsed' && m.declined), 'open offers lapse as declined');
for (let i = 0; i < 60; i++) {
  state.simMinute += 1440;
  rollDailyMandates(state);
}
assert.equal(mandatesOf(state).filter((m) => m.status === 'offered').length, 0, 'no new offers while off');
assert.ok(mandatesOf(state).every((m) => !m.declined), 'declined offers are not kept as history');
assert.notEqual(state.mandateSeed, seedBefore, 'the draws go on while off');
assert.equal(JSON.parse(JSON.stringify(state)).requestsOff, true, 'the switch is saved');
state.contractsOff = true;
assert.ok(!pipelineItems(state).some((item) => item.lane === 'commercial'), 'the Sales lane goes with tenders and requests both off');
state.contractsOff = undefined;
setRequestsOff(state, false);
assert.equal(requestsOff(state), false);
state.eventsOff = true;
assert.equal(requestsOff(state), false, 'the switch overrides the start-screen choice');
state.requestsOff = undefined;
assert.equal(requestsOff(state), true, 'without the switch, events off means requests off');
console.log('requests switch: ok');
