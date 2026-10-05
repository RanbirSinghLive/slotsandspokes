import { CREW_BASE_FEE, crewBases, openCrewBase } from './crews';
import type { SimState } from './state';

/**
 * Bases as investments (WEEK-SIXTEEN.md, stage 1).
 *
 * **A crew base** is where crews live and planes can be leased and based
 * (sim/crews.ts holds its crews). It's opened deliberately, on the Crews
 * tab, for CREW_BASE_FEE and CREW_BASE_PER_DAY for the crew room.
 *
 * **A line base** is where nights are line checks (sim/mxChecks.ts). Its
 * level is how many planes it can check in a night; a plane past that is
 * treated like one at an outstation. **A heavy base** is a hangar: its
 * level is how many bays it has, and only a plane holding a bay banks
 * heavy-check hours on its nights there. The two are opened and levelled
 * apart on the Mtc tab, so a station can be line-only (cheap, never does a
 * heavy check) or a hangar.
 *
 * **Ratings.** A station's mechanics are rated by aircraft class, like
 * crews. A plane of an unrated class is treated like one at an outstation.
 * A station's first rating is free; each further class costs
 * MX_RATING_PER_DAY, so a mixed fleet costs more to maintain.
 *
 * **Anywhere else** a plane sleeps (no base, a full base, an unrated
 * class), the night is a **contracted check**, paid CONTRACT_CHECK_PER_HOUR
 * of the night's work, or a **deferred item**, by the station's setting
 * (contracted unless the player changes it).
 *
 * Home starts with both at level MX_HOME_FREE_LEVELS, rated for the
 * starting class, inside the starting cost: those cost nothing to run.
 * Levels above that, and every level elsewhere, are paid by the day.
 * A save from before levels has a base of each kind at every old
 * maintenance base, at level 3 or its based planes if more, rated for every
 * class (mxLevels()), so no one's planes start deferring.
 */

export const CREW_BASE_PER_DAY = 500;
export type MxKind = 'line' | 'heavy';
export const MX_MAX_LEVEL = 6;
/** Home's line and heavy levels at the start, and the levels there that cost nothing a day. */
export const MX_HOME_FREE_LEVELS = 3;
export const MX_BASE_FEE: Record<MxKind, number> = { line: 150_000, heavy: 400_000 };
/** Each level above the first: planes checked a night, or bays. */
export const MX_LEVEL_FEE: Record<MxKind, number> = { line: 75_000, heavy: 250_000 };
export const MX_PER_LEVEL_PER_DAY: Record<MxKind, number> = { line: 300, heavy: 900 };
/** Rating a station's mechanics for another aircraft class: once, then a day. */
export const MX_RATING_FEE = 100_000;
export const MX_RATING_PER_DAY = 400;
export const CONTRACT_CHECK_PER_HOUR = 300;

export type OutstationCheck = 'contract' | 'defer';

type Outcome = { ok: true; message: string } | { ok: false; reason: string };

const MX_FIELD = { line: 'lineBases', heavy: 'heavyBases' } as const;

/** One kind's levels by IATA. A save from before levels derives them from its old maintenance bases. */
export function mxLevels(state: SimState, kind: MxKind): Record<string, number> {
  const own = state[MX_FIELD[kind]];
  if (own) return own;
  const old = state.mxBases ?? [...new Set([state.homeAirport, ...Object.keys(crewBases(state))])];
  const levels: Record<string, number> = {};
  for (const iata of old) levels[iata] = Math.max(MX_HOME_FREE_LEVELS, state.aircraft.filter((aircraft) => aircraft.baseAirport === iata).length);
  return levels;
}

/** Writes both kinds' levels into the state before the first change to either. */
function ownMxLevels(state: SimState): { line: Record<string, number>; heavy: Record<string, number> } {
  state.lineBases = mxLevels(state, 'line');
  state.heavyBases = mxLevels(state, 'heavy');
  delete state.mxBases;
  return { line: state.lineBases, heavy: state.heavyBases };
}

export function mxLevel(state: SimState, kind: MxKind, iata: string): number {
  return mxLevels(state, kind)[iata] ?? 0;
}

/** Every station with a base of either kind: home first. */
export function mxStationList(state: SimState): string[] {
  const all = new Set([...Object.keys(mxLevels(state, 'line')), ...Object.keys(mxLevels(state, 'heavy'))]);
  return [...all].sort((a, b) => (a === state.homeAirport ? -1 : b === state.homeAirport ? 1 : a.localeCompare(b)));
}

export function hasLineBase(state: SimState, iata: string): boolean {
  return mxLevel(state, 'line', iata) > 0;
}

export function hasHeavyBase(state: SimState, iata: string): boolean {
  return mxLevel(state, 'heavy', iata) > 0;
}

/** The classes a station's mechanics are rated for; null when every class is (a save from before ratings). */
export function mxRatings(state: SimState, iata: string): string[] | null {
  if (!state.mxRatings) return null;
  return state.mxRatings[iata] ?? [];
}

export function mxRated(state: SimState, iata: string, classCode: string): boolean {
  const rated = mxRatings(state, iata);
  return rated === null || rated.includes(classCode);
}

export function hasCrewBase(state: SimState, iata: string): boolean {
  return crewBases(state)[iata] !== undefined;
}

/** Whether the station has a line base rated for the class (capacity aside). */
export function lineRated(state: SimState, iata: string, classCode: string): boolean {
  return hasLineBase(state, iata) && mxRated(state, iata, classCode);
}

/** Whether the station has a hangar rated for the class (bays aside). */
export function heavyRated(state: SimState, iata: string, classCode: string): boolean {
  return hasHeavyBase(state, iata) && mxRated(state, iata, classCode);
}

/** What a night the station can't check itself is (no line base, full, or an unrated class): contracted unless set to defer. */
export function outstationCheck(state: SimState, iata: string): OutstationCheck {
  return state.outstationChecks?.[iata] ?? 'contract';
}

export function setOutstationCheck(state: SimState, iata: string, check: OutstationCheck): Outcome {
  const checks = (state.outstationChecks ??= {});
  if (check === 'contract') delete checks[iata];
  else checks[iata] = check;
  return { ok: true, message: `${iata} · ${check === 'contract' ? 'contracted checks' : 'checks deferred'}` };
}

/** A contracted check's price for `minutes` of work. */
export function contractCost(minutes: number): number {
  return Math.round((minutes / 60) * CONTRACT_CHECK_PER_HOUR);
}

/** Why a crew base can't be opened here, or null. */
export function crewBaseBlocked(state: SimState, iata: string): string | null {
  if (hasCrewBase(state, iata)) return `${iata} is already a crew base.`;
  if (!state.knownAirports.includes(iata)) return `${iata} isn't on your map yet.`;
  if (state.cash < CREW_BASE_FEE) return `Needs $${CREW_BASE_FEE.toLocaleString()} on hand.`;
  return null;
}

export function openCrewBaseAt(state: SimState, iata: string): Outcome {
  const blocked = crewBaseBlocked(state, iata);
  if (blocked) return { ok: false, reason: blocked };
  state.cash -= CREW_BASE_FEE;
  openCrewBase(state, iata);
  return { ok: true, message: `Crew base opened · ${iata} · $${CREW_BASE_FEE.toLocaleString()} · $${CREW_BASE_PER_DAY.toLocaleString()}/day · hire crews here before basing planes` };
}

/** Why this crew base can't close: home, planes based there, or crews still on its books. */
export function crewBaseCloseBlocked(state: SimState, iata: string): string | null {
  const base = crewBases(state)[iata];
  if (!base) return `${iata} isn't a crew base.`;
  if (iata === state.homeAirport) return 'Home is always a crew base.';
  if (state.aircraft.some((aircraft) => aircraft.baseAirport === iata || aircraft.rebase?.to === iata)) return `Planes are based at ${iata}: move or return them first.`;
  const crews = Object.values(base.crewsByClass ?? {}).reduce((total, count) => total + count, 0);
  if (crews > 0 || base.hiring.length > 0 || base.retraining.length > 0) return `${iata} still has crews: release them first.`;
  return null;
}

export function closeCrewBase(state: SimState, iata: string): Outcome {
  const blocked = crewBaseCloseBlocked(state, iata);
  if (blocked) return { ok: false, reason: blocked };
  delete state.crewBases![iata];
  return { ok: true, message: `Crew base closed · ${iata}` };
}

const KIND_NAME: Record<MxKind, string> = { line: 'line base', heavy: 'hangar' };

/** Why a base of this kind can't be opened here, or null. */
export function mxBaseBlocked(state: SimState, kind: MxKind, iata: string): string | null {
  if (mxLevel(state, kind, iata) > 0) return `${iata} already has a ${KIND_NAME[kind]}.`;
  if (!state.knownAirports.includes(iata)) return `${iata} isn't on your map yet.`;
  if (state.cash < MX_BASE_FEE[kind]) return `Needs $${MX_BASE_FEE[kind].toLocaleString()} on hand.`;
  return null;
}

/** The class a new station is rated for: the airline's most numerous (the smaller on a tie). */
function firstRating(state: SimState): string {
  const counts = new Map<string, number>();
  for (const aircraft of state.aircraft) counts.set(aircraft.typeCode, (counts.get(aircraft.typeCode) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? 'PROP';
}

export function openMxBase(state: SimState, kind: MxKind, iata: string): Outcome {
  const blocked = mxBaseBlocked(state, kind, iata);
  if (blocked) return { ok: false, reason: blocked };
  const levels = ownMxLevels(state);
  state.cash -= MX_BASE_FEE[kind];
  levels[kind][iata] = 1;
  if (state.mxRatings && (state.mxRatings[iata]?.length ?? 0) === 0) state.mxRatings[iata] = [firstRating(state)];
  return {
    ok: true,
    message: `${kind === 'line' ? 'Line base' : 'Hangar'} opened · ${iata} · $${MX_BASE_FEE[kind].toLocaleString()} · level 1 · $${MX_PER_LEVEL_PER_DAY[kind].toLocaleString()}/day a level`,
  };
}

/** Why a base can't change level by `delta`, or null. */
export function mxLevelBlocked(state: SimState, kind: MxKind, iata: string, delta: 1 | -1): string | null {
  const level = mxLevel(state, kind, iata);
  if (level === 0) return `${iata} has no ${KIND_NAME[kind]}.`;
  if (delta === 1 && level >= MX_MAX_LEVEL) return `Level ${MX_MAX_LEVEL} is the most.`;
  if (delta === 1 && state.cash < MX_LEVEL_FEE[kind]) return `Needs $${MX_LEVEL_FEE[kind].toLocaleString()} on hand.`;
  if (delta === -1 && level <= 1) return 'Close it instead.';
  return null;
}

export function changeMxLevel(state: SimState, kind: MxKind, iata: string, delta: 1 | -1): Outcome {
  const blocked = mxLevelBlocked(state, kind, iata, delta);
  if (blocked) return { ok: false, reason: blocked };
  const levels = ownMxLevels(state);
  if (delta === 1) state.cash -= MX_LEVEL_FEE[kind];
  levels[kind][iata] += delta;
  const unit = kind === 'line' ? 'planes a night' : 'bays';
  return { ok: true, message: `${iata} · ${KIND_NAME[kind]} level ${levels[kind][iata]} · ${levels[kind][iata]} ${unit}` };
}

export function mxBaseCloseBlocked(state: SimState, kind: MxKind, iata: string): string | null {
  if (mxLevel(state, kind, iata) === 0) return `${iata} has no ${KIND_NAME[kind]}.`;
  if (iata === state.homeAirport) return `Home always has a ${KIND_NAME[kind]}.`;
  return null;
}

export function closeMxBase(state: SimState, kind: MxKind, iata: string): Outcome {
  const blocked = mxBaseCloseBlocked(state, kind, iata);
  if (blocked) return { ok: false, reason: blocked };
  const levels = ownMxLevels(state);
  delete levels[kind][iata];
  if (state.mxRatings && !levels.line[iata] && !levels.heavy[iata]) delete state.mxRatings[iata];
  return { ok: true, message: `${kind === 'line' ? 'Line base' : 'Hangar'} closed · ${iata} · nights here contracted unless set to defer` };
}

/** Why a station can't be rated for the class, or null. */
export function mxRatingBlocked(state: SimState, iata: string, classCode: string): string | null {
  if (!hasLineBase(state, iata) && !hasHeavyBase(state, iata)) return `${iata} has no maintenance base.`;
  if (mxRated(state, iata, classCode)) return `${iata} is already rated for it.`;
  if (state.cash < MX_RATING_FEE) return `Needs $${MX_RATING_FEE.toLocaleString()} on hand.`;
  return null;
}

/** Rate the station's mechanics for a class. A save from before ratings rates every class everywhere, so there's nothing to add. */
export function rateStation(state: SimState, iata: string, classCode: string): Outcome {
  const blocked = mxRatingBlocked(state, iata, classCode);
  if (blocked) return { ok: false, reason: blocked };
  state.cash -= MX_RATING_FEE;
  (state.mxRatings ??= {})[iata] = [...(state.mxRatings[iata] ?? []), classCode];
  return { ok: true, message: `${iata} · mechanics rated for ${classCode} · $${MX_RATING_FEE.toLocaleString()} · $${MX_RATING_PER_DAY.toLocaleString()}/day` };
}

/** Why a rating can't be dropped, or null: the last one goes with its base. */
export function mxUnrateBlocked(state: SimState, iata: string, classCode: string): string | null {
  const rated = mxRatings(state, iata);
  if (rated === null || !rated.includes(classCode)) return `${iata} isn't rated for it.`;
  if (rated.length <= 1) return 'A station keeps at least one rating.';
  return null;
}

export function unrateStation(state: SimState, iata: string, classCode: string): Outcome {
  const blocked = mxUnrateBlocked(state, iata, classCode);
  if (blocked) return { ok: false, reason: blocked };
  state.mxRatings![iata] = state.mxRatings![iata].filter((code) => code !== classCode);
  return { ok: true, message: `${iata} · rating for ${classCode} dropped` };
}

/** Planes a line base can check in a night; 0 without one. */
export function lineCapacity(state: SimState, iata: string): number {
  return mxLevel(state, 'line', iata);
}

/** Bays a hangar has; 0 without one. */
export function heavyBays(state: SimState, iata: string): number {
  return mxLevel(state, 'heavy', iata);
}

/** One station's maintenance running cost a day: levels past home's free ones, and ratings past the first. */
export function mxCostPerDay(state: SimState, iata: string): number {
  const free = iata === state.homeAirport ? MX_HOME_FREE_LEVELS : 0;
  const levels = (['line', 'heavy'] as const).reduce((total, kind) => total + Math.max(0, mxLevel(state, kind, iata) - free) * MX_PER_LEVEL_PER_DAY[kind], 0);
  const ratings = Math.max(0, (mxRatings(state, iata)?.length ?? 0) - 1) * MX_RATING_PER_DAY;
  return levels + ratings;
}

/** The bases' running costs a day: crew rooms under crew, maintenance under maintenance. Home's crew room is free. */
export function basesCostPerDay(state: SimState): { crew: number; maintenance: number } {
  return {
    crew: Object.keys(crewBases(state)).filter((iata) => iata !== state.homeAirport).length * CREW_BASE_PER_DAY,
    maintenance: mxStationList(state).reduce((total, iata) => total + mxCostPerDay(state, iata), 0),
  };
}
