import assert from 'node:assert/strict';
import { flightNumber } from './flightNumbers';
import type { ScheduleLeg } from './schedule';

// Run with `npm run flightnumbertest`: a route and its return are an even
// and an odd number, a repeat departure gets a distinct number, and a
// number never changes with the order legs are listed in.
const leg = (legId: string, origin: string, dest: string, departMinute: number): ScheduleLeg => ({ legId, tail: 'C-P001', origin, dest, departMinute, blockMinutes: 90 });
const out = leg('a', 'YUL', 'YYZ', 360);
const back = leg('b', 'YYZ', 'YUL', 480);
const again = leg('c', 'YUL', 'YYZ', 900);
const schedule = [out, back, again];
const digits = (text: string) => Number(text.split(' ')[1]);

assert.equal(Math.abs(digits(flightNumber(schedule, out)) - digits(flightNumber(schedule, back))), 1);
assert.notEqual(flightNumber(schedule, out), flightNumber(schedule, again));
assert.equal(flightNumber([...schedule].reverse(), out), flightNumber(schedule, out));
console.log('flight numbers: ok');
