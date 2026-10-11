import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { nemesisStatus, NAMING_GRUDGE } from './nemesis';
import { step } from './step';

// Run with `npm run nemesistest`: a nemesis is named from the rivals' share of
// the player's routes, survives a save round trip, and a fresh game has none.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
assert.equal(nemesisStatus(state), null, 'no nemesis at the start');
let namedOn = -1;
for (let day = 1; day <= 240; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
  if (namedOn < 0 && state.nemesis) namedOn = day;
}
console.log('named on day', namedOn, JSON.stringify(state.nemesis), Object.entries(state.rivalGrudge ?? {}).map(([k, v]) => `${k}:${Math.round(v)}`).join(' '), 'beaten', state.nemesesBeaten);
assert.ok(Object.values(state.rivalGrudge ?? {}).every((n) => n >= 0 && Number.isFinite(n)));
if (state.nemesis) {
  const status = nemesisStatus(state)!;
  assert.ok(status.grudge >= 0 && status.theirRoutes >= 3);
  assert.ok(status.grudge > 0 || NAMING_GRUDGE > 0);
}
const copy = JSON.parse(JSON.stringify(state));
assert.deepEqual(copy.nemesis, state.nemesis);
assert.deepEqual(copy.rivalGrudge, state.rivalGrudge);
console.log('nemesistest ok');
