import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOME_AIRPORT } from '../sim/state';
import { step } from '../sim/step';
import { startHeadlessGame } from './newGame';

const MINUTES_PER_DAY = 1440;
const SEED = 1;

// `npm run headless -- 30` runs 30 days instead of the default year;
// `npm run headless -- 30 YHZ` also starts from Halifax instead of the default home.
const days = Number(process.argv[2]) || 365;
const home = process.argv[3] || DEFAULT_HOME_AIRPORT;

// A real new game (see newGame.ts): the starting fleet at `home`, routes
// opened by the same rules the route builder uses.
const state = startHeadlessGame(home, SEED);
const startingCash = state.cash;

const rows: string[] = ['day,cash,revenue,cost,margin,legsFlown,fuelPriceIndex'];

for (let day = 1; day <= days; day++) {
  for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
    step(state);
  }

  // At this exact point, state.simMinute sits exactly on a home-midnight
  // boundary (the game starts on one, and a day is 1440 steps) — minute
  // 0 of the *next* day hasn't been processed yet, so step()'s day-rollover
  // reset (see sim/step.ts) hasn't fired for it. That means todayRevenue/
  // Cost/Margin and completedToday still hold the day we just finished,
  // intact, which is exactly the row this loop wants to write.
  rows.push(
    [
      day,
      Math.round(state.cash),
      Math.round(state.todayRevenue),
      Math.round(state.todayCost),
      Math.round(state.todayMargin),
      state.completedToday.length,
      state.fuelPriceIndex.toFixed(3),
    ].join(','),
  );
}

const outputPath = fileURLToPath(new URL('../../headless-output.csv', import.meta.url));
writeFileSync(outputPath, rows.join('\n') + '\n');

const markets = new Set(state.schedule.map((leg) => [leg.origin, leg.dest].sort().join('-')));
console.log(`Ran ${days} simulated days from ${home}: ${state.aircraft.length} aircraft, ${state.schedule.length} daily legs on ${[...markets].join(', ') || 'no routes'}.`);
console.log(`Cash: $${Math.round(startingCash).toLocaleString()} -> $${Math.round(state.cash).toLocaleString()}`);
console.log(`Wrote ${outputPath}`);
