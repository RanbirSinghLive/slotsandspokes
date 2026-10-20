import { lineRated } from './bases';
import { sameSeatPlan, seatPlanOf } from './cabins';
import { isAog } from './aog';
import { deferredItems, lineCheckMinutes, lineDue, nightsSinceLine, nightStart, RELEASE_MINUTES } from './mxChecks';
import { MIN_TURN_MINUTES, type ScheduleLeg } from './schedule';
import type { Aircraft, LineSlip, SimState } from './state';
import { scheduledTurnMinutes } from './utilisation';

/**
 * Line slips: planes trade lines of flying, the way an airline's tails
 * float across its lines. A *line* is a day's flying that repeats every
 * day (the legs on one tail); a plane is free to change line unless the
 * player locks it to its own (`Aircraft.lineLocked`).
 *
 * **Why:** a line that ends away from a line base, or too late for a
 * line check (a night stop, a long-haul landing after midnight), never
 * gives the plane flying it a check. Each morning, a plane due its line
 * check tonight on such a line looks for an unlocked twin (same type,
 * base and cabin) it meets on the ground today with a turn to spare
 * each way. At that meeting they trade the rest of their days: the due
 * plane finishes the twin's day and goes to bed at a line base, the twin
 * takes over the bad line. The flying each did before they met changes
 * plane at the rollover, so from tomorrow each keeps the other's whole
 * line, and the bad line passes round the pool as each plane falls due.
 *
 * Meeting before either has flown is a whole-day trade. A twin with no
 * flying at all takes the line outright. Planes on alternate-day legs,
 * held, broken, ferrying or booked into a heavy check don't trade, and
 * a twin due its own check tonight won't take a line that misses it.
 */

/** A plane's legs today, earliest first. */
function legsOf(state: SimState, tail: string): ScheduleLeg[] {
  return state.schedule.filter((leg) => leg.tail === tail).sort((a, b) => a.departMinute - b.departMinute);
}

/** Where a plane starts the day, and when it is free there (home-local minute of day, negative for last night). Null if it lands too late to count. */
function dayStartPosition(state: SimState, aircraft: Aircraft, legs: ScheduleLeg[], dayStart: number): { station: string; ready: number } | null {
  const releaseBy = dayStart + (legs.length > 0 ? legs[0].departMinute - RELEASE_MINUTES : 24 * 60);
  const start = nightStart(state, aircraft, releaseBy);
  return start ? { station: start.station, ready: start.since - dayStart } : null;
}

/** Whether a plane flying `today` then `tomorrow` gets its line check tonight: in bed at a rated line base for long enough. */
function nightIsCheck(state: SimState, aircraft: Aircraft, today: ScheduleLeg[], tomorrow: ScheduleLeg[], start: { station: string; ready: number }): boolean {
  const last = today[today.length - 1];
  const station = last ? last.dest : start.station;
  if (!lineRated(state, station, aircraft.typeCode)) return false;
  // A plane with nothing to fly tomorrow has the whole day at the line base.
  if (tomorrow.length === 0) return true;
  const landed = last ? last.departMinute + last.blockMinutes : start.ready;
  return 24 * 60 + tomorrow[0].departMinute - RELEASE_MINUTES - landed >= lineCheckMinutes(aircraft);
}

/** Why a plane can't trade lines today, or null when it can. */
function tradeBlocker(state: SimState, aircraft: Aircraft, legs: ScheduleLeg[]): string | null {
  if (aircraft.lineLocked) return 'locked';
  if (!aircraft.baseAirport || aircraft.rebase || aircraft.returningOnDay !== undefined) return 'away';
  if (isAog(state, aircraft.tail) || state.groundedTails.includes(aircraft.tail) || (state.mxHoldsToday ?? []).includes(aircraft.tail)) return 'out of service';
  if (aircraft.heavyCheckBooked || aircraft.dCheckBooked) return 'heavy check booked';
  if (legs.some((leg) => leg.dayParity !== undefined)) return 'alternate days';
  const swapped = new Set((state.swappedToday ?? []).map((entry) => entry.legId));
  if (legs.some((leg) => swapped.has(leg.legId))) return 'swapped today';
  return null;
}

type Plan = { twin: Aircraft; split: number; twinSplit: number; station: string; minute: number; slack: number };

/** The best meeting of a due plane with `twin`: where both trade the rest of their days with a turn to spare. */
function bestMeeting(
  state: SimState,
  due: { aircraft: Aircraft; legs: ScheduleLeg[]; start: { station: string; ready: number } },
  twin: { aircraft: Aircraft; legs: ScheduleLeg[]; start: { station: string; ready: number } },
): Plan | null {
  // Where a plane is after its first `count` legs, and from when.
  const at = (side: typeof due, count: number) => {
    if (count === 0) return { station: side.start.station, ready: side.start.ready + MIN_TURN_MINUTES };
    const leg = side.legs[count - 1];
    return { station: leg.dest, ready: leg.departMinute + leg.blockMinutes + scheduledTurnMinutes(state, leg.origin, leg.dest) };
  };
  let best: Plan | null = null;
  // The due plane always hands something on; the twin may hand on nothing (it stops flying at the meeting).
  for (let split = 0; split < due.legs.length; split += 1) {
    const dueAt = at(due, split);
    const dueNext = due.legs[split];
    if (dueNext.origin !== dueAt.station) continue;
    for (let twinSplit = 0; twinSplit <= twin.legs.length; twinSplit += 1) {
      const twinAt = at(twin, twinSplit);
      if (twinAt.station !== dueAt.station) continue;
      const twinNext = twin.legs[twinSplit];
      if (twinNext && twinNext.origin !== twinAt.station) continue;
      const slack = Math.min(dueNext.departMinute - twinAt.ready, twinNext ? twinNext.departMinute - dueAt.ready : Infinity);
      if (slack < 0) continue;
      // The due plane flies its own day to the meeting, then the twin's; tomorrow the twin's whole line.
      const dueToday = [...due.legs.slice(0, split), ...twin.legs.slice(twinSplit)];
      if (!nightIsCheck(state, due.aircraft, dueToday, twin.legs, due.start)) continue;
      if (best && slack <= best.slack) continue;
      const minute = Math.min(dueNext.departMinute, twinNext?.departMinute ?? Infinity);
      best = { twin: twin.aircraft, split, twinSplit, station: dueAt.station, minute, slack };
    }
  }
  return best;
}

/**
 * Each morning, after the night's checks and holds: every unlocked plane
 * due its line check on a line that won't give it one trades the rest of
 * its day with the twin it meets with the most time to spare. The legs
 * after the meeting change plane now; the ones before go in the slip's
 * hand-over for the rollover (finishLineSlips()).
 */
export function planLineSlips(state: SimState, dayStart: number): void {
  state.lineSlipsToday = [];
  const traded = new Set<string>();
  const sides = state.aircraft.flatMap((aircraft) => {
    const legs = legsOf(state, aircraft.tail);
    if (tradeBlocker(state, aircraft, legs)) return [];
    const start = dayStartPosition(state, aircraft, legs, dayStart);
    return start ? [{ aircraft, legs, start }] : [];
  });
  // The most overdue first, so a short pool goes to the plane that needs it most.
  const due = sides
    .filter((side) => side.legs.length > 0 && lineDue(side.aircraft) && !nightIsCheck(state, side.aircraft, side.legs, side.legs, side.start))
    .sort((a, b) => deferredItems(b.aircraft) - deferredItems(a.aircraft) || nightsSinceLine(b.aircraft) - nightsSinceLine(a.aircraft) || a.aircraft.tail.localeCompare(b.aircraft.tail));
  for (const side of due) {
    if (traded.has(side.aircraft.tail)) continue;
    let best: Plan | null = null;
    for (const twin of sides) {
      const other = twin.aircraft;
      if (other.tail === side.aircraft.tail || traded.has(other.tail) || lineDue(other)) continue;
      if (other.typeCode !== side.aircraft.typeCode || other.baseAirport !== side.aircraft.baseAirport) continue;
      if (!sameSeatPlan(seatPlanOf(other), seatPlanOf(side.aircraft))) continue;
      const plan = bestMeeting(state, side, twin);
      // Most time to spare wins; then the twin furthest from its own check.
      if (plan && (!best || plan.slack > best.slack || (plan.slack === best.slack && nightsSinceLine(plan.twin) < nightsSinceLine(best.twin)))) best = plan;
    }
    if (!best) continue;
    const twinLegs = legsOf(state, best.twin.tail);
    const dueLegs = side.legs;
    for (const leg of dueLegs.slice(best.split)) leg.tail = best.twin.tail;
    for (const leg of twinLegs.slice(best.twinSplit)) leg.tail = side.aircraft.tail;
    const slip: LineSlip = {
      tail: side.aircraft.tail,
      with: best.twin.tail,
      station: best.station,
      minute: best.minute,
      handOver: [
        ...dueLegs.slice(0, best.split).map((leg) => ({ legId: leg.legId, toTail: best.twin.tail })),
        ...twinLegs.slice(0, best.twinSplit).map((leg) => ({ legId: leg.legId, toTail: side.aircraft.tail })),
      ],
    };
    state.lineSlipsToday.push(slip);
    traded.add(side.aircraft.tail);
    traded.add(best.twin.tail);
  }
}

/** Rollover: the flying each traded plane did before its meeting changes plane, so each keeps the other's whole line. */
export function finishLineSlips(state: SimState): void {
  for (const slip of state.lineSlipsToday ?? []) {
    for (const { legId, toTail } of slip.handOver) {
      const leg = state.schedule.find((l) => l.legId === legId);
      if (leg) leg.tail = toTail;
    }
  }
  state.lineSlipsToday = [];
}

/** The schedule as it flies from tomorrow: today's slips' hand-overs made, on copies of the legs. */
export function scheduleAfterSlips(state: SimState): ScheduleLeg[] {
  const handOver = new Map((state.lineSlipsToday ?? []).flatMap((slip) => slip.handOver.map((entry) => [entry.legId, entry.toTail] as const)));
  return state.schedule.map((leg) => (handOver.has(leg.legId) ? { ...leg, tail: handOver.get(leg.legId)! } : leg));
}

/** Today's slip a plane is in, either side. */
export function lineSlipOf(state: SimState, tail: string): LineSlip | null {
  return (state.lineSlipsToday ?? []).find((slip) => slip.tail === tail || slip.with === tail) ?? null;
}

/** Lock a plane to its own line, or free it to trade (sim/lineSlips.ts). */
export function setLineLocked(state: SimState, tail: string, locked: boolean): { ok: true; message: string } | { ok: false; reason: string } {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft) return { ok: false, reason: 'No such plane' };
  if (locked) aircraft.lineLocked = true;
  else delete aircraft.lineLocked;
  return { ok: true, message: `${tail} · ${locked ? 'line locked' : 'line free'}` };
}
