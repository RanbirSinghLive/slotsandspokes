import { airportCapacityPerDay, dailyDeparturesAt } from './airports';
import { hasCrewBase, hasLineBase } from './bases';
import { dayIndex } from './clock';
import type { DelayBreakdown } from './delays';
import type { SimState } from './state';

/**
 * Stations: how well the ground work is done at each airport you fly from,
 * and the record of what delayed your departures there.
 *
 * **Handling tiers.** Every departure rolls a ground-handling delay at its
 * origin (the fifth delay cause, sim/delays.ts). How often and how long
 * depends on who does the handling:
 *
 *   contract — a handler hired by the flight. The default everywhere but
 *              home. Worse at thin fields, where the handler has few
 *              staff to spare.
 *   own      — your own ramp staff. Needs a crew base or a line base
 *              there. Home starts here at no running cost.
 *   hub      — hub-grade handling with its own turn crews. Needs the
 *              station to be an own station already and HUB_MIN_DEPARTURES
 *              daily departures.
 *
 * Each step up is paid up front, takes days to build (the player sees the
 * pending step), and costs a fixed amount a day. Stepping down is instant
 * and refunds nothing. The slow build and the running cost are what make a
 * well-run hub a moat: a rival can't copy it overnight, and it only pays
 * where there are enough departures to spread the cost.
 *
 * **The ledger.** Each station keeps today's departures and delay minutes
 * by cause, and the last LEDGER_DAYS finished days. It exists so the player
 * can see *which* causes are eating each station's day, then choose between
 * the answers the game offers: a longer turn buffer (sim/turnBuffer.ts), a
 * better handling tier, a different aircraft, or fewer movements at a full
 * field.
 */

export type HandlingTier = 'contract' | 'own' | 'hub';
export const HANDLING_TIERS: HandlingTier[] = ['contract', 'own', 'hub'];

/** Chance of a ground delay on a departure, and its worst case in minutes. */
export const HANDLING: Record<HandlingTier, { chance: number; maxMinutes: number }> = {
  contract: { chance: 0.1, maxMinutes: 20 },
  own: { chance: 0.05, maxMinutes: 12 },
  hub: { chance: 0.015, maxMinutes: 8 },
};

/** Below this daily capacity a field is thin: a contracted handler there runs worse. */
export const THIN_FIELD_CAPACITY = 60;
const THIN_CHANCE_FACTOR = 1.5;
const THIN_MINUTES_FACTOR = 1.25;

export const STATION_FEE: Record<'own' | 'hub', number> = { own: 120_000, hub: 400_000 };
export const STATION_PER_DAY: Record<'own' | 'hub', number> = { own: 400, hub: 1_200 };
export const STATION_BUILD_DAYS: Record<'own' | 'hub', number> = { own: 14, hub: 30 };
export const HUB_MIN_DEPARTURES = 6;

/** Finished days the ledger keeps. */
export const LEDGER_DAYS = 7;

type Outcome = { ok: true; message: string } | { ok: false; reason: string };

// --- Tiers -----------------------------------------------------------------

/** Who handles the ground work at this station now. Home is always at least `own`. */
export function stationTier(state: SimState, iata: string): HandlingTier {
  const set = state.stationTiers?.[iata];
  if (set) return set;
  return iata === state.homeAirport ? 'own' : 'contract';
}

/** The step being built at this station, if any. */
export function pendingStation(state: SimState, iata: string): { to: 'own' | 'hub'; readyDay: number } | null {
  return state.stationUpgrades?.[iata] ?? null;
}

/** The chance and worst case of a ground delay for a departure from here. */
export function handlingParameters(state: SimState, iata: string): { chance: number; maxMinutes: number } {
  const base = HANDLING[stationTier(state, iata)];
  const thin = stationTier(state, iata) === 'contract' && airportCapacityPerDay(iata) < THIN_FIELD_CAPACITY;
  return thin
    ? { chance: base.chance * THIN_CHANCE_FACTOR, maxMinutes: Math.round(base.maxMinutes * THIN_MINUTES_FACTOR) }
    : base;
}

/** Why this station can't take the next step up, or null. */
export function stationUpgradeBlocked(state: SimState, iata: string): string | null {
  const tier = stationTier(state, iata);
  if (tier === 'hub') return 'Already hub-grade.';
  const to = tier === 'contract' ? 'own' : 'hub';
  if (pendingStation(state, iata)) return `Already building · ready day ${pendingStation(state, iata)!.readyDay}.`;
  if (!state.knownAirports.includes(iata)) return `${iata} isn't on your map yet.`;
  if (to === 'own' && !hasCrewBase(state, iata) && !hasLineBase(state, iata)) return 'Needs a crew base or a line base here first.';
  if (to === 'hub' && dailyDeparturesAt(state, iata) < HUB_MIN_DEPARTURES) return `Needs ${HUB_MIN_DEPARTURES} departures a day here.`;
  if (state.cash < STATION_FEE[to]) return `Needs $${STATION_FEE[to].toLocaleString()} on hand.`;
  return null;
}

export function upgradeStation(state: SimState, iata: string): Outcome {
  const blocked = stationUpgradeBlocked(state, iata);
  if (blocked) return { ok: false, reason: blocked };
  const to = stationTier(state, iata) === 'contract' ? 'own' : 'hub';
  state.cash -= STATION_FEE[to];
  const readyDay = dayIndex(state) + STATION_BUILD_DAYS[to];
  (state.stationUpgrades ??= {})[iata] = { to, readyDay };
  return { ok: true, message: `${iata} · ${to === 'own' ? 'own ramp staff' : 'hub-grade handling'} · $${STATION_FEE[to].toLocaleString()} · ready day ${readyDay}` };
}

/** Why this station can't step down, or null. Home never goes below `own`. */
export function stationDowngradeBlocked(state: SimState, iata: string): string | null {
  if (pendingStation(state, iata)) return 'Cancel the build by waiting for it, or step down after it opens.';
  const tier = stationTier(state, iata);
  if (tier === 'contract') return 'Already contracted.';
  if (tier === 'own' && iata === state.homeAirport) return 'Home keeps its own staff.';
  return null;
}

export function downgradeStation(state: SimState, iata: string): Outcome {
  const blocked = stationDowngradeBlocked(state, iata);
  if (blocked) return { ok: false, reason: blocked };
  const lower: HandlingTier = stationTier(state, iata) === 'hub' ? 'own' : 'contract';
  const tiers = (state.stationTiers ??= {});
  if (lower === 'contract') delete tiers[iata];
  else tiers[iata] = lower;
  return { ok: true, message: `${iata} · back to ${lower === 'own' ? 'own staff' : 'a contract handler'}` };
}

/** What the player's stations cost a day: home's own staff is free. */
export function stationCostPerDay(state: SimState): number {
  let total = 0;
  for (const [iata, tier] of Object.entries(state.stationTiers ?? {})) {
    if (tier === 'contract') continue;
    if (iata === state.homeAirport && tier === 'own') continue;
    total += STATION_PER_DAY[tier];
  }
  return total;
}

/** At rollover: builds that are due open. */
export function rollDailyStations(state: SimState): void {
  const upgrades = state.stationUpgrades;
  if (!upgrades) return;
  const today = dayIndex(state);
  for (const [iata, upgrade] of Object.entries(upgrades)) {
    if (upgrade.readyDay > today) continue;
    (state.stationTiers ??= {})[iata] = upgrade.to;
    delete upgrades[iata];
  }
}

// --- Ledger ----------------------------------------------------------------

/** One station's departures and delay minutes by cause over a stretch of days. */
export type StationDay = {
  departures: number;
  /** Minutes the departures left after their scheduled time, summed: how much the inbound leg ate of the turn. */
  lateDeparture: number;
  age: number;
  weather: number;
  knockOn: number;
  congestion: number;
  ground: number;
};

export type StationLedger = { today: StationDay; past: StationDay[] };

export const DELAY_CAUSES = ['knockOn', 'ground', 'congestion', 'weather', 'age'] as const;
export type DelayCause = (typeof DELAY_CAUSES)[number];

function emptyDay(): StationDay {
  return { departures: 0, lateDeparture: 0, age: 0, weather: 0, knockOn: 0, congestion: 0, ground: 0 };
}

/** Called for every departure, with the delay rolled before any executive scaling. */
export function recordStationDeparture(state: SimState, iata: string, breakdown: DelayBreakdown, lateAtDepartureMinutes: number): void {
  const ledgers = (state.stationLedger ??= {});
  const day = (ledgers[iata] ??= { today: emptyDay(), past: [] }).today;
  day.departures += 1;
  day.lateDeparture += Math.max(0, lateAtDepartureMinutes);
  day.age += breakdown.age;
  day.weather += breakdown.weather;
  day.knockOn += breakdown.knockOn;
  day.congestion += breakdown.congestion;
  day.ground += breakdown.ground ?? 0;
}

/** At rollover: today's tallies become the newest finished day. */
export function rollStationLedgers(state: SimState): void {
  for (const ledger of Object.values(state.stationLedger ?? {})) {
    ledger.past.push(ledger.today);
    if (ledger.past.length > LEDGER_DAYS) ledger.past.shift();
    ledger.today = emptyDay();
  }
}

export type StationReadout = {
  /** Departures in the window. */
  departures: number;
  /** Average minutes per departure, by cause. */
  perDeparture: Record<DelayCause, number>;
  /** Average of the five: minutes a departure from here is delayed. */
  totalPerDeparture: number;
  /** Average minutes the departures left late: the inbound lateness the turn didn't absorb. */
  lateDeparturePerDeparture: number;
  /** The cause with the most minutes, or null when nothing was delayed. */
  topCause: DelayCause | null;
  days: number;
};

/** The finished days plus today. Null where the airline has not yet departed from here. */
export function stationReadout(state: SimState, iata: string): StationReadout | null {
  const ledger = state.stationLedger?.[iata];
  if (!ledger) return null;
  const days = [...ledger.past, ledger.today];
  const sum = emptyDay();
  for (const day of days) {
    sum.departures += day.departures;
    sum.lateDeparture += day.lateDeparture;
    for (const cause of DELAY_CAUSES) sum[cause] += day[cause];
  }
  if (sum.departures === 0) return null;
  const perDeparture = { knockOn: 0, ground: 0, congestion: 0, weather: 0, age: 0 } as Record<DelayCause, number>;
  let total = 0;
  let top: DelayCause | null = null;
  for (const cause of DELAY_CAUSES) {
    perDeparture[cause] = sum[cause] / sum.departures;
    total += perDeparture[cause];
    if (sum[cause] > 0 && (top === null || sum[cause] > sum[top])) top = cause;
  }
  return {
    departures: sum.departures,
    perDeparture,
    totalPerDeparture: total,
    lateDeparturePerDeparture: sum.lateDeparture / sum.departures,
    topCause: top,
    days: days.filter((day) => day.departures > 0).length,
  };
}
