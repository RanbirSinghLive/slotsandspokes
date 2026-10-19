import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { dayIndex } from './clock';
import { activeTranches, airlineFuelPrice, FUEL_RUNGS, hedgedShare, rungInterval, setFuelPolicy, surchargeFor } from './fuelPrice';
import { policyFare } from './pricing';
import { step } from './step';

// Run with `npm test -- fuel`: the standing fuel policy keeps a ladder of
// rungs that fills over one term and never covers more than the dial, the
// airline pays a blend of market and locked prices, the surcharge lifts
// policy fares only above the usual price, and the long term waits for a
// treasury CFO.
const sitter = createPlayer('sitter');
const state = startHeadlessGame('YYZ', 2, sitter);
const runDay = () => {
  for (let minute = 0; minute < 1440; minute++) step(state);
  sitter.playDay(state);
};
for (let day = 0; day < 5; day++) runDay();

assert.equal(setFuelPolicy(state, { cover: 0.5, termDays: 180, buy: 'any', surcharge: 0 }).ok, false, '180 days needs a treasury CFO');
state.cash += 1_000_000;
const set = setFuelPolicy(state, { cover: 0.75, termDays: 30, buy: 'any', surcharge: 0 });
assert.ok(set.ok, 'a policy can be set');
assert.equal(activeTranches(state).length, 1, 'the first rung is bought at once');
assert.ok(Math.abs(hedgedShare(state) - 0.75 / FUEL_RUNGS) < 1e-9);

// Flicking the dials can't buy rungs faster than the ladder does.
setFuelPolicy(state, { cover: 0.5, termDays: 30, buy: 'any', surcharge: 0 });
setFuelPolicy(state, { cover: 0.75, termDays: 30, buy: 'any', surcharge: 0 });
assert.equal(activeTranches(state).length, 1, 'changing the dials buys no extra rung');
assert.equal(state.fuelNextRungDay, dayIndex(state) + rungInterval(30));

for (let day = 0; day < 40; day++) {
  runDay();
  assert.ok(hedgedShare(state) <= 0.75 + 1e-9, 'never more than the cover');
  const paid = airlineFuelPrice(state);
  const locked = activeTranches(state).map((tranche) => tranche.lockedPrice);
  const prices = [state.fuelPriceIndex, ...locked];
  assert.ok(paid >= Math.min(...prices) - 1e-9 && paid <= Math.max(...prices) + 1e-9, 'the airline pays a blend');
}
// One more minute runs the day's rollover, where the next rung is bought.
step(state);
assert.equal(activeTranches(state).length, FUEL_RUNGS, 'a full ladder after one term');
assert.ok(Math.abs(hedgedShare(state) - 0.75) < 1e-9);
assert.ok((state.fuelPaidHistory?.length ?? 0) >= 40, 'paid history kept beside the market one');
assert.ok((state.fuelBook?.premiums ?? 0) > 0, 'premiums are booked');
console.log('fuel ladder: ok');

// The surcharge: nothing at or under usual, a share of the rise above it.
setFuelPolicy(state, { cover: 0, termDays: 30, buy: 'any', surcharge: 1 });
const leg = state.schedule[0];
state.fuelPriceIndex = 0.9;
assert.equal(surchargeFor(state), 0, 'no surcharge under the usual price');
state.fuelPriceIndex = 1.4;
assert.ok(Math.abs(surchargeFor(state) - 0.12) < 1e-9, 'full surcharge on +40% fuel is +12%');
const before = policyFare(state, leg.origin, leg.dest);
state.fuelSurcharge = surchargeFor(state);
assert.ok(policyFare(state, leg.origin, leg.dest) > before, 'the surcharge lifts policy fares');
console.log('fuel surcharge: ok');

// An older save's one hedge reads as a rung covering all the fuel, and becomes one at rollover.
const old = startHeadlessGame('YYZ', 3, createPlayer('sitter'));
const today = dayIndex(old);
old.fuelHedge = { lockedPrice: 0.9, startDay: today, endDay: today + 30, premium: 1000, saved: 0 };
assert.equal(hedgedShare(old), 1);
assert.equal(airlineFuelPrice(old), 0.9);
for (let minute = 0; minute < 1440; minute++) step(old);
assert.equal(old.fuelHedge, undefined);
assert.equal(old.fuelTranches?.length, 1);
console.log('fuel old save: ok');
