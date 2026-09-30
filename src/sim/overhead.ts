import { executiveOverheadMultiplier } from './executives';
import type { SimState } from './state';

/**
 * Network overhead: the cost of running an airline beyond its flights,
 * leases and slots (head office, systems, crew bases, and the coordination
 * that gets harder as the network grows, since every plane and route has
 * to be planned against every other). Charged airline-wide at each
 * rollover (sim/step.ts).
 *
 * It grows with the square of the fleet, so it hardly touches a small
 * airline and bites a big one: $75 a day for one plane, $1,875 for five,
 * $24,300 for eighteen before the large-fleet term below ($26,460 with it,
 * $64,000 at twenty-five). At twice that, careful airlines in the core went
 * bust late in the year as their overhead outgrew what rivals left them. Each extra plane adds more than the last, which is
 * what keeps growth paying but not at any cost (CLAUDE.md, the game's
 * philosophy): a uniform cost can't tame a big airline's profits without
 * hurting a one-plane start more (WEEK-NINE.md, threads 8 and 9).
 *
 * Rivals don't pay it: they're small start-ups, capped at 20 routes.
 */
export const OVERHEAD_PER_PLANE_SQUARED = 75;

/**
 * Past this many planes, running the airline gets harder faster: a big
 * network's hub, crews and schedule have to be coordinated as one, and
 * overhead grows with the cube of every plane beyond it on top of the
 * square. Below it, nothing changes, so a small or mid-size airline never
 * feels it; a big one pays for being big. Set with rival attention
 * (sim/pressure.ts) on 18 seeds a home: the steady player's year at
 * Philadelphia fell from $95M to $67M (it was $57M before hubs could grow
 * off-peak), Toronto stayed at $41M, and big airlines stop at 11–13
 * planes, where the next one no longer pays, instead of 19–20.
 */
export const LARGE_FLEET_PLANES = 15;
export const OVERHEAD_PER_EXTRA_PLANE_CUBED = 80;

/** Overhead a day for an airline with this many planes. */
export function networkOverheadFor(planes: number): number {
  const extra = Math.max(0, planes - LARGE_FLEET_PLANES);
  return OVERHEAD_PER_PLANE_SQUARED * planes * planes + OVERHEAD_PER_EXTRA_PLANE_CUBED * extra * extra * extra;
}

/** What the airline pays in overhead a day now. */
export function networkOverheadPerDay(state: SimState): number {
  // A cost-cutting CFO trims it (sim/executives.ts).
  return networkOverheadFor(state.aircraft.length) * executiveOverheadMultiplier(state);
}

/** How much the daily overhead would fall with one plane fewer. */
export function overheadSavedByOneFewer(state: SimState): number {
  const planes = state.aircraft.length;
  if (planes === 0) return 0;
  return (networkOverheadFor(planes) - networkOverheadFor(planes - 1)) * executiveOverheadMultiplier(state);
}

/** How much one more plane would add to the daily overhead. */
export function overheadAddedByNextPlane(state: SimState): number {
  return (networkOverheadFor(state.aircraft.length + 1) - networkOverheadFor(state.aircraft.length)) * executiveOverheadMultiplier(state);
}
