import aircraftTypesData from '../../data/aircraft-types.json';
import { CREWS_ENABLED } from './features';
import { nextRandom } from './rng';
import type { SimState } from './state';

/**
 * Week six's crew model. Built to the shape agreed directly, and the
 * design constraint that mattered most was avoiding the failure mode
 * where staffing is just a tax — "every aircraft costs more per day,
 * click hire, nothing else changes." Four things stop it being that:
 *
 *   1. **Lead time.** Hiring isn't instant. Buy an aircraft before you
 *      have crew and it sits earning nothing; hire ahead of the aircraft
 *      and you pay idle salaries. That timing call is the best thing
 *      crew offers as a mechanic.
 *   2. **Tier gating.** A pilot qualified on a propeller can't
 *      fly a widebody, so climbing the fleet ladder is gated by people, not
 *      only cash.
 *   3. **Train vs. hire.** Buy tier directly at a premium, or train
 *      someone up cheaply and lose their capacity while they're away.
 *   4. **Paid whether or not they fly**, which is what makes
 *      over-hiring a real mistake rather than free insurance.
 *
 * **Pools, not individuals.** Counts per qualification tier, never named
 * people with schedules. A real roster means duty times, rest rules and
 * pairing — a second scheduling problem sitting alongside the rotation
 * board, and firmly out of scope.
 *
 * Three disciplines, deliberately modelled differently rather than as
 * three copies of the same thing:
 *
 *   - **Pilots** are a threshold. Below the complement, the aircraft
 *     doesn't fly at all. Tiered, because type ratings are the real
 *     progression gate in aviation.
 *   - **Cabin crew** are also a threshold, but untiered — cabin
 *     qualifications don't gate the fleet ladder the way pilot ratings
 *     do. Complement scales with seats.
 *   - **Mechanics** are a *continuum*, not a threshold: shared capacity
 *     across the fleet rather than something consumed per flight. Running
 *     thin doesn't stop you flying, it degrades reliability as deferred
 *     defects accumulate (see maintenanceAgeFactor() below). Untiered in
 *     this pass — maintenance licences really are type-specific, but the
 *     interesting dimension here is the ratio, and tiering them would
 *     triple the training UI for very little.
 */

export type CrewRole = 'pilot' | 'cabin' | 'mechanic';
export const MAX_PILOT_TIER = 3;

type AircraftTypeCrewSpec = { code: string; seats: number; crewTier: number };
const typesByCode = new Map<string, AircraftTypeCrewSpec>(
  (aircraftTypesData as AircraftTypeCrewSpec[]).map((type) => [type.code, type]),
);

/**
 * Flight-deck crew per aircraft, before any coverage multiplier — captain
 * and first officer.
 */
const PILOTS_PER_AIRCRAFT = 2;

/**
 * Seats per cabin crew member. A real regulatory standard rather than a
 * tuned constant: both the FAA and Transport Canada require one flight
 * attendant per fifty passenger seats. Gives 1 on a propeller, 2 on a
 * regional, 3 on a narrowbody and 6 on a widebody straight from the seat
 * counts already in data/aircraft-types.json.
 */
const SEATS_PER_CABIN_CREW = 50;

/**
 * How many people it takes to keep one seat's worth of duty covered
 * every day of the year — days off, leave, recurrent training. "Crew
 * ratio" is a real airline planning term, and one constant is what
 * explains why an aircraft flying twelve hours a day needs more than one
 * crew on the books.
 *
 * This is the *operating* requirement. Reserve depth (below) multiplies
 * on top of it and is the player's own lever.
 */
const CREW_COVERAGE_RATIO = 2.2;

/**
 * The reserve-depth range. 1.0 means exactly enough crew to cover the
 * schedule with normal days off and no slack whatsoever; 1.4 means
 * carrying 40% more than that.
 *
 * The shape is the point: **cost is linear in depth, protection is a
 * threshold.** Thin reserves are cheap and mostly fine right up until a
 * bad day takes out a chunk of the schedule; deep reserves are expensive
 * insurance you mostly don't need. That's diminishing returns with a real
 * interior optimum rather than a slider with an obvious best setting.
 */
export const RESERVE_DEPTH_MIN = 1;
export const RESERVE_DEPTH_MAX = 1.4;

/**
 * The worst fraction of crew that can be unavailable on a single day —
 * sickness, missed connections, recurrent training, crew timing out. Drawn
 * fresh each day from the seeded PRNG, so a given seed reproduces the same
 * disruption history like every other random model in sim/.
 *
 * Reserve depth is what absorbs this: at depth 1.2 a draw of up to 20%
 * is covered, while at 1.0 any draw at all leaves you short. Set wider
 * than the reserve range so no depth is completely safe — otherwise every
 * setting above the worst case would be strictly dominated, and the top
 * half of the slider would be dead. The shortfall
 * is proportional rather than all-or-nothing — losing 5% of your crew
 * grounds roughly 5% of your fleet, not the whole operation.
 */
const MAX_DAILY_CREW_DISRUPTION = 0.2;

/**
 * Daily salary per head. Pilots scale steeply with tier; that premium is
 * what makes training worth paying for.
 *
 * Calibrated as a *share* of operating cost rather than to real absolute
 * salaries, the same way every other constant in this sim works
 * (LOAD_FACTOR, the fuel share). Measured against the reference fleet,
 * these put crew at roughly a quarter of total operating cost, which is a
 * plausible real relationship — whereas real regional salaries in
 * absolute dollars would make a 19-seat operation structurally
 * unprofitable, which is arguably true in reality but a poor starting
 * aircraft for a game.
 */
const PILOT_DAILY_SALARY = [150, 260, 420];
const CABIN_DAILY_SALARY = 95;
const MECHANIC_DAILY_SALARY = 120;

/** One-off cost to recruit one head, and how long until they actually turn up. */
const PILOT_HIRE_COST = [2600, 5200, 11000];
const CABIN_HIRE_COST = 1300;
const MECHANIC_HIRE_COST = 1900;
export const HIRE_LEAD_TIME_DAYS = 10;

/** Training one pilot up a single tier: what it costs, and how long they're gone for. */
const TRAINING_COST_PER_PILOT = [3400, 7000];
export const TRAINING_DAYS = 21;

/**
 * Recurrent cabin service training. Cheaper and much shorter than a
 * pilot type rating, because it isn't a qualification to fly anything —
 * it's a service-quality upgrade that feeds NPS (sim/nps.ts).
 *
 * The interesting part is that trainees come **off the line** for the
 * duration, exactly like pilots do. Cabin crew are a staffing threshold,
 * so pulling people out can drop you below the operating minimum and
 * ground aircraft. That gives reserve depth a second job beyond absorbing
 * sickness: slack is what lets you train without cancelling flights.
 */
const CABIN_TRAINING_COST_PER_HEAD = 900;
export const CABIN_TRAINING_DAYS = 7;

/**
 * How fast recurrent training lapses. "Recurrent" means exactly that in
 * aviation — it expires and has to be redone, typically annually — so
 * this is an ongoing commitment rather than a one-time purchase you make
 * and forget. Roughly a 180-day decay, chosen so it actually bites inside
 * a typical run rather than being a technicality.
 *
 * Newly hired cabin crew arrive untrained, so growing the fleet also
 * dilutes the trained share: expansion costs service quality until the
 * new people have been through it.
 */
const CABIN_TRAINING_LAPSE_PER_DAY = 1 / 180;

/**
 * Mechanics per aircraft at which the fleet is considered properly
 * maintained. Below it, airframes behave older than they are; at or above
 * it, better than they are (see maintenanceAgeFactor()).
 */
const TARGET_MECHANICS_PER_AIRCRAFT = 3;
const MAINTENANCE_FACTOR_WORST = 1.4;
const MAINTENANCE_FACTOR_BEST = 0.6;

/**
 * Week six's third cancellation cause: an unscheduled maintenance event
 * that takes an airframe out of service for the day (AOG — "aircraft on
 * ground"). The daily chance per aircraft scales with *effective* age, so
 * it reads off the same maintenance staffing the delay model already
 * uses: a neglected old airframe strands itself far more often than a
 * well-kept one.
 *
 * WEEK-SIX.md's cancellation design named this as its second candidate
 * cause precisely because the age curve already existed — this is that
 * curve's tail, expressed as "doesn't fly today" rather than "flies very
 * late."
 */
const AOG_PROBABILITY_PER_EFFECTIVE_YEAR = 0.0025;
const AOG_PROBABILITY_MAX = 0.06;

const MINUTES_PER_DAY = 1440;

export type CrewPools = {
  /** Pilots by qualification tier. A tier-N pilot can fly anything rated tier N or below. */
  pilotsByTier: [number, number, number];
  cabinCrew: number;
  /**
   * How many of `cabinCrew` currently hold recurrent service training —
   * a subset, never more than the total. Deliberately not a tier: any
   * cabin crew member can staff any aircraft, so this doesn't gate
   * anything. It only raises NPS, and it lapses (see
   * CABIN_TRAINING_LAPSE_PER_DAY).
   */
  cabinCrewTrained: number;
  mechanics: number;
};

export type PendingHire = {
  id: string;
  role: CrewRole;
  /** 1-3 for pilots; always 1 for cabin crew and mechanics, which are untiered. */
  tier: number;
  count: number;
  availableAtMinute: number;
};

/**
 * A discriminated union rather than one shape with optional fields: the
 * two kinds of training genuinely return different things — a pilot comes
 * back one tier higher, a cabin crew member comes back service-trained —
 * and letting the type say so keeps `resolveArrivals()` honest.
 */
export type PendingTraining =
  | {
      id: string;
      kind: 'pilot';
      /** The tier being trained *out of* — they return at fromTier + 1. */
      fromTier: number;
      count: number;
      completesAtMinute: number;
    }
  | { id: string; kind: 'cabin'; count: number; completesAtMinute: number };

export function createCrewPools(): CrewPools {
  return { pilotsByTier: [0, 0, 0], cabinCrew: 0, cabinCrewTrained: 0, mechanics: 0 };
}

// --- Requirements -----------------------------------------------------

/** Flight-deck and cabin complement one aircraft of this type needs on board. */
function complementFor(typeCode: string): { pilots: number; cabin: number; tier: number } {
  const type = typesByCode.get(typeCode);
  if (!type) return { pilots: PILOTS_PER_AIRCRAFT, cabin: 1, tier: 1 };
  return {
    pilots: PILOTS_PER_AIRCRAFT,
    cabin: Math.max(1, Math.ceil(type.seats / SEATS_PER_CABIN_CREW)),
    tier: type.crewTier,
  };
}

/**
 * How many people one aircraft needs *on the books* to be operable every
 * day — complement times the coverage ratio. Not multiplied by reserve
 * depth: this is the operating floor, and reserve depth is the buffer the
 * player chooses to hold above it.
 */
function operatingNeedFor(typeCode: string): { pilots: number; cabin: number; tier: number } {
  const complement = complementFor(typeCode);
  return {
    pilots: Math.ceil(complement.pilots * CREW_COVERAGE_RATIO),
    cabin: Math.ceil(complement.cabin * CREW_COVERAGE_RATIO),
    tier: complement.tier,
  };
}

export type CrewRequirement = {
  /** Minimum headcount to operate the current fleet at all, by pilot tier and in total. */
  pilotsByTier: [number, number, number];
  pilotsTotal: number;
  cabinCrew: number;
  /** What the player should actually employ, i.e. the operating need times reserve depth. */
  targetPilotsByTier: [number, number, number];
  targetPilotsTotal: number;
  targetCabinCrew: number;
  targetMechanics: number;
};

/**
 * What the current fleet demands. Pilot figures are per tier because a
 * tier-3 aircraft can only be flown by a tier-3 pilot, while a tier-1
 * aircraft can be flown by anyone — so "do I have enough pilots" is a
 * cascade, not a single comparison (see crewedAircraftCount below).
 */
export function crewRequirement(state: SimState): CrewRequirement {
  const pilotsByTier: [number, number, number] = [0, 0, 0];
  let cabinCrew = 0;

  for (const aircraft of state.aircraft) {
    const need = operatingNeedFor(aircraft.typeCode);
    pilotsByTier[need.tier - 1] += need.pilots;
    cabinCrew += need.cabin;
  }

  const depth = state.reserveDepth;
  return {
    pilotsByTier,
    pilotsTotal: pilotsByTier.reduce((a, b) => a + b, 0),
    cabinCrew,
    targetPilotsByTier: pilotsByTier.map((n) => Math.ceil(n * depth)) as [number, number, number],
    targetPilotsTotal: Math.ceil(pilotsByTier.reduce((a, b) => a + b, 0) * depth),
    targetCabinCrew: Math.ceil(cabinCrew * depth),
    targetMechanics: Math.ceil(state.aircraft.length * TARGET_MECHANICS_PER_AIRCRAFT * depth),
  };
}

/**
 * How many aircraft can actually be crewed from the pools given, walking
 * the fleet from the highest tier down so scarce senior pilots are spent
 * on the aircraft that genuinely require them before being used up on
 * something a junior could fly. Returns the tails that *can* fly;
 * everything else is grounded for the day.
 *
 * Deterministic ordering (highest tier first, then fleet order) rather
 * than anything clever, so the same shortfall always grounds the same
 * aircraft — a shortage that reshuffled which tails flew each day would
 * make a rotation impossible to plan around.
 */
export function crewableTails(state: SimState, availablePilotsByTier: number[], availableCabin: number): string[] {
  const pilotBudget = [...availablePilotsByTier];
  let cabinBudget = availableCabin;

  const ordered = [...state.aircraft].sort(
    (a, b) => (typesByCode.get(b.typeCode)?.crewTier ?? 1) - (typesByCode.get(a.typeCode)?.crewTier ?? 1),
  );

  const flying: string[] = [];
  for (const aircraft of ordered) {
    const need = operatingNeedFor(aircraft.typeCode);
    if (cabinBudget < need.cabin) continue;

    // Spend the lowest-qualified pilots that are still legal for this
    // aircraft first, keeping higher tiers free for aircraft that have no
    // cheaper option.
    let stillNeeded = need.pilots;
    const spend: number[] = [0, 0, 0];
    for (let tier = need.tier; tier <= MAX_PILOT_TIER && stillNeeded > 0; tier++) {
      const take = Math.min(stillNeeded, pilotBudget[tier - 1]);
      spend[tier - 1] = take;
      stillNeeded -= take;
    }
    if (stillNeeded > 0) continue; // can't be crewed at any qualifying tier

    for (let i = 0; i < spend.length; i++) pilotBudget[i] -= spend[i];
    cabinBudget -= need.cabin;
    flying.push(aircraft.tail);
  }

  return flying;
}

// --- Maintenance ------------------------------------------------------

/**
 * A multiplier on effective airframe age, driven by how many mechanics
 * the fleet has per aircraft. Well staffed, an airframe behaves younger
 * than its years; badly staffed, older. This is what gives mechanics a
 * real job without waiting for a full maintenance system — the age delay
 * cause (sim/delays.ts) already exists and is exactly the right hook.
 *
 * Returns 1 when there are no aircraft, so an empty fleet is neutral
 * rather than dividing by zero.
 */
export function maintenanceAgeFactor(state: SimState): number {
  // Crews parked (sim/features.ts): assume the fleet is fully maintained,
  // rather than reading an empty mechanic pool as the worst case.
  if (!CREWS_ENABLED) return MAINTENANCE_FACTOR_BEST;
  if (state.aircraft.length === 0) return 1;
  const perAircraft = state.crew.mechanics / state.aircraft.length;
  const coverage = Math.min(1, perAircraft / TARGET_MECHANICS_PER_AIRCRAFT);
  return MAINTENANCE_FACTOR_WORST - (MAINTENANCE_FACTOR_WORST - MAINTENANCE_FACTOR_BEST) * coverage;
}

// --- Costs and hiring -------------------------------------------------

export function dailyCrewSalary(pools: CrewPools): number {
  const pilots = pools.pilotsByTier.reduce((total, count, i) => total + count * PILOT_DAILY_SALARY[i], 0);
  return pilots + pools.cabinCrew * CABIN_DAILY_SALARY + pools.mechanics * MECHANIC_DAILY_SALARY;
}

/** A month, for anything quoted per month. */
export const MONTH_DAYS = 30;

// --- Training lines (week eight) ---

/**
 * A funded training pipeline for one role (and, for pilots, one tier).
 * The player commits money per month; the line converts it into people.
 *
 * Modelled on Hearts of Iron's production lines rather than on a hiring
 * form, because the interesting thing about crew is not *how many* you
 * order but how long an institution takes to become good at producing
 * them. A line starts inefficient and improves the longer it runs, so
 * money spent early is largely wasted and a mature line is the cheap one.
 *
 * That single property is what this exists for: it makes **fleet
 * commonality** a real strategic axis. Adding an aircraft from a tier you
 * don't already train for is no longer just a purchase — it's a second
 * pipeline starting cold. Real airlines agonise over exactly this, and
 * before now nothing in the game charged for fleet diversity at all.
 *
 * Deliberately *not* target-seeking. It produces while funded and the
 * surplus stockpiles, paying salaries — over-funding is a real mistake
 * the player manages, not something the sim quietly prevents. That is a
 * reversal of the standing-order design this replaces, and the reason is
 * that an auto-stop made the funding number costless to get wrong.
 */
export type TrainingLine = {
  id: string;
  role: CrewRole;
  /** Which pilot tier this line produces. Always 1 for cabin crew and mechanics, who aren't tiered. */
  tier: number;
  /** What the player commits per month. Spent whether or not the line is efficient yet. */
  fundingPerMonth: number;
  /** 0..1. Scales output, not spend — an immature line wastes money rather than costing less. */
  efficiency: number;
  /** While positive, the line is converting to a new tier: full spend, no output. */
  retoolDaysLeft: number;
  /** Fractional heads carried between days, since people arrive whole. */
  accrued: number;
};

/** Where a brand-new line starts. Low enough that churning lines genuinely hurts. */
export const LINE_START_EFFICIENCY = 0.2;
export const LINE_MAX_EFFICIENCY = 1;
/** Reaches the cap in roughly six months of continuous running. */
const LINE_EFFICIENCY_GAIN_PER_DAY = (LINE_MAX_EFFICIENCY - LINE_START_EFFICIENCY) / 180;
/** Converting a line to another tier: no output for this long. */
export const LINE_RETOOL_DAYS = 30;
/**
 * How much efficiency survives a retool. The point of retooling rather
 * than closing and opening a fresh line is that it keeps some of what the
 * old line learned — instructors, process, a training department that has
 * done this before. Set above LINE_START_EFFICIENCY so converting is
 * always better than starting cold, which is what makes it a real choice
 * when a fleet pivots.
 */
const LINE_RETOOL_EFFICIENCY_RETAINED = 0.5;

/**
 * What an immediate agency hire costs, as a multiple of the same head
 * produced by a line. Batch "Recruit" survives alongside lines as the
 * expensive, instant option — without a premium a line would be strictly
 * worse than buying heads outright, since efficiency only ever wastes
 * money and never discounts it.
 */
export const IMMEDIATE_HIRE_PREMIUM = 1.75;

export function hireCost(role: CrewRole, tier: number, count: number): number {
  if (role === 'pilot') return PILOT_HIRE_COST[tier - 1] * count;
  return (role === 'cabin' ? CABIN_HIRE_COST : MECHANIC_HIRE_COST) * count;
}

export function trainingCost(fromTier: number, count: number): number {
  return TRAINING_COST_PER_PILOT[fromTier - 1] * count;
}

export function cabinTrainingCost(count: number): number {
  return CABIN_TRAINING_COST_PER_HEAD * count;
}

/**
 * The share of cabin crew carrying recurrent training, 0-1 — what
 * sim/nps.ts turns into its service component. Zero when there are no
 * cabin crew at all rather than dividing by zero.
 */
export function cabinServiceShare(pools: CrewPools): number {
  // Crews parked (sim/features.ts): service is neither rewarded nor
  // penalised by training nobody can buy.
  if (!CREWS_ENABLED) return 1;
  if (pools.cabinCrew <= 0) return 0;
  return Math.min(1, pools.cabinCrewTrained / pools.cabinCrew);
}

function nextId(prefix: string, existing: { id: string }[]): string {
  const numbers = existing.map((e) => Number(e.id.split('-').pop())).filter((n) => !Number.isNaN(n));
  return `${prefix}-${(numbers.length > 0 ? Math.max(...numbers) : 0) + 1}`;
}

/**
 * Place a bulk recruitment order. Charged immediately, delivered after
 * HIRE_LEAD_TIME_DAYS — that gap is the whole point, and the UI is
 * responsible for checking affordability first (same "let the UI gate it"
 * shape sim/loans.ts's takeLoan() already uses).
 */
/**
 * Hire off the street, immediately — the expensive alternative to a
 * training line. Costs IMMEDIATE_HIRE_PREMIUM times what a line produces
 * the same head for, because without a premium a line would be strictly
 * worse than buying: efficiency only ever wastes money, it never
 * discounts it, so a mature line has to be *cheaper per head* than the
 * instant option or there'd be no reason to run one.
 *
 * Still lands after HIRE_LEAD_TIME_DAYS — an agency hire is quick, not
 * instantaneous.
 */
export function immediateHireCost(role: CrewRole, tier: number, count: number): number {
  return Math.round(hireCost(role, tier, count) * IMMEDIATE_HIRE_PREMIUM);
}

export function hireCrew(state: SimState, role: CrewRole, tier: number, count: number): void {
  state.cash -= immediateHireCost(role, tier, count);
  state.pendingHires.push({
    id: nextId('hire', state.pendingHires),
    role,
    tier,
    count,
    availableAtMinute: state.simMinute + HIRE_LEAD_TIME_DAYS * MINUTES_PER_DAY,
  });
}

/**
 * Send pilots away to upgrade one tier. They leave the pool *now* —
 * losing their capacity for the duration is the real cost of training,
 * more than the fee — and return one tier higher after TRAINING_DAYS.
 */
export function startTraining(state: SimState, fromTier: number, count: number): void {
  // Guard rather than trust the caller, unlike hireCrew() above: hiring
  // only ever adds, but this *subtracts* from a pool, and a negative
  // headcount would silently corrupt every requirement and salary
  // calculation downstream. Same "silently does nothing if it can't"
  // shape sim/loans.ts's repayLoan() already uses for its own guard.
  if (count <= 0 || count > state.crew.pilotsByTier[fromTier - 1]) return;

  state.cash -= trainingCost(fromTier, count);
  state.crew.pilotsByTier[fromTier - 1] -= count;
  state.pendingTraining.push({
    id: nextId('train', state.pendingTraining),
    kind: 'pilot',
    fromTier,
    count,
    completesAtMinute: state.simMinute + TRAINING_DAYS * MINUTES_PER_DAY,
  });
}

/**
 * Send cabin crew for recurrent service training. Same shape as pilot
 * training and the same real cost: they leave the pool now, which counts
 * against the staffing threshold and can ground aircraft if you have no
 * reserve slack to cover them.
 *
 * Guarded for the same reason startTraining() is — this subtracts from a
 * pool, and a negative headcount would corrupt every requirement and
 * salary calculation downstream.
 */
export function startCabinTraining(state: SimState, count: number): void {
  if (count <= 0 || count > state.crew.cabinCrew) return;

  state.cash -= cabinTrainingCost(count);
  state.crew.cabinCrew -= count;
  // Someone already trained who goes round again shouldn't leave a
  // trained count stranded above the (now smaller) total.
  state.crew.cabinCrewTrained = Math.min(state.crew.cabinCrewTrained, state.crew.cabinCrew);
  state.pendingTraining.push({
    id: nextId('train', state.pendingTraining),
    kind: 'cabin',
    count,
    completesAtMinute: state.simMinute + CABIN_TRAINING_DAYS * MINUTES_PER_DAY,
  });
}

/** Deliver any recruitment or training that has come due. Called once per simulated day. */
function resolveArrivals(state: SimState): void {
  for (let i = state.pendingHires.length - 1; i >= 0; i--) {
    const hire = state.pendingHires[i];
    if (state.simMinute < hire.availableAtMinute) continue;
    if (hire.role === 'pilot') state.crew.pilotsByTier[hire.tier - 1] += hire.count;
    else if (hire.role === 'cabin') state.crew.cabinCrew += hire.count;
    else state.crew.mechanics += hire.count;
    state.pendingHires.splice(i, 1);
  }

  for (let i = state.pendingTraining.length - 1; i >= 0; i--) {
    const training = state.pendingTraining[i];
    if (state.simMinute < training.completesAtMinute) continue;
    if (training.kind === 'pilot') {
      state.crew.pilotsByTier[training.fromTier] += training.count; // fromTier is 1-based, so this index is fromTier + 1
    } else {
      state.crew.cabinCrew += training.count;
      state.crew.cabinCrewTrained = Math.min(state.crew.cabinCrew, state.crew.cabinCrewTrained + training.count);
    }
    state.pendingTraining.splice(i, 1);
  }
}

/**
 * The daily crew pass: deliver arrivals, pay everyone, then roll today's
 * disruption and work out which aircraft can actually be crewed. Called
 * once per simulated day from step.ts's day-rollover.
 *
 * Salaries are charged for everyone on the books whether or not they fly,
 * which is what makes over-hiring a genuine mistake rather than free
 * insurance. Crew in training are already out of the pools, so they stop
 * being paid — a deliberate simplification worth noting, since real
 * airlines keep paying them.
 */
/**
 * Headcount this role/tier will have once everything already paid for has
 * landed — the pool now, plus hires in transit, plus anyone due back from
 * training. Standing orders count against *this* rather than the current
 * pool, or a ten-day lead time would have them re-order the same people
 * every day until the first batch showed up.
 *
 * Pilots away upgrading are already out of their old tier's pool and
 * return one tier higher, so they count toward the tier they're arriving
 * at and not the one they left.
 */
export function projectedHeadcount(state: SimState, role: CrewRole, tier: number): number {
  let total =
    role === 'pilot' ? state.crew.pilotsByTier[tier - 1] : role === 'cabin' ? state.crew.cabinCrew : state.crew.mechanics;

  for (const hire of state.pendingHires) {
    if (hire.role !== role) continue;
    if (role === 'pilot' && hire.tier !== tier) continue;
    total += hire.count;
  }
  for (const training of state.pendingTraining) {
    if (role === 'pilot' && training.kind === 'pilot' && training.fromTier + 1 === tier) total += training.count;
    if (role === 'cabin' && training.kind === 'cabin') total += training.count;
  }
  return total;
}

/**
 * What one head of this role/tier costs a training line to produce. The
 * existing hire cost already scales steeply with tier (2,600 / 5,200 /
 * 11,000 for pilots), which is exactly the "longer training costs more"
 * scaling — a mainline-jet pilot is dearer per head because they take
 * far longer to produce, so the same monthly funding buys fewer of them.
 */
export function trainingCostPerHead(role: CrewRole, tier: number): number {
  return hireCost(role, tier, 1);
}

/** Add a head to the pool this line feeds. */
function addToPool(state: SimState, role: CrewRole, tier: number, count: number): void {
  if (role === 'pilot') state.crew.pilotsByTier[tier - 1] += count;
  else if (role === 'cabin') state.crew.cabinCrew += count;
  else state.crew.mechanics += count;
}

/**
 * Point an existing line at a different tier. Keeps half its efficiency
 * and pauses output for LINE_RETOOL_DAYS — better than closing it and
 * opening a fresh one, which would start at LINE_START_EFFICIENCY with
 * nothing carried over. That difference is the whole reason retooling is
 * an action rather than something the player fakes with delete-and-create.
 */
export function retoolLine(line: TrainingLine, tier: number): void {
  if (line.tier === tier) return;
  line.tier = tier;
  line.retoolDaysLeft = LINE_RETOOL_DAYS;
  line.efficiency = Math.max(LINE_START_EFFICIENCY, line.efficiency * LINE_RETOOL_EFFICIENCY_RETAINED);
  line.accrued = 0;
}

/**
 * Run every training line for one day: spend its daily share of funding,
 * convert it to people at the line's current efficiency, and add whole
 * heads to the pool.
 *
 * Efficiency scales **output, not spend**. An immature line costs the
 * same and delivers less, which is what punishes churn — if efficiency
 * discounted the money instead, starting a fresh line would be free and
 * the mechanic would say nothing.
 *
 * Runs after payroll, so wages keep first call on cash. A line that can't
 * afford its day is skipped entirely — no spend, no output, and no
 * progress up the efficiency curve, since an idle training department
 * isn't getting better at its job.
 *
 * Rolls no randomness, so the balance sweep's constant-draws-per-day
 * guarantee is untouched.
 */
export function runTrainingLines(state: SimState): void {
  for (const line of state.trainingLines) {
    const dailySpend = line.fundingPerMonth / MONTH_DAYS;
    if (dailySpend <= 0 || state.cash < dailySpend) continue;

    state.cash -= dailySpend;
    state.todayCost += dailySpend;
    state.todayCostByCategory.training += dailySpend;
    state.todayMargin -= dailySpend;

    // Retooling still costs full funding — the department is being
    // rebuilt around a new type and is paying for it — but produces
    // nobody, and doesn't climb the curve either.
    if (line.retoolDaysLeft > 0) {
      line.retoolDaysLeft -= 1;
      continue;
    }

    line.efficiency = Math.min(LINE_MAX_EFFICIENCY, line.efficiency + LINE_EFFICIENCY_GAIN_PER_DAY);
    line.accrued += (dailySpend * line.efficiency) / trainingCostPerHead(line.role, line.tier);

    const heads = Math.floor(line.accrued);
    if (heads <= 0) continue;
    line.accrued -= heads;
    addToPool(state, line.role, line.tier, heads);
  }
}

export function rollDailyCrew(state: SimState): void {
  // Crews parked (sim/features.ts): no payroll, no disruption roll, and
  // nothing is ever grounded for lack of crew.
  if (!CREWS_ENABLED) {
    state.groundedTails = [];
    return;
  }

  resolveArrivals(state);

  // Recurrent training lapses — it has to be kept up rather than bought
  // once. Clamped to the current total so hiring or losses can never
  // leave more trained crew on the books than there are crew.
  state.crew.cabinCrewTrained = Math.min(
    state.crew.cabinCrew,
    state.crew.cabinCrewTrained * (1 - CABIN_TRAINING_LAPSE_PER_DAY),
  );

  const salary = dailyCrewSalary(state.crew);
  state.cash -= salary;
  state.todayCost += salary;
  state.todayCostByCategory.crew += salary;
  state.todayMargin -= salary;

  // After payroll on purpose — see runTrainingLines()'s own note.
  runTrainingLines(state);

  const [disruptionRoll, nextSeed] = nextRandom(state.rngSeed);
  state.rngSeed = nextSeed;
  const unavailable = disruptionRoll * MAX_DAILY_CREW_DISRUPTION;

  const availablePilots = state.crew.pilotsByTier.map((n) => Math.floor(n * (1 - unavailable)));
  const availableCabin = Math.floor(state.crew.cabinCrew * (1 - unavailable));

  const flying = new Set(crewableTails(state, availablePilots, availableCabin));
  state.groundedTails = state.aircraft.filter((a) => !flying.has(a.tail)).map((a) => a.tail);
}

/**
 * Roll each aircraft for an unscheduled maintenance grounding. Called
 * once per simulated day from step.ts's day-rollover, after the crew pass
 * — a tail already grounded for lack of crew isn't rolled again, since it
 * wasn't going to fly either way and double-counting it would inflate the
 * mechanical cancellation figures.
 */
export function rollDailyMechanicalGroundings(state: SimState): void {
  const factor = maintenanceAgeFactor(state);
  const grounded: string[] = [];

  for (const aircraft of state.aircraft) {
    // Every aircraft is rolled every day, including ones already grounded
    // for crew, and the result is discarded for those rather than the
    // draw being skipped.
    //
    // That matters more than it looks. Skipping the draw would make the
    // *number* of random numbers consumed per day depend on how many
    // aircraft happened to be crew-grounded, which changes the entire
    // downstream seeded history — weather, delays, competitor openings —
    // between two runs that differ only in reserve depth. It silently
    // broke the balance sweep's core guarantee that the only thing
    // differing between rows is the lever being swept, and produced a
    // reserve curve that looked like under-staffing was profitable.
    const [roll, nextSeed] = nextRandom(state.rngSeed);
    state.rngSeed = nextSeed;
    if (state.groundedTails.includes(aircraft.tail)) continue;

    const effectiveAge = aircraft.ageYears * factor;
    const probability = Math.min(AOG_PROBABILITY_MAX, effectiveAge * AOG_PROBABILITY_PER_EFFECTIVE_YEAR);
    if (roll < probability) grounded.push(aircraft.tail);
  }

  state.mechanicalGroundedTails = grounded;
}
