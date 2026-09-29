import type { SimState } from './state';

/**
 * How a hub is run, chosen per airport: how the route planner times the
 * rotations that start there (WEEK-THIRTEEN.md, thread 5). Connections
 * come from real times (sim/hubs.ts: an arrival meets a departure within
 * a few hours), so the style is what lines them up. Three things pull
 * against each other:
 *
 *   - Banks: under Banked or Tight banks, every rotation from the hub
 *     starts on a wave (every BANK_PERIOD from FIRST_BANK_MINUTE), so
 *     departures bunch and the planes coming back meet the next wave.
 *     Rolling lets each plane go when it's ready.
 *   - Peaks: waves bunch departures into the same hours, which fill
 *     (sim/hours.ts) and congest.
 *   - Hub wait: extra scheduled ground time after every flight *into* this
 *     airport, while the wave assembles. Paid for in aircraft time, like a
 *     turn buffer (sim/turnBuffer.ts) — and, like one, it absorbs delays.
 *
 * Kept in its own small module with no imports beyond types so the load
 * and utilisation code can read it without an import cycle.
 */
export type HubStyle = 'rolling' | 'banked' | 'tight';

export type HubStyleSpec = {
  name: string;
  description: string;
  /** Minutes between waves, or 0 for none (Rolling). */
  bankPeriodMinutes: number;
  hubWaitMinutes: number;
};

/** The first wave of the day, home time. */
export const FIRST_BANK_MINUTE = 7 * 60;

export const HUB_STYLES: Record<HubStyle, HubStyleSpec> = {
  rolling: {
    name: 'Rolling',
    description: 'Planes leave when ready. Smooth hours; connections only where times happen to meet.',
    bankPeriodMinutes: 0,
    hubWaitMinutes: 0,
  },
  banked: {
    name: 'Banked',
    description: 'Departures in waves every 3 h, 20 min extra ground time per arrival. More connections, fuller wave hours.',
    bankPeriodMinutes: 180,
    hubWaitMinutes: 20,
  },
  tight: {
    name: 'Tight banks',
    description: 'Waves every 2 h, 35 min extra ground time per arrival. Most connections, sharpest peaks.',
    bankPeriodMinutes: 120,
    hubWaitMinutes: 35,
  },
};

export const HUB_STYLE_ORDER: HubStyle[] = ['rolling', 'banked', 'tight'];

/** This airport's style; every airport starts Rolling. */
export function hubStyleAt(state: SimState, iata: string): HubStyle {
  return state.hubStyles[iata] ?? 'rolling';
}

/** Extra scheduled ground time after a flight into this airport. */
export function hubWaitMinutes(state: SimState, iata: string): number {
  return HUB_STYLES[hubStyleAt(state, iata)].hubWaitMinutes;
}

/**
 * When a rotation from this airport that could start at `minute` starts:
 * the next wave at a banked hub (never before `minute`), `minute` itself
 * under Rolling. Schedule minutes, home clock.
 */
export function nextBankMinute(state: SimState, iata: string | null | undefined, minute: number): number {
  if (!iata) return minute;
  const period = HUB_STYLES[hubStyleAt(state, iata)].bankPeriodMinutes;
  if (period <= 0 || minute <= FIRST_BANK_MINUTE) return period <= 0 ? minute : FIRST_BANK_MINUTE;
  return FIRST_BANK_MINUTE + Math.ceil((minute - FIRST_BANK_MINUTE) / period) * period;
}
