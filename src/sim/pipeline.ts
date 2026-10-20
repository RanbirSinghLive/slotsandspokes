import { closureIsRelevant } from './airspace';
import { daysUntilReturn } from './aog';
import { dayIndex } from './clock';
import { contractsOf } from './contracts';
import { crewPlan } from './crewPlan';
import { mandatesOf } from './mandates';
import { heavyCheckReadouts } from './playerActions';
import type { SimState } from './state';

/**
 * The pipeline: everything dated that is coming at the airline over the
 * next PIPELINE_DAYS, on one list, for the map's bottom-left panel
 * (ui/pipeline.ts). A read-out, no rules: each item points back at the
 * mechanic that owns it (checks in sim/mxChecks.ts, deliveries in
 * sim/fleetTiming.ts, crews in sim/crews.ts, and so on), and the actions a
 * tip offers are those mechanics' own.
 *
 * Days are absolute day indexes (sim/clock.ts's dayIndex()). An item with
 * an `endDay` is a span (a plane in the hangar, a closure); the rest are
 * one day each. Something already overdue sits on today.
 */

export const PIPELINE_DAYS = 30;

export type PipelineLane = 'mtc' | 'fleet' | 'crew' | 'commercial' | 'network';

export type PipelineKind =
  /** A C check due (or overdue). */
  | 'C'
  /** A D check due inside the horizon. */
  | 'D'
  /** A plane in its heavy check, until it's back. */
  | 'hangar'
  /** A plane grounded by a fault or a refit, until it's back. */
  | 'aog'
  /** A leased plane delivered into service. */
  | 'eis'
  /** A plane ferrying to another base, arriving. */
  | 'rebase'
  /** A plane going back to the lessor. */
  | 'return'
  /** Crews hired or converting, joining. */
  | 'crews'
  /** A running contract's term ending. */
  | 'contractEnd'
  /** A contract offer or award that lapses unless flown. */
  | 'contractOffer'
  /** A contested tender being decided. */
  | 'tender'
  /** A rival's takeover window on a sad buyer closing. */
  | 'takeover'
  /** A mandate offer lapsing, or a running mandate ending. */
  | 'mandate'
  /** An airspace closure near the network. */
  | 'closure'
  /** A festival, conference or final lifting demand at a known airport. */
  | 'event'
  /** A station's handling upgrade completing. */
  | 'station';

export type PipelineTone = 'bad' | 'warn' | 'good' | 'info';

export type PipelineItem = {
  /** Stable across days, for keeping a tip open through a redraw. */
  key: string;
  lane: PipelineLane;
  kind: PipelineKind;
  day: number;
  endDay?: number;
  tone: PipelineTone;
  tail?: string;
  iata?: string;
  classCode?: string;
  /** A contract or mandate id, or a closure's. */
  id?: number;
  /** Crews joining, or crews short at an EIS. */
  count?: number;
  short?: number;
  /** A check the player has booked for tomorrow. */
  booked?: boolean;
  /** Days a C check has been pushed by paid tolerance. */
  shift?: number;
};

export const LANE_ORDER: PipelineLane[] = ['mtc', 'fleet', 'crew', 'commercial', 'network'];

/** Every dated item from today to `horizon` days out, soonest first. */
export function pipelineItems(state: SimState, horizon = PIPELINE_DAYS): PipelineItem[] {
  const today = dayIndex(state);
  const last = today + horizon;
  const items: PipelineItem[] = [];
  // Anything already past its day (an overdue check) sits on today; a span already over is dropped.
  const add = (item: PipelineItem) => {
    const day = Math.max(today, item.day);
    if (day <= last && (item.endDay ?? day) >= today) items.push({ ...item, day });
  };

  // Maintenance: the checks coming due, and what's out of service now.
  for (const plane of heavyCheckReadouts(state)) {
    if (plane.inCheck) continue;
    // A booked D check does the C check, so that plane's C is not coming.
    if (!plane.dBooked) {
      const coveredByD = !plane.dInCheck && plane.dDueIn <= plane.dueIn;
      add({ key: `C:${plane.tail}`, lane: 'mtc', kind: 'C', day: today + plane.dueIn, tone: plane.booked ? 'good' : plane.dueIn <= 0 ? 'bad' : coveredByD ? 'info' : plane.open ? 'warn' : 'info', tail: plane.tail, classCode: plane.typeCode, iata: plane.base ?? undefined, booked: plane.booked, shift: plane.shiftDays });
    }
    if (!plane.dInCheck) add({ key: `D:${plane.tail}`, lane: 'mtc', kind: 'D', day: today + plane.dDueIn, tone: plane.dBooked ? 'good' : plane.dDueIn <= 0 ? 'bad' : 'warn', tail: plane.tail, classCode: plane.typeCode, iata: plane.base ?? undefined, booked: plane.dBooked });
  }
  for (const event of state.aogs) {
    const aircraft = state.aircraft.find((a) => a.tail === event.tail);
    const back = today + daysUntilReturn(state, event);
    add({ key: `${event.check ? 'hangar' : 'aog'}:${event.tail}`, lane: 'mtc', kind: event.check ? 'hangar' : 'aog', day: today, endDay: back, tone: event.check || event.refitTo ? 'info' : 'bad', tail: event.tail, classCode: aircraft?.typeCode, iata: event.base });
  }

  // Fleet and crews, from the crew planner, which already lines each delivery up against the crews for it.
  for (const base of crewPlan(state)) {
    for (const plan of base.classes) {
      plan.entries.forEach((entry, i) => {
        add({ key: `eis:${base.iata}:${plan.classCode}:${entry.day}:${i}`, lane: 'fleet', kind: 'eis', day: entry.day, tone: entry.short > 0 ? 'bad' : 'good', iata: base.iata, classCode: plan.classCode, short: entry.short });
      });
      plan.joining.forEach((batch, i) => {
        add({ key: `crews:${base.iata}:${plan.classCode}:${batch.day}:${i}`, lane: 'crew', kind: 'crews', day: batch.day, tone: 'info', iata: base.iata, classCode: plan.classCode, count: batch.count });
      });
    }
  }
  for (const aircraft of state.aircraft) {
    if (aircraft.rebase) add({ key: `rebase:${aircraft.tail}`, lane: 'fleet', kind: 'rebase', day: aircraft.rebase.arrivesDay, tone: 'info', tail: aircraft.tail, classCode: aircraft.typeCode, iata: aircraft.rebase.to });
    const goes = aircraft.returningOnDay ?? aircraft.seasonalUntilDay;
    if (goes !== undefined) add({ key: `return:${aircraft.tail}`, lane: 'fleet', kind: 'return', day: goes, tone: 'info', tail: aircraft.tail, classCode: aircraft.typeCode, iata: aircraft.baseAirport ?? undefined });
  }

  // Commercial: contract terms, offers and tenders, and mandates.
  for (const contract of contractsOf(state)) {
    if (contract.status === 'active') {
      if (contract.endsDay !== undefined) add({ key: `contractEnd:${contract.id}`, lane: 'commercial', kind: 'contractEnd', day: contract.endsDay, tone: 'warn', id: contract.id, iata: contract.b });
      if (contract.takeoverEndsDay !== undefined) add({ key: `takeover:${contract.id}`, lane: 'commercial', kind: 'takeover', day: contract.takeoverEndsDay, tone: 'bad', id: contract.id, iata: contract.b });
    } else if (contract.status === 'offered') {
      if (contract.tenderEndsDay !== undefined && contract.awardedDay === undefined && contract.lostTo === undefined) {
        add({ key: `tender:${contract.id}`, lane: 'commercial', kind: 'tender', day: contract.tenderEndsDay, tone: 'info', id: contract.id, iata: contract.b });
      } else if (contract.lostTo === undefined) {
        add({ key: `contractOffer:${contract.id}`, lane: 'commercial', kind: 'contractOffer', day: contract.offerEndsDay, tone: contract.awardedDay !== undefined ? 'warn' : 'info', id: contract.id, iata: contract.b });
      }
    }
  }
  for (const mandate of mandatesOf(state)) {
    if (mandate.status === 'offered') add({ key: `mandate:${mandate.id}`, lane: 'commercial', kind: 'mandate', day: mandate.startDay, tone: 'warn', id: mandate.id, iata: mandate.dest });
    else if (mandate.status === 'accepted') add({ key: `mandate:${mandate.id}`, lane: 'commercial', kind: 'mandate', day: mandate.startDay, endDay: mandate.endDay - 1, tone: 'info', id: mandate.id, iata: mandate.dest });
  }

  // The network: closures near the network and demand events at airports on the map, once announced.
  for (const closure of state.airspaceClosures ?? []) {
    if (closure.announcedDay > today || !closureIsRelevant(state, closure)) continue;
    add({ key: `closure:${closure.id}`, lane: 'network', kind: 'closure', day: closure.startDay, endDay: closure.endDay - 1, tone: 'bad', id: closure.id });
  }
  const known = new Set(state.knownAirports);
  for (const event of state.demandEvents ?? []) {
    if (event.announceDay > today || !known.has(event.iata)) continue;
    add({ key: `event:${event.iata}:${event.startDay}`, lane: 'network', kind: 'event', day: event.startDay, endDay: event.endDay, tone: 'good', iata: event.iata });
  }
  for (const [iata, upgrade] of Object.entries(state.stationUpgrades ?? {})) {
    add({ key: `station:${iata}`, lane: 'network', kind: 'station', day: upgrade.readyDay, tone: 'info', iata });
  }

  return items.sort((a, b) => a.day - b.day || LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane));
}
