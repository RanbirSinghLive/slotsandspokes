import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { airportWatch, movementShareAt, rollAirportShares, shareTrend, SHARE_HISTORY_DAYS } from './airportWatch';
import { MOAT_FLOOR_DEPARTURES } from './stations';

// Run with `npm test -- airportWatch`: the Airports screen's watch list and the weekly share.
const state = startHeadlessGame('YHZ', 7, createPlayer('steady'));
const tail = state.aircraft[0].tail;
state.schedule = [
  { legId: 'T-1', tail, origin: 'YHZ', dest: 'BOS', departMinute: 420, blockMinutes: 90 },
  { legId: 'T-2', tail, origin: 'BOS', dest: 'YHZ', departMinute: 560, blockMinutes: 90 },
  { legId: 'T-3', tail, origin: 'YHZ', dest: 'YQB', departMinute: 700, blockMinutes: 90 },
  { legId: 'T-4', tail, origin: 'YQB', dest: 'YHZ', departMinute: 840, blockMinutes: 90 },
] as typeof state.schedule;

// Share: yours of every airline's movements, so a field only you fly is all yours.
const share = movementShareAt(state, 'YHZ');
assert.ok(share !== null && share > 0 && share <= 1, `YHZ share ${share}`);
assert.equal(shareTrend(state, 'YHZ'), null, 'no trend before two days');
for (let day = 0; day < SHARE_HISTORY_DAYS + 3; day++) rollAirportShares(state);
assert.equal(state.airportShares?.YHZ.length, SHARE_HISTORY_DAYS, 'a week kept, no more');
assert.equal(shareTrend(state, 'YHZ'), 0, 'an unchanged schedule holds its share');
assert.equal(state.airportShares?.LGA, undefined, 'fields you do not fly are not kept');
console.log(`ok: YHZ share ${Math.round(share! * 100)}%`);

// The feed idea from two spokes at Halifax shows up (Moncton, PR #203's example) only once it is worth a call.
const items = airportWatch(state);
const feed = items.find((item) => item.kind === 'feed');
console.log('ok: watch', items.map((item) => `${item.kind} ${item.iata}`).join(', ') || 'none');
if (feed) assert.equal(feed.iata, 'YHZ');

// A moat that drains below its floor is called out with the days it has left.
state.stationMoatDays = { YHZ: 10 };
state.schedule = state.schedule.slice(0, 2);
const moat = airportWatch(state).find((item) => item.kind === 'moat');
assert.ok(moat && moat.kind === 'moat', 'home station under its floor shows on the list');
assert.equal(moat.daysLeft, 5);
assert.equal(moat.floor, MOAT_FLOOR_DEPARTURES.own);
console.log('ok: moat', moat.daysLeft, 'days left');

// The list is the same twice: no hidden randomness, and its order never wobbles.
assert.deepEqual(airportWatch(state), airportWatch(state));
console.log('ok: watch list is stable');
