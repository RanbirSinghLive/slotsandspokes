import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { dayStartMinute } from './clock';
import { callsNeeded } from './controller';
import { applyStandingOrders, orderFor, setOrder } from './orders';
import { marketKey } from './schedule';
import { step } from './step';
import { rotationsForTail } from './utilisation';

// Run with `npm run orderstest`: a plane on 'ask' is put to the player, on
// 'protect' it is never raised or cancelled, and on 'auto' its breaking day
// is settled without a stop. Nothing changes for a game that sets none.
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
      return found.length >= 2 && found.every((r) => r.legs[0].origin === found[0].legs[0].origin);
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
  if (!callsNeeded(state).some((c) => c.tail === t && c.kind === 'curfew')) continue;
  setOrder(state, t, 'auto');
  applyStandingOrders(state);
  if (state.cancelledToday.length > 0 || (state.swappedToday ?? []).length > 0) chosen = hour;
}
assert.ok(chosen >= 0, 'no hour of the day where auto has something worth doing');
restore();
const tail = breakTheDay(chosen);
assert.equal(orderFor(state, tail), 'ask');
const asked = callsNeeded(state).find((c) => c.tail === tail);
assert.ok(asked, 'a plane waiting on a broken day should be put to the player');
assert.equal(asked.kind, 'curfew', 'the test setup should break the curfew');

// protect: silent, and the day is left alone.
setOrder(state, tail, 'protect');
assert.equal(callsNeeded(state).some((c) => c.tail === tail), false, 'protect must not raise a call');
applyStandingOrders(state);
assert.equal(state.cancelledToday.length, 0, 'protect must not cancel');

// auto: no call raised, and the day is settled by a swap or a cancel.
setOrder(state, tail, 'auto');
assert.equal(callsNeeded(state).some((c) => c.tail === tail), false, 'auto must not raise a call');
const cashBefore = state.cash;
applyStandingOrders(state);
const acted = state.cancelledToday.length > 0 || (state.swappedToday ?? []).length > 0;
assert.ok(acted, 'auto should have swapped or cancelled a rotation');
assert.ok((state.orderLog ?? []).some((e) => e.tail === tail), 'auto should log what it did');
assert.equal(callsNeeded(state, true).some((c) => c.tail === tail && c.kind === 'curfew'), false, 'the curfew cancel should be gone');
console.log(`orders: ok · ${state.orderLog![state.orderLog!.length - 1].text} · cash ${state.cash - cashBefore}`);

// A plane's order equal to the fleet default is dropped.
setOrder(state, null, 'auto');
setOrder(state, tail, 'auto');
assert.equal(state.callOrders?.tails?.[tail], undefined);
console.log('orders default: ok');
