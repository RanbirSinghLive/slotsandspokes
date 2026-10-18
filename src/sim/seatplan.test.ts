import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { bestSeatPlan, cabinLayout, layoutFor, orderRefit, refitBlockedReason, seatsOfType, typeSegmentSplit } from './cabins';
import { DEFAULT_FARE_CLASSES, sellSeats } from './fareClasses';
import { freeHeavyBays } from './mxChecks';
import { step } from './step';

// Run with `npm run seatplantest`: seat plans (J, W and Y seats), the segment split a type flies,
// and a refit holding a hangar bay.

// The old business cabin is the plan it always was.
assert.deepEqual(cabinLayout(150, 'business'), { economy: 150 - Math.round(12 * 2.5), premium: 0, business: 12 });
assert.deepEqual(layoutFor(150, { business: 10, premium: 20 }), { economy: 150 - 25 - 30, premium: 20, business: 10 });

// Premium economy sells to those who value it, and earns more than the same seats as economy would.
const sale = (premiumSeats: number) =>
  sellSeats({
    seats: 100,
    premiumSeats,
    baseFare: 200,
    demand: 120,
    mix: { leisure: 0.3, vfr: 0.2, business: 0.5 },
    shareAt: (_segment, price) => Math.max(0, 1 - price / 600),
    connecting: 0,
    recapturable: 0,
    classes: DEFAULT_FARE_CLASSES,
  });
assert.ok((sale(20).tally.premiumSold ?? 0) > 0, 'no premium seat sold');
assert.equal(sale(0).tally.premiumSold, undefined);

const state = startHeadlessGame('YYZ', 4, createPlayer('bold'));
for (let day = 0; day < 20; day++) for (let minute = 0; minute < 1440; minute++) step(state);

// The split is a share of each segment, adding to 1.
const aircraft = state.aircraft.find((a) => a.typeCode !== 'PROP' && state.schedule.some((leg) => leg.tail === a.tail)) ?? state.aircraft[0];
const split = typeSegmentSplit(state, aircraft.typeCode);
if (split) assert.ok(Math.abs(split.leisure + split.vfr + split.business - 1) < 1e-6);

// Too many J and W seats are refused; a sound plan is accepted.
const seats = seatsOfType('NARROWBODY');
const narrow = state.aircraft.find((a) => a.typeCode === 'NARROWBODY');
if (narrow) {
  state.cash = 1e9;
  assert.match(refitBlockedReason(state, narrow, { business: seats, premium: 0 }) ?? '', /at most/);
  const best = bestSeatPlan(state, narrow.tail);
  assert.ok(best && best.gainPerDay >= 0);
}

// A refit takes a hangar bay at its base for its days and gives it back; with no rated bay it is contracted out and paid by the hour.
function refitAtHome(rated: boolean): { inBay: boolean; spent: number } {
  const game = startHeadlessGame('YYZ', 4, createPlayer('bold'));
  const plane = game.aircraft[0];
  plane.typeCode = 'REGIONAL';
  plane.status = 'ground';
  plane.atAirport = plane.baseAirport;
  game.schedule = game.schedule.filter((leg) => leg.tail !== plane.tail);
  game.cash = 1e9;
  const home = plane.baseAirport!;
  if (rated) (game.mxRatings ??= {})[home] = [...(game.mxRatings[home] ?? []), 'REGIONAL'];
  const ordered = orderRefit(game, plane.tail, { business: 4, premium: 8 });
  assert.ok(ordered.ok, ordered.ok ? '' : ordered.reason);
  const cashAfterOrder = game.cash;
  const freeBefore = freeHeavyBays(game, home);
  for (let minute = 0; minute < 1440 * 2 && plane.refitPending; minute++) step(game);
  assert.equal(plane.refitPending, undefined, 'refit never started');
  const event = game.aogs.find((e) => e.tail === plane.tail && e.refitTo);
  assert.ok(event, 'no refit in work');
  assert.equal(freeHeavyBays(game, home), event.inBay ? freeBefore - 1 : freeBefore);
  const spent = cashAfterOrder - game.cash;
  for (let minute = 0; minute < 1440 * 8 && game.aogs.some((e) => e.tail === plane.tail && e.refitTo); minute++) step(game);
  assert.deepEqual(plane.seatPlan, { business: 4, premium: 8 });
  assert.equal(freeHeavyBays(game, home), freeBefore, 'the bay was not given back');
  return { inBay: event.inBay === true, spent };
}
const inHouse = refitAtHome(true);
const contracted = refitAtHome(false);
assert.equal(inHouse.inBay, true);
assert.equal(contracted.inBay, false);
assert.ok(contracted.spent > inHouse.spent, 'a contracted refit should cost more than one in a bay');
console.log('ok: seat plans, split, refit bays');
