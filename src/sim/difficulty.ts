import type { SimState } from './state';

/**
 * The game's difficulty, chosen with the home city on the first screen
 * (ui/homePicker.ts). Medium is the game as balanced (balance-reference.json);
 * the others move only the start and how soon pressure arrives, never the
 * economy's own rules, so the same route pays the same on every tier.
 */
export type GameDifficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: GameDifficulty[] = ['easy', 'medium', 'hard'];

type DifficultySettings = {
  startingCash: number;
  /** First day a new rival airline can arrive (sim/competitors.ts). */
  rivalFirstEntryDay: number;
  /** Multiplies each day's chance of a rival arriving (sim/pressure.ts). */
  rivalEntryChanceMultiplier: number;
  /** First day a shock can strike (sim/shocks.ts). */
  firstShockDay: number;
  /** First day an airspace closure can be announced (sim/airspace.ts). */
  closureFirstDay: number;
  /** Multiplies how often closures start. */
  closureRateMultiplier: number;
};

export const DIFFICULTY_SETTINGS: Record<GameDifficulty, DifficultySettings> = {
  easy: { startingCash: 1_000_000, rivalFirstEntryDay: 30, rivalEntryChanceMultiplier: 0.5, firstShockDay: 120, closureFirstDay: 120, closureRateMultiplier: 0.5 },
  medium: { startingCash: 500_000, rivalFirstEntryDay: 15, rivalEntryChanceMultiplier: 1, firstShockDay: 60, closureFirstDay: 60, closureRateMultiplier: 1 },
  hard: { startingCash: 350_000, rivalFirstEntryDay: 10, rivalEntryChanceMultiplier: 1.5, firstShockDay: 40, closureFirstDay: 40, closureRateMultiplier: 1.5 },
};

/** A save from before difficulty existed plays as Medium. */
export function difficultySettings(state: SimState): DifficultySettings {
  return DIFFICULTY_SETTINGS[state.difficulty ?? 'medium'];
}
