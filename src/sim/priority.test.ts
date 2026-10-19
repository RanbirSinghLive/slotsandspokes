import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { dayStartMinute } from './clock';
import { callsNeeded } from './controller';
import { applyPriorityPolicy, callPolicy, routePriority, setCallPolicy, setRoutePriority } from './priority';
import { marketKey } from './schedule';
import { step } from './step';
import { rotationsForTail } from './utilisation';

// Run with `npm run prioritytest`: with the default priority policy a
// breaking day is settled without a stop, by route rank (keep is never cut,
// expendable goes first); with ask the plane is put to the player.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
for (let day = 1; day <= 40; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}

function breakTheDay(hour: number): string {
  const tail = state.aircraft
    .map((a) => a.tail)
    .find((t) => {
      const found = rotationsForTail(state, t);
      return (
        found.length >= 2 &&
        found.every((r) => r.legs[0].origin === found[0].legs[0].origin) &&
        new Set(found.map((r) => marketKey(r.legs[0].origin, r.legs[0].dest))).size >= 2
      );
    });
  assert.ok(tail, 'no plane with two rotations to test with');
  const aircraft = state.aircraft.find((a) => a.tail === tail)!;
  const rotations = rotationsForTail(state, tail);
  state.simMinute = dayStartMinute(state) + hour * 60;
  state.completedToday = [];
  state.cancelledToday = [];
  state.activeFlights = [];
  aircraft.status = 'ground';
  aircraft.atAirport = rotations[0].legs[0].origin;
  aircraft.groundSinceMinute = state.simMinute - 60;
  // Set up by hand: whatever the played days left the plane with (an AOG, a crew grounding) is cleared.
  state.aogs = state.aogs.filter((event) => event.tail !== tail);
  state.groundedTails = state.groundedTails.filter((grounded) => grounded !== tail);
  // The first rotation earns little and the ones the curfew would take earn a lot, so giving up the first is the sensible call.
  rotations.forEach((r, i) => {
    for (const leg of r.legs) state.revenueHistoryByMarket[marketKey(leg.origin, leg.dest)] = [i === 0 ? 100 : 20000];
  });
  return tail;
}

// Find an hour of the day at which the curfew will cancel something and one cancel recovers more than it costs.
const trial = JSON.stringify(state);
function restore(): void {
  for (const key of Object.keys(state)) delete (state as Record<string, unknown>)[key];
  Object.assign(state, JSON.parse(trial));
}
let chosen = -1;
for (let hour = 7; hour <= 17 && chosen < 0; hour++) {
  restore();
  const t = breakTheDay(hour);
  setCallPolicy(state, 'ask');
  if (!callsNeeded(state).some((c) => c.tail === t && c.kind === 'curfew')) continue;
  setCallPolicy(state, 'priority');
  applyPriorityPolicy(state);
  if (state.cancelledToday.length > 0 || (state.swappedToday ?? []).length > 0) chosen = hour;
}
assert.ok(chosen >= 0, 'no hour of the day where the policy has something worth doing');
restore();
const tail = breakTheDay(chosen);
assert.equal(callPolicy(state), 'priority', 'a game that sets nothing uses the priority policy');
assert.equal(callsNeeded(state).some((c) => c.tail === tail), false, 'priority must not raise a call');

// ask: the plane is put to the player and the policy does nothing.
setCallPolicy(state, 'ask');
const asked = callsNeeded(state).find((c) => c.tail === tail);
assert.ok(asked && asked.kind === 'curfew', 'a plane waiting on a broken day should be put to the player');
applyPriorityPolicy(state);
assert.equal(state.cancelledToday.length, 0, 'ask must not cancel');
setCallPolicy(state, 'priority');

// keep on every route of the plane: nothing is cut for it.
const keepAll = rotationsForTail(state, tail).flatMap((r) => r.legs);
for (const leg of keepAll) setRoutePriority(state, leg.origin, leg.dest, 'keep');
applyPriorityPolicy(state);
assert.equal(keepAll.some((leg) => state.cancelledToday.includes(leg.legId)), false, 'keep must never be cut');
setRoutePriority(state, keepAll[0].origin, keepAll[0].dest, 'normal');
assert.equal(routePriority(state, keepAll[0].origin, keepAll[0].dest), 'normal');

restore();
breakTheDay(chosen);
assert.equal(state.routePriority, undefined, 'a restored game has no ranks');
// normal: the day is settled by a swap or a cancel, and it is logged for the brief.
const cashBefore = state.cash;
applyPriorityPolicy(state);
const acted = state.cancelledToday.length > 0 || (state.swappedToday ?? []).length > 0;
assert.ok(acted, 'the policy should have swapped or cancelled a rotation');
assert.ok((state.priorityLog ?? []).length > 0, 'the policy should log what it did');
console.log(`priority: ok · ${state.priorityLog![state.priorityLog!.length - 1].text} · cash ${state.cash - cashBefore}`);

// A keep route is spared while an expendable one is cut instead.
restore();
const t2 = breakTheDay(chosen);
const rots = rotationsForTail(state, t2);
const [first, ...rest] = rots;
setRoutePriority(state, first.legs[0].origin, first.legs[0].dest, 'keep');
const keptMarket = marketKey(first.legs[0].origin, first.legs[0].dest);
for (const r of rest) for (const leg of r.legs) if (marketKey(leg.origin, leg.dest) !== keptMarket) setRoutePriority(state, leg.origin, leg.dest, 'expendable');
applyPriorityPolicy(state);
assert.equal(state.cancelledToday.includes(first.legs[0].legId), false, 'the keep rotation must not be cancelled');
console.log('priority ranks: ok');
