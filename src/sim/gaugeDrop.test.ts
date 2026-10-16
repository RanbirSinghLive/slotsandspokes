import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { commitDraft, planDrop, scheduleConflicts } from './scheduleDraft';
import { computeBlockMinutes, legDistanceNm } from './schedule';
import { step } from './step';
import { allRotations } from './utilisation';

// Run with `npm run gaugetest`: a rotation dropped on a plane of another type
// at the same base is re-timed for that type, and refused when any leg is
// beyond the receiving type's range, whichever way it is dragged.
const player = createPlayer('bold');
const state = startHeadlessGame('YYZ', 2, player);
for (let day = 1; day <= 75; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}

const typeOf = (tail: string) => state.aircraft.find((a) => a.tail === tail)!.typeCode;
const longest = (legs: { origin: string; dest: string }[]) => Math.max(...legs.map((leg) => legDistanceNm(leg.origin, leg.dest)));
const rotations = allRotations(state).filter((r) => r.closed && r.airports.length === 3);
const props = rotations.filter((r) => typeOf(r.tail) === 'PROP');
const regionals = state.aircraft.filter((a) => a.typeCode === 'REGIONAL');
assert.ok(props.length > 0 && regionals.length > 0, 'the game needs props and a regional');
// Night stops read as breaks in the chain here, so compare against how many there were.
const startingConflicts = scheduleConflicts(state).length;

// Upgauge: a prop round trip dropped on a regional's free time goes there, block times from the regional's speed.
let upgauged = 0;
for (const rotation of props) {
  for (const plane of regionals) {
    const copy = structuredClone(state);
    const ids = rotation.legs.map((leg) => leg.legId);
    for (let start = 360; start <= 1200; start += 30) {
      const drop = planDrop(copy, ids, plane.tail, start);
      if (!drop.ok || drop.kind !== 'move') continue;
      const result = commitDraft(copy, drop.moves);
      if (!result.ok) continue;
      for (const leg of copy.schedule.filter((l) => ids.includes(l.legId))) {
        assert.equal(leg.tail, plane.tail);
        assert.equal(leg.blockMinutes, computeBlockMinutes(leg.origin, leg.dest, 360), 'block time not re-timed for the regional');
      }
      assert.equal(scheduleConflicts(copy).length, startingConflicts, 'upgauge left an overlap');
      upgauged++;
      break;
    }
  }
}
assert.ok(upgauged > 0, 'no prop round trip could be upgauged onto a regional');

// Range: a rotation with a leg beyond the prop's range is refused on every prop, in both a plain move and as the far side of a swap.
const tooFar = rotations.filter((r) => typeOf(r.tail) !== 'PROP' && longest(r.legs) > 380);
assert.ok(tooFar.length > 0, 'the game needs a regional rotation beyond a prop');
for (const rotation of tooFar) {
  const ids = rotation.legs.map((leg) => leg.legId);
  for (const prop of state.aircraft.filter((a) => a.typeCode === 'PROP')) {
    for (let start = 360; start <= 1200; start += 30) {
      const drop = planDrop(state, ids, prop.tail, start);
      assert.ok(!drop.ok, `${rotation.tail} ${rotation.airports.join('>')} dropped on ${prop.tail} at ${start} was allowed`);
      assert.match(drop.reason ?? '', /range/);
    }
  }
}

// A swap whose return side is out of range is never offered: dragging a prop onto a regional over a long rotation holds, not swaps.
for (const rotation of props) {
  for (const far of tooFar) {
    const ids = rotation.legs.map((leg) => leg.legId);
    for (let start = far.departMinute - 60; start <= far.departMinute + 60; start += 5) {
      const drop = planDrop(state, ids, far.tail, start);
      if (drop.ok && drop.kind === 'swap') {
        for (const move of drop.moves.slice(1)) {
          const legs = state.schedule.filter((leg) => move.legIds.includes(leg.legId));
          assert.ok(longest(legs) <= 380, 'a swap sent a long rotation to a prop');
        }
      }
    }
  }
}
console.log(`gauge drops ok · ${upgauged} upgauges tried · ${tooFar.length} long rotations kept off props`);
