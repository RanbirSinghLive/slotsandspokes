import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { layoutFor } from './cabins';
import { attendantsForLayout, cabinCover, cabinNeed, ensureCrewBases, planeCabinNeed, rollDailyCrews } from './crews';
import { step } from './step';

// Run with `npm test -- cabinCrew`: attendants follow the seat plan. One for
// every 50 seats or part of them is the legal floor, under which a plane
// stays on the ground; premium seats need more for full service; and a save
// from when cabin crew counted in teams loads with no plane grounded.

// The floor: 50 seats is one attendant, 51 is two; a 75-seat Regional needs two, a 150-seat Narrowbody three.
assert.deepEqual(attendantsForLayout({ economy: 50, premium: 0, business: 0 }), { floor: 1, full: 1 });
assert.deepEqual(attendantsForLayout({ economy: 51, premium: 0, business: 0 }), { floor: 2, full: 2 });
assert.deepEqual(attendantsForLayout(layoutFor(75, { business: 0, premium: 0 })), { floor: 2, full: 2 });
assert.deepEqual(attendantsForLayout(layoutFor(150, { business: 0, premium: 0 })), { floor: 3, full: 3 });
// A Regional with 18 J seats is down to 48 seats: one attendant by law, three for full service.
assert.deepEqual(attendantsForLayout(layoutFor(75, { business: 18, premium: 0 })), { floor: 1, full: 3 });
// Premium seats need more hands: 12J 24W 84Y on a Narrowbody is 3 by law, 4 for full service.
assert.deepEqual(attendantsForLayout(layoutFor(150, { business: 12, premium: 24 })), { floor: 3, full: 4 });

const player = createPlayer('bold');
const state = startHeadlessGame('YYZ', 4, player);
for (let day = 1; day <= 75; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}
const flying = state.aircraft.filter((a) => a.typeCode !== 'PROP' && planeCabinNeed(state, a.tail).floor > 0);
assert.ok(flying.length > 0, 'the game needs a plane that carries cabin crew');
const plane = flying[0];
const base = state.crewBases![plane.baseAirport!];

// Enough pilots for everyone, then one attendant short of the floors (sickness can only take more): a plane stays on the ground for its cabin.
const short = structuredClone(state);
const shortBase = short.crewBases![plane.baseAirport!];
shortBase.crewsByClass[plane.typeCode] = 50;
shortBase.sick = [];
shortBase.cabinSick = [];
shortBase.cabinByClass![plane.typeCode] = cabinNeed(short, plane.baseAirport!, plane.typeCode).minimum - 1;
rollDailyCrews(short);
const cabinGrounded = short.crewDay?.cabinShortTails ?? [];
assert.ok(cabinGrounded.length > 0, 'a plane under its legal cabin floor flew');
assert.ok(cabinGrounded.every((tail) => short.groundedTails.includes(tail)), 'a cabin-short plane was not grounded');

// Twenty spare over full service, more than a day's sickness takes: every flying plane's cabin is at full cover.
const full = structuredClone(state);
const fullBase = full.crewBases![plane.baseAirport!];
fullBase.crewsByClass[plane.typeCode] = 50;
fullBase.sick = [];
fullBase.cabinByClass![plane.typeCode] = cabinNeed(full, plane.baseAirport!, plane.typeCode).full + 20;
rollDailyCrews(full);
for (const a of full.aircraft.filter((a) => a.typeCode === plane.typeCode && a.baseAirport === plane.baseAirport && !full.groundedTails.includes(a.tail))) {
  if (planeCabinNeed(full, a.tail).full > 0) assert.equal(cabinCover(full, a.tail), 1, `${a.tail} short of full service with attendants to spare`);
}

// A save from when cabin crew counted in teams: one Regional team stood for two attendants, and nothing loads under the floor.
const old = structuredClone(state);
const oldBase = old.crewBases![plane.baseAirport!];
delete oldBase.cabinUnit;
oldBase.cabinByClass = { [plane.typeCode]: 1 };
oldBase.cabinHiring = [{ classCode: plane.typeCode, count: 2, readyDay: 999 }];
ensureCrewBases(old);
assert.equal(oldBase.cabinUnit, 'attendant');
assert.ok(oldBase.cabinByClass![plane.typeCode] >= cabinNeed(old, plane.baseAirport!, plane.typeCode).minimum, 'an old save loaded under the legal floor');
assert.ok(oldBase.cabinHiring![0].count >= 4, 'teams in training were not turned into attendants');
// And a loaded save converts only once.
const after = oldBase.cabinByClass![plane.typeCode];
ensureCrewBases(old);
assert.equal(oldBase.cabinByClass![plane.typeCode], after);
assert.equal(base.cabinUnit, 'attendant', 'a new game counts attendants from the start');

console.log(`cabin crew ok · ${plane.tail} needs ${planeCabinNeed(state, plane.tail).floor} by law, ${planeCabinNeed(state, plane.tail).full} for full service`);
