import airportsData from '../../data/airports.json';
import { potentialDailyDemand } from '../sim/demand';
import { chooseHome } from '../sim/homes';
import { applyRotation, planRotation, type RotationStop } from '../sim/rotations';
import { legsServingMarket } from '../sim/schedule';
import { createNewGameState, type SimState } from '../sim/state';

/**
 * Start a headless game the way a player starts a real one, so balance
 * numbers describe the game people actually play.
 *
 * The browser does two things before any time passes: createNewGameState()
 * and then chooseHome() once the player picks a city (main.ts). This does
 * the same two calls. Then, because a real new game has an empty schedule
 * and would otherwise just sit there paying for its planes, it plays a
 * simple opening for the player — openStarterRoutes() below.
 *
 * The seed is always passed in, never left to createNewGameState()'s
 * Date.now() default, so a headless run is repeatable.
 */
export function startHeadlessGame(homeIata: string, seed: number): SimState {
  const state = createNewGameState(seed, homeIata);
  chooseHome(state, homeIata);
  openStarterRoutes(state);
  return state;
}

const airports = airportsData as RotationStop[];

/**
 * A deliberately plain "player": for each plane, keep adding out-and-back
 * rotations from home until its day is full, each time choosing the known
 * airport with the most potential demand per flight already on that market.
 * Dividing by existing flights spreads the planes over several markets
 * instead of stacking every rotation on the single biggest one.
 *
 * Every rotation goes through planRotation() and applyRotation() — the same
 * rules and the same commit the route builder uses — so this can never
 * build something a player couldn't. It is an opening, not a strategy: it
 * never leases more planes, changes fares or reacts to rivals. Balance work
 * that needs a smarter player should add one here rather than hand-writing
 * a schedule, which is what the old runner did.
 */
export function openStarterRoutes(state: SimState): void {
  const home = airports.find((airport) => airport.iata === state.homeAirport)!;
  // A safety cap: every successful rotation uses up part of a plane's day,
  // so the loop ends on its own long before this.
  const MAX_ROTATIONS_PER_PLANE = 20;

  for (const aircraft of state.aircraft) {
    for (let added = 0; added < MAX_ROTATIONS_PER_PLANE; added++) {
      let best: { dest: RotationStop; score: number } | null = null;
      for (const dest of airports) {
        if (dest.iata === home.iata || !state.knownAirports.includes(dest.iata)) continue;
        const demand = potentialDailyDemand(home.iata, dest.iata);
        if (demand <= 0) continue;
        if (planRotation([home], dest, aircraft.tail, state).error !== null) continue;
        const score = demand / (1 + legsServingMarket(home.iata, dest.iata, state.schedule));
        // Ties go to the earlier airport in the data file, so the pick never
        // depends on anything but the state.
        if (!best || score > best.score) best = { dest, score };
      }
      if (!best) break; // this plane's day is full, or nothing is in reach
      applyRotation(state, aircraft.tail, planRotation([home], best.dest, aircraft.tail, state));
    }
  }
}
