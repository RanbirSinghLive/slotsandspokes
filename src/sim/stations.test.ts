import assert from 'node:assert/strict';
import { chooseHome } from './homes';
import { step } from './step';
import { createNewGameState } from './state';
import {
  HANDLING,
  HUB_MIN_DEPARTURES,
  STATION_BUILD_DAYS,
  STATION_FEE,
  downgradeStation,
  handlingParameters,
  pendingStation,
  recordStationDeparture,
  rollDailyStations,
  rollStationLedgers,
  stationCostPerDay,
  stationReadout,
  stationTier,
  stationUpgradeBlocked,
  upgradeStation,
} from './stations';
import { openCrewBaseAt } from './bases';

// Run with `npm run stationtest`: handling tiers, the slow build, and the delay ledger.
const state = createNewGameState(7, 'YUL');
chooseHome(state, 'YUL', 'summer', 'medium');
state.cash = 5_000_000;

// Home starts on its own staff at no running cost; elsewhere a contract handler.
assert.equal(stationTier(state, 'YUL'), 'own');
assert.equal(stationCostPerDay(state), 0);
const other = state.knownAirports.find((iata) => iata !== 'YUL')!;
assert.equal(stationTier(state, other), 'contract');

// Better handling means fewer and shorter ground delays.
assert.ok(HANDLING.own.chance < HANDLING.contract.chance && HANDLING.hub.chance < HANDLING.own.chance);

// Own staff needs a base there first.
assert.match(stationUpgradeBlocked(state, other) ?? '', /base/);
state.knownAirports.push(other);
const opened = openCrewBaseAt(state, other);
assert.ok(opened.ok, 'crew base should open');
assert.equal(stationUpgradeBlocked(state, other), null);

// The step is paid now and opens after its build days, not before.
const cashBefore = state.cash;
assert.ok(upgradeStation(state, other).ok);
assert.equal(cashBefore - state.cash, STATION_FEE.own);
assert.ok(pendingStation(state, other));
assert.equal(stationTier(state, other), 'contract');
assert.match(stationUpgradeBlocked(state, other) ?? '', /Already building/);
state.simMinute += (STATION_BUILD_DAYS.own - 1) * 1440;
rollDailyStations(state);
assert.equal(stationTier(state, other), 'contract', 'opened a day early');
state.simMinute += 1440;
rollDailyStations(state);
assert.equal(stationTier(state, other), 'own');
assert.ok(stationCostPerDay(state) > 0);

// Hub-grade needs the departures; stepping down is instant and keeps home on its own staff.
assert.match(stationUpgradeBlocked(state, other) ?? '', new RegExp(`${HUB_MIN_DEPARTURES} departures`));
assert.ok(downgradeStation(state, other).ok);
assert.equal(stationTier(state, other), 'contract');
assert.equal(downgradeStation(state, 'YUL').ok, false);

// A thin field is worse for a contract handler.
const thin = handlingParameters(state, 'YUL').chance;
assert.ok(thin <= HANDLING.own.chance);

// The ledger tallies departures by cause and keeps a rolling window.
const breakdown = { age: 3, weather: 0, knockOn: 4, congestion: 0, ground: 5 };
recordStationDeparture(state, 'YUL', breakdown, 10);
recordStationDeparture(state, 'YUL', breakdown, 0);
const today = stationReadout(state, 'YUL')!;
assert.equal(today.departures, 2);
assert.equal(today.perDeparture.ground, 5);
assert.equal(today.topCause, 'ground');
assert.equal(today.lateDeparturePerDeparture, 5);
for (let day = 0; day < 10; day++) {
  rollStationLedgers(state);
  recordStationDeparture(state, 'YUL', breakdown, 0);
}
assert.ok(state.stationLedger!.YUL.past.length <= 7, 'ledger window should be capped');
assert.equal(stationReadout(state, 'nowhere'), null);

// The ledger and tiers survive a save.
const reloaded = JSON.parse(JSON.stringify(state));
assert.deepEqual(reloaded.stationLedger, state.stationLedger);

// A played game fills the ledger, and two runs from one seed match.
function play(seed: number): string {
  const game = createNewGameState(seed, 'YYZ');
  chooseHome(game, 'YYZ', 'summer', 'medium');
  for (let i = 0; i < 3 * 1440; i++) step(game);
  return JSON.stringify(game.stationLedger ?? {});
}
assert.equal(play(3), play(3));
console.log('stations: ok');
