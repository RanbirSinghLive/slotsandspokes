import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { dayIndex } from './clock';
import { removeOrphanFlights, rollDailyFleet, startReturn } from './fleetTiming';
import { planRotation } from './rotations';
import { rotationsForTail } from './utilisation';
import { coverRotations } from './turnBuffer';
import { playDays } from '../headless/simulate';

// Run with `npm run ghostflighttest`: a plane going back to the lessor takes
// no new flights, from the route planner or from AOG cover, and whatever is
// still on it when it leaves the fleet comes off with it. A save that holds
// flights on a plane no longer in the fleet loses them on load.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
playDays(state, player, 20);
const flying = [...new Set(state.schedule.map((leg) => leg.tail))];
assert.ok(flying.length >= 2, 'two planes with flights by day 20');
const [leaver, grounded] = flying.map((tail) => state.aircraft.find((a) => a.tail === tail)!);
assert.equal(leaver.typeCode, grounded.typeCode, 'the starting fleet is one type');

// A returning plane is not offered as AOG cover.
const leaverLegs = state.schedule.filter((leg) => leg.tail === leaver.tail);
state.schedule = state.schedule.filter((leg) => leg.tail !== leaver.tail);
startReturn(state, leaver);
const covered = coverRotations(state, grounded.tail, rotationsForTail(state, grounded.tail));
assert.ok(!state.schedule.some((leg) => leg.tail === leaver.tail), 'no cover flights handed to a returning plane');
assert.ok(covered.covered === 0 || covered.movedLegIds.every((id) => !id.startsWith(leaver.tail)));

// Nor by the route planner.
const first = leaverLegs[0];
const stop = (iata: string) => ({ iata, name: iata, lat: 0, lon: 0 });
assert.match(planRotation([stop(first.origin)], stop(first.dest), leaver.tail, state).error ?? '', /returning/);

// Flights still on it when it goes come off with it, and so do its markets' settings when nobody else flies them.
state.schedule.push(...leaverLegs);
const today = dayIndex(state);
leaver.returningOnDay = today;
rollDailyFleet(state);
assert.ok(!state.aircraft.includes(leaver), 'the plane has gone');
assert.ok(!state.schedule.some((leg) => leg.tail === leaver.tail), 'and its flights with it');

// An old save's orphaned flights come off on load.
state.schedule.push(...leaverLegs);
assert.equal(removeOrphanFlights(state), leaverLegs.length);
assert.equal(removeOrphanFlights(state), 0, 'safe to run again');

console.log('ghost flights: ok');
