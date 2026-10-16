import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { dayIndex } from './clock';
import { HOLD_DAYS, holdDaysLeft, takeListing } from './market';
import { leasePlane, planeOptions } from './playerActions';
import { listingForOrder, rollStandingOrders, setStandingOrder, standingOrderOf } from './standingOrders';
import { leaseRateFor } from './leasing';

// Run with `npm test -- fleetmarket`: a new listing is held from rivals for
// HOLD_DAYS, a lease can name the airframe (and so the age) it takes, and a
// standing order leases the youngest matching listing once, then clears.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
state.cash = 50_000_000;
const today = dayIndex(state);
const market = state.market;
const add = (ageYears: number, listedDay = today) => {
  const id = market.nextListingId++;
  market.listings.push({ id, typeCode: 'PROP', ageYears, leasePricePerDay: leaseRateFor('PROP', ageYears), listedDay });
  return id;
};
market.listings = [];

// Hold: rivals can't take it until the hold ends; the player can at once.
const held = add(16);
assert.equal(holdDaysLeft(state, market.listings[0]), HOLD_DAYS);
assert.equal(takeListing(state, 'PROP', undefined, true), null, 'a rival took a held listing');
state.simMinute += HOLD_DAYS * 1440;
assert.equal(holdDaysLeft(state, market.listings[0]), 0);
assert.equal(takeListing(state, 'PROP', held, true)?.id, held, 'a rival could not take it after the hold');

// Choosing an age: the lease takes the named airframe.
market.listings = [];
const old = add(24, dayIndex(state));
const young = add(15, dayIndex(state));
assert.equal(planeOptions(state, state.homeAirport).find((o) => o.code === 'PROP')!.choices.length, 2);
const before = state.inboundLeases?.length ?? 0;
assert.equal(leasePlane(state, state.homeAirport, 'PROP', false, undefined, young).ok, true);
assert.equal(state.inboundLeases!.length, before + 1);
assert.equal(state.inboundLeases![before].ageYears, 15, 'leased the wrong age');
assert.deepEqual(market.listings.map((l) => l.id), [old]);
assert.equal(leasePlane(state, state.homeAirport, 'PROP', false, undefined, young).ok, false, 'leased a listing twice');

// Standing order: no match keeps it waiting; a match leases the youngest fit and clears it.
setStandingOrder(state, 'PROP', { maxAgeYears: 20 });
assert.deepEqual(rollStandingOrders(state), []);
assert.ok(standingOrderOf(state, 'PROP'), 'order cleared without a match');
const fit18 = add(18, dayIndex(state));
add(19, dayIndex(state));
assert.equal(listingForOrder(state, 'PROP', standingOrderOf(state, 'PROP')!)?.id, fit18);
const inbound = state.inboundLeases!.length;
assert.equal(rollStandingOrders(state).length, 1);
assert.equal(state.inboundLeases!.length, inbound + 1);
assert.equal(state.inboundLeases![inbound].ageYears, 18);
assert.equal(standingOrderOf(state, 'PROP'), null, 'order not cleared after leasing');

// Cash short: the order waits.
setStandingOrder(state, 'PROP', { maxAgeYears: 20 });
state.cash = 0;
assert.deepEqual(rollStandingOrders(state), []);
assert.ok(standingOrderOf(state, 'PROP'));
console.log('fleet market ok');
