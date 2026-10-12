import { tomorrowView } from './retime';
import { commitDraft, type DraftMove } from './scheduleDraft';
import { marketKey } from './schedule';
import type { SimState } from './state';
import { nightStopLegs } from './nightStops';
import { rotationsForTail, scheduledTurnMinutes, type Rotation } from './utilisation';

/**
 * One-click re-sorts for the Schedule timeline (ui/panels.ts): the same
 * markets back to back on the same plane, without dragging each rotation.
 *
 * A sort only changes which plane flies a rotation. Departure times stay
 * where they are, so the curfew, the turns, the hourly room at every airport,
 * slot prices and the demand each flight was timed for are all untouched.
 * It works inside one aircraft type at one base, the only place a rotation
 * can move (sim/retime.ts), and leaves a night stop's halves, and planes that
 * are AOG or leaving the base, where they are.
 *
 * - **FIFO**: rotations are placed in order of departure; one goes on a plane
 *   that already flies its market if that plane is free, else on the first
 *   free plane in list order, so the first planes fill up first.
 * - **LIFO**: the same, taking free planes from the last one back.
 * - **Optimise**: starts from today's planes and only makes a move that
 *   leaves a market on fewer planes, trying single moves and swaps of two
 *   rotations until nothing helps, so the fewest rotations change plane.
 *
 * The result is a list of moves for a draft (sim/scheduleDraft.ts): the
 * player reads it on the timeline and confirms with the ✓.
 */

export type SortMode = 'fifo' | 'lifo' | 'optimise';

export type SortPlan = { ok: true; moves: DraftMove[]; note?: string } | { ok: false; reason: string };

/** A rotation's place on a plane's day: from take-off until its last turn is done. */
type Busy = { from: number; to: number; market: string };

type Movable = { rotation: Rotation; market: string; busy: Busy };

/** The market a rotation flies: an out-and-back by its pair, a longer one by its stops. */
function marketOf(rotation: Rotation): string {
  return rotation.airports.length === 3 ? marketKey(rotation.airports[0], rotation.airports[1]) : rotation.airports.join('>');
}

function busyOf(view: SimState, rotation: Rotation): Busy {
  const last = rotation.legs[rotation.legs.length - 1];
  return { from: rotation.departMinute, to: rotation.arriveMinute + scheduledTurnMinutes(view, last.origin, last.dest), market: marketOf(rotation) };
}

const clashes = (a: Busy, b: Busy): boolean => a.from < b.to && b.from < a.to;

/** Plan the sort of tomorrow's schedule; an empty list of moves means it is already sorted. */
export function planSort(state: SimState, mode: SortMode): SortPlan {
  const view = tomorrowView(state);
  const moves: DraftMove[] = [];

  const groups = new Map<string, string[]>();
  for (const aircraft of state.aircraft) {
    if (!aircraft.baseAirport) continue;
    const key = `${aircraft.typeCode}|${aircraft.baseAirport}`;
    groups.set(key, [...(groups.get(key) ?? []), aircraft.tail]);
  }

  for (const tails of groups.values()) {
    if (tails.length < 2) continue;
    const available = tails.filter((tail) => {
      const aircraft = state.aircraft.find((a) => a.tail === tail)!;
      return aircraft.returningOnDay === undefined && !aircraft.rebase && !state.aogs.some((event) => event.tail === tail);
    });
    if (available.length < 2) continue;

    // Where every plane stands before any move: what stays put, and what can move.
    const fixed = new Map<string, Busy[]>(available.map((tail) => [tail, []]));
    const movable: Movable[] = [];
    for (const tail of tails) {
      const half = nightStopLegs(view, tail);
      for (const rotation of rotationsForTail(view, tail)) {
        const busy = busyOf(view, rotation);
        const isHalf = half !== null && (rotation.legs[0] === half.morning || rotation.legs[0] === half.evening);
        if (rotation.closed && !isHalf && available.includes(tail)) movable.push({ rotation, market: busy.market, busy });
        else fixed.get(tail)?.push(busy);
      }
    }
    if (movable.length < 2) continue;

    const placed = mode === 'optimise' ? improve(available, fixed, movable) : assign(available, fixed, movable, mode);
    if (!placed) continue;
    for (const { rotation } of movable) {
      const tail = placed.get(rotation.legs[0].legId)!;
      if (tail !== rotation.tail) moves.push({ legIds: rotation.legs.map((leg) => leg.legId), tail, start: rotation.departMinute });
    }
  }

  if (moves.length === 0) return { ok: true, moves, note: unsortedNote(state, view) };
  // All or nothing, the same check the ✓ makes: nothing is changed here.
  const check = commitDraft(state, moves, { dryRun: true });
  return check.ok ? { ok: true, moves } : { ok: false, reason: check.reason };
}

/**
 * Why "already sorted" can still leave a market on two planes: tomorrow's
 * schedule (the one a sort works on) may already hold moves waiting for the
 * rollover, and some flights overlap in time so no one plane can fly them.
 */
function unsortedNote(state: SimState, view: SimState): string {
  const planes = new Map<string, Set<string>>();
  for (const aircraft of state.aircraft) {
    for (const rotation of rotationsForTail(view, aircraft.tail)) {
      const market = marketOf(rotation);
      planes.set(market, (planes.get(market) ?? new Set()).add(aircraft.tail));
    }
  }
  const split = [...planes].filter(([, tails]) => tails.size > 1).map(([market]) => market.replace('>', '-'));
  const waiting = (state.pendingRetimes ?? []).length > 0;
  const parts = [waiting ? 'tomorrow already holds the moves' : 'nothing to move'];
  if (split.length > 0) parts.push(`${split.join(' ')} still on 2+ planes`);
  return parts.join(' · ');
}

/** Which plane flies each rotation (by its first flight's id), or null when the pass runs out of room (a plane's fixed flights can leave no gap). */
function assign(tails: string[], fixed: Map<string, Busy[]>, movable: Movable[], mode: 'fifo' | 'lifo'): Map<string, string> | null {
  const order = mode === 'lifo' ? [...tails].reverse() : tails;
  // In order of departure: whenever a rotation takes off, a plane is free for it as long as the day is no busier than the fleet, whichever free plane the earlier ones chose.
  const items = [...movable].sort((a, b) => a.rotation.departMinute - b.rotation.departMinute || a.market.localeCompare(b.market));

  const day = new Map<string, Busy[]>(tails.map((tail) => [tail, [...(fixed.get(tail) ?? [])]]));
  const result = new Map<string, string>();
  for (const item of items) {
    const free = order.filter((tail) => !day.get(tail)!.some((busy) => clashes(busy, item.busy)));
    if (free.length === 0) return null;
    const holds = (tail: string) => day.get(tail)!.some((busy) => busy.market === item.market);
    const pick = free.find(holds) ?? free[0];
    day.get(pick)!.push(item.busy);
    result.set(item.rotation.legs[0].legId, pick);
  }
  return result;
}

const SPLIT_COST = 1000;

/**
 * Start from today's planes and keep making the move or swap that most
 * lowers the number of (plane, market) pairs, a move costing a little so it
 * only happens when it helps. Never returns null: today's planes always work.
 */
function improve(tails: string[], fixed: Map<string, Busy[]>, movable: Movable[]): Map<string, string> {
  const planeOf = new Map(movable.map((item) => [item.rotation.legs[0].legId, item.rotation.tail]));
  const idOf = (item: Movable) => item.rotation.legs[0].legId;
  const cost = (): number => {
    const pairs = new Set<string>();
    for (const tail of tails) for (const busy of fixed.get(tail) ?? []) pairs.add(`${tail}|${busy.market}`);
    let moved = 0;
    for (const item of movable) {
      pairs.add(`${planeOf.get(idOf(item))}|${item.market}`);
      if (planeOf.get(idOf(item)) !== item.rotation.tail) moved++;
    }
    return pairs.size * SPLIT_COST + moved;
  };
  // Whether `item` fits on `tail` once the rotations in `except` are lifted off it.
  const fits = (item: Movable, tail: string, except: Movable[]): boolean =>
    !(fixed.get(tail) ?? []).some((busy) => clashes(busy, item.busy)) &&
    !movable.some((other) => other !== item && !except.includes(other) && planeOf.get(idOf(other)) === tail && clashes(other.busy, item.busy));

  let best = cost();
  for (let pass = 0; pass < 30; pass++) {
    let improved = false;
    for (const item of movable) {
      const from = planeOf.get(idOf(item))!;
      for (const to of tails) {
        if (to === from) continue;
        if (fits(item, to, [])) {
          planeOf.set(idOf(item), to);
          const next = cost();
          if (next < best) {
            best = next;
            improved = true;
            break;
          }
          planeOf.set(idOf(item), from);
          continue;
        }
        // Blocked by one rotation that would fit where this one stands: trade places.
        for (const other of movable) {
          if (planeOf.get(idOf(other)) !== to || !clashes(other.busy, item.busy)) continue;
          if (!fits(item, to, [other]) || !fits(other, from, [item])) continue;
          planeOf.set(idOf(item), to);
          planeOf.set(idOf(other), from);
          const next = cost();
          if (next < best) {
            best = next;
            improved = true;
            break;
          }
          planeOf.set(idOf(item), from);
          planeOf.set(idOf(other), to);
        }
        if (planeOf.get(idOf(item)) !== from) break;
      }
    }
    if (!improved) break;
  }
  return planeOf;
}
