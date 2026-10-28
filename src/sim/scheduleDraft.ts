import { commitBringHome, commitRetime, moveRoomProblem, planRetime, roomProblemText, spacingProblem, tomorrowView, type RetimePlan } from './retime';
import { connectingPassengersThrough, connectionsWith, spokesOf, type LegConnection } from './hubs';
import type { ScheduleLeg } from './schedule';
import type { SimState } from './state';
import { rotationsForTail, scheduledTurnMinutes, USABLE_DAY_END_MINUTE, USABLE_DAY_START_MINUTE, wrappedLongHaul } from './utilisation';

/**
 * Planning the Gantt (the Schedule timeline, ui/panels.ts) without the
 * rules getting in the way mid-gesture. Three things build on sim/retime.ts:
 *
 * - **Gauge**: a plane of another type at the same base takes the rotation
 *   too, its flights re-timed for that type's speed. Upgauging a propeller
 *   round trip onto a regional, or the other way down, is a move or a swap
 *   like any other, but never onto a leg beyond the receiving type's range or
 *   an airport too small for it: that drop is refused, red, in both
 *   directions of a swap.
 * - **Swap**: a rotation dropped onto a plane where other rotations already
 *   sit in that time of day trades places with them: those rotations go to
 *   the dragged one's plane at their own times (or, for a single one, at the
 *   time the dragged one left). One long flight over two short ones sends
 *   both short ones across. Tried before anything else is given up on.
 * - **Hold**: a drop that fails only because it sits on top of other flights
 *   is kept as a draft move. The timeline plans on a copy of the state
 *   while a draft is open, and every move in it is replayed here on the real
 *   state when the player verifies it.
 * - **Every change is a draft**: the Gantt puts every drop, turn step, sort
 *   and ⌂ into the draft, and nothing is real until the player saves it.
 * - **Verify**: `commitDraft()` makes the moves one by one with overlaps
 *   allowed, then checks every plane they touched joins up. If any step or
 *   the final check fails, nothing changes.
 */

/** One drop of a rotation: which flights, onto which plane, starting when. */
export type DraftMove = {
  legIds: string[];
  tail: string;
  start: number;
  /** A stretched or shortened turn (planGroundTime()): the flights it pushes never make or undo a night stop. */
  noWrap?: boolean;
  /** The night stop's ⌂: `tail` brought home for the night (sim/retime.ts commitBringHome()), `legIds` and `start` unused. */
  bringHome?: boolean;
};

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
      legs: state.schedule.map((leg) => [leg.legId, leg.tail, leg.departMinute, leg.blockMinutes]),
      slotsHeld: state.slotsHeld,
      pendingRetimes: state.pendingRetimes,
      retimedToday: state.retimedToday,
      completedToday: state.completedToday,
      wrappedFrom: state.wrappedFrom,
    }),
  ) as {
    legs: [string, string, number, number][];
    slotsHeld: SimState['slotsHeld'];
    pendingRetimes: SimState['pendingRetimes'];
    retimedToday: SimState['retimedToday'];
    completedToday: SimState['completedToday'];
    wrappedFrom: SimState['wrappedFrom'];
  };
}

function restore(state: SimState, saved: ReturnType<typeof snapshot>): void {
  const byId = new Map(saved.legs.map(([legId, tail, departMinute, blockMinutes]) => [legId, { tail, departMinute, blockMinutes }]));
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
  // Overlaps already there before these moves aren't theirs to answer for: a turn stretched on a plane that already had one still goes.
  const pairOf = (c: Conflict) => `${c.a.legId}|${c.b.legId}`;
  const touchedTails = (legIds: Set<string>) => [...new Set([...moves.map((move) => move.tail), ...saved.legs.filter(([legId]) => legIds.has(legId)).map(([, tail]) => tail)])];
  const movedIds = new Set(moves.flatMap((move) => move.legIds));
  const existing = final ? new Set(scheduleConflicts(state, touchedTails(movedIds)).map(pairOf)) : new Set<string>();
  const fail = (reason: string) => {
    restore(state, saved);
    return { ok: false as const, reason };
  };
  // Room by the hour and same-route spacing are judged once, on where every
  // moved flight ends up, so two rotations trading times or planes trade
  // their slots too.
  const before = tomorrowView(state);
  const beforeView = { ...before, schedule: before.schedule.map((leg) => ({ ...leg })) };
  const messages: string[] = [];
  for (const move of moves) {
    const result = move.bringHome
      ? commitBringHome(state, move.tail)
      : commitRetime(state, move.legIds, move.tail, move.start, { allowOverlap: true, allowTypeChange: true, noWrap: move.noWrap, draftChecks: true });
    if (!result.ok) return fail(result.reason);
    messages.push(result.message);
  }
  const after = tomorrowView(state).schedule;
  const movedLegs = after.filter((leg) => movedIds.has(leg.legId));
  const room = moveRoomProblem(beforeView, movedLegs);
  if (room) return fail(roomProblemText(room));
  const spacing = spacingProblem(beforeView.schedule, movedLegs, after);
  if (spacing) return fail(spacing);
  if (final) {
    // A leg that left a plane can leave a problem behind on it too.
    const problem = scheduleConflicts(state, touchedTails(movedIds)).find((c) => (movedIds.has(c.a.legId) || movedIds.has(c.b.legId)) && !existing.has(pairOf(c)));
    if (problem) return fail(problem.text);
  }
  if (options.dryRun) restore(state, saved);
  return { ok: true, message: moves.length === 1 ? messages[0] : `${moves.length} rotations moved` };
}

/**
 * What dropping this rotation here would do: move, swap, hold in a draft, or
 * nothing. A move may make or undo a night stop (sim/retime.ts).
 */
export function planDrop(state: SimState, legIds: string[], toTail: string, start: number): DropPlan {
  return planDropOn(state, legIds, toTail, start);
}

function planDropOn(state: SimState, legIds: string[], toTail: string, start: number): DropPlan {
  const move: DraftMove = { legIds, tail: toTail, start };
  const plain = planRetime(state, legIds, toTail, start, { allowTypeChange: true });
  if (plain.ok) return { ok: true, kind: 'move', plan: plain, moves: [move], swapWith: [], reason: null };
  // Refused for a reason other than sitting on other flights: nothing to hold.
  // Room and spacing are left to the swap below, where the flights it trades with give theirs up.
  const loose = planRetime(state, legIds, toTail, start, { allowOverlap: true, allowTypeChange: true, draftChecks: true });
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
  // Held on its own, it needs room of its own.
  const held = planRetime(state, legIds, toTail, start, { allowOverlap: true, allowTypeChange: true });
  if (!held.ok) return { ok: false, kind: 'move', plan: held, moves: [move], swapWith: [], reason: held.reason };
  return { ok: true, kind: 'hold', plan: held, moves: [move], swapWith: [], reason: plain.reason };
}

/** How close, in minutes, a dragged rotation must be to a neighbour's edge for `snapStart()` to pull it in. */
export const SNAP_MINUTES = 10;

/**
 * Where a rotation dragged to `rawStart` on `toTail` lands when it is pulled
 * to a nearby edge: just after the flight before it (its turn included), just
 * before the flight after it, or the ends of the usable day. A start already
 * clear of every edge stays as it is. Ties go to the closer edge.
 */
export function snapStart(state: SimState, legIds: string[], toTail: string, rawStart: number): number {
  const view = tomorrowView(state);
  let own = view.schedule.filter((leg) => legIds.includes(leg.legId)).sort((a, b) => a.departMinute - b.departMinute);
  if (own.length === 0) return rawStart;
  // A long-haul pair across midnight stores its flight back a day early: measured flight out first.
  const wrapped = wrappedLongHaul(view, own[0].tail);
  if (wrapped) own = [wrapped.out, { ...wrapped.back, departMinute: wrapped.back.departMinute + 24 * 60 }];
  const first = own[0];
  const last = own[own.length - 1];
  const span = last.departMinute + last.blockMinutes - first.departMinute;
  const turnAfterOwn = scheduledTurnMinutes(view, last.origin, last.dest);
  const candidates = [USABLE_DAY_START_MINUTE, USABLE_DAY_END_MINUTE - span];
  for (const other of view.schedule) {
    if (other.tail !== toTail || legIds.includes(other.legId)) continue;
    // Just after it, and just before it; rounded to the 5 minutes a move steps in, away from the neighbour.
    candidates.push(Math.ceil((other.departMinute + other.blockMinutes + scheduledTurnMinutes(view, other.origin, other.dest)) / 5) * 5);
    candidates.push(Math.floor((other.departMinute - turnAfterOwn - span) / 5) * 5);
  }
  let best = rawStart;
  let bestGap = SNAP_MINUTES + 1;
  for (const candidate of candidates) {
    const gap = Math.abs(candidate - rawStart);
    if (gap <= SNAP_MINUTES && gap < bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

/** What one tap of the Gantt's turn stepper changes the wait by, in minutes. */
export const GROUND_STEP_MINUTES = 5;

export type GroundTimePlan = DropPlan & {
  /** Where the plane waits after the flight. */
  station: string;
  /** The wait there now, and the shortest one allowed (the scheduled turn). */
  groundMinutes: number;
  minimumMinutes: number;
};

/**
 * Longer or shorter on the ground at a flight's arrival airport: every later
 * flight that plane flies in the day moves by `deltaMinutes`, together, the
 * same checks as a drag (sim/retime.ts) with no night stop made or undone.
 * Never shorter than the scheduled turn. A plane flying a long-haul pair or
 * alternate days is moved by dragging its round trip instead.
 */
export function planGroundTime(state: SimState, legId: string, deltaMinutes: number): GroundTimePlan {
  const view = tomorrowView(state);
  const leg = view.schedule.find((l) => l.legId === legId);
  // An empty plan for a refusal: nothing to show but the reason.
  const blankPlan = planRetime(state, [], '', 0);
  const refuse = (reason: string, extra: Partial<GroundTimePlan> = {}): GroundTimePlan => ({
    ok: false,
    kind: 'move',
    plan: blankPlan,
    moves: [],
    swapWith: [],
    reason,
    station: leg?.dest ?? '',
    groundMinutes: 0,
    minimumMinutes: 0,
    ...extra,
  });
  if (!leg) return refuse('That flight is gone.');
  const day = view.schedule.filter((l) => l.tail === leg.tail).sort((a, b) => a.departMinute - b.departMinute);
  if (wrappedLongHaul(view, leg.tail) || day.some((l) => l.dayParity !== undefined)) return refuse('Long-haul round trip · drag it to move it');
  const later = day.filter((l) => l.departMinute > leg.departMinute);
  const minimumMinutes = scheduledTurnMinutes(view, leg.origin, leg.dest);
  const groundMinutes = later.length > 0 ? later[0].departMinute - (leg.departMinute + leg.blockMinutes) : 0;
  const numbers = { station: leg.dest, groundMinutes, minimumMinutes };
  if (later.length === 0) return refuse(`Last flight of ${leg.tail}'s day`, numbers);
  const laterIds = later.map((l) => l.legId);
  // A move held for tomorrow that this would split: its other flights would be lost from it.
  const split = (state.pendingRetimes ?? []).some((p) => p.legs.some((l) => laterIds.includes(l.legId)) && p.legs.some((l) => !laterIds.includes(l.legId)));
  if (split) return refuse(`A move held for tomorrow on ${leg.tail} · ✕ it first`, numbers);
  if (groundMinutes + deltaMinutes < minimumMinutes) return refuse(`${leg.dest} turn ${minimumMinutes}m minimum`, numbers);
  const start = later[0].departMinute + deltaMinutes;
  const plan = planRetime(state, laterIds, leg.tail, start, { noWrap: true });
  const move: DraftMove = { legIds: laterIds, tail: leg.tail, start, noWrap: true };
  if (!plan.ok) return { ...refuse(plan.reason ?? 'It can’t go there.', numbers), plan };
  return { ok: true, kind: 'move', plan, moves: [move], swapWith: [], reason: null, ...numbers, groundMinutes: groundMinutes + deltaMinutes };
}

/** What a planned move does at the hubs its flights touch: the flights it would meet, and connecting passengers a day before and after. */
export type DropConnections = {
  connections: LegConnection[];
  hubs: { hub: string; before: number; after: number }[];
};

/**
 * The connections these flights would make at the times given
 * (sim/hubs.ts), on tomorrow's schedule. Passengers are counted for a move
 * of these flights alone; the other side of a swap isn't moved here.
 */
export function dropConnections(state: SimState, legs: ScheduleLeg[]): DropConnections {
  const before = tomorrowView(state);
  const byId = new Map(legs.map((leg) => [leg.legId, leg]));
  const after: SimState = { ...before, schedule: before.schedule.map((leg) => byId.get(leg.legId) ?? leg) };
  const touched = [...new Set(legs.flatMap((leg) => [leg.origin, leg.dest]))].filter((iata) => spokesOf(after, iata).size >= 2);
  const hubs = touched
    .map((hub) => ({ hub, before: Math.round(connectingPassengersThrough(before, hub)), after: Math.round(connectingPassengersThrough(after, hub)) }))
    .filter((h) => h.before > 0 || h.after > 0);
  return { connections: connectionsWith(after, legs), hubs };
}
