import assert from 'node:assert/strict';
import { chooseHome } from './homes';
import { closeLosingRivalRoutes } from './rivalEconomics';
import { rollRivalCapacityResponse } from './rivalResponse';
import { countryOf } from './rights';
import { createNewGameState } from './state';

// Run with `npm test -- rivalRights`: a rival never flies a domestic route in a country
// its own carriers may not fly (cabotage), and one already flying such a route closes it.
const state = createNewGameState(1, 'YVR');
chooseHome(state, 'YVR', 'summer', 'medium');
const rival = { airline: 'Baobab Air', code: 'BB', dailyFrequency: 2, fare: 200, baseFare: 200, openedAtMinute: state.simMinute - 100_000 };
state.competitorRoutes = [
  { ...rival, origin: 'YVR', dest: 'SEA', homeCountry: 'ZA' },
  { ...rival, origin: 'YVR', dest: 'YYJ' },
];
assert.equal(countryOf('YVR'), countryOf('YYJ'));
closeLosingRivalRoutes(state);
assert.deepEqual(state.competitorRoutes.map((r) => `${r.origin}-${r.dest}`), ['YVR-SEA'], 'the CA-CA route of a ZA carrier closes');

// A rival chasing the player's full, dear market must not open a domestic route it can't fly.
for (let day = 0; day < 200; day++) rollRivalCapacityResponse(state, state.simMinute);
for (const route of state.competitorRoutes) {
  assert.ok(countryOf(route.origin) !== countryOf(route.dest) || countryOf(route.origin) === 'ZA', `${route.origin}-${route.dest} is cabotage for BB`);
}
console.log('rival rights: ok');
