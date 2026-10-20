import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { connectionQuality, connectionsWith, MAX_CONNECT_MINUTES, MIN_CONNECT_MINUTES } from './hubs';
import { commitDraft, dropConnections, GROUND_STEP_MINUTES, planGroundTime } from './scheduleDraft';
import { step } from './step';
import { scheduledTurnMinutes, USABLE_DAY_END_MINUTE } from './utilisation';

// Run with `npm run groundtimetest`: the Gantt's turn stepper moves every
// later flight of that plane's day together, never below the scheduled
// turn or past the curfew, and the connections it reports follow the hub
// window.
const player = createPlayer('bold');
const state = startHeadlessGame('YYZ', 4, player);
for (let day = 1; day <= 40; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}

const dayOf = (s: typeof state, tail: string) => s.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
const tails = [...new Set(state.schedule.map((leg) => leg.tail))].filter((tail) => dayOf(state, tail).length >= 2);
assert.ok(tails.length > 0, 'the game needs a plane flying two flights');

let stretched = 0;
let shortened = 0;
for (const tail of tails) {
  const legs = dayOf(state, tail);
  const first = legs[0];
  const plus = planGroundTime(state, first.legId, GROUND_STEP_MINUTES);
  if (!plus.ok) continue;
  const copy = structuredClone(state);
  const result = commitDraft(copy, plus.moves);
  assert.ok(result.ok, `stretching ${tail}'s turn failed on commit: ${!result.ok && result.reason}`);
  const after = dayOf(copy, tail);
  assert.equal(after[0].departMinute, first.departMinute, 'the flight before the turn moved');
  for (let i = 1; i < legs.length; i++) assert.equal(after[i].departMinute, legs[i].departMinute + GROUND_STEP_MINUTES, 'a later flight did not move with the turn');
  stretched++;
  // And back again.
  const minus = planGroundTime(copy, first.legId, -GROUND_STEP_MINUTES);
  assert.ok(minus.ok, `taking the time back off failed: ${minus.reason}`);
  assert.ok(commitDraft(copy, minus.moves).ok);
  assert.deepEqual(dayOf(copy, tail).map((leg) => leg.departMinute), legs.map((leg) => leg.departMinute));
  shortened++;
}
assert.ok(stretched > 0 && shortened > 0, 'no turn could be stretched and shortened');

// Never below the scheduled turn.
for (const tail of tails) {
  const [first, second] = dayOf(state, tail);
  const ground = second.departMinute - (first.departMinute + first.blockMinutes);
  const turn = scheduledTurnMinutes(state, first.origin, first.dest);
  const tooShort = planGroundTime(state, first.legId, turn - ground - GROUND_STEP_MINUTES);
  assert.equal(tooShort.ok, false, 'a turn below the minimum was allowed');
}

// Never past the curfew, and never a night stop.
for (const tail of tails) {
  const legs = dayOf(state, tail);
  const last = legs[legs.length - 1];
  const late = planGroundTime(state, legs[0].legId, USABLE_DAY_END_MINUTE - (last.departMinute + last.blockMinutes) + GROUND_STEP_MINUTES);
  if (late.ok) assert.ok(late.plan.legs.every((leg) => leg.departMinute + leg.blockMinutes <= USABLE_DAY_END_MINUTE || leg.blockMinutes > 600), 'pushed past the curfew');
  assert.equal(late.ok && late.plan.kind !== 'move', false, 'a turn stepper made a night stop');
}

// The last flight of a day has nothing to push.
assert.equal(planGroundTime(state, dayOf(state, tails[0]).at(-1)!.legId, GROUND_STEP_MINUTES).ok, false);

// Connections: each one the window allows, and its quality.
let seen = 0;
for (const leg of state.schedule) {
  for (const connection of connectionsWith(state, [leg])) {
    const other = state.schedule.find((l) => l.legId === connection.legId)!;
    const wait = other.origin === leg.dest ? other.departMinute - (leg.departMinute + leg.blockMinutes) : leg.departMinute - (other.departMinute + other.blockMinutes);
    if (other.tail !== leg.tail) {
      assert.ok(wait >= MIN_CONNECT_MINUTES && wait <= MAX_CONNECT_MINUTES, `connection outside the window: ${wait}m`);
      assert.ok(connection.quality <= connectionQuality(wait) + 1e-9);
    }
    seen++;
  }
}
assert.ok(seen > 0, 'no connections found in the game');
const sample = planGroundTime(state, dayOf(state, tails[0])[0].legId, GROUND_STEP_MINUTES);
if (sample.ok) assert.ok(Array.isArray(dropConnections(state, sample.plan.legs).hubs));

console.log(`ground time ok: ${stretched} turns stretched and taken back, ${seen} connections checked`);
