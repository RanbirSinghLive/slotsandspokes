import { AIRCRAFT_CLASSES } from './aircraftClasses';
import { dayIndex } from './clock';
import { classOpen } from './ladder';
import { CREWS_PER_NEW_PLANE, crewBases, crewNeed, crewsOf, hireLeadDays, retrainDays } from './crews';
import { inboundAt } from './fleetTiming';
import type { SimState } from './state';

/**
 * The crew planner (WEEK-ELEVEN.md, thread 7): what a base's crews will
 * look like against what's coming, for the Crews screen. A read-out, no
 * rules: the crews that decide who flies are sim/crews.ts's.
 *
 * Each plane on its way (sim/fleetTiming.ts) enters service needing
 * CREWS_PER_NEW_PLANE crews on top of what the base's planes need today.
 * Against each entry into service (EIS), in order, the planner counts the
 * crews on hand plus every batch joining by that day, and says how many
 * short it would arrive, and the last day a hire (HIRE_LEAD_DAYS) or a
 * conversion from another type (RETRAIN_DAYS) still lands in time.
 */

export type CrewJoining = { count: number; day: number; kind: 'hire' | 'conversion'; from?: string };

export type PlaneEntry = {
  /** The day the plane is delivered and starts flying. */
  day: number;
  /** Crews the class needs at the legal minimum once this plane (and those before it) are flying. */
  needed: number;
  /** Crews on hand plus those joining by that day. */
  available: number;
  short: number;
  /** The last day a hire placed still joins by the EIS; below today, it's too late for a hire. */
  hireBy: number;
  /** The last day a conversion started still lands by the EIS. */
  convertBy: number;
};

export type ClassPlan = {
  classCode: string;
  name: string;
  crews: number;
  /** Needed by the planes flying today, at ideal shifts and at the legal minimum. */
  ideal: number;
  minimum: number;
  joining: CrewJoining[];
  entries: PlaneEntry[];
  /** Planes going back to the lessor: their crews are free after the day they go. */
  returningDays: number[];
};

export type BasePlan = { iata: string; classes: ClassPlan[] };

/** Every crew base's plan, class by class, where there are crews, planes or planes coming. */
export function crewPlan(state: SimState): BasePlan[] {
  const today = dayIndex(state);
  const lead = hireLeadDays(state);
  const conversion = retrainDays(state);
  return Object.entries(crewBases(state))
    .map(([iata, base]) => {
      const classes = AIRCRAFT_CLASSES.map((cls): ClassPlan => {
        const need = crewNeed(state, iata, cls.code);
        const joining: CrewJoining[] = [
          ...(base.hiring ?? []).filter((b) => b.classCode === cls.code).map((b) => ({ count: b.count, day: b.readyDay, kind: 'hire' as const })),
          ...(base.retraining ?? [])
            .filter((b) => b.classCode === cls.code)
            .map((b) => ({ count: b.count, day: b.readyDay, kind: 'conversion' as const, from: b.from })),
        ].sort((x, y) => x.day - y.day);
        const crews = crewsOf(base, cls.code);
        const entries = inboundAt(state, iata, cls.code)
          .map((lease) => lease.arrivesDay)
          .sort((x, y) => x - y)
          .map((day, i): PlaneEntry => {
            const needed = need.minimum + (i + 1) * CREWS_PER_NEW_PLANE;
            const available = crews + joining.filter((j) => j.day <= day).reduce((sum, j) => sum + j.count, 0);
            return { day, needed, available, short: Math.max(0, needed - available), hireBy: day - lead, convertBy: day - conversion };
          });
        const returningDays = state.aircraft
          .filter((a) => a.baseAirport === iata && a.typeCode === cls.code && a.returningOnDay !== undefined)
          .map((a) => a.returningOnDay!)
          .sort((x, y) => x - y);
        return { classCode: cls.code, name: cls.name, crews, ideal: need.ideal, minimum: need.minimum, joining, entries, returningDays };
      }).filter(
        (plan) =>
          plan.crews > 0 || plan.ideal > 0 || plan.joining.length > 0 || plan.entries.length > 0 || classOpen(state, plan.classCode),
      );
      return { iata, classes };
    })
    .filter((base) => base.classes.length > 0 && base.classes.some((c) => c.crews > 0 || c.ideal > 0 || c.entries.length > 0 || c.joining.length > 0))
    .map((base) => ({ ...base, classes: base.classes.map((c) => ({ ...c, entries: c.entries.filter((e) => e.day >= today) })) }));
}

/** Whether any plane on its way will enter service short of crews: the Crews dot's amber. */
export function anyEntryShort(state: SimState): boolean {
  return crewPlan(state).some((base) => base.classes.some((c) => c.entries.some((e) => e.short > 0)));
}
