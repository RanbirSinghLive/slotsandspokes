import type { StartSeason } from '../sim/clock';
import type { GameDifficulty } from '../sim/difficulty';
import { chooseHome } from '../sim/homes';
import { createNewGameState, type SimState } from '../sim/state';
import type { Player } from './player';

/**
 * Start a headless game the way a player starts a real one, so balance
 * numbers describe the game people actually play.
 *
 * The browser does two things before any time passes: createNewGameState()
 * and then chooseHome() once the player picks a city (main.ts). This does
 * the same two calls. Then, because a real new game has an empty schedule
 * and would otherwise just sit there paying for its planes, the headless
 * player (headless/player.ts) opens routes for the starting plane. The
 * runner then calls its playDay() at every rollover.
 *
 * The seed is always passed in, never left to createNewGameState()'s
 * Date.now() default, so a headless run is repeatable. A game starts in
 * summer, as the picker does unless the player changes it.
 */
export function startHeadlessGame(homeIata: string, seed: number, player: Player, season: StartSeason = 'summer', difficulty: GameDifficulty = 'medium'): SimState {
  const state = createNewGameState(seed, homeIata);
  chooseHome(state, homeIata, season, difficulty);
  player.open(state);
  return state;
}
