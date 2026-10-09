import { minuteOfDay } from './clock';
import { crewBases, crewNeed, crewsOf } from './crews';
import { hourlyRoomProblem, hourOf, airportHours, hourPriceMultiplier } from './hours';
import { summarizeMarket } from './marketSummary';
import { chainProblem, nightStopLegs, planUnwrap, planWrap } from './nightStops';
import { marketKey, type ScheduleLeg } from './schedule';
import { nextSlotFees } from './slots';
import type { SimState } from './state';
import { scheduledTurnMinutes, USABLE_DAY_END_MINUTE, USABLE_DAY_START_MINUTE } from './utilisation';

/**
 * Moving a rotation in the day (WEEK-THIRTEEN.md, thread 4): the rules
 * behind the Schedule timeline's drag (ui/panels.ts). A rotation moves
 * whole, its legs keeping their turns, to a new start and optionally onto
 * another plane of the same type at the same base.
 *
 * - **Always movable**: a rotation with a leg in the air or half flown
 *   (the plane is away from base) can still be moved. Its flying today is
 *   left alone and the move is held as a pending retime
 *   (`SimState.pendingRetimes`) that is applied at the midnight rollover
 *   (`applyPendingRetimes()`), so it starts tomorrow. Everything else is
 *   planned against the schedule as it will stand tomorrow, pending moves
 *   included.
 * - **What it must fit**: the usable day (06:00–22:00), its new plane's
 *   other rotations with a turn either side, room in every hour its legs
 *   now use at every airport (sim/hours.ts, not counting its own old
 *   movements), and no same-market departure at the same minute.
 * - **What it costs**: each departure's slot re-priced at its new hour
 *   (a peak slot costs more, sim/slots.ts), so a slot taken cheap
 *   off-peak can't be dragged into the peak for free.
 * - **Today**: legs flown today don't fly again. A rotation not flown yet
 *   today and moved to a time already past starts tomorrow; it doesn't
 *   leave late now (`SimState.retimedToday`).
 *
 * - **Night stops** (sim/nightStops.ts): an out-and-back dragged past
 *   either end of the day, on its own plane, wraps into a night stop
 *   instead of failing; a night stop's half pushed past its own end of
 *   the day wraps back into an out-and-back. A half stays on its plane,
 *   and no move may leave a flight departing from where the plane isn't.
 *
 * - **Night stop undo** (`planBringHome()`): the same unwrap as dragging a
 *   half past its end of the day, from a button. It goes back to where the
 *   out-and-back was before the wrap (`SimState.wrappedFrom`) when that
 *   still fits, else to the end of the day.
 *
 * `planRetime()` checks and prices a move without changing anything (the
 * drag preview); `commitRetime()` makes it.
 */

export type RetimePlan = {
  ok: boolean;
  /** Why it can't move there, when it can't. */
  reason: string | null;
  /** The rotation's legs as they'd be. */
  legs: ScheduleLeg[];
  /** Change in the daily margin of the markets it flies, at today's demand (sim/marketSummary.ts). */
  marginChangePerDay: number;
  /** Change in daily slot fees from re-pricing its departures at their new hours. */
  slotFeeChangePerDay: number;
  /** Each departure whose hour changes: its airport, and its slot's price in the old hour and the new. */
  repriced: { iata: string; oldFee: number; newFee: number }[];
  /** A crew base short of crews for its new plane's longer day, when it would be. */
  crewWarning: string | null;
  /** Its first flight is today but the new time has passed: it starts tomorrow. */
  startsTomorrow: boolean;
  /** A plain move, or a night stop made or brought home (sim/nightStops.ts). */
  kind: 'move' | 'wrap' | 'unwrap';
  /** The night stop's station, for a wrap or an unwrap. */
  station: string | null;
  /** Legs whose new time has passed today, not yet flown: they start tomorrow. */
  tomorrowLegIds: string[];
  /** A wrap's or unwrap's legs flown earlier today and moved later: they fly again tonight, so the plane ends the day where its new shape needs it. */
  againTodayLegIds: string[];
  /** Held for the midnight rollover: today's flying (a leg in the air, a part-flown rotation, a plane asleep away from base) is left alone. */
  deferred: boolean;
  /** Where the rotation started before the move, for a wrap to remember. */
  fromStart: number;
};

export type RetimeOptions = {
  /** Plan it as a move that starts tomorrow, whatever today looks like. */
  forceDeferred?: boolean;
  /** For an unwrap: where to put the out-and-back if it fits. */
  unwrapStart?: number;
  /** Let the move sit on top of the new plane's other flights; a draft (sim/scheduleDraft.ts) checks the whole day once it's done. */
  allowOverlap?: boolean;
};

/** The schedule as it will stand after the midnight rollover applies the pending retimes. */
export function tomorrowView(state: SimState): SimState {
  const pending = state.pendingRetimes ?? [];
  if (pending.length === 0) return state;
  const byId = new Map(pending.flatMap((p) => p.legs.map((leg) => [leg.legId, leg] as const)));
  return { ...state, schedule: state.schedule.map((leg) => (byId.has(leg.legId) ? { ...leg, ...byId.get(leg.legId)! } : leg)) };
}

/** Whether a rotation has a move waiting for tomorrow. */
export function hasPendingRetime(state: SimState, legIds: string[]): boolean {
  return (state.pendingRetimes ?? []).some((p) => p.legs.some((leg) => legIds.includes(leg.legId)));
}

function hhmm(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Plan moving the rotation made of these legs to start at `startMinute` on `toTail`. */
export function planRetime(state: SimState, legIds: string[], toTail: string, startMinute: number, options: RetimeOptions = {}): RetimePlan {
  // A rotation's legs as they'll stand tomorrow: a move waiting for the rollover counts.
  const view = tomorrowView(state);
  const realLegs = state.schedule.filter((leg) => legIds.includes(leg.legId));
  const airborne = new Set(state.activeFlights.map((flight) => flight.legId));
  const realDone = new Set([...state.completedToday, ...state.cancelledToday]);
  const realFlown = realLegs.filter((leg) => realDone.has(leg.legId)).length;
  // In the air, or some flown and some not: today's flying is left alone and the move starts tomorrow.
  const inMotion = realLegs.some((leg) => airborne.has(leg.legId)) || (realFlown > 0 && realFlown < realLegs.length);
  const deferred = options.forceDeferred === true || inMotion || hasPendingRetime(state, legIds);
  // Planned in tomorrow's world: a fresh day, nothing flown or in the air.
  const world: SimState = deferred ? { ...view, completedToday: [], cancelledToday: [], activeFlights: [], retimedToday: [] } : view;

  const legs = world.schedule.filter((leg) => legIds.includes(leg.legId)).sort((a, b) => a.departMinute - b.departMinute);
  const blank: RetimePlan = { ok: false, reason: null, legs, marginChangePerDay: 0, slotFeeChangePerDay: 0, repriced: [], crewWarning: null, startsTomorrow: false, kind: 'move', station: null, tomorrowLegIds: [], againTodayLegIds: [], deferred, fromStart: legs[0]?.departMinute ?? 0 };
  const fail = (reason: string): RetimePlan => ({ ...blank, reason });
  if (legs.length === 0) return fail('That rotation is gone.');
  const fromTail = legs[0].tail;
  const from = state.aircraft.find((a) => a.tail === fromTail);
  const to = state.aircraft.find((a) => a.tail === toTail);
  if (!from || !to) return fail('No such plane.');
  if (to.typeCode !== from.typeCode) return fail(`${toTail} is a different type`);
  if (to.baseAirport !== from.baseAirport) return fail(`${toTail} is based at ${to.baseAirport ?? 'no base'}`);
  if (to.returningOnDay !== undefined || to.rebase) return fail(`${toTail} is leaving the base`);
  if (toTail !== fromTail && state.aogs.some((event) => event.tail === toTail)) return fail(`${toTail} AOG`);

  const done = new Set([...world.completedToday, ...world.cancelledToday]);
  const flown = legs.filter((leg) => done.has(leg.legId)).length;

  // Half of a night stop starts or ends away from base: it stays on its plane.
  if (toTail !== fromTail && (legs[0].origin !== from.baseAirport || legs[legs.length - 1].dest !== from.baseAirport)) return fail('Part of a night stop · it stays on its plane');

  const delta = Math.round((startMinute - legs[0].departMinute) / 5) * 5;
  let moved = legs.map((leg) => ({ ...leg, tail: toTail, departMinute: leg.departMinute + delta }));
  let kind: RetimePlan['kind'] = 'move';
  let station: string | null = null;
  const offStart = moved[0].departMinute < USABLE_DAY_START_MINUTE;
  const offEnd = moved[moved.length - 1].departMinute + moved[moved.length - 1].blockMinutes > USABLE_DAY_END_MINUTE;
  // Off either end of the day on its own plane: an out-and-back wraps into a
  // night stop, and a night stop's half pushed past its own end wraps back.
  if (toTail === fromTail && (offStart || offEnd)) {
    const pair = nightStopLegs(world, fromTail);
    const isHalf = pair !== null && legs.length === 1;
    const wrap = isHalf
      ? (offStart && legs[0] === pair.morning) || (offEnd && legs[0] === pair.evening)
        ? planUnwrap(world, fromTail, options.unwrapStart)
        : null
      : legs.length === 2 && pair === null
        ? planWrap(world, legIds)
        : null;
    if (wrap && !wrap.ok) return fail(wrap.reason);
    // Asleep at the station now, it flies home first: the move starts tomorrow, once it's home.
    if (wrap && wrap.ok && isHalf && !deferred && from.status === 'ground' && from.atAirport === wrap.station && !state.completedToday.includes(pair.morning.legId) && !state.cancelledToday.includes(pair.morning.legId)) {
      return planRetime(state, legIds, toTail, startMinute, { ...options, forceDeferred: true });
    }
    // Tonight's flight out has flown: it's at the station for the night.
    if (wrap && wrap.ok && isHalf && state.completedToday.includes(pair.evening.legId)) {
      return fail(`At ${wrap.station} tonight · bring it home after tomorrow's ${hhmm(pair.morning.departMinute)} flight`);
    }
    if (wrap && wrap.ok) {
      moved = wrap.legs.map((leg) => ({ ...leg, tail: toTail }));
      kind = isHalf ? 'unwrap' : 'wrap';
      station = wrap.station;
    }
  }
  const first = moved[0];
  const last = moved[moved.length - 1];
  const end = last.departMinute + last.blockMinutes;
  if (kind === 'move') {
    if (first.departMinute < USABLE_DAY_START_MINUTE) return fail(`Starts ${hhmm(first.departMinute)} · the day opens 06:00`);
    if (end > USABLE_DAY_END_MINUTE) return fail(`Back at ${hhmm(end)} · past the 22:00 curfew`);

    // Its new plane's other rotations, with a turn either side. (A wrap or
    // an unwrap is planned round them by sim/nightStops.ts.)
    const others = world.schedule.filter((leg) => leg.tail === toTail && !legIds.includes(leg.legId));
    for (const other of options.allowOverlap ? [] : others) {
      const otherEnd = other.departMinute + other.blockMinutes;
      const turnAfter = scheduledTurnMinutes(world, other.origin, other.dest);
      const turnBefore = scheduledTurnMinutes(world, last.origin, last.dest);
      if (other.departMinute < end + turnBefore && otherEnd + turnAfter > first.departMinute) {
        return fail(`Overlaps ${toTail}'s ${other.origin}→${other.dest} at ${hhmm(other.departMinute)}`);
      }
    }
    // The plane's day still has to join up (a night stop's half dragged into the middle of it wouldn't).
    const chain = options.allowOverlap ? null : chainProblem([...others, ...moved]);
    if (chain) return fail(chain);
  }

  // Room by the hour: its own old movements count as room, rivals stay put.
  const movedIds = new Set(moved.map((leg) => leg.legId));
  const without = { ...world, schedule: world.schedule.filter((leg) => !movedIds.has(leg.legId)) };
  const room = hourlyRoomProblem(world, moved, new Map(), world.schedule.filter((leg) => movedIds.has(leg.legId)));
  if (room) return fail(`${room.iata} ${String(room.hour).padStart(2, '0')}:00 full`);
  const collision = moved.find((leg) =>
    without.schedule.some((other) => other.origin === leg.origin && other.dest === leg.dest && other.departMinute === leg.departMinute),
  );
  if (collision) return fail(`${collision.origin}→${collision.dest} already leaves at ${hhmm(collision.departMinute)}`);

  const after = { ...world, schedule: [...without.schedule, ...moved] };

  // What it does to the money: its markets' margin, and its slots at their new hours.
  const markets = [...new Set(legs.map((leg) => marketKey(leg.origin, leg.dest)))];
  let marginChangePerDay = 0;
  for (const key of markets) {
    const [a, b] = key.split('-');
    const settings = world.routeSettings[key];
    if (!settings) continue;
    marginChangePerDay += summarizeMarket(a, b, after, settings).margin - summarizeMarket(a, b, world, settings).margin;
  }
  const repriced: RetimePlan['repriced'] = [];
  // Matched by id: a wrap reorders the legs.
  for (const leg of moved) {
    const before = world.schedule.find((l) => l.legId === leg.legId)!;
    const oldHour = hourOf(before.departMinute);
    const newHour = hourOf(leg.departMinute);
    if (oldHour === newHour) continue;
    // Priced on the whole schedule less its own pair (slotFeeAt's −2), not on `without`, which has already set it aside.
    repriced.push({ iata: before.origin, oldFee: slotFeeAt(world, before.origin, oldHour), newFee: slotFeeAt(world, before.origin, newHour) });
  }
  const slotFeeChangePerDay = repriced.reduce((sum, r) => sum + r.newFee - r.oldFee, 0);

  // A longer day for its new plane can need more crews than the base has.
  let crewWarning: string | null = null;
  const base = to.baseAirport ? crewBases(after)[to.baseAirport] : undefined;
  if (base && to.baseAirport) {
    const need = crewNeed(after, to.baseAirport, to.typeCode);
    const have = crewsOf(base, to.typeCode);
    if (have < need.minimum) crewWarning = `${to.baseAirport} short ${need.minimum - have} crews for it`;
  }

  // Held for the rollover: it all starts tomorrow, nothing to sort out for today.
  if (deferred) {
    return { ok: true, reason: null, legs: moved, marginChangePerDay: Math.round(marginChangePerDay), slotFeeChangePerDay, repriced, crewWarning, startsTomorrow: true, kind, station, tomorrowLegIds: [], againTodayLegIds: [], deferred, fromStart: blank.fromStart };
  }

  // Not flown today, and the new start has passed: it waits for tomorrow.
  // A wrap's two flights are judged one by one: tonight's flight out can still fly.
  const now = minuteOfDay(state);
  const startsTomorrow = flown === 0 && first.departMinute <= now;
  // A new night stop's flight home waits for tomorrow unless the plane is already at the station: it sleeps there from tonight.
  const tomorrowLegIds =
    kind === 'move'
      ? startsTomorrow
        ? legIds
        : []
      : moved
          .filter((leg) => !done.has(leg.legId) && (leg.departMinute <= now || (kind === 'wrap' && leg.origin === station && from.atAirport !== station)))
          .map((leg) => leg.legId);

  const againTodayLegIds = kind === 'move' ? [] : moved.filter((leg) => state.completedToday.includes(leg.legId) && leg.departMinute > now).map((leg) => leg.legId);

  return { ok: true, reason: null, legs: moved, marginChangePerDay: Math.round(marginChangePerDay), slotFeeChangePerDay, repriced, crewWarning, startsTomorrow, kind, station, tomorrowLegIds, againTodayLegIds, deferred, fromStart: blank.fromStart };
}

/** Today's price of one slot pair at an airport, at an hour. */
function slotFeeAt(state: SimState, iata: string, hour: number): number {
  const multiplier = hourPriceMultiplier(airportHours(state, iata), hour);
  return nextSlotFees(state, iata, 1, -2, undefined, multiplier)[0] ?? 0;
}

/** Move the rotation, if it can go there. The same legs (same ids), retimed and on their new plane. */
export function commitRetime(state: SimState, legIds: string[], toTail: string, startMinute: number, options: RetimeOptions = {}): { ok: true; message: string } | { ok: false; reason: string } {
  const plan = planRetime(state, legIds, toTail, startMinute, options);
  if (!plan.ok) return { ok: false, reason: plan.reason ?? 'It can’t go there.' };
  const first = plan.legs[0];

  // A night stop remembers where its out-and-back sat, so bringing it home puts it back.
  if (plan.kind === 'wrap') (state.wrappedFrom ??= {})[toTail] = { legId: plan.legs[1].legId, start: plan.fromStart };
  if (plan.kind === 'unwrap' && state.wrappedFrom) delete state.wrappedFrom[toTail];

  if (plan.deferred) {
    // Held for the rollover: a later move of the same rotation replaces this one.
    const ids = new Set(plan.legs.map((leg) => leg.legId));
    const pending = (state.pendingRetimes ?? []).filter((p) => !p.legs.some((leg) => ids.has(leg.legId)));
    // Dragged back to where it stands now: nothing left to hold.
    const unchanged = plan.legs.every((leg) => {
      const now = state.schedule.find((l) => l.legId === leg.legId);
      return now && now.tail === leg.tail && now.departMinute === leg.departMinute;
    });
    if (!unchanged) pending.push({ legs: plan.legs.map((leg) => ({ legId: leg.legId, tail: leg.tail, departMinute: leg.departMinute })), repriced: plan.repriced });
    state.pendingRetimes = pending;
    const when = unchanged ? 'stays as it is' : 'from tomorrow';
    if (plan.kind === 'wrap') return { ok: true, message: `${toTail} night stop ${plan.station} · out ${hhmm(plan.legs[1].departMinute)} · back ${hhmm(first.departMinute)} · ${when}` };
    if (plan.kind === 'unwrap') return { ok: true, message: `${toTail} sleeps at base again · ${plan.station} ${hhmm(first.departMinute)}–${hhmm(plan.legs[1].departMinute + plan.legs[1].blockMinutes)} · ${when}` };
    return { ok: true, message: `${first.origin}→${first.dest} rotation on ${toTail} · ${hhmm(first.departMinute)} · ${when}` };
  }

  applyLegs(state, plan.legs, plan.repriced);
  if (plan.tomorrowLegIds.length > 0) (state.retimedToday ??= []).push(...plan.tomorrowLegIds);
  if (plan.againTodayLegIds.length > 0) state.completedToday = state.completedToday.filter((id) => !plan.againTodayLegIds.includes(id));
  if (plan.kind !== 'move') {
    const [a, b] = plan.legs;
    return {
      ok: true,
      message:
        plan.kind === 'wrap'
          ? `${toTail} night stop ${plan.station} · out ${hhmm(b.departMinute)} · back ${hhmm(a.departMinute)}`
          : `${toTail} sleeps at base again · ${plan.station} ${hhmm(a.departMinute)}–${hhmm(b.departMinute + b.blockMinutes)}`,
    };
  }
  return {
    ok: true,
    message:
      `${first.origin}→${first.dest} rotation on ${toTail} · ${hhmm(first.departMinute)}` +
      (plan.startsTomorrow ? ' · from tomorrow' : '') +
      (plan.marginChangePerDay !== 0 ? ` · ${plan.marginChangePerDay > 0 ? '+' : '−'}$${Math.abs(plan.marginChangePerDay).toLocaleString()}/day` : ''),
  };
}

/** Write retimed legs into the schedule, and re-price the slots they hold at their new hours. */
function applyLegs(state: SimState, legs: { legId: string; tail: string; departMinute: number }[], repriced: RetimePlan['repriced']): void {
  const byId = new Map(legs.map((leg) => [leg.legId, leg]));
  for (const leg of state.schedule) {
    const moved = byId.get(leg.legId);
    if (!moved) continue;
    leg.tail = moved.tail;
    leg.departMinute = moved.departMinute;
  }
  // For each departure that changed hour, the held pair nearest its
  // old-hour price takes the new-hour price.
  for (const { iata, oldFee, newFee } of repriced) {
    const held = state.slotsHeld[iata];
    if (!held || held.length === 0) continue;
    let nearest = 0;
    for (let i = 1; i < held.length; i++) if (Math.abs(held[i] - oldFee) < Math.abs(held[nearest] - oldFee)) nearest = i;
    held[nearest] = newFee;
  }
}

/** The moves held for tomorrow, made at the midnight rollover. One whose rotation has gone since is dropped. */
export function applyPendingRetimes(state: SimState): void {
  const pending = state.pendingRetimes ?? [];
  if (pending.length === 0) return;
  for (const move of pending) {
    const present = move.legs.every((leg) => state.schedule.some((l) => l.legId === leg.legId) && state.aircraft.some((a) => a.tail === leg.tail));
    if (present) applyLegs(state, move.legs, move.repriced);
  }
  state.pendingRetimes = [];
}

/**
 * A night stop brought home from a button, the same unwrap as dragging a
 * half past its end of the day: back to where the out-and-back sat before
 * the wrap if that still fits, else the end of the day.
 */
function bringHomeOptions(state: SimState, tail: string): (RetimeOptions | undefined)[] {
  const remembered = state.wrappedFrom?.[tail];
  const pair = nightStopLegs(tomorrowView(state), tail);
  return remembered && pair && remembered.legId === pair.evening.legId ? [{ unwrapStart: remembered.start }, undefined] : [undefined];
}

/** The leg to drag past the end of the day to bring `tail`'s night stop home, or null if it isn't on one. */
function bringHomeLeg(state: SimState, tail: string): string | null {
  const pair = nightStopLegs(tomorrowView(state), tail);
  return pair ? pair.evening.legId : null;
}

export function planBringHome(state: SimState, tail: string): RetimePlan | null {
  const legId = bringHomeLeg(state, tail);
  if (!legId) return null;
  let plan: RetimePlan | null = null;
  for (const options of bringHomeOptions(state, tail)) {
    plan = planRetime(state, [legId], tail, USABLE_DAY_END_MINUTE + 60, options);
    if (plan.ok) return plan;
  }
  return plan;
}

export function commitBringHome(state: SimState, tail: string): { ok: true; message: string } | { ok: false; reason: string } {
  const legId = bringHomeLeg(state, tail);
  if (!legId) return { ok: false, reason: `${tail} isn't on a night stop` };
  let result: ReturnType<typeof commitRetime> = { ok: false, reason: 'It can’t go there.' };
  for (const options of bringHomeOptions(state, tail)) {
    result = commitRetime(state, [legId], tail, USABLE_DAY_END_MINUTE + 60, options);
    if (result.ok) return result;
  }
  return result;
}
