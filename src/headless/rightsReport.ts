import { connectingFlowsAt } from '../sim/hubs';
import { isInsolvent } from '../sim/insolvency';
import { flowRights, homeCountry, legRights } from '../sim/rights';
import { marketKey, networkAirports } from '../sim/schedule';
import { step } from '../sim/step';
import { startHeadlessGame } from './newGame';
import { createPlayer } from './player';

/**
 * What the air rights rule (sim/rights.ts) would bar from the steady
 * player's game, without barring it: the first measurement before the
 * rule is switched on.
 *
 *   npm run rights                 # the four quick-balance homes, 2 seeds, a year
 *   npm run rights -- 180 YUL      # 180 days from one home
 *
 * Per game it prints the markets the player flies that a carrier of its home
 * country could not, and the connecting passengers a day (sim/hubs.ts) that
 * the rule would remove, out of the total.
 */

const MINUTES_PER_DAY = 1440;
const days = Number(process.argv[2]) || 365;
const homes = process.argv[3] ? [process.argv[3]] : ['YUL', 'YYZ', 'PHL', 'YHZ'];
const seeds = [1, 2];

console.log(`\n  Air rights, log only · steady player · ${days} days\n`);
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

    let total = 0;
    let barred = 0;
    const barredFlows: string[] = [];
    for (const hub of networkAirports(state.schedule)) {
      for (const flow of connectingFlowsAt(state, hub)) {
        total += flow.passengers;
        if (!flowRights(country, flow.a, hub, flow.b).ok) {
          barred += flow.passengers;
          barredFlows.push(`${flow.a}-${hub}-${flow.b}`);
        }
      }
    }
    console.log(
      `  ${home} s${seed} · ${country} carrier · ${markets.size} markets, ${barredMarkets.length} barred${barredMarkets.length ? ` (${barredMarkets.slice(0, 6).join(' ')}${barredMarkets.length > 6 ? ' …' : ''})` : ''}` +
        ` · connecting ${Math.round(total)}/day, ${Math.round(barred)} barred${total ? ` (${Math.round((100 * barred) / total)}%)` : ''}`,
    );
    if (barredFlows.length) console.log(`      ${barredFlows.slice(0, 4).join('  ')}${barredFlows.length > 4 ? ` +${barredFlows.length - 4} more` : ''}`);
  }
}
console.log('');
