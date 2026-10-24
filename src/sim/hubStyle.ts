import type { SimState } from './state';

/**
 * How a hub is run, chosen per airport: how the route planner times the
 * rotations based there. Connections come from real times (sim/hubs.ts:
 * an arrival meets a departure 40 to 180 minutes later), so the style is
 * what lines them up.
 *
 *   - Rolling: each plane leaves when it's ready. Smooth hours;
 *     connections only where times happen to meet.
 *   - Banked: the day runs in waves. A wave is a pair: flights home land
 *     BANK_INBOUND_LEAD_MINUTES before it, so their passengers make a good
 *     connection, and flights out leave on it. The waves repeat every
 *     bank cycle, sized when the hub switches to the round trip its own
 *     rotations take (bankCycleFor()), so a plane that leaves on one wave
 *     is back for the next and waits little at the hub. A rotation that
 *     comes back early waits at its last outstation instead, so it still
 *     lands in the wave's arrival window.
 *
 * What banking costs: departures bunch into the wave hours, which fill
 * (sim/hours.ts), congest and price slots higher, and a rotation longer
 * than the cycle waits for the wave after next. A plane whose day can't
 * take the waiting flies its later rotations rolling (sim/turnBuffer.ts),
 * so switching never fails for want of time on one plane.
 *
 * Kept in its own small module with no imports beyond types so the load
 * and utilisation code can read it without an import cycle.
 */
export type HubStyle = 'rolling' | 'banked';

export type HubStyleSpec = {
  name: string;
  description: string;
};

/** A banked hub's waves: every `periodMinutes` from `firstMinute`, home clock. */
export type HubBanks = { periodMinutes: number; firstMinute: number };

/**
 * How long before a wave the flights feeding it land: the shortest
 * connection a passenger and their bag can make (sim/hubs.ts's 40
 * minutes) plus ten to spare, and more than the plane's own 30-minute turn.
 */
export const BANK_INBOUND_LEAD_MINUTES = 50;
/** The first wave a newly banked hub gets: the opening of the usable day (sim/utilisation.ts's 06:00, written out here to keep this module import-free). */
const FIRST_BANK_MINUTE = 6 * 60;
/** Bank cycles are whole quarter hours, and at least this long... */
const MIN_BANK_PERIOD = 90;
/** ...and at most this long, so a day still has several waves. */
const MAX_BANK_PERIOD = 300;
const BANK_PERIOD_STEP = 15;
/** The cycle a hub gets when it has no rotations of its own to size it by. */
const DEFAULT_BANK_PERIOD = 180;
/** A departure up to this long after a wave is still on it: the same-route nudge can move one 5 to 15 minutes. */
const ON_BANK_TOLERANCE_MINUTES = 15;

export const HUB_STYLES: Record<HubStyle, HubStyleSpec> = {
  rolling: {
    name: 'Rolling',
    description: 'Planes leave when ready. Smooth hours; connections only where times happen to meet.',
  },
  banked: {
    name: 'Banked',
    description: 'Waves sized to your round trips: flights land just before each wave and leave on it. More connections, fuller wave hours.',
  },
};

export const HUB_STYLE_ORDER: HubStyle[] = ['rolling', 'banked'];

/** This airport's style; every airport starts Rolling. */
export function hubStyleAt(state: SimState, iata: string): HubStyle {
  return state.hubStyles[iata] === 'banked' ? 'banked' : 'rolling';
}

/** A banked hub's waves, or null at a Rolling one. */
export function hubBanksAt(state: SimState, iata: string | null | undefined): HubBanks | null {
  if (!iata || hubStyleAt(state, iata) !== 'banked') return null;
  return state.hubBanks?.[iata] ?? { periodMinutes: DEFAULT_BANK_PERIOD, firstMinute: FIRST_BANK_MINUTE };
}

/**
 * When a rotation from this airport that could start at `minute` starts:
 * the next wave at a banked hub (never before `minute`), `minute` itself
 * under Rolling. Schedule minutes, home clock.
 */
export function nextBankMinute(state: SimState, iata: string | null | undefined, minute: number): number {
  const banks = hubBanksAt(state, iata);
  if (!banks) return minute;
  if (minute <= banks.firstMinute) return banks.firstMinute;
  return banks.firstMinute + Math.ceil((minute - banks.firstMinute) / banks.periodMinutes) * banks.periodMinutes;
}

/**
 * The wave at or before `minute` at a banked hub (its first wave if
 * `minute` is earlier still), for a plane that spent the night there and
 * can as well leave earlier. `minute` itself under Rolling.
 */
export function bankAtOrBefore(state: SimState, iata: string | null | undefined, minute: number): number {
  const banks = hubBanksAt(state, iata);
  if (!banks) return minute;
  if (minute <= banks.firstMinute) return banks.firstMinute;
  return banks.firstMinute + Math.floor((minute - banks.firstMinute) / banks.periodMinutes) * banks.periodMinutes;
}

/**
 * When a flight home to a banked hub that could land at `arrivalMinute`
 * lands: BANK_INBOUND_LEAD_MINUTES before the next wave it can feed,
 * never earlier than it could. Under Rolling, `arrivalMinute` itself.
 */
export function bankedArrivalMinute(state: SimState, iata: string | null | undefined, arrivalMinute: number): number {
  if (!hubBanksAt(state, iata)) return arrivalMinute;
  return nextBankMinute(state, iata, arrivalMinute + BANK_INBOUND_LEAD_MINUTES) - BANK_INBOUND_LEAD_MINUTES;
}

/** Whether a departure at `minute` from this banked hub leaves on one of its waves. */
export function isOnBank(state: SimState, iata: string, minute: number): boolean {
  const banks = hubBanksAt(state, iata);
  if (!banks || minute < banks.firstMinute) return false;
  return (minute - banks.firstMinute) % banks.periodMinutes <= ON_BANK_TOLERANCE_MINUTES;
}

/**
 * The bank cycle that fits these rotations: the median of each one's
 * round trip (`roundTripMinutes`, first departure to arrival back) plus
 * the inbound lead, rounded up to a quarter hour. With it the typical
 * plane leaves on a wave and lands just in time for the next, so it waits
 * at the hub only its turn; shorter ones wait at their last outstation,
 * longer ones skip a wave.
 */
export function bankCycleFor(roundTripMinutes: number[]): number {
  if (roundTripMinutes.length === 0) return DEFAULT_BANK_PERIOD;
  const sorted = [...roundTripMinutes].sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  const period = Math.ceil((median + BANK_INBOUND_LEAD_MINUTES) / BANK_PERIOD_STEP) * BANK_PERIOD_STEP;
  return Math.min(MAX_BANK_PERIOD, Math.max(MIN_BANK_PERIOD, period));
}

/** A newly banked hub's waves for a cycle of `periodMinutes`. */
export function banksWithPeriod(periodMinutes: number): HubBanks {
  return { periodMinutes, firstMinute: FIRST_BANK_MINUTE };
}

/** "every 2h45": how often a banked hub's waves come round. */
export function bankPeriodText(periodMinutes: number): string {
  const hours = Math.floor(periodMinutes / 60);
  const minutes = periodMinutes % 60;
  return `every ${hours}h${minutes > 0 ? String(minutes).padStart(2, '0') : ''}`;
}

/**
 * Hub styles from before waves were sized to the network: Tight banks (2 h
 * waves) and Banked (3 h) became one Banked style, each keeping its old
 * waves from 07:00 so its timetable stays on them.
 */
export function migrateHubStyles(state: SimState): void {
  const styles = state.hubStyles as Record<string, string>;
  for (const [iata, style] of Object.entries(styles)) {
    if (style !== 'tight' && style !== 'banked') {
      delete styles[iata];
      continue;
    }
    state.hubBanks ??= {};
    state.hubBanks[iata] = { periodMinutes: style === 'tight' ? 120 : 180, firstMinute: 7 * 60 };
    styles[iata] = 'banked';
  }
}
