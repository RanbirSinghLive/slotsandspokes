import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { step } from './step';

// Run with `npm run overnighttest`: a round trip whose return leg lands after
// midnight flies every day. Landing was once recorded against the new day, so
// that day's own departure of the same leg counted as already flown and the
// plane flew about one round trip every two and a half days.
const state = startHeadlessGame('YYZ', 4, createPlayer('bold'));
const aircraft = state.aircraft[0];
const base = aircraft.baseAirport!;
const other = state.schedule.find((leg) => leg.tail === aircraft.tail && leg.dest !== base)?.dest ?? state.schedule[0].dest;

// Two 9 hour legs: out 06:00, back 15:30, landing 00:30 the next day.
state.schedule = [
  { legId: 'T-1', tail: aircraft.tail, origin: base, dest: other, departMinute: 360, blockMinutes: 540 },
  { legId: 'T-2', tail: aircraft.tail, origin: other, dest: base, departMinute: 930, blockMinutes: 540 },
] as typeof state.schedule;

let departures = 0;
let airborne = false;
const days = 12;
for (let minute = 0; minute < 1440 * days; minute++) {
  step(state);
  const flying = state.activeFlights.some((flight) => flight.tail === aircraft.tail);
  if (flying && !airborne) departures++;
  airborne = flying;
}
// Two legs a day for 12 days is 24; allow for weather and breakdowns, but a plane losing every other day would sit near 10.
assert.ok(departures >= 18, `a daily round trip over midnight flew only ${departures} legs in ${days} days`);
console.log(`ok: ${departures} legs in ${days} days`);
