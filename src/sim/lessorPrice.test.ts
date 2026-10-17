import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { dayIndex } from './clock';
import { leaseRateFor } from './leasing';
import { MARKET_RHYTHM, PRICE_MAX, PRICE_MIN, priceIndexOf, rollDailyMarket } from './market';
import { leasePlane } from './playerActions';

// Run with `npm test -- lessorPrice`: an emptied shelf pushes its class's
// lessor price up (and brings deliveries sooner), a sitting shelf eases it
// down more slowly, both within limits, and a signed lease keeps its rate.
const state = startHeadlessGame('YYZ', 1, createPlayer('steady'));
state.cash = 50_000_000;
const market = state.market;
const roll = (days: number) => {
  for (let i = 0; i < days; i++) {
    state.simMinute += 1440;
    rollDailyMarket(state, dayIndex(state));
  }
};

// Empty shelf: the price climbs, capped.
market.listings = [];
market.nextArrivalDay.PROP = 10_000;
roll(10);
assert.ok(priceIndexOf(market, 'PROP') > 1.1, 'an empty shelf did not raise the price');
roll(100);
assert.equal(priceIndexOf(market, 'PROP'), PRICE_MAX);

// A new listing is priced at the level, and a squeezed class refills sooner.
market.nextArrivalDay.PROP = dayIndex(state) + 1;
roll(1);
const listing = market.listings.find((l) => l.typeCode === 'PROP')!;
assert.equal(listing.leasePricePerDay, Math.round((leaseRateFor('PROP', listing.ageYears) * PRICE_MAX) / 10) * 10);
const base = MARKET_RHYTHM.PROP.intervalDays;
assert.ok(market.nextArrivalDay.PROP - dayIndex(state) < base, 'a squeezed class refilled no sooner');

// Signing locks the rate: a later price move does not touch the leased plane.
assert.equal(leasePlane(state, state.homeAirport, 'PROP', false, undefined, listing.id).ok, true);
const signed = state.inboundLeases![state.inboundLeases!.length - 1].leasePricePerDay;
assert.equal(signed, listing.leasePricePerDay);
roll(5);
assert.equal(state.inboundLeases![state.inboundLeases!.length - 1].leasePricePerDay, signed);

// Listings sitting past their hold ease the price, slower than it rose, never below the floor.
market.nextArrivalDay.PROP = 10_000;
market.listings = [{ id: market.nextListingId++, typeCode: 'PROP', ageYears: 20, leasePricePerDay: 1, listedDay: dayIndex(state) - 10 }];
const high = priceIndexOf(market, 'PROP');
roll(10);
const eased = priceIndexOf(market, 'PROP');
assert.ok(eased < high && high - eased < 0.1, 'the price did not ease slowly');
roll(400);
assert.equal(priceIndexOf(market, 'PROP'), PRICE_MIN);
assert.equal(market.listings[0].leasePricePerDay, Math.round((leaseRateFor('PROP', 20) * PRICE_MIN) / 10) * 10, 'the sitting listing was not re-priced');

// A locked class does not drift: nothing can use it yet.
assert.equal(priceIndexOf(market, 'WIDEBODY'), 1);
console.log('lessorPrice ok');
