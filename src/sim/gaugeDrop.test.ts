import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { commitDraft, planDrop, scheduleConflicts } from './scheduleDraft';
import { computeBlockMinutes, legDistanceNm } from './schedule';
import { step } from './step';
import { allRotations } from './utilisation';
import { rangeNmFor } from './range';
import { leasePlane } from './playerActions';
import airportsData from '../../data/airports.json';
import { applyRotation, planRotation, type RotationStop } from './rotations';

// Run with `npm run gaugetest`: a rotation dropped on a plane of another type
// at the same base is re-timed for that type, and refused when any leg is
// beyond the receiving type's range, whichever way it is dragged.
const player = createPlayer('bold');
const state = startHeadlessGame('YYZ', 4, player);
for (let day = 1; day <= 75; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}

const typeOf = (tail: string) => state.aircraft.find((a) => a.tail === tail)!.typeCode;
const longest = (legs: { origin: string; dest: string }[]) => Math.max(...legs.map((leg) => legDistanceNm(leg.origin, leg.dest)));
const rotations = allRotations(state).filter((r) => r.closed && r.airports.length === 3);
const props = rotations.filter((r) => typeOf(r.tail) === 'PROP');
if (!state.aircraft.some((a) => a.typeCode === 'REGIONAL')) {
  // The game didn't lease one by day 75: lease one at home the way the page does, with the cash to pay for it.
  state.cash = Math.max(state.cash, 5_000_000);
  const leased = leasePlane(state, state.homeAirport, 'REGIONAL');
  assert.ok(leased.ok, `couldn't lease a regional: ${!leased.ok && leased.reason}`);
  // It arrives after its delivery days.
  for (let day = 0; day < 60 && !state.aircraft.some((a) => a.typeCode === 'REGIONAL'); day++) {
    for (let minute = 0; minute < 1440; minute++) step(state);
  }
}
const regionals = state.aircraft.filter((a) => a.typeCode === 'REGIONAL');
assert.ok(props.length > 0 && regionals.length > 0, 'the game needs props and a regional');
// A regional with its day cleared, so a prop round trip has free time to land on whatever the game booked.
const roomy = structuredClone(state);
roomy.schedule = roomy.schedule.filter((leg) => leg.tail !== regionals[0].tail);
// Night stops read as breaks in the chain here, and moving a rotation off a
// plane can clear an overlap it had, so the check is that none are added.
const startingConflicts = scheduleConflicts(roomy).length;

// Upgauge: a prop round trip dropped on a regional's free time goes there, block times from the regional's speed.
let upgauged = 0;
for (const rotation of props) {
  for (const plane of regionals) {
    const copy = structuredClone(roomy);
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
      assert.ok(scheduleConflicts(copy).length <= startingConflicts, 'upgauge left an overlap');
      upgauged++;
      break;
    }
  }
}
assert.ok(upgauged > 0, 'no prop round trip could be upgauged onto a regional');

// Range: a rotation with a leg beyond the prop's range is refused on every prop, in both a plain move and as the far side of a swap.
// Clear of the prop's range by a mile: the planner rounds distances, so a leg a fraction over still fits.
const isTooFar = (r: (typeof rotations)[number]) => typeOf(r.tail) !== 'PROP' && longest(r.legs) > rangeNmFor(state, 'PROP') + 1;
if (!rotations.some(isTooFar)) {
  // The game didn't fly one by day 75: give the regional one through the route planner, on a day cleared for it.
  const regional = regionals[0];
  state.schedule = state.schedule.filter((leg) => leg.tail !== regional.tail);
  const stop = (iata: string) => (airportsData as RotationStop[]).find((airport) => airport.iata === iata)!;
  const plan = planRotation([stop(regional.baseAirport!)], stop('MSP'), regional.tail, state);
  assert.equal(plan.error, null, `the regional couldn't plan a long rotation: ${plan.error}`);
  applyRotation(state, regional.tail, plan);
}
const tooFar = allRotations(state).filter((r) => r.closed && r.airports.length === 3).filter(isTooFar);
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
// Same time of day, other type: the flight keeps the slots it holds, even
// when rivals have packed every hour at both ends past what the field takes.
const packed = (copy: typeof state, airports: string[]) => {
  const template = copy.competitorRoutes[0];
  for (const iata of airports) copy.competitorRoutes.push({ ...template, origin: iata, dest: iata === 'LHR' ? 'CDG' : 'LHR', dailyFrequency: 400 });
};
const keptSlot = props.find((rotation) => {
  const copy = structuredClone(roomy);
  packed(copy, rotation.airports);
  const drop = planDrop(copy, rotation.legs.map((leg) => leg.legId), regionals[0].tail, rotation.departMinute);
  assert.ok(drop.ok || !/full/.test(drop.reason ?? ''), `${rotation.airports.join('>')} at its own time refused: ${drop.reason}`);
  return drop.ok && drop.kind === 'move' && commitDraft(copy, drop.moves).ok;
});
assert.ok(keptSlot, 'no prop round trip could change type at its own time on packed airports');
// And a planned slot that isn't held still needs room: the same flight an hour later is refused.
const later = structuredClone(roomy);
packed(later, keptSlot.airports);
const laterDrop = planDrop(later, keptSlot.legs.map((leg) => leg.legId), regionals[0].tail, keptSlot.departMinute + 120);
assert.ok(!laterDrop.ok && /full/.test(laterDrop.reason ?? ''), `a new hour on a packed airport was allowed: ${laterDrop.reason}`);

// A swap trades slots: a prop round trip dropped on a regional's round trip at the same times swaps planes, on airports packed past full.
const swapping = structuredClone(state);
swapping.schedule = swapping.schedule.filter((leg) => leg.tail !== regionals[0].tail);
const propTrip = allRotations(swapping).find((r) => r.closed && r.airports.length === 3 && typeOf(r.tail) === 'PROP' && r.departMinute >= 9 * 60)!;
const regionalStop = (iata: string) => (airportsData as RotationStop[]).find((airport) => airport.iata === iata)!;
const regionalPlan = planRotation([regionalStop(regionals[0].baseAirport!)], regionalStop(propTrip.airports[1]), regionals[0].tail, swapping);
assert.equal(regionalPlan.error, null, `the regional couldn't fly ${propTrip.airports[1]}: ${regionalPlan.error}`);
applyRotation(swapping, regionals[0].tail, regionalPlan);
// At the prop's own times, as an older save's stacked flights can be: each plane keeps its times and trades only its type.
for (const leg of swapping.schedule.filter((l) => l.tail === regionals[0].tail)) {
  leg.departMinute = propTrip.legs.find((l) => l.origin === leg.origin)!.departMinute;
}
const regionalTrip = allRotations(swapping).find((r) => r.tail === regionals[0].tail)!;
packed(swapping, propTrip.airports);
const swapDrop = planDrop(swapping, propTrip.legs.map((leg) => leg.legId), regionals[0].tail, regionalTrip.departMinute);
assert.ok(swapDrop.ok && swapDrop.kind === 'swap', `trading slots on packed airports was refused: ${swapDrop.reason}`);
const swapped = commitDraft(swapping, swapDrop.moves);
assert.ok(swapped.ok, `the swap didn't save: ${!swapped.ok && swapped.reason}`);

console.log(`gauge drops ok · ${upgauged} upgauges tried · ${tooFar.length} long rotations kept off props`);
