import assert from 'node:assert/strict';
import aircraftTypesData from '../../data/aircraft-types.json';
import airportsData from '../../data/airports.json';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { airportHours, freeInHour } from './hours';
import { applyRotation, planRotation, type RotationStop } from './rotations';

// Run with `npm test -- longhaulHour`: a new long-haul round trip opens at
// 06:00 like any other, so when that hour is full at an end it starts in the
// next hour with room rather than failing.
const stopOf = (iata: string): RotationStop => {
  const airport = (airportsData as { iata: string; name: string; lat: number; lon: number }[]).find((a) => a.iata === iata)!;
  return { iata, name: airport.name, lat: airport.lat, lon: airport.lon };
};

const state = startHeadlessGame('YVR', 4, createPlayer('bold'));
const template = state.aircraft[0];
const spec = (aircraftTypesData as { code: string }[]).find((type) => type.code === 'WIDEBODY')!;
state.aircraft.push({ ...structuredClone(template), tail: 'C-W901', typeCode: spec.code, baseAirport: 'YVR', atAirport: 'YVR', status: 'ground' });

const open = planRotation([stopOf('YVR')], stopOf('BOG'), 'C-W901', state);
assert.equal(open.error, null, `YVR-BOG should plan on an open day: ${open.error}`);
assert.equal(open.legs[0].departMinute, 360, 'an open day starts at 06:00');

// Fill YVR's 06:00 hour with someone else's departures.
const free = freeInHour(airportHours(state, 'YVR'), 6);
for (let index = 0; index < free; index++) {
  state.schedule.push({ legId: `FILL-${index}`, tail: template.tail, origin: 'YVR', dest: 'YYJ', departMinute: 360 + index, blockMinutes: 30 });
}
assert.equal(freeInHour(airportHours(state, 'YVR'), 6), 0, 'the 06:00 hour is full');

const held = planRotation([stopOf('YVR')], stopOf('BOG'), 'C-W901', state);
assert.equal(held.error, null, `a full 06:00 should push the long-haul start later, not fail: ${held.error}`);
assert.equal(held.legs[0].departMinute, 420, 'it leaves at 07:00, the next hour with room');
assert.equal(held.heldBack?.hour, 6);
applyRotation(state, 'C-W901', held);
assert.equal(state.schedule.find((leg) => leg.tail === 'C-W901' && leg.origin === 'YVR')?.departMinute, 420, 'committed at 07:00');
console.log(`ok: YVR-BOG held from 06:00 to ${held.legs[0].departMinute / 60}:00`);
