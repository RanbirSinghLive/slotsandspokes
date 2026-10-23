import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { playDays } from '../headless/simulate';
import { dayStartMinute } from './clock';
import { coverRotations, handBackCover } from './turnBuffer';
import { rotationsForTail } from './utilisation';

// Run with `npm run aogcovertest`: cover for a plane that is out moves its
// flying onto other planes without re-timing anyone's timetable, and when
// it's back every leg returns to it at exactly the time it had.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
// Cash enough to grow a fleet whatever the cost level (sim/costLevel.ts): this checks cover, not the economy.
state.cash = 3_000_000;
playDays(state, player, 40);
// Between days: nothing is in the air or half flown.
state.activeFlights = [];
state.completedToday = [];
state.cancelledToday = [];

const timetable = () => new Map(state.schedule.map((leg) => [leg.legId, `${leg.tail} ${leg.departMinute}`]));
const flying = [...new Set(state.schedule.map((leg) => leg.tail))];
assert.ok(flying.length >= 2, 'two planes with flights by day 40');
const [down, ...others] = flying;
const downPlane = state.aircraft.find((a) => a.tail === down)!;
const host = others.find((tail) => {
  const plane = state.aircraft.find((a) => a.tail === tail)!;
  return plane.typeCode === downPlane.typeCode && plane.baseAirport === downPlane.baseAirport;
})!;
assert.ok(host, 'a second plane of the same type at the same base');
// Room on the host: it keeps only its first rotation, so cover has to fit round it.
const hostRotations = rotationsForTail(state, host);
const dropped = new Set(hostRotations.slice(1).flatMap((rotation) => rotation.legs));
state.schedule = state.schedule.filter((leg) => !dropped.has(leg));
const before = timetable();
const hostLegs = () => state.schedule.filter((leg) => leg.tail === host).map((leg) => `${leg.legId} ${leg.departMinute}`).sort();
const hostBefore = hostLegs();

const event = { tail: down, base: state.aircraft.find((a) => a.tail === down)!.baseAirport!, fault: 'hydraulics', returnsAtMinute: dayStartMinute(state, state.simMinute) + 1440, uncoveredRoutes: [], coveredRotations: 0, movedLegIds: [] as string[], scheduledAt: {} as Record<string, number> };
state.aogs.push(event);
const result = coverRotations(state, down, rotationsForTail(state, down));
event.movedLegIds.push(...result.movedLegIds);
event.scheduledAt = result.scheduledAt;
assert.ok(result.covered >= 1, 'something was covered');

// The planes covering keep their own flights where they were.
for (const leg of state.schedule.filter((leg) => !result.movedLegIds.includes(leg.legId))) {
  assert.equal(`${leg.tail} ${leg.departMinute}`, before.get(leg.legId), `${leg.legId} untouched by cover`);
}
assert.deepEqual(hostLegs().filter((line) => hostBefore.includes(line)), hostBefore, 'the host keeps its own day');
// Moved legs keep their ids, and none overlaps another on its new plane.
for (const id of result.movedLegIds) assert.ok(before.has(id), `${id} keeps its id`);
for (const tail of flying) {
  const legs = state.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
  for (let i = 1; i < legs.length; i++) assert.ok(legs[i].departMinute >= legs[i - 1].departMinute + legs[i - 1].blockMinutes, `${tail}: ${legs[i].legId} leaves after ${legs[i - 1].legId} lands`);
}

state.aogs = [];
handBackCover(state, event);
assert.deepEqual(timetable(), before, 'after the AOG the timetable is exactly as it was');

console.log(`aog cover: ok (${result.covered} rotations covered, all back at their own times)`);
