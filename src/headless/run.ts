import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInitialState } from '../sim/state';
import { step } from '../sim/step';

const MINUTES_PER_DAY = 1440;
const ACTIVE_TAILS = ['C-GVIA', 'C-FATL', 'C-GMAR'];

// `npm run headless -- 30` runs 30 days instead of the default year.
const days = Number(process.argv[2]) || 365;

const state = createInitialState(ACTIVE_TAILS);

const rows: string[] = ['day,cash,revenue,cost,margin,legsFlown'];

for (let day = 1; day <= days; day++) {
  for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
    step(state);
  }

  // At this exact point, state.simMinute is precisely `day * 1440` — minute
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
    ].join(','),
  );
}

const outputPath = fileURLToPath(new URL('../../headless-output.csv', import.meta.url));
writeFileSync(outputPath, rows.join('\n') + '\n');

console.log(`Ran ${days} simulated days across ${ACTIVE_TAILS.length} aircraft.`);
console.log(`Final cash: $${Math.round(state.cash).toLocaleString()}`);
console.log(`Wrote ${outputPath}`);
