import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isInsolvent } from '../sim/insolvency';
import { DEFAULT_HOME_AIRPORT } from '../sim/state';
import { step } from '../sim/step';
import { startHeadlessGame } from './newGame';
import { createPlayer, playerFromArgs } from './player';

const MINUTES_PER_DAY = 1440;
const SEED = 1;

// `npm run headless -- 30` runs 30 days instead of the default year;
// `npm run headless -- 30 YHZ` also starts from Halifax instead of the default home;
// `--player starter` plays it with the do-nothing player instead of the steady one.
const { kind: playerKind, rest: args } = playerFromArgs(process.argv.slice(2));
const days = Number(args[0]) || 365;
const home = args[1] || DEFAULT_HOME_AIRPORT;

// A real new game (see newGame.ts): the starting fleet at `home`, played
// by a headless player (headless/player.ts) through the same rules and
// actions a person has.
const player = createPlayer(playerKind);
const state = startHeadlessGame(home, SEED, player);
const startingCash = state.cash;

const rows: string[] = ['day,cash,revenue,cost,margin,legsFlown,fuelPriceIndex'];

// The game ends the moment Cash reaches $0 (sim/insolvency.ts's isInsolvent()),
// and the browser checks that every frame, mid-day included. So this
// checks after every simulated minute too, and stops the run there: any
// day after it describes a game nobody could still be playing.
let gameOverDay: number | null = null;
// What the player did, day by day, printed after the run so it reads as a story.
const decisions: string[] = [];

for (let day = 1; day <= days && gameOverDay === null; day++) {
  for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
    step(state);
    if (isInsolvent(state)) {
      gameOverDay = day;
      break;
    }
  }

  // After a full day (the usual case), state.simMinute sits exactly on a home-midnight
  // boundary (the game starts on one, and a day is 1440 steps) — minute
  // 0 of the *next* day hasn't been processed yet, so step()'s day-rollover
  // reset (see sim/step.ts) hasn't fired for it. That means todayRevenue/
  // Cost/Margin and completedToday still hold the day we just finished,
  // intact, which is exactly the row this loop wants to write. On the
  // game-over day the row covers the part of the day that was flown.
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

  if (gameOverDay === null) {
    for (const decision of player.playDay(state)) decisions.push(`  day ${day}: ${decision}`);
  }
}

const outputPath = fileURLToPath(new URL('../../headless-output.csv', import.meta.url));
writeFileSync(outputPath, rows.join('\n') + '\n');

const markets = new Set(state.schedule.map((leg) => [leg.origin, leg.dest].sort().join('-')));
const daysRun = gameOverDay ?? days;
console.log(`${playerKind} player, ${decisions.length} decision${decisions.length === 1 ? '' : 's'}:`);
for (const decision of decisions) console.log(decision);
console.log(`Ran ${daysRun} simulated days from ${home}: ${state.aircraft.length} aircraft, ${state.schedule.length} daily legs on ${[...markets].join(', ') || 'no routes'}.`);
console.log(`Cash: $${Math.round(startingCash).toLocaleString()} -> $${Math.round(state.cash).toLocaleString()}`);
if (gameOverDay !== null) {
  console.log(`GAME OVER on day ${gameOverDay}: cash reached $0, which ends a real game.`);
}
console.log(`Wrote ${outputPath}`);
