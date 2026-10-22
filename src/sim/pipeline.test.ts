import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { dayIndex } from './clock';
import { PIPELINE_DAYS, pipelineItems } from './pipeline';
import { step } from './step';

// The pipeline read-out: items sit inside the horizon, soonest first, an
// overdue check sits on today, a booked D check takes its plane's C off,
// a grounded plane shows as a span to the day it's back, and attendants
// joining sit on the crew lane.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
for (let minute = 0; minute < 1440; minute++) step(state);
const today = dayIndex(state);
const aircraft = state.aircraft[0];

aircraft.daysSinceHeavyCheck = 200;
let items = pipelineItems(state);
const c = items.find((item) => item.key === `C:${aircraft.tail}`);
assert.ok(c, 'an overdue C check is in the pipeline');
assert.equal(c.day, today, 'overdue sits on today');
assert.equal(c.tone, 'bad');
for (const item of items) assert.ok(item.day >= today && item.day <= today + PIPELINE_DAYS, `${item.key} inside the horizon`);
for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].day <= items[i].day, 'soonest first');

aircraft.daysSinceD = 10_000;
aircraft.dCheckBooked = true;
items = pipelineItems(state);
assert.ok(!items.some((item) => item.key === `C:${aircraft.tail}`), 'a booked D check does the C');
assert.equal(items.find((item) => item.key === `D:${aircraft.tail}`)?.tone, 'good');
delete aircraft.dCheckBooked;

state.aogs.push({ tail: aircraft.tail, base: aircraft.baseAirport ?? 'YYZ', fault: 'hydraulics', returnsAtMinute: (today + 4) * 1440, uncoveredRoutes: [], coveredRotations: 0, movedLegIds: [] });
const aog = pipelineItems(state).find((item) => item.key === `aog:${aircraft.tail}`);
assert.ok(aog && aog.day === today && aog.endDay === today + 4, 'an AOG spans to the day it is back');

const home = state.crewBases?.[aircraft.baseAirport ?? 'YYZ'];
assert.ok(home, 'the home is a crew base');
(home.cabinHiring ??= []).push({ classCode: 'REGIONAL', count: 3, readyDay: today + 6 });
const cabin = pipelineItems(state).find((item) => item.kind === 'cabin');
assert.ok(cabin && cabin.lane === 'crew' && cabin.count === 3 && cabin.day === today + 6, 'attendants joining are on the crew lane');

assert.deepEqual(JSON.parse(JSON.stringify(state)).aogs, state.aogs, 'reading the pipeline leaves state plain');
console.log('ok · pipeline read-out');
