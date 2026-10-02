import { minuteOfDay } from './clock';
import { crewBases, crewNeed, crewsOf } from './crews';
import { hourlyRoomProblem, hourOf, airportHours, hourPriceMultiplier } from './hours';
import { summarizeMarket } from './marketSummary';
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
 * - **What can't move**: a rotation with a leg in the air, or half flown
 *   (the plane is away from base).
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
};

function hhmm(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Plan moving the rotation made of these legs to start at `startMinute` on `toTail`. */
export function planRetime(state: SimState, legIds: string[], toTail: string, startMinute: number): RetimePlan {
  const legs = state.schedule.filter((leg) => legIds.includes(leg.legId)).sort((a, b) => a.departMinute - b.departMinute);
  const blank: RetimePlan = { ok: false, reason: null, legs, marginChangePerDay: 0, slotFeeChangePerDay: 0, repriced: [], crewWarning: null, startsTomorrow: false };
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

  // Not while it's flying: a leg in the air, or some flown and some not.
  const airborne = new Set(state.activeFlights.map((flight) => flight.legId));
  if (legs.some((leg) => airborne.has(leg.legId))) return fail('In the air · move it once it lands at base');
  const done = new Set([...state.completedToday, ...state.cancelledToday]);
  const flown = legs.filter((leg) => done.has(leg.legId)).length;
  if (flown > 0 && flown < legs.length) return fail('Part flown · move it once it is back at base');

  const delta = Math.round((startMinute - legs[0].departMinute) / 5) * 5;
  const moved = legs.map((leg) => ({ ...leg, tail: toTail, departMinute: leg.departMinute + delta }));
  const first = moved[0];
  const last = moved[moved.length - 1];
  const end = last.departMinute + last.blockMinutes;
  if (first.departMinute < USABLE_DAY_START_MINUTE) return fail(`Starts ${hhmm(first.departMinute)} · the day opens 06:00`);
  if (end > USABLE_DAY_END_MINUTE) return fail(`Back at ${hhmm(end)} · past the 22:00 curfew`);

  // Its new plane's other rotations, with a turn either side.
  const others = state.schedule.filter((leg) => leg.tail === toTail && !legIds.includes(leg.legId));
  for (const other of others) {
    const otherEnd = other.departMinute + other.blockMinutes;
    const turnAfter = scheduledTurnMinutes(state, other.origin, other.dest);
    const turnBefore = scheduledTurnMinutes(state, last.origin, last.dest);
    if (other.departMinute < end + turnBefore && otherEnd + turnAfter > first.departMinute) {
      return fail(`Overlaps ${toTail}'s ${other.origin}→${other.dest} at ${hhmm(other.departMinute)}`);
    }
  }

  // Room by the hour: its own old movements count as room, rivals stay put.
  const without = { ...state, schedule: state.schedule.filter((leg) => !legIds.includes(leg.legId)) };
  const room = hourlyRoomProblem(state, moved, new Map(), legs);
  if (room) return fail(`${room.iata} ${String(room.hour).padStart(2, '0')}:00 full`);
  const collision = moved.find((leg) =>
    without.schedule.some((other) => other.origin === leg.origin && other.dest === leg.dest && other.departMinute === leg.departMinute),
  );
  if (collision) return fail(`${collision.origin}→${collision.dest} already leaves at ${hhmm(collision.departMinute)}`);

  const after = { ...state, schedule: [...without.schedule, ...moved] };

  // What it does to the money: its markets' margin, and its slots at their new hours.
  const markets = [...new Set(legs.map((leg) => marketKey(leg.origin, leg.dest)))];
  let marginChangePerDay = 0;
  for (const key of markets) {
    const [a, b] = key.split('-');
    const settings = state.routeSettings[key];
    if (!settings) continue;
    marginChangePerDay += summarizeMarket(a, b, after, settings).margin - summarizeMarket(a, b, state, settings).margin;
  }
  const repriced: RetimePlan['repriced'] = [];
  for (let i = 0; i < legs.length; i++) {
    const oldHour = hourOf(legs[i].departMinute);
    const newHour = hourOf(moved[i].departMinute);
    if (oldHour === newHour) continue;
    repriced.push({ iata: legs[i].origin, oldFee: slotFeeAt(without, legs[i].origin, oldHour), newFee: slotFeeAt(without, legs[i].origin, newHour) });
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

  // Not flown today, and the new start has passed: it waits for tomorrow.
  const now = minuteOfDay(state);
  const startsTomorrow = flown === 0 && first.departMinute <= now;

  return { ok: true, reason: null, legs: moved, marginChangePerDay: Math.round(marginChangePerDay), slotFeeChangePerDay, repriced, crewWarning, startsTomorrow };
}

/** Today's price of one slot pair at an airport, at an hour. */
function slotFeeAt(state: SimState, iata: string, hour: number): number {
  const multiplier = hourPriceMultiplier(airportHours(state, iata), hour);
  return nextSlotFees(state, iata, 1, -2, undefined, multiplier)[0] ?? 0;
}

/** Move the rotation, if it can go there. The same legs (same ids), retimed and on their new plane. */
export function commitRetime(state: SimState, legIds: string[], toTail: string, startMinute: number): { ok: true; message: string } | { ok: false; reason: string } {
  const plan = planRetime(state, legIds, toTail, startMinute);
  if (!plan.ok) return { ok: false, reason: plan.reason ?? 'It can’t go there.' };
  const byId = new Map(plan.legs.map((leg) => [leg.legId, leg]));
  for (const leg of state.schedule) {
    const moved = byId.get(leg.legId);
    if (!moved) continue;
    leg.tail = moved.tail;
    leg.departMinute = moved.departMinute;
  }
  // The slots it holds, re-priced at their new hours: for each departure
  // that changed hour, the held pair nearest its old-hour price takes the
  // new-hour price.
  for (const { iata, oldFee, newFee } of plan.repriced) {
    const held = state.slotsHeld[iata];
    if (!held || held.length === 0) continue;
    let nearest = 0;
    for (let i = 1; i < held.length; i++) if (Math.abs(held[i] - oldFee) < Math.abs(held[nearest] - oldFee)) nearest = i;
    held[nearest] = newFee;
  }
  if (plan.startsTomorrow) (state.retimedToday ??= []).push(...legIds);
  const first = plan.legs[0];
  return {
    ok: true,
    message:
      `${first.origin}→${first.dest} rotation on ${toTail} · ${hhmm(first.departMinute)}` +
      (plan.startsTomorrow ? ' · from tomorrow' : '') +
      (plan.marginChangePerDay !== 0 ? ` · ${plan.marginChangePerDay > 0 ? '+' : '−'}$${Math.abs(plan.marginChangePerDay).toLocaleString()}/day` : ''),
  };
}
