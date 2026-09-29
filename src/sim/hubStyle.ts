import type { SimState } from './state';

/**
 * How a hub is run, chosen per airport. No times involved: the player
 * picks a style and the schedule follows (sim/hubs.ts re-times it). Three
 * things pull against each other:
 *
 *   - Connection efficiency: how many of the passengers who *could*
 *     connect through here actually make it (sim/hubs.ts). Banking flights
 *     into waves lines arrivals up with departures.
 *   - Peaks: how bunched the airport's traffic is, which shows in the
 *     real hours its flights use (sim/hours.ts). Waves are peaks, so they
 *     fill hours and congest.
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
  connectionEfficiency: number;
  hubWaitMinutes: number;
};

export const HUB_STYLES: Record<HubStyle, HubStyleSpec> = {
  rolling: {
    name: 'Rolling',
    description: 'Flights spread through the day. Smooth, but fewer connections line up.',
    connectionEfficiency: 0.5,
    hubWaitMinutes: 0,
  },
  banked: {
    name: 'Banked',
    description: 'Arrivals and departures grouped into waves. More connections, busier peaks, 20 min extra ground time per arrival.',
    connectionEfficiency: 0.75,
    hubWaitMinutes: 20,
  },
  tight: {
    name: 'Tight banks',
    description: 'Short, dense waves. Most connections, sharpest peaks, 35 min extra ground time per arrival.',
    connectionEfficiency: 1,
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
