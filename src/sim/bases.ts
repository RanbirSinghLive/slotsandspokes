import { CREW_BASE_FEE, crewBases, openCrewBase } from './crews';
import type { SimState } from './state';

/**
 * Bases as investments (WEEK-SIXTEEN.md, stage 1).
 *
 * **A crew base** is where crews live and planes can be leased and based
 * (sim/crews.ts holds its crews). It's opened deliberately, on the Crews
 * tab, for CREW_BASE_FEE and CREW_BASE_PER_DAY for the crew room.
 *
 * **A maintenance base** is where a night counts as a line check and
 * banks heavy-check hours (sim/mxChecks.ts). Abstract: no hangar sizes or
 * slots. Opened on the Mtc tab for MX_BASE_FEE and MX_BASE_PER_DAY.
 *
 * **Anywhere else** a plane sleeps, the night is a **contracted check**,
 * paid CONTRACT_CHECK_PER_HOUR of the night's work, or a **deferred item**,
 * by the station's setting (contracted unless the player changes it). So a
 * crew base without a maintenance base is cheap to open and dearer to run.
 *
 * Home has both from the start, inside the starting cost: they cost
 * nothing to run, so a new game plays as it did before bases were
 * opened by hand. A save from before maintenance bases has one at every
 * crew base (mxBaseList()), so no one's planes start deferring.
 */

export const CREW_BASE_PER_DAY = 500;
export const MX_BASE_FEE = 400_000;
export const MX_BASE_PER_DAY = 1_500;
export const CONTRACT_CHECK_PER_HOUR = 300;

export type OutstationCheck = 'contract' | 'defer';

type Outcome = { ok: true; message: string } | { ok: false; reason: string };

/** Every maintenance base, by IATA: home first. */
export function mxBaseList(state: SimState): string[] {
  return state.mxBases ?? [...new Set([state.homeAirport, ...Object.keys(crewBases(state))])];
}

export function hasMxBase(state: SimState, iata: string): boolean {
  return mxBaseList(state).includes(iata);
}

export function hasCrewBase(state: SimState, iata: string): boolean {
  return crewBases(state)[iata] !== undefined;
}

/** What a night away from a maintenance base is at this station: contracted unless set to defer. */
export function outstationCheck(state: SimState, iata: string): OutstationCheck {
  return state.outstationChecks?.[iata] ?? 'contract';
}

export function setOutstationCheck(state: SimState, iata: string, check: OutstationCheck): Outcome {
  if (hasMxBase(state, iata)) return { ok: false, reason: `${iata} is a maintenance base: its nights are line checks.` };
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
  const cabin = Object.values(base.cabinByClass ?? {}).reduce((total, count) => total + count, 0);
  if (crews > 0 || cabin > 0 || base.hiring.length > 0 || base.retraining.length > 0 || (base.cabinHiring ?? []).length > 0) return `${iata} still has crews: release them first.`;
  return null;
}

export function closeCrewBase(state: SimState, iata: string): Outcome {
  const blocked = crewBaseCloseBlocked(state, iata);
  if (blocked) return { ok: false, reason: blocked };
  delete state.crewBases![iata];
  return { ok: true, message: `Crew base closed · ${iata}` };
}

/** Why a maintenance base can't be opened here, or null. */
export function mxBaseBlocked(state: SimState, iata: string): string | null {
  if (hasMxBase(state, iata)) return `${iata} is already a maintenance base.`;
  if (!state.knownAirports.includes(iata)) return `${iata} isn't on your map yet.`;
  if (state.cash < MX_BASE_FEE) return `Needs $${MX_BASE_FEE.toLocaleString()} on hand.`;
  return null;
}

export function openMxBase(state: SimState, iata: string): Outcome {
  const blocked = mxBaseBlocked(state, iata);
  if (blocked) return { ok: false, reason: blocked };
  state.cash -= MX_BASE_FEE;
  state.mxBases = [...mxBaseList(state), iata];
  if (state.outstationChecks) delete state.outstationChecks[iata];
  return { ok: true, message: `Maintenance base opened · ${iata} · $${MX_BASE_FEE.toLocaleString()} · $${MX_BASE_PER_DAY.toLocaleString()}/day · nights here are line checks` };
}

export function mxBaseCloseBlocked(state: SimState, iata: string): string | null {
  if (!hasMxBase(state, iata)) return `${iata} isn't a maintenance base.`;
  if (iata === state.homeAirport) return 'Home is always a maintenance base.';
  return null;
}

export function closeMxBase(state: SimState, iata: string): Outcome {
  const blocked = mxBaseCloseBlocked(state, iata);
  if (blocked) return { ok: false, reason: blocked };
  state.mxBases = mxBaseList(state).filter((code) => code !== iata);
  return { ok: true, message: `Maintenance base closed · ${iata} · nights here contracted unless set to defer` };
}

/** The bases' running costs a day, home's excepted: crew rooms under crew, maintenance bases under maintenance. */
export function basesCostPerDay(state: SimState): { crew: number; maintenance: number } {
  const away = (iata: string) => iata !== state.homeAirport;
  return {
    crew: Object.keys(crewBases(state)).filter(away).length * CREW_BASE_PER_DAY,
    maintenance: mxBaseList(state).filter(away).length * MX_BASE_PER_DAY,
  };
}
