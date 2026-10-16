import { isInsolvent } from '../sim/insolvency';
import type { SimState } from '../sim/state';
import { step } from '../sim/step';
import type { Player } from './player';

const MINUTES_PER_DAY = 1440;

/**
 * Advance a game by whole days the way run.ts does: a day of minutes, then
 * the headless player decides once. Stops early when cash reaches $0.
 * Returns the number of days actually played.
 */
export function playDays(state: SimState, player: Player, days: number): number {
  for (let day = 1; day <= days; day++) {
    for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
      step(state);
      if (isInsolvent(state)) return day;
    }
    player.playDay(state);
  }
  return days;
}
