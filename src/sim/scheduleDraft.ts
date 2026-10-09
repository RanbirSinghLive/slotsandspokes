import { commitRetime, planRetime, tomorrowView, type RetimePlan } from './retime';
import type { ScheduleLeg } from './schedule';
import type { SimState } from './state';
import { rotationsForTail, scheduledTurnMinutes } from './utilisation';

/**
 * Planning the Gantt (the Schedule timeline, ui/panels.ts) without the
 * rules getting in the way mid-gesture. Three things build on sim/retime.ts:
 *
 * - **Swap**: a rotation dropped onto a plane where other rotations already
 *   sit in that time of day trades places with them: those rotations go to
 *   the dragged one's plane at their own times (or, for a single one, at the
 *   time the dragged one left). One long flight over two short ones sends
 *   both short ones across. Tried before anything else is given up on.
 * - **Hold**: a drop that fails only because it sits on top of other flights
 *   is kept as a draft move. The timeline plans on a copy of the state
 *   while a draft is open, and every move in it is replayed here on the real
 *   state when the player verifies it.
 * - **Verify**: `commitDraft()` makes the moves one by one with overlaps
 *   allowed, then checks every plane they touched joins up. If any step or
 *   the final check fails, nothing changes.
 */

/** One drop of a rotation: which flights, onto which plane, starting when. */
export type DraftMove = { legIds: string[]; tail: string; start: number };

export type DropPlan = {
  ok: boolean;
  /** A plain move, a swap of places with other rotations, or a hold (overlapping, kept in the draft). */
  kind: 'move' | 'swap' | 'hold';
  /** The dragged rotation's own plan: its numbers and what to show. */
  plan: RetimePlan;
  /** The drops to make, the dragged one first. */
  moves: DraftMove[];
  /** For a swap, the planes' rotations it trades with, e.g. "C-P002 ALB→LGA". */
  swapWith: string[];
  /** Why not, when it isn't ok; for a hold, what it sits on. */
  reason: string | null;
};

type Conflict = { a: ScheduleLeg; b: ScheduleLeg; text: string };

const hhmm = (minute: number): string => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Flights on one plane that sit on top of each other, or that leave from where the plane isn't, as tomorrow's schedule will stand. */
export function scheduleConflicts(state: SimState, tails?: string[]): Conflict[] {
  const view = tomorrowView(state);
  const found: Conflict[] = [];
  for (const tail of tails ?? [...new Set(view.schedule.map((leg) => leg.tail))]) {
    const legs = view.schedule.filter((leg) => leg.tail === tail).sort((x, y) => x.departMinute - y.departMinute);
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        const first = legs[i];
        const second = legs[j];
        const clear = first.departMinute + first.blockMinutes + scheduledTurnMinutes(view, first.origin, first.dest);
        if (second.departMinute < clear) {
          found.push({ a: first, b: second, text: `Overlaps ${tail}'s ${first.origin}→${first.dest} at ${hhmm(first.departMinute)}` });
        }
      }
      if (i > 0 && legs[i].origin !== legs[i - 1].dest) {
        found.push({ a: legs[i - 1], b: legs[i], text: `${legs[i].origin}→${legs[i].dest} would leave ${legs[i].origin} with the plane at ${legs[i - 1].dest}` });
      }
    }
  }
  return found;
}

/** Ids of every flight caught in a conflict, for marking them on the timeline. */
export function conflictingLegIds(state: SimState): Set<string> {
  return new Set(scheduleConflicts(state).flatMap((c) => [c.a.legId, c.b.legId]));
}

/** What a failed attempt must put back: the fields a retime touches. */
function snapshot(state: SimState) {
  return JSON.parse(
    JSON.stringify({
      legs: state.schedule.map((leg) => [leg.legId, leg.tail, leg.departMinute]),
      slotsHeld: state.slotsHeld,
      pendingRetimes: state.pendingRetimes,
      retimedToday: state.retimedToday,
      completedToday: state.completedToday,
      wrappedFrom: state.wrappedFrom,
    }),
  ) as {
    legs: [string, string, number][];
    slotsHeld: SimState['slotsHeld'];
    pendingRetimes: SimState['pendingRetimes'];
    retimedToday: SimState['retimedToday'];
    completedToday: SimState['completedToday'];
    wrappedFrom: SimState['wrappedFrom'];
  };
}

function restore(state: SimState, saved: ReturnType<typeof snapshot>): void {
  const byId = new Map(saved.legs.map(([legId, tail, departMinute]) => [legId, { tail, departMinute }]));
  for (const leg of state.schedule) {
    const was = byId.get(leg.legId);
    if (was) Object.assign(leg, was);
  }
  state.slotsHeld = saved.slotsHeld;
  state.pendingRetimes = saved.pendingRetimes;
  state.retimedToday = saved.retimedToday;
  state.completedToday = saved.completedToday;
  state.wrappedFrom = saved.wrappedFrom;
}

type CommitOptions = {
  /** Check the planes these moves touched join up afterwards; false leaves overlaps for a draft. */
  final?: boolean;
  /** Check only: put everything back at the end. */
  dryRun?: boolean;
};

/** Make the moves in order, all or nothing. */
export function commitDraft(state: SimState, moves: DraftMove[], options: CommitOptions = {}): { ok: true; message: string } | { ok: false; reason: string } {
  const final = options.final ?? true;
  const saved = snapshot(state);
  const fail = (reason: string) => {
    restore(state, saved);
    return { ok: false as const, reason };
  };
  const messages: string[] = [];
  for (const move of moves) {
    const result = commitRetime(state, move.legIds, move.tail, move.start, { allowOverlap: true });
    if (!result.ok) return fail(result.reason);
    messages.push(result.message);
  }
  if (final) {
    const moved = new Set(moves.flatMap((move) => move.legIds));
    const tails = [...new Set(moves.map((move) => move.tail))];
    // A leg that left a plane can leave a problem behind on it too.
    const origins = saved.legs.filter(([legId]) => moved.has(legId)).map(([, tail]) => tail);
    const problem = scheduleConflicts(state, [...new Set([...tails, ...origins])]).find((c) => moved.has(c.a.legId) || moved.has(c.b.legId));
    if (problem) return fail(problem.text);
  }
  if (options.dryRun) restore(state, saved);
  return { ok: true, message: moves.length === 1 ? messages[0] : `${moves.length} rotations moved` };
}

/**
 * What dropping this rotation here would do: move, swap, hold in a draft, or
 * nothing. `inDraft`: planning on a draft copy, where a night stop can't be
 * made or undone (its rotations are grouped as the real schedule has them).
 */
export function planDrop(state: SimState, legIds: string[], toTail: string, start: number, inDraft = false): DropPlan {
  const result = planDropOn(state, legIds, toTail, start);
  if (inDraft && result.ok && result.plan.kind !== 'move') {
    return { ...result, ok: false, reason: 'Save the draft first · night stops are made on the real schedule' };
  }
  return result;
}

function planDropOn(state: SimState, legIds: string[], toTail: string, start: number): DropPlan {
  const move: DraftMove = { legIds, tail: toTail, start };
  const plain = planRetime(state, legIds, toTail, start);
  if (plain.ok) return { ok: true, kind: 'move', plan: plain, moves: [move], swapWith: [], reason: null };
  // Refused for a reason other than sitting on other flights: nothing to hold.
  const loose = planRetime(state, legIds, toTail, start, { allowOverlap: true });
  if (!loose.ok) return { ok: false, kind: 'move', plan: loose, moves: [move], swapWith: [], reason: loose.reason };

  const view = tomorrowView(state);
  const fromTail = view.schedule.find((leg) => legIds.includes(leg.legId))?.tail;
  if (fromTail && fromTail !== toTail) {
    const earliest = Math.min(...loose.legs.map((leg) => leg.departMinute));
    const latest = Math.max(...loose.legs.map((leg) => leg.departMinute + leg.blockMinutes));
    const oldStart = loose.fromStart;
    // The rotations on the target plane that the dragged one would sit on.
    const sitting = rotationsForTail(view, toTail).filter(
      (rotation) => rotation.closed && rotation.departMinute < latest && rotation.arriveMinute > earliest && !rotation.legs.some((leg) => legIds.includes(leg.legId)),
    );
    if (sitting.length > 0) {
      // Each one back at its own time of day first; a lone one can also take the place the dragged rotation left.
      const starts: (number | null)[][] = sitting.length === 1 ? [[null], [oldStart]] : [sitting.map(() => null)];
      for (const options of starts) {
        const trades = sitting.map((rotation, i): DraftMove => ({ legIds: rotation.legs.map((leg) => leg.legId), tail: fromTail, start: options[i] ?? rotation.departMinute }));
        if (commitDraft(state, [move, ...trades], { dryRun: true }).ok) {
          return { ok: true, kind: 'swap', plan: loose, moves: [move, ...trades], swapWith: sitting.map((r) => `${r.tail} ${r.airports.join('→')}`), reason: null };
        }
      }
    }
  }
  return { ok: true, kind: 'hold', plan: loose, moves: [move], swapWith: [], reason: plain.reason };
}
