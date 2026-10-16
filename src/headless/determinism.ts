import assert from 'node:assert/strict';
import { step } from '../sim/step';
import { saveFileText, upgradeSave } from '../ui/save';
import { startHeadlessGame } from './newGame';
import { createPlayer } from './player';
import { playDays } from './simulate';

// `npm run determinism` checks the two promises CLAUDE.md makes about the sim:
// 1. two games from the same seed end up identical, and
// 2. a game saved and reloaded mid-way carries on exactly like the original.
// Both use the real save path (saveFileText, then upgradeSave), so a field
// that does not survive JSON, or a hidden source of randomness, fails here.
const MINUTES_PER_DAY = 1440;
const HOME = 'YYZ';
const SEED = 7;
const DAYS_BEFORE_SAVE = 8;
const DAYS_AFTER_SAVE = 8;

function freshGame() {
  const player = createPlayer('steady');
  return { player, state: startHeadlessGame(HOME, SEED, player) };
}

const first = freshGame();
playDays(first.state, first.player, DAYS_BEFORE_SAVE + DAYS_AFTER_SAVE);
const second = freshGame();
playDays(second.state, second.player, DAYS_BEFORE_SAVE + DAYS_AFTER_SAVE);
assert.equal(JSON.stringify(first.state), JSON.stringify(second.state), 'same seed gave different games');
console.log(`same seed: two ${DAYS_BEFORE_SAVE + DAYS_AFTER_SAVE}-day games match`);

// After the save the player stays out of it: its own memory (which route it
// opened when) is not in the save, so a reloaded copy would decide
// differently for reasons that have nothing to do with the sim.
const original = freshGame();
playDays(original.state, original.player, DAYS_BEFORE_SAVE);
const loaded = upgradeSave(JSON.parse(saveFileText(original.state)));
assert.ok(loaded.ok, 'a fresh save did not load');
for (let minute = 0; minute < DAYS_AFTER_SAVE * MINUTES_PER_DAY; minute++) {
  step(original.state);
  step(loaded.state);
}
assert.equal(JSON.stringify(original.state), JSON.stringify(loaded.state), 'a reloaded save diverged from the original');
console.log(`save reload: day ${DAYS_BEFORE_SAVE} save carries on identically for ${DAYS_AFTER_SAVE} days`);
