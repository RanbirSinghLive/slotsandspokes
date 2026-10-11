import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { clientKey, mandatesOf, rollDailyMandates } from './mandates';
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
