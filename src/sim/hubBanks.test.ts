import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { MIN_CONNECT_MINUTES, planHubStyleChange, rotationsOnBank, wavesAt } from './hubs';
import {
  BANK_INBOUND_LEAD_MINUTES,
  bankAtOrBefore,
  bankCycleFor,
  bankedArrivalMinute,
  hubBanksAt,
  migrateHubStyles,
  nextBankMinute,
} from './hubStyle';
import airportsData from '../../data/airports.json';
import { setHubStyle } from './playerActions';
import { planRotation, type RotationStop } from './rotations';
import { step } from './step';
import { rotationsForTail, USABLE_DAY_END_MINUTE } from './utilisation';
import type { SimState } from './state';

// Run with `npm test -- hubBanks`: a banked hub's waves are sized to its
// round trips, flights home land just before a wave and flights out leave
// on one, switching never refuses for want of time on one plane, and old
// Banked / Tight banks saves keep their waves.

// The cycle: median round trip plus the inbound lead, in quarter hours, within 90 min to 5 h.
assert.equal(bankCycleFor([]), 180);
assert.equal(bankCycleFor([100, 140, 400]), Math.ceil((140 + BANK_INBOUND_LEAD_MINUTES) / 15) * 15);
assert.equal(bankCycleFor([10]), 90);
assert.equal(bankCycleFor([900]), 300);

// Wave arithmetic at a hub banked every 4 h from 06:00.
const banked = { hubStyles: { AAA: 'banked' }, hubBanks: { AAA: { periodMinutes: 240, firstMinute: 360 } } } as unknown as SimState;
assert.equal(nextBankMinute(banked, 'AAA', 300), 360);
assert.equal(nextBankMinute(banked, 'AAA', 361), 600);
assert.equal(nextBankMinute(banked, 'AAA', 600), 600);
assert.equal(bankAtOrBefore(banked, 'AAA', 599), 360);
assert.equal(bankedArrivalMinute(banked, 'AAA', 500), 600 - BANK_INBOUND_LEAD_MINUTES);
assert.equal(bankedArrivalMinute(banked, 'AAA', 556), 556, 'a flight running a little long still feeds the wave 44 minutes later');
assert.equal(bankedArrivalMinute(banked, 'AAA', 570), 840 - BANK_INBOUND_LEAD_MINUTES, 'a flight too late for one wave feeds the next');
assert.equal(nextBankMinute(banked, 'BBB', 361), 361, 'a Rolling airport has no waves');
assert.ok(BANK_INBOUND_LEAD_MINUTES >= MIN_CONNECT_MINUTES, 'the lead leaves a connection time');

// Old styles: Tight banks and Banked both become Banked, keeping their waves from 07:00.
const old = { hubStyles: { AAA: 'tight', BBB: 'banked' } } as unknown as SimState;
migrateHubStyles(old);
assert.deepEqual(old.hubStyles, { AAA: 'banked', BBB: 'banked' });
assert.deepEqual(old.hubBanks, { AAA: { periodMinutes: 120, firstMinute: 420 }, BBB: { periodMinutes: 180, firstMinute: 420 } });

// A real mid-game home: switching to Banked fits, sizes its waves, and banks most rotations.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
for (let day = 1; day <= 60; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}
const hub = state.homeAirport;
if (state.hubStyles[hub]) setHubStyle(state, hub, 'rolling');
const plan = planHubStyleChange(state, hub, 'banked');
assert.ok(plan.ok, `switching ${hub} to Banked was refused: ${!plan.ok && plan.reason}`);
const result = setHubStyle(state, hub, 'banked');
assert.ok(result.ok, 'the switch failed');
const banks = hubBanksAt(state, hub)!;
assert.ok(banks.periodMinutes >= 90 && banks.periodMinutes <= 300 && banks.periodMinutes % 15 === 0, `odd cycle ${banks.periodMinutes}`);
const { onBank, total } = rotationsOnBank(state, hub);
assert.ok(total > 0 && onBank > 0, `no rotation left on a wave (${onBank}/${total})`);

// Landing 50 to 40 minutes before a wave: in time for it, with the connection to spare.
const feedsWave = (lands: number) => {
  const ahead = nextBankMinute(state, hub, lands) - lands;
  return ahead >= MIN_CONNECT_MINUTES && ahead <= BANK_INBOUND_LEAD_MINUTES;
};

// Each banked rotation's flight home lands the inbound lead before a wave, and every day still ends by 22:00.
let feeding = 0;
for (const aircraft of state.aircraft.filter((a) => a.baseAirport === hub)) {
  const rotations = rotationsForTail(state, aircraft.tail);
  for (const rotation of rotations) {
    const home = rotation.legs[rotation.legs.length - 1];
    const lands = home.departMinute + home.blockMinutes;
    assert.ok(lands <= USABLE_DAY_END_MINUTE || rotations.length === 1, `${aircraft.tail} lands ${lands} after the day`);
    if (feedsWave(lands)) feeding++;
  }
}
assert.ok(feeding > 0, 'no flight home lands just before a wave');

// The planner's next rotation from the hub leaves on a wave and lands just before one, unless the wave would land it after the day.
const stops = airportsData as RotationStop[];
const hubStop = stops.find((stop) => stop.iata === hub)!;
let planned = 0;
for (const aircraft of state.aircraft.filter((a) => a.baseAirport === hub)) {
  // Room for one more: plan it on a copy whose plane gave up its last rotation.
  const copy: SimState = structuredClone(state);
  const last = rotationsForTail(copy, aircraft.tail).at(-1);
  if (!last) continue;
  copy.schedule = copy.schedule.filter((leg) => !last.legs.includes(leg));
  if (last.legs.length !== 2 || last.legs[0].origin !== hub) continue;
  const spokeStop = stops.find((stop) => stop.iata === last.legs[0].dest)!;
  const next = planRotation([hubStop], spokeStop, aircraft.tail, copy);
  if (next.error || next.legs.length !== 2) continue;
  const [out, back] = next.legs;
  const lands = back.departMinute + back.blockMinutes;
  if (out.departMinute === nextBankMinute(copy, hub, out.departMinute)) {
    const beforeWave = feedsWave(lands);
    const waveAfterDay = bankedArrivalMinute(copy, hub, lands) > USABLE_DAY_END_MINUTE;
    assert.ok(beforeWave || waveAfterDay, `${aircraft.tail}'s new rotation lands ${lands}, not before a wave`);
  }
  planned++;
}
assert.ok(planned > 0, 'no plane at the hub could plan a rotation');

const json = JSON.parse(JSON.stringify(state));
assert.deepEqual(json.hubBanks, state.hubBanks, 'banks survive a save');

// The Hubs card's strip: some wave is both fed and flown out of.
const waves = wavesAt(state, hub);
assert.ok(waves.length >= 3 && waves.some((wave) => wave.feeding > 0 && wave.leaving > 0), `no working wave: ${JSON.stringify(waves)}`);

// Back to Rolling drops the waves.
assert.ok(setHubStyle(state, hub, 'rolling').ok);
assert.equal(hubBanksAt(state, hub), null);
assert.equal(state.hubBanks?.[hub], undefined);

console.log(`hub banks ok: ${hub} every ${banks.periodMinutes} min, ${onBank}/${total} rotations on bank, ${feeding} feeding a wave`);
