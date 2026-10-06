import { barredSpokePairsAt, connectingFlowsAt } from '../sim/hubs';
import { isInsolvent } from '../sim/insolvency';
import { homeCountry, legRights } from '../sim/rights';
import { marketKey, networkAirports } from '../sim/schedule';
import { step } from '../sim/step';
import { startHeadlessGame } from './newGame';
import { createPlayer } from './player';

/**
 * What air rights (sim/rights.ts) take out of the steady player's game: the
 * markets it flies that its home country's carrier couldn't (none, since
 * the planner refuses them), and the spoke pairs at its hubs that can't
 * connect, with the connecting passengers a day that remain.
 *
 *   npm run rights                 # the four quick-balance homes, 2 seeds, a year
 *   npm run rights -- 180 YUL      # 180 days from one home
 */

const MINUTES_PER_DAY = 1440;
const days = Number(process.argv[2]) || 365;
const homes = process.argv[3] ? [process.argv[3]] : ['YUL', 'YYZ', 'PHL', 'YHZ'];
const seeds = [1, 2];

console.log(`\n  Air rights · steady player · ${days} days\n`);
for (const home of homes) {
  for (const seed of seeds) {
    const player = createPlayer('steady');
    const state = startHeadlessGame(home, seed, player);
    for (let day = 1; day <= days; day++) {
      let bust = false;
      for (let minute = 0; minute < MINUTES_PER_DAY && !bust; minute++) {
        step(state);
        bust = isInsolvent(state);
      }
      if (bust) break;
      player.playDay(state);
    }

    const country = homeCountry(state);
    const markets = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
    const barredMarkets = [...markets].filter((key) => {
      const [a, b] = key.split('-');
      return !legRights(country, a, b).ok;
    });

    let connecting = 0;
    let barredPairs = 0;
    for (const hub of networkAirports(state.schedule)) {
      barredPairs += barredSpokePairsAt(state, hub);
      for (const flow of connectingFlowsAt(state, hub)) connecting += flow.passengers;
    }
    console.log(
      `  ${home} s${seed} · ${country} carrier · ${markets.size} markets, ${barredMarkets.length} barred` +
        ` · connecting ${Math.round(connecting)}/day · ${barredPairs} spoke pairs barred`,
    );
  }
}
console.log('');
