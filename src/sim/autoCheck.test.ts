import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { dCheckDueIn, heavyCheckDueIn } from './mxChecks';
import { step } from './step';

// A C or D check that falls due goes in by itself the next morning the plane
// is at base, unbooked, so nothing waits at the front of the pipeline.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
for (let day = 1; day <= 12; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}
const plane = state.aircraft.find((a) => !state.aogs.some((e) => e.tail === a.tail) && !a.heavyCheckBooked && !a.dCheckBooked && !a.rebase)!;
assert.ok(plane, 'no plane to test with');
const inCheck = () => state.aogs.find((e) => e.tail === plane.tail);
const runUntil = (done: () => boolean, days: number) => {
  for (let minute = 0; minute < days * 1440 && !done(); minute++) step(state);
};

plane.daysSinceHeavyCheck = 90;
assert.ok(heavyCheckDueIn(plane) <= 0);
runUntil(() => inCheck() !== undefined, 4);
const cEvent = inCheck();
assert.ok(cEvent?.check && cEvent.checkKind === undefined, 'due C check did not go in by itself');
assert.equal(cEvent.fault, 'C check due');
runUntil(() => inCheck() === undefined, 10);
assert.ok(heavyCheckDueIn(plane) > 30, 'C check never finished');

plane.daysSinceD = 720;
assert.ok(dCheckDueIn(plane) <= 0);
runUntil(() => inCheck() !== undefined, 4);
const dEvent = inCheck();
assert.ok(dEvent?.check && dEvent.checkKind === 'D', 'due D check did not go in by itself');
assert.equal(dEvent.fault, 'D check due');
console.log('auto check ok');
