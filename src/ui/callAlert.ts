import { briefSettings } from '../sim/briefs';
import { dayIndex } from '../sim/clock';
import { callsNeeded, LATE_CALL_MINUTES, type Call } from '../sim/controller';
import type { SimState } from '../sim/state';
import { select } from './selection';

/**
 * The controller's call (sim/controller.ts), put in front of the player: a
 * waiting plane whose day is about to break pauses the clock once and opens
 * its page, where Needs a call has the ✕ for each rotation it can still
 * cancel. The ops row's CALL count (ui/opsBoard.ts) lists the planes
 * whatever the setting, so turning the pause off loses nothing but the stop.
 *
 * A plane is raised once a day per kind of trouble: a plane that stays late
 * isn't raised again every minute.
 */
const raised = new Set<string>();
let primed = false;
let checkedKey = '';
let calls: Call[] = [];

export const CALL_TITLES: Record<Call['kind'], string> = {
  curfew: 'the 22:00 curfew will cancel a rotation',
  event: 'a priority flight will fail',
  late: `a flight is ${LATE_CALL_MINUTES}+ min late`,
};

/** The planes that need a call now, worst first. Recomputed when the minute or the day's cancellations change. */
export function pendingCalls(state: SimState): Call[] {
  // A cancellation changes the answer within the same minute (the game may be paused).
  const key = `${state.simMinute}:${state.cancelledToday.length}:${state.aircraft.length}`;
  if (key !== checkedKey) {
    checkedKey = key;
    calls = callsNeeded(state);
  }
  return calls;
}

/** Called every frame; true on the frame a new call is put in front of the player, so the caller can pause the clock. */
export function updateCalls(state: SimState, choosingHome: boolean): boolean {
  const now = pendingCalls(state);
  const today = dayIndex(state);
  const fresh = now.filter((call) => !raised.has(`${today}:${call.tail}:${call.kind}`));
  for (const call of fresh) raised.add(`${today}:${call.tail}:${call.kind}`);
  // What a loaded game already holds isn't news.
  if (!primed) {
    primed = true;
    return false;
  }
  if (choosingHome || fresh.length === 0 || !briefSettings(state).callPause) return false;
  if (document.querySelector('.modal-overlay:not([hidden])')) return false;
  select({ kind: 'aircraft', tail: fresh[0].tail });
  return true;
}
