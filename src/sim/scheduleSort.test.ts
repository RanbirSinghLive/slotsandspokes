import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { commitDraft, planDrop, scheduleConflicts } from './scheduleDraft';
import { planSort, type SortMode } from './scheduleSort';
import { marketKey, nextLegId, repairDuplicateLegIds } from './schedule';
import { step } from './step';
import { nightStopLegs } from './nightStops';
import { allRotations } from './utilisation';

// Run with `npm run sorttest`: a one-click sort only changes which plane flies
// a rotation, never its time; it leaves the schedule legal, never splits a
// market over more planes than before, and a second FIFO or LIFO changes nothing.
const player = createPlayer('bold');
const state = startHeadlessGame('YYZ', 1, player);
for (let day = 1; day <= 100; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}

const planesPerMarket = (s: typeof state): number => {
  const planes = new Map<string, Set<string>>();
  for (const r of allRotations(s)) {
    const key = r.airports.length === 3 ? marketKey(r.airports[0], r.airports[1]) : r.airports.join('>');
    planes.set(key, (planes.get(key) ?? new Set()).add(r.tail));
  }
  return [...planes.values()].reduce((sum, set) => sum + set.size, 0);
};

// Scramble the fleet first: swap pairs of rotations between planes (seeded, so it repeats).
let seed = 12345;
const random = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
let swaps = 0;
const baseOf = (tail: string) => state.aircraft.find((p) => p.tail === tail)!;
const movable = allRotations(state).filter((r) => r.closed && r.airports[0] === baseOf(r.tail).baseAirport && nightStopLegs(state, r.tail) === null);
// Lift every such rotation off its plane, then deal them back out at random in order of departure.
const plans = movable.map((r) => ({ r, group: baseOf(r.tail).typeCode, original: r.tail }));
for (const { r } of plans) for (const leg of r.legs) leg.tail = 'TMP';
for (const { r, group, original } of plans.sort((x, y) => x.r.departMinute - y.r.departMinute)) {
  const options = state.aircraft.filter((a) => a.typeCode === group && a.baseAirport === baseOf(original).baseAirport).map((a) => a.tail).sort(() => random(3) - 1);
  const pick = options.find((tail) => {
    for (const leg of r.legs) leg.tail = tail;
    return scheduleConflicts(state, [tail]).length === 0;
  });
  for (const leg of r.legs) leg.tail = pick ?? original;
  if (pick && pick !== original) swaps++;
}
console.log('scramble moves', swaps);
assert.deepEqual(scheduleConflicts(state), [], 'scramble left the schedule overlapping');
const before = planesPerMarket(state);
console.log(`scrambled with ${swaps} swaps`);
let anyMoved = false;
for (const mode of ['fifo', 'lifo', 'optimise'] as SortMode[]) {
  const copy = structuredClone(state);
  const plan = planSort(copy, mode);
  assert.ok(plan.ok, `${mode} refused: ${plan.ok ? '' : plan.reason}`);
  if (!plan.ok) continue;
  const times = new Map(copy.schedule.map((leg) => [leg.legId, leg.departMinute]));
  const result = commitDraft(copy, plan.moves);
  assert.ok(result.ok || plan.moves.length === 0, `${mode} commit refused: ${result.ok ? '' : result.reason}`);
  for (const leg of copy.schedule) assert.equal(leg.departMinute, times.get(leg.legId), `${mode} moved a departure time`);
  assert.deepEqual(scheduleConflicts(copy), [], `${mode} left the schedule overlapping`);
  assert.ok(planesPerMarket(copy) < before, `${mode} did not tidy a scrambled fleet`);
  assert.ok(planesPerMarket(copy) <= before, `${mode} split markets over more planes (${planesPerMarket(copy)} > ${before})`);
  
  if (mode !== 'optimise') assert.equal(planSort(copy, mode).ok && (planSort(copy, mode) as { moves: unknown[] }).moves.length, 0, `${mode} twice should change nothing`);
  anyMoved ||= plan.moves.length > 0;
  console.log(`${mode}: ${plan.moves.length} rotations moved, planes per market ${before} -> ${planesPerMarket(copy)}`);
}
assert.ok(anyMoved, 'no sort moved anything on a 100-day game');

// A long-haul round trip (back after 22:00, exempt from the curfew in sim/curfew.ts)
// can be moved in its day and onto another plane; the timeline used to refuse it outright.
const longHaul = structuredClone(state);
const rotation = allRotations(longHaul).find((r) => r.legs.length === 2 && r.closed && r.airports[0] === longHaul.aircraft.find((a) => a.tail === r.tail)!.baseAirport)!;
longHaul.schedule = longHaul.schedule.filter((leg) => leg.tail !== rotation.tail || rotation.legs.includes(leg));
const [out, home] = longHaul.schedule.filter((leg) => rotation.legs.some((l) => l.legId === leg.legId)).sort((a, b) => a.departMinute - b.departMinute);
out.blockMinutes = 520;
home.blockMinutes = 520;
out.departMinute = 360;
home.departMinute = 360 + 520 + 60;
const longIds = [out.legId, home.legId];
assert.ok(planDrop(longHaul, longIds, rotation.tail, 365).ok, 'a long-haul round trip should move along its own plane');
assert.equal(planDrop(longHaul, longIds, rotation.tail, 355).ok, false, 'but not before the day opens');
console.log('long-haul move: ok');
console.log('schedule sort: ok');

// A leg moved to another plane keeps its id, so a new leg on the plane it left must not reuse its number,
// and a save that already holds two legs with one id is repaired.
const ids = structuredClone(state);
const moved = ids.schedule.find((leg) => leg.legId.startsWith(`${leg.tail}-`))!;
const originalTail = moved.tail;
const taken = nextLegId(originalTail, ids.schedule);
moved.tail = 'C-ELSEWHERE';
assert.equal(nextLegId(originalTail, ids.schedule), taken === moved.legId ? `${originalTail}-${Number(taken.slice(originalTail.length + 1)) + 1}` : taken);
assert.notEqual(nextLegId(originalTail, ids.schedule), moved.legId, 'a moved leg\'s id was handed out again');
const twin = { ...moved, tail: originalTail };
ids.schedule.push(twin);
assert.equal(repairDuplicateLegIds(ids), 1, 'one duplicate should be renamed');
assert.equal(new Set(ids.schedule.map((leg) => leg.legId)).size, ids.schedule.length, 'ids still collide');
assert.equal(repairDuplicateLegIds(ids), 0, 'repair should be safe to run twice');
console.log('leg ids: ok');
