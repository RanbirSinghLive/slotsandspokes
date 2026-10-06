import assert from 'node:assert/strict';
import airportCountries from '../../data/airport-countries.json';
import { makeOffers } from './contracts';
import { chooseHome } from './homes';
import { createNewGameState } from './state';

// Run with `npm run contracttest`: a Halifax airline with legs at several
// US airports is never offered a contract between two of them, since
// cabotage is barred for a Canadian carrier (sim/rights.ts).
const country = airportCountries as Record<string, string>;
let offered = 0;
for (let seed = 1; seed <= 40; seed++) {
  const state = createNewGameState(seed, 'YHZ');
  chooseHome(state, 'YHZ', 'summer', 'medium');
  state.contracts = [];
  const usAirports = ['BOS', 'PWM', 'SYR', 'ROC', 'GRR', 'BUF'];
  state.knownAirports = [...new Set([...state.knownAirports, ...usAirports])];
  state.schedule = usAirports.map((iata, i) => ({ legId: `t-${i}`, tail: 'C-P001', origin: 'YHZ', dest: iata, departMinute: 360, blockMinutes: 100 }));
  makeOffers(state, false);
  for (const contract of state.contracts) {
    offered++;
    assert.ok(country[contract.a] !== 'US' || country[contract.b] !== 'US', `seed ${seed}: ${contract.a}-${contract.b} is US-US for a Canadian carrier`);
  }
}
assert.ok(offered > 0, 'the check made no offers to inspect');
console.log(`contract rights: ok (${offered} offers checked)`);
