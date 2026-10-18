import assert from 'node:assert/strict';
import aircraftTypesData from '../../data/aircraft-types.json';
import airportsData from '../../data/airports.json';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { completeInnovation } from './innovations';
import { rangeNmFor } from './range';
import { planRetime } from './retime';
import { applyRotation, planRotation, type RotationStop } from './rotations';
import { legsServingMarket } from './schedule';
import { step } from './step';
import { aircraftUtilisation } from './utilisation';

// Run with `npm run ultrahaultest`: a sector beyond the widebody's range needs the ultra-long-range
// kit, and a round trip longer than a day is flown by each plane every other day, so two planes
// on opposite days make one departure a day each way.
const stopOf = (iata: string): RotationStop => {
  const airport = (airportsData as { iata: string; name: string; lat: number; lon: number }[]).find((a) => a.iata === iata)!;
  return { iata, name: airport.name, lat: airport.lat, lon: airport.lon };
};

const state = startHeadlessGame('YVR', 4, createPlayer('bold'));
const template = state.aircraft[0];
const spec = (aircraftTypesData as { code: string; seats: number }[]).find((type) => type.code === 'WIDEBODY')!;
const planes = ['C-W901', 'C-W902'].map((tail) => {
  const plane = { ...structuredClone(template), tail, typeCode: spec.code, baseAirport: 'YVR', atAirport: 'YVR', status: 'ground' as const };
  state.aircraft.push(plane);
  return plane;
});
state.schedule = [];
// Crews for both planes: flying them is not what is under test.
const yvrCrews = (state.crewBases ??= {}).YVR ?? { crewsByClass: {}, hiring: [], retraining: [] };
yvrCrews.crewsByClass.WIDEBODY = 20;
yvrCrews.cabinByClass = { ...yvrCrews.cabinByClass, WIDEBODY: 20 };
state.crewBases.YVR = yvrCrews;
state.knownAirports = [...new Set([...state.knownAirports, 'SYD'])];

const before = planRotation([stopOf('YVR')], stopOf('SYD'), planes[0].tail, state);
assert.ok(before.error, 'Sydney is beyond a widebody without the kit');
assert.equal(rangeNmFor(state, 'WIDEBODY'), 5500);

completeInnovation(state, 'ultra-long-range');
assert.equal(rangeNmFor(state, 'WIDEBODY'), 8500);

const first = planRotation([stopOf('YVR')], stopOf('SYD'), planes[0].tail, state);
assert.equal(first.error, null, first.error ?? '');
assert.ok(first.clockMinutes > 1440, 'a Sydney round trip outruns a day');
assert.ok(first.legs[1].departMinute < 1440, 'its flight back leaves before midnight');
applyRotation(state, planes[0].tail, first);
const second = planRotation([stopOf('YVR')], stopOf('SYD'), planes[1].tail, state);
assert.equal(second.error, null, second.error ?? '');
applyRotation(state, planes[1].tail, second);

const parities = planes.map((plane) => state.schedule.filter((leg) => leg.tail === plane.tail).map((leg) => leg.dayParity));
assert.deepEqual(parities[0], [parities[0][0], parities[0][0]]);
assert.notEqual(parities[0][0], undefined);
assert.notEqual(parities[0][0], parities[1][0], 'the second plane takes the other days');
assert.equal(legsServingMarket('YVR', 'SYD', state.schedule), 2, 'two planes every other day are one daily round trip');
assert.equal(aircraftUtilisation(state, planes[0].tail).share, 1);

// Moving it within the day is allowed; a start that sends the flight back past midnight is not.
const legIds = state.schedule.filter((leg) => leg.tail === planes[0].tail).map((leg) => leg.legId);
const earlier = planRetime(state, legIds, planes[0].tail, 300);
assert.ok(earlier.ok, earlier.reason ?? '');
assert.ok(earlier.legs.every((leg) => leg.dayParity === parities[0][0]), 'a move keeps its days');
const later = planRetime(state, legIds, planes[0].tail, 20 * 60);
assert.equal(later.ok, false, 'the flight back would leave after midnight');

// A saved game reloads to the same thing.
assert.deepEqual(JSON.parse(JSON.stringify(state.schedule)), state.schedule);

const departures = new Map<string, number[]>();
let airborne = new Set<string>();
const days = 12;
for (let minute = 0; minute < 1440 * days; minute++) {
  step(state);
  const nowFlying = new Set(state.activeFlights.filter((flight) => planes.some((p) => p.tail === flight.tail)).map((flight) => flight.legId));
  for (const legId of nowFlying) {
    if (!airborne.has(legId)) departures.set(legId, [...(departures.get(legId) ?? []), Math.floor(minute / 1440)]);
  }
  airborne = nowFlying;
}
const total = [...departures.values()].reduce((sum, list) => sum + list.length, 0);
// Each plane flies out and back every other day: two legs per two days per plane, four legs every two days overall.
assert.ok(total >= 16, `the two planes flew only ${total} legs in ${days} days`);
for (const [legId, list] of departures) {
  const leg = state.schedule.find((l) => l.legId === legId)!;
  for (let i = 1; i < list.length; i++) assert.ok(list[i] - list[i - 1] >= 2, `${legId} flew on consecutive days (${leg.dayParity})`);
}
console.log(`ok: ${total} legs in ${days} days`);
