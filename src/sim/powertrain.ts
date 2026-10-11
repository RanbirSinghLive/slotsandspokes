import { isAdopted } from './innovations';
import { leaseRateFor } from './leasing';
import type { Aircraft, SimState } from './state';

/**
 * Hybrid and electric planes (the R&D shop's electric path, sim/rd.ts).
 *
 * **Hybrid** (researched as "Hybrid propulsion"): every propeller and
 * regional plane leased afterwards is a new hybrid build. It burns
 * HYBRID_FUEL_FACTOR of the fuel and leases for HYBRID_LEASE_PREMIUM more
 * than the same class new. Planes already flying stay as they are.
 *
 * **Electric** (researched as "Electric 25-seater"): a 25-seat plane
 * leased on its own line in the leasing menu, almost no energy cost per
 * flight and ELECTRIC_LEASE_PREMIUM more to lease. It can only fly from and
 * to airports with a charger, built like a hangar: a fee once, then a day.
 *
 * A powertrain plane is always a new airframe, so it never arrives
 * refurbished or old.
 */

export const HYBRID_FUEL_FACTOR = 0.75;
export const HYBRID_LEASE_PREMIUM = 1.15;
export const ELECTRIC_FUEL_FACTOR = 0.1;
export const ELECTRIC_LEASE_PREMIUM = 1.3;
export const ELECTRIC_CLASS = 'PROP';
export const CHARGER_FEE = 250_000;
export const CHARGER_PER_DAY = 300;

type Outcome = { ok: true; message: string } | { ok: false; reason: string };

/** The fuel a plane burns, as a share of its class's: 1 for the usual plane. */
export function powertrainFuelFactor(aircraft: Pick<Aircraft, 'powertrain'>): number {
  if (aircraft.powertrain === 'hybrid') return HYBRID_FUEL_FACTOR;
  if (aircraft.powertrain === 'electric') return ELECTRIC_FUEL_FACTOR;
  return 1;
}

/** What a new lease of this class is built as, once the research is done: hybrid for propellers and regionals, otherwise the usual plane. */
export function defaultPowertrain(state: SimState, typeCode: string): Aircraft['powertrain'] {
  return isAdopted(state, 'hybrid-retrofit') && (typeCode === 'PROP' || typeCode === 'REGIONAL') ? 'hybrid' : undefined;
}

/** Whether the electric 25-seater is on the leasing menu. */
export function electricAvailable(state: SimState): boolean {
  return isAdopted(state, 'electric-25');
}

/** A new airframe's daily lease with this powertrain. */
export function powertrainLeasePerDay(typeCode: string, powertrain: NonNullable<Aircraft['powertrain']>): number {
  const premium = powertrain === 'electric' ? ELECTRIC_LEASE_PREMIUM : HYBRID_LEASE_PREMIUM;
  return Math.round((leaseRateFor(typeCode, 0) * premium) / 10) * 10;
}

export function hasCharger(state: SimState, iata: string): boolean {
  return state.chargers?.includes(iata) ?? false;
}

/** What chargers cost to run a day. Charged at rollover. */
export function chargersPerDay(state: SimState): number {
  return (state.chargers?.length ?? 0) * CHARGER_PER_DAY;
}

/** Why a charger can't be built here now, or null. */
export function chargerBlockedReason(state: SimState, iata: string): string | null {
  if (!isAdopted(state, 'charging-tech')) return 'Needs Charging network (R&D)';
  if (hasCharger(state, iata)) return 'Built';
  if (state.cash < CHARGER_FEE) return `Needs $${CHARGER_FEE.toLocaleString()} cash`;
  return null;
}

export function buildCharger(state: SimState, iata: string): Outcome {
  const blocked = chargerBlockedReason(state, iata);
  if (blocked) return { ok: false, reason: blocked };
  state.cash -= CHARGER_FEE;
  state.chargers = [...(state.chargers ?? []), iata];
  return { ok: true, message: `Charger built at ${iata}: $${CHARGER_FEE.toLocaleString()} once, $${CHARGER_PER_DAY}/day.` };
}

/** The airports an electric plane would land at with no charger, or an empty list. */
export function missingChargers(state: SimState, aircraft: Pick<Aircraft, 'powertrain'>, airports: string[]): string[] {
  if (aircraft.powertrain !== 'electric') return [];
  return [...new Set(airports)].filter((iata) => !hasCharger(state, iata));
}
