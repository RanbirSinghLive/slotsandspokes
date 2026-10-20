import assert from 'node:assert/strict';
import { startHeadlessGame } from '../headless/newGame';
import { createPlayer } from '../headless/player';
import { lineRated } from './bases';
import { dayStartMinute } from './clock';
import { finishLineSlips, planLineSlips, setLineLocked } from './lineSlips';
import { tonightCheck } from './mxChecks';
import type { ScheduleLeg } from './schedule';
import type { Aircraft } from './state';

// Run with `npm test -- lineSlips`: a plane due its line check on a night
// stop trades the rest of its day with a twin it meets at base, and keeps
// the twin's whole line from the next day.
const state = startHeadlessGame('YUL', 1, createPlayer('steady'));
const dayStart = dayStartMinute(state);
const first = state.aircraft[0];
assert.ok(lineRated(state, 'YUL', first.typeCode), 'home should be a line base for the starting type');

function plane(tail: string, at: string, nightsSinceLine: number): Aircraft {
  return { ...first, tail, status: 'ground', atAirport: at, baseAirport: 'YUL', groundSinceMinute: dayStart - 300, nightsSinceLine, deferredItems: undefined, lineLocked: undefined };
}
function leg(legId: string, tail: string, origin: string, dest: string, depart: string, blockMinutes: number): ScheduleLeg {
  const [hours, minutes] = depart.split(':').map(Number);
  return { legId, tail, origin, dest, departMinute: hours * 60 + minutes, blockMinutes };
}

function setUp(): { stop: Aircraft; day: Aircraft } {
  const stop = plane('T-STOP', 'YQB', 4); // due its line check tonight, slept at the night stop
  const day = plane('T-DAY', 'YUL', 1);
  state.aircraft = [stop, day];
  state.aogs = [];
  state.groundedTails = [];
  state.mxHoldsToday = [];
  state.swappedToday = [];
  state.activeFlights = [];
  state.lineSlipsToday = [];
  state.schedule = [
    // The night stop: home in the morning, a midday round trip, back out to YQB at night.
    leg('S1', 'T-STOP', 'YQB', 'YUL', '06:00', 45),
    leg('S2', 'T-STOP', 'YUL', 'YOW', '09:00', 40),
    leg('S3', 'T-STOP', 'YOW', 'YUL', '11:00', 40),
    leg('S4', 'T-STOP', 'YUL', 'YQB', '20:00', 45),
    // The day line: two round trips from base, in bed at YUL by late afternoon.
    leg('D1', 'T-DAY', 'YUL', 'YYZ', '07:00', 75),
    leg('D2', 'T-DAY', 'YYZ', 'YUL', '09:00', 75),
    leg('D3', 'T-DAY', 'YUL', 'YYZ', '13:00', 75),
    leg('D4', 'T-DAY', 'YYZ', 'YUL', '15:00', 75),
  ];
  return { stop, day };
}
const tailOf = (legId: string) => state.schedule.find((l) => l.legId === legId)!.tail;

{
  setUp();
  planLineSlips(state, dayStart);
  assert.equal(state.lineSlipsToday?.length, 1, 'the due plane should trade');
  const slip = state.lineSlipsToday![0];
  assert.deepEqual([slip.tail, slip.with, slip.station], ['T-STOP', 'T-DAY', 'YUL']);
  // The meeting with the most time to spare: the twin finishes its day, then flies the night stop out to YQB.
  assert.deepEqual(['S1', 'S2', 'S3'].map(tailOf), ['T-STOP', 'T-STOP', 'T-STOP']);
  assert.deepEqual(['D1', 'D2', 'D3', 'D4', 'S4'].map(tailOf), ['T-DAY', 'T-DAY', 'T-DAY', 'T-DAY', 'T-DAY']);
  const tonight = tonightCheck(state, 'T-STOP')!;
  assert.equal(tonight.station, 'YUL');
  assert.ok(tonight.night >= tonight.work, 'a full night at base on the twin line');
  // At the rollover the flying before the meeting changes plane too: each keeps the other's whole line.
  finishLineSlips(state);
  assert.deepEqual(['D1', 'D2', 'D3', 'D4'].map(tailOf), ['T-STOP', 'T-STOP', 'T-STOP', 'T-STOP']);
  assert.deepEqual(['S1', 'S2', 'S3', 'S4'].map(tailOf), ['T-DAY', 'T-DAY', 'T-DAY', 'T-DAY']);
  assert.deepEqual(state.lineSlipsToday, []);
  console.log('line slip at base: ok');
}

{
  const { stop } = setUp();
  assert.ok(setLineLocked(state, stop.tail, true).ok);
  planLineSlips(state, dayStart);
  assert.deepEqual(state.lineSlipsToday, [], 'a locked plane keeps its line');
  assert.ok(setLineLocked(state, stop.tail, false).ok);
  assert.equal(stop.lineLocked, undefined);
  console.log('line slip locked: ok');
}

{
  const { day } = setUp();
  day.nightsSinceLine = 4;
  planLineSlips(state, dayStart);
  assert.deepEqual(state.lineSlipsToday, [], 'a twin due tonight itself does not take a line that misses it');
  console.log('line slip twin due: ok');
}

{
  // The meeting needs a turn each way: a twin away at YYZ all day, back after the night stop's flight out, can't trade.
  setUp();
  state.schedule = state.schedule.filter((l) => l.legId !== 'D3' && l.legId !== 'D4');
  state.schedule.find((l) => l.legId === 'D2')!.departMinute = 19 * 60;
  planLineSlips(state, dayStart);
  assert.deepEqual(state.lineSlipsToday, [], 'no meeting with a turn to spare');
  console.log('line slip no meeting: ok');
}

{
  // A twin with nothing to fly takes the line outright; the due plane rests at base.
  const { day } = setUp();
  state.schedule = state.schedule.filter((l) => l.tail !== day.tail);
  planLineSlips(state, dayStart);
  assert.equal(state.lineSlipsToday?.length, 1);
  assert.equal(tailOf('S4'), 'T-DAY');
  finishLineSlips(state);
  assert.deepEqual(['S1', 'S2', 'S3', 'S4'].map(tailOf), ['T-DAY', 'T-DAY', 'T-DAY', 'T-DAY']);
  console.log('line slip to idle twin: ok');
}
