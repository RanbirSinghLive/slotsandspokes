import { barredSpokePairsAt, connectingFlowsAt } from '../sim/hubs';
import { isInsolvent } from '../sim/insolvency';
import { tiersClimbed } from '../sim/ladder';
import { grantedCountries, homeCountry, legRights } from '../sim/rights';
import { buyRights, rightsCountries, rightsOffer } from '../sim/rightsLicences';
import { dayIndex } from '../sim/clock';
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
// --buy: the player buys every domestic-rights offer it can afford (sim/rightsLicences.ts), the day it appears.
const buying = process.argv.includes('--buy');
const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const days = Number(args[0]) || 365;
const homes = args[1] ? [args[1]] : ['YUL', 'YYZ', 'PHL', 'YHZ'];
const seeds = [1, 2];

console.log(`\n  Air rights · steady player · ${days} days\n`);
for (const home of homes) {
  for (const seed of seeds) {
    const player = createPlayer('steady');
    const bought: string[] = [];
    const state = startHeadlessGame(home, seed, player);
    for (let day = 1; day <= days; day++) {
      let bust = false;
      for (let minute = 0; minute < MINUTES_PER_DAY && !bust; minute++) {
        step(state);
        bust = isInsolvent(state);
      }
      if (bust) break;
      player.playDay(state);
      if (buying) {
        for (const country of rightsCountries(state)) {
          if (rightsOffer(state, country).status !== 'offered') continue;
          const result = buyRights(state, country);
          if (result.ok) bought.push(`${country}@d${dayIndex(state)}`);
        }
      }
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
    const offers = rightsCountries(state).map((c) => rightsOffer(state, c)).map((o) => `${o.country} ${o.status} ${o.progressDays}d`);
    console.log(
      `    tier ${tiersClimbed(state)} · cash $${Math.round(state.cash / 1000)}k · rights: ${offers.join(', ') || 'none'}` +
        ` · held ${grantedCountries(state).join(',') || '-'} · bought ${bought.join(',') || '-'}`,
    );
  }
}
console.log('');
