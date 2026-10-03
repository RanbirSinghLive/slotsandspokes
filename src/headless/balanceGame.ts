import type { StartSeason } from '../sim/clock';
import { isInsolvent } from '../sim/insolvency';
import { tiersClimbed } from '../sim/ladder';
import { marketKey } from '../sim/schedule';
import { step } from '../sim/step';
import { startHeadlessGame } from './newGame';
import { createPlayer, type PlayerKind } from './player';

/**
 * One balance-report game (src/headless/balance.ts), in a module of its
 * own so the report's worker threads (balanceWorker.ts) can play games
 * without running the report.
 */

const MINUTES_PER_DAY = 1440;

/** `season` is the start (sim/clock.ts): summer unless given. */
export type GameSpec = { home: string; seed: number; player: PlayerKind; days: number; season?: StartSeason };

export type RunResult = {
  home: string;
  seed: number;
  player: PlayerKind;
  cash: number;
  /** The day cash reached $0, or null if the airline lasted the run. */
  bustDay: number | null;
  planes: number;
  markets: number;
  flightsPerDay: number;
  /** Ladder tiers climbed by the end (sim/ladder.ts): 0 is still a start-up. */
  tiers: number;
};

/** One game, the same way run.ts plays it: stop at $0, checked every minute, as the browser does. */
export function playOne({ home, seed, player: kind, days, season }: GameSpec): RunResult {
  const player = createPlayer(kind);
  const state = startHeadlessGame(home, seed, player, season);
  let bustDay: number | null = null;
  for (let day = 1; day <= days && bustDay === null; day++) {
    for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
      step(state);
      if (isInsolvent(state)) {
        bustDay = day;
        break;
      }
    }
    if (bustDay === null) player.playDay(state);
  }
  return {
    home,
    seed,
    player: kind,
    cash: state.cash,
    bustDay,
    planes: state.aircraft.length,
    markets: new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest))).size,
    flightsPerDay: state.schedule.length,
    tiers: tiersClimbed(state),
  };
}

