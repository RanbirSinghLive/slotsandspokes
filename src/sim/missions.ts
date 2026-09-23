import missionsData from '../../data/missions.json';
import { MISSIONS_ENABLED } from './features';
import type { SimState } from './state';

/**
 * Week six's missions: the direct answer to "what should I be striving
 * for," which is the complaint that started this whole line of work
 * (WEEK-FIVE.md) and the one thing every system built since has been
 * machinery *for* rather than an answer to.
 *
 * A mission is authored content — a fixed objective with flavour and a
 * Reputation reward — as opposed to a target (sim/targets.ts), which the
 * player defines for themselves. The two are deliberately separate
 * mechanics that happen to share a currency: missions are the game
 * telling you what's worth doing, targets are you telling the game what
 * you intend to do.
 *
 * Split across two places on purpose. `data/missions.json` holds
 * everything hand-authored (name, objective, flavour, reward), the same
 * way every other data file in this project works. The *conditions* live
 * here as real code, because a completion condition is a predicate over
 * `SimState` and there is no sane way to express that in JSON without
 * inventing a small query language nobody asked for. Adding a mission
 * means adding one JSON entry and one line in MISSION_CONDITIONS below.
 *
 * Deliberately no acceptance step this pass. WEEK-SIX.md's original
 * sketch had missions being accepted before they count, but nothing in
 * the current set has a cost or a risk to weigh, so an accept button
 * would be a click that changes nothing. Missions are simply always
 * active and complete the moment their condition holds; acceptance can
 * be added later, when there's a mission where declining is a real
 * choice.
 */

export type MissionDefinition = {
  id: string;
  name: string;
  /** One line stating what has to happen, shown as the objective. */
  objective: string;
  /** Real aviation history the mission is themed on — shown once completed and before. */
  flavor: string;
  reputationReward: number;
};

export function loadMissions(): MissionDefinition[] {
  return missionsData as MissionDefinition[];
}

/**
 * One predicate per mission id. Pure reads of `state`, so checking them
 * is deterministic and free of side effects — `checkMissions()` below is
 * the only thing that acts on the result.
 *
 * A mission whose id has no entry here can never complete; that's a
 * deliberate fail-safe rather than a crash, so a half-authored JSON entry
 * degrades to "never completes" instead of taking the tick loop down.
 */
const MISSION_CONDITIONS: Record<string, (state: SimState) => boolean> = {
  'first-aircraft': (state) => state.aircraft.length > 0,
  'first-route': (state) => state.schedule.length > 0,
  'five-airports': (state) => {
    const airports = new Set<string>();
    for (const leg of state.schedule) {
      airports.add(leg.origin);
      airports.add(leg.dest);
    }
    return airports.size >= 5;
  },
  'crew-twenty': (state) =>
    state.crew.pilotsByTier.reduce((a, b) => a + b, 0) + state.crew.cabinCrew + state.crew.mechanics >= 20,
  'cash-milestone': (state) => state.cash >= 750_000,
  'five-aircraft': (state) => state.aircraft.length >= 5,
  // A minimum sample for the same reason Reputation and service targets
  // both use one: 90% over ten flights is luck, not performance.
  'on-time-90': (state) =>
    state.flightsArrivedTotal >= 100 && state.flightsOnTimeTotal / state.flightsArrivedTotal >= 0.9,
  'first-executive': (state) => Object.values(state.executives).some((appointment) => appointment !== null),
};

/**
 * Complete any mission whose condition now holds, awarding its
 * Reputation once. Called every tick from step.ts rather than once a day:
 * the conditions are trivial reads, and "you bought your first aircraft"
 * landing up to a simulated day later would feel broken for exactly the
 * mission most likely to be someone's first feedback from this system.
 *
 * Mutates `state` in place and returns nothing, same contract as step()
 * itself — ui/ticker.ts notices new entries in `completedMissionIds` by
 * diffing, rather than this needing to reach out to the UI.
 */
export function checkMissions(state: SimState): void {
  if (!MISSIONS_ENABLED) return;

  for (const mission of loadMissions()) {
    if (state.completedMissionIds.includes(mission.id)) continue;
    const condition = MISSION_CONDITIONS[mission.id];
    if (!condition || !condition(state)) continue;

    state.completedMissionIds.push(mission.id);
    state.reputation += mission.reputationReward;
  }
}
