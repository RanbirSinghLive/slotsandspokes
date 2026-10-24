import assert from 'node:assert/strict';
import airportsData from '../../data/airports.json';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { planRetime } from './retime';
import { applyRotation, planRotation, type RotationStop } from './rotations';
import { SAME_ROUTE_SPACING_MINUTES, sameRouteClash, stackedDepartures, type ScheduleLeg } from './schedule';

// Run with `npm test -- sameRouteSpacing`: two of your flights on the same
// route the same way leave at least SAME_ROUTE_SPACING_MINUTES apart, however
// they get placed: a new route is nudged clear, a drag closer is refused.
const leg = (legId: string, tail: string, origin: string, dest: string, departMinute: number, dayParity?: 0 | 1): ScheduleLeg => ({
  legId,
  tail,
  origin,
  dest,
  departMinute,
  blockMinutes: 60,
  ...(dayParity !== undefined ? { dayParity } : {}),
});

const first = leg('A', 'T1', 'YYZ', 'YUL', 900);
assert.ok(sameRouteClash(leg('B', 'T2', 'YYZ', 'YUL', 900 + SAME_ROUTE_SPACING_MINUTES - 1), [first]), 'under the spacing clashes');
assert.equal(sameRouteClash(leg('B', 'T2', 'YYZ', 'YUL', 900 + SAME_ROUTE_SPACING_MINUTES), [first]), undefined, 'exactly the spacing is fine');
assert.equal(sameRouteClash(leg('B', 'T2', 'YUL', 'YYZ', 900), [first]), undefined, 'the opposite way at the same minute is a bank, not a clash');
assert.equal(sameRouteClash(leg('B', 'T2', 'YYZ', 'YUL', 900, 1), [{ ...first, dayParity: 0 }]), undefined, 'alternate days on opposite parities never meet');
assert.ok(sameRouteClash(leg('B', 'T2', 'YYZ', 'YUL', 900 - 1440 + 5), [first]), 'a flight back stored a day early is compared on the clock');
assert.deepEqual([...stackedDepartures([first, leg('B', 'T2', 'YYZ', 'YUL', 905)]).keys()].sort(), ['A', 'B']);

const stopOf = (iata: string): RotationStop => {
  const airport = (airportsData as { iata: string; name: string; lat: number; lon: number }[]).find((a) => a.iata === iata)!;
  return { iata, name: airport.name, lat: airport.lat, lon: airport.lon };
};

const state = startHeadlessGame('YYZ', 7, createPlayer('bold'));
state.schedule = [];
const template = state.aircraft[0];
state.aircraft = [
  { ...structuredClone(template), tail: 'C-T901', baseAirport: 'YYZ', atAirport: 'YYZ', status: 'ground' },
  { ...structuredClone(template), tail: 'C-T902', baseAirport: 'YYZ', atAirport: 'YYZ', status: 'ground' },
];

const one = planRotation([stopOf('YYZ')], stopOf('YUL'), 'C-T901', state);
assert.equal(one.error, null, `YYZ-YUL should plan: ${one.error}`);
applyRotation(state, 'C-T901', one);
const two = planRotation([stopOf('YYZ')], stopOf('YUL'), 'C-T902', state);
assert.equal(two.error, null, `a second YYZ-YUL should plan: ${two.error}`);
applyRotation(state, 'C-T902', two);
assert.equal(stackedDepartures(state.schedule).size, 0, 'two planes on one route are placed apart');

const secondLegs = state.schedule.filter((l) => l.tail === 'C-T902');
const firstOut = state.schedule.find((l) => l.tail === 'C-T901' && l.origin === 'YYZ')!;
const close = planRetime(state, secondLegs.map((l) => l.legId), 'C-T902', firstOut.departMinute + 5);
assert.equal(close.ok, false, 'dragging it 5 minutes behind the first is refused');
assert.match(close.reason ?? '', /YYZ→YUL .* C-T901 .* 15m apart/);
const clear = planRetime(state, secondLegs.map((l) => l.legId), 'C-T902', firstOut.departMinute + SAME_ROUTE_SPACING_MINUTES * 4);
assert.ok(clear.ok || !/apart/.test(clear.reason ?? ''), `an hour behind is not refused for spacing: ${clear.reason}`);
console.log(`ok: second YYZ-YUL leaves ${secondLegs[0].departMinute - firstOut.departMinute}m after the first; ${close.reason}`);
