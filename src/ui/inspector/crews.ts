import { dayIndex } from '../../sim/clock';
import { crewPlan, type ClassPlan, type PlaneEntry } from '../../sim/crewPlan';
import { AIRCRAFT_CLASSES, classByCode } from '../../sim/aircraftClasses';
import { classOpen, tierThatOpens } from '../../sim/ladder';
import { cabinHireFee, needsCabinCrew, CABIN_SHORT_NPS_PENALTY, CABIN_TEAMS_PER_SHIFT, CREWS_PER_NEW_PLANE, crewReadiness, hireFee, hireLeadDays, retrainDays, retrainFee, SICK_BASE_CHANCE, SICK_STRAIN_CHANCE, standbyCost } from '../../sim/crews';
import type { SimState } from '../../sim/state';
import { money } from '../format';
import { linkToMap } from '../mapLink';
import { planeIconElement } from '../planeIcons';
import { showConfirm } from '../confirmModal';
import * as ops from '../routeActions';
import { select } from '../selection';
import { baseSection } from './bases';
import { heading, line, lineWithInfo } from './dom';

/**
 * The Crews screen as a crew planner's board (sim/crewPlan.ts): what's
 * coming over the next month, what needs doing about it, and each base's
 * roster by type rating.
 *
 * - **The horizon**: the next HORIZON_DAYS, with each plane's entry into
 *   service (red if it would arrive short of crews), each batch of crews
 *   joining, and each plane going back.
 * - **To do**: every plane that would enter service short, with the last
 *   day a hire still lands in time and a button to hire the shortfall, or
 *   to convert reserve crews of another type at the base.
 * - **Roster**: per base, per type, a bar of crews on hand and joining
 *   against the minimum and comfortable marks, with a status chip.
 */

const HORIZON_DAYS = 30;

type Chip = { text: string; tone: 'bad' | 'warn' | 'good' | 'info' | 'idle' };

function chipFor(plan: ClassPlan): Chip {
  if (plan.crews < plan.minimum) return { text: 'SHORT', tone: 'bad' };
  // A plane on its way that would arrive short matters before today's roster does.
  if (plan.entries.some((entry) => entry.short > 0)) return { text: 'SHORT AT EIS', tone: 'bad' };
  if (plan.ideal === 0 && plan.crews === 0) return { text: plan.entries.length > 0 ? 'CREWED FOR EIS' : '—', tone: plan.entries.length > 0 ? 'good' : 'idle' };
  if (plan.crews < plan.minimum) return { text: 'SHORT', tone: 'bad' };
  if (plan.crews < plan.ideal) return { text: 'TIGHT', tone: 'warn' };
  if (plan.crews > plan.ideal) return { text: `RESERVE +${plan.crews - plan.ideal}`, tone: 'info' };
  return { text: 'OK', tone: 'good' };
}

function chipElement(chip: Chip): HTMLElement {
  const el = document.createElement('span');
  el.className = `crew-chip crew-chip--${chip.tone}`;
  el.textContent = chip.text;
  return el;
}

/** A confirm window before an action that spends money or lets crews go; `confirm` null runs it at once. */
type CrewConfirm = { title: string; rows: { label: string; value: string }[]; facts?: string[]; confirmLabel: string };

function actionButton(label: string, disabled: boolean, act: () => void, changed: () => void, confirm: CrewConfirm | null = null): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub crew-action';
  button.textContent = label;
  button.disabled = disabled;
  const run = () => {
    act();
    changed();
  };
  button.addEventListener('click', () => (confirm ? showConfirm({ ...confirm, run }) : run()));
  return button;
}

/** Days from today as the board says them: "today", "in 5d", "2d ago". */
function when(day: number, today: number): string {
  const d = day - today;
  return d === 0 ? 'today' : d > 0 ? `in ${d}d` : `${-d}d ago`;
}

export function buildCrewsView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const title = document.createElement('h3');
  title.className = 'inspector-title';
  title.textContent = 'Crews';
  root.append(title);

  const today = dayIndex(state);
  const plan = crewPlan(state);

  const classes = plan.flatMap((base) => base.classes);
  const crews = classes.reduce((sum, c) => sum + c.crews, 0);
  const joining = classes.reduce((sum, c) => sum + c.joining.reduce((s, j) => s + j.count, 0), 0);
  const reserveCost = plan.reduce(
    (sum, base) => sum + base.classes.reduce((s, c) => s + Math.max(0, c.crews - c.ideal) * standbyCost(c.classCode), 0),
    0,
  );
  root.append(
    line(
      `${crews} crews · ${ops.crewBaseReadout(state).bases.length} base${ops.crewBaseReadout(state).bases.length === 1 ? '' : 's'}` +
        (joining > 0 ? ` · +${joining} joining` : '') +
        (reserveCost > 0 ? ` · reserve ${money(reserveCost)}/day` : '') +
        ` · hire ${hireLeadDays(state)}d · conversion ${retrainDays(state)}d`,
    ),
  );

  root.append(...horizon(plan, today));
  root.append(...toDo(state, plan, today, changed));
  root.append(...roster(state, plan, today, changed));
  root.append(...crewBasesSection(state, plan, changed));
  return root;
}

/**
 * The crew bases (sim/bases.ts): open one at any airport on the map, close
 * an empty one. A new base has no crews: hire them here, then lease or
 * move planes to it.
 */
function crewBasesSection(state: SimState, plan: ReturnType<typeof crewPlan>, changed: () => void): HTMLElement[] {
  const readout = ops.crewBaseReadout(state);
  const nodes = baseSection({
    title: 'Crew bases',
    info: `Where crews live, and the only places planes can be leased or based. Opening one costs ${money(readout.fee)} and ${money(readout.perDay)} a day for the crew room; home's comes with the start. A new base has no crews: hire them before its first plane. A crew base is not a maintenance base: nights there are contracted or deferred unless you open one on the Mtc screen.`,
    kind: 'crew base',
    bases: readout.bases,
    candidates: readout.candidates,
    fee: readout.fee,
    perDay: readout.perDay,
    preview: (action, iata) => ops.previewBaseChange(state, 'crew', action, iata),
    open: (iata) => ops.openCrewBaseAt(state, iata),
    close: (iata) => ops.closeCrewBaseAt(state, iata),
    changed,
  });
  // A base with no roster yet (no crews, no planes) has nothing in the roster above to hire from.
  for (const base of readout.bases) {
    if (plan.some((entry) => entry.iata === base.iata)) continue;
    const classes = ops.crewReadout(state, base.iata)?.classes.filter((c) => c.open) ?? [];
    if (classes.length === 0) continue;
    const buttons = document.createElement('div');
    buttons.className = 'crew-buttons';
    buttons.append(line(`${base.iata} · no crews yet`, 'inspector-line crew-row-detail'));
    const emptySeats = ops.crewReadout(state, base.iata)?.training.pilot.free ?? 0;
    for (const c of classes) {
      buttons.append(actionButton(`Hire 1 ${c.name} · ${money(hireFee(c.classCode))}`, emptySeats === 0 || state.cash < hireFee(c.classCode), () => ops.hireCrewsAt(state, base.iata, c.classCode, 1), changed, {
        title: `Hire 1 ${c.name} crew · ${base.iata}`,
        rows: [{ label: 'Fee now', value: money(hireFee(c.classCode)) }, { label: 'Cash after', value: money(state.cash - hireFee(c.classCode)) }],
        confirmLabel: `Hire · ${money(hireFee(c.classCode))}`,
      }));
    }
    nodes.push(buttons);
  }
  return nodes;
}

/** The next HORIZON_DAYS as a strip: EIS, crews joining, planes going back. */
function horizon(plan: ReturnType<typeof crewPlan>, today: number): HTMLElement[] {
  const strip = document.createElement('div');
  strip.className = 'crew-horizon';
  const at = (day: number) => `${(Math.min(HORIZON_DAYS, Math.max(0, day - today)) / HORIZON_DAYS) * 100}%`;
  for (const d of [0, 10, 20, 30]) {
    const tick = document.createElement('span');
    tick.className = 'crew-horizon-tick';
    tick.style.left = at(today + d);
    tick.textContent = d === 0 ? 'today' : `+${d}d`;
    strip.append(tick);
  }
  let marks = 0;
  const mark = (day: number, className: string, glyph: string, text: string) => {
    if (day - today > HORIZON_DAYS) return;
    const el = document.createElement('span');
    el.className = `crew-horizon-mark ${className}`;
    el.style.left = at(day);
    el.textContent = glyph;
    el.title = text;
    strip.append(el);
    marks++;
  };
  for (const base of plan) {
    for (const c of base.classes) {
      for (const entry of c.entries) {
        mark(entry.day, entry.short > 0 ? 'is-short' : 'is-eis', '✈', `${base.iata} ${c.name} EIS day ${entry.day}${entry.short > 0 ? ` · short ${entry.short}` : ' · crewed'}`);
      }
      for (const j of c.joining) mark(j.day, 'is-joining', '●', `${base.iata} +${j.count} ${c.name} crew${j.count === 1 ? '' : 's'} day ${j.day} (${j.kind})`);
      for (const day of c.returningDays) mark(day, 'is-returning', '↩', `${base.iata} ${c.name} back to lessor day ${day}`);
    }
  }
  const nodes: HTMLElement[] = [heading(`Next ${HORIZON_DAYS} days`, '✈ a plane entering service (red if it would arrive short of crews), ● crews joining, ↩ a plane going back to the lessor. Hover a mark for its day.'), strip];
  if (marks === 0) nodes.push(line('Nothing coming · lease a plane and its EIS shows here', 'inspector-line goal-ahead'));
  return nodes;
}

/** Every plane that would enter service short, with what to do and by when. */
function toDo(state: SimState, plan: ReturnType<typeof crewPlan>, today: number, changed: () => void): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const base of plan) {
    for (const c of base.classes) {
      // The first entry short is the one to act on: fixing it fixes the order after.
      const entry = c.entries.find((e) => e.short > 0);
      if (!entry) continue;
      rows.push(entryRow(state, base.iata, c, entry, base.classes, today, changed));
    }
  }
  if (rows.length === 0) return [];
  return [heading('To do', 'Planes that would enter service short of crews. A crew hired today joins after the hiring lead time; a conversion takes longer but uses a reserve crew of another type at the same base.'), ...rows];
}

function entryRow(state: SimState, iata: string, c: ClassPlan, entry: PlaneEntry, siblings: ClassPlan[], today: number, changed: () => void): HTMLElement {
  const row = linkToMap(document.createElement('div'), { kind: 'airport', iata });
  row.className = 'crew-todo';
  const head = document.createElement('div');
  head.className = 'crew-todo-head';
  head.append(planeIconElement(c.classCode), ` ${iata} ${c.name} · EIS day ${entry.day} (${when(entry.day, today)}) · short ${entry.short}`);
  row.append(head);

  const lead = hireLeadDays(state);
  const late = today + lead - entry.day;
  row.append(
    line(
      late <= 0 ? `Hire by day ${entry.hireBy} (${when(entry.hireBy, today)}) to join in time` : `Too late to hire in time · a hire today joins day ${today + lead}, ${late}d after EIS`,
      late <= 0 ? 'inspector-line' : 'inspector-line is-warn',
    ),
  );
  const buttons = document.createElement('div');
  buttons.className = 'crew-buttons';
  // Only as many as the base has training seats for; the rest can follow as seats free up.
  const seats = ops.crewReadout(state, iata)?.training.pilot.free ?? 0;
  const hireCount = Math.min(entry.short, seats);
  const fee = hireFee(c.classCode) * hireCount;
  buttons.append(actionButton(hireCount === 0 ? 'No free training seats' : `Hire ${hireCount}${hireCount < entry.short ? ` of ${entry.short}` : ''} · ${money(fee)}`, hireCount === 0 || state.cash < fee, () => ops.hireCrewsAt(state, iata, c.classCode, hireCount), changed, {
    title: `Hire ${hireCount} ${c.name} crew${hireCount === 1 ? '' : 's'} · ${iata}`,
    rows: [
      { label: 'Fee now', value: money(fee) },
      { label: 'Join', value: `day ${today + lead} (${lead}d)` },
      { label: 'Cash after', value: money(state.cash - fee) },
    ],
    facts: [`Short ${entry.short} at EIS day ${entry.day}${late > 0 ? `: they join ${late}d late` : ''}.`, ...(hireCount < entry.short ? [`Training seats cap this hire at ${hireCount}.`] : [])],
    confirmLabel: `Hire · ${money(fee)}`,
  }));
  // Reserve of another type at this base, converted: slower, cheaper.
  const donor = siblings.filter((s) => s.classCode !== c.classCode && s.crews - s.ideal > 0).sort((x, y) => y.crews - y.ideal - (x.crews - x.ideal))[0];
  if (donor) {
    const n = Math.min(entry.short, donor.crews - donor.ideal);
    const ready = today + retrainDays(state);
    buttons.append(
      actionButton(
        `Convert ${n} from ${donor.name} · ${money(retrainFee(c.classCode) * n)} · ready day ${ready}${ready > entry.day ? ' (late)' : ''}`,
        n > seats,
        () => ops.retrainCrewsAt(state, iata, donor.classCode, c.classCode, n),
        changed,
        {
          title: `Convert ${n} ${donor.name} → ${c.name} · ${iata}`,
          rows: [
            { label: 'Fee now', value: money(retrainFee(c.classCode) * n) },
            { label: 'Ready', value: `day ${ready}` },
            { label: 'Cash after', value: money(state.cash - retrainFee(c.classCode) * n) },
          ],
          facts: [`${donor.name} reserve drops by ${n}; they fly nothing while retraining.`],
          confirmLabel: `Convert · ${money(retrainFee(c.classCode) * n)}`,
        },
      ),
    );
  }
  row.append(buttons);
  return row;
}

/** Each base's roster, type by type. */
function roster(state: SimState, plan: ReturnType<typeof crewPlan>, today: number, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [heading('Roster', 'Crews by type rating at each base. The bar is crews on hand (solid) and joining (hatched); the marks are the legal minimum (red), the comfortable number for 8-hour shifts (white), and what the planes on their way will need (amber). Short grounds planes; tight flies late legs tired; reserve crews stand by at a daily cost. Regional and bigger types have a cabin row under their pilots: cabin teams staff the plane, and short ones cost NPS.')];
  for (const base of plan) {
    const card = document.createElement('div');
    card.className = 'crew-base';
    const name = linkToMap(document.createElement('button'), { kind: 'airport', iata: base.iata });
    name.type = 'button';
    name.className = 'inspector-link crew-base-name';
    name.textContent = `${base.iata} · crew base`;
    name.addEventListener('click', () => select({ kind: 'airport', iata: base.iata }));
    card.append(name);
    const training = ops.crewReadout(state, base.iata)?.training;
    if (training) {
      card.append(
        lineWithInfo(
          `Training seats · pilots ${training.pilot.used}/${training.pilot.seats} · cabin ${training.cabin.used}/${training.cabin.seats}`,
          'Crews hired or retraining take a training seat until they join. A base has 2 seats for each workforce plus 1 for every 2 crews it already has, so a small base can only grow so fast: ask for more crews than seats and the rest wait. A crew academy shortens the courses, which frees seats sooner.',
          training.pilot.free === 0 || training.cabin.free === 0 ? 'inspector-line is-warn' : 'inspector-line',
        ),
      );
    }
    for (const c of base.classes) {
      card.append(classRow(state, base.iata, c, base.classes, today, changed));
      const cabin = ops.crewReadout(state, base.iata)?.classes.find((r) => r.classCode === c.classCode)?.cabin;
      if (cabin) card.append(cabinRow(state, base.iata, c, cabin, changed));
    }
    // Types the airline can't fly yet still show their cabin row, greyed out: a hint of what comes later.
    for (const cls of AIRCRAFT_CLASSES) {
      if (needsCabinCrew(cls.code) && !classOpen(state, cls.code)) card.append(lockedCabinRow(cls.code));
    }
    nodes.push(card);
  }
  return nodes;
}

function classRow(state: SimState, iata: string, c: ClassPlan, siblings: ClassPlan[], today: number, changed: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'crew-row';
  const joining = c.joining.reduce((sum, j) => sum + j.count, 0);
  const coming = c.entries.length * CREWS_PER_NEW_PLANE;

  const head = document.createElement('div');
  head.className = 'crew-row-head';
  const label = document.createElement('span');
  label.append(planeIconElement(c.classCode), ` ${c.name}`);
  head.append(label, chipElement(chipFor(c)));
  row.append(head);

  // The bar: on hand and joining against the marks, on a scale wide
  // enough for whichever is biggest, including planes on their way.
  const scale = Math.max(1, c.crews + joining, c.ideal, c.minimum + coming);
  const bar = document.createElement('div');
  bar.className = 'crew-bar';
  const pct = (n: number) => `${(n / scale) * 100}%`;
  const onHand = document.createElement('span');
  onHand.className = 'crew-bar-onhand';
  onHand.style.width = pct(c.crews);
  const incoming = document.createElement('span');
  incoming.className = 'crew-bar-joining';
  incoming.style.left = pct(c.crews);
  incoming.style.width = pct(joining);
  bar.append(onHand, incoming);
  const neededAtLastEis = c.entries.length > 0 ? c.entries[c.entries.length - 1].needed : 0;
  for (const [n, className, text] of [
    [c.minimum, 'is-minimum', `Legal minimum ${c.minimum}`],
    [c.ideal, 'is-ideal', `Comfortable ${c.ideal}`],
    [neededAtLastEis, 'is-eis', `Needed once the planes on their way are flying: ${neededAtLastEis}`],
  ] as const) {
    if (n <= 0) continue;
    const markEl = document.createElement('span');
    markEl.className = `crew-bar-mark ${className}`;
    markEl.style.left = pct(n);
    markEl.title = text;
    bar.append(markEl);
  }
  row.append(bar);

  const parts = [`${c.crews} rated`, `need ${c.ideal} (min ${c.minimum})`];
  if (neededAtLastEis > 0) parts.push(`${neededAtLastEis} at EIS`);
  for (const j of c.joining) parts.push(`+${j.count} ${j.kind === 'conversion' ? `from ${j.from ?? '?'} ` : ''}day ${j.day}`);
  if (c.entries.length > 0) parts.push(`✈ ${c.entries.length} EIS from day ${c.entries[0].day}`);
  for (const day of c.returningDays) parts.push(`↩ plane back day ${day} (${when(day, today)})`);
  row.append(line(parts.join(' · '), 'inspector-line crew-row-detail'));
  // Readiness (sim/crews.ts): who's off sick, and the chance of a crew grounding this week.
  if (c.minimum > 0) {
    const ready = crewReadiness(state, iata, c.classCode);
    const risk = Math.round(ready.weeklyRisk * 100);
    row.append(
      lineWithInfo(
        `Sick ${ready.sick} · reserve ${Math.max(0, ready.reserve)} · grounding risk ${ready.weeklyRisk < 0.01 ? '<1' : risk}%/wk`,
        `Crews call in sick for 1–3 days: about ${Math.round(SICK_BASE_CHANCE * 100)}% a crew a day on an easy roster, up to ${Math.round((SICK_BASE_CHANCE + SICK_STRAIN_CHANCE) * 100)}% when shifts run to the 13-hour limit (now ${(ready.chance * 100).toFixed(1)}%). Sick crews fly nothing: with fewer than the legal minimum fit, a plane is grounded and its flights cancel. Reserve crews over the minimum cover them, at standby cost. The risk is the chance of at least one grounding in the next 7 days at this staffing.`,
        risk >= 25 ? 'inspector-line is-over' : risk >= 10 ? 'inspector-line is-warn' : 'inspector-line',
      ),
    );
  }

  const buttons = document.createElement('div');
  buttons.className = 'crew-buttons';
  const open = ops.crewReadout(state, iata)?.classes.find((r) => r.classCode === c.classCode)?.open ?? false;
  const pilotSeats = ops.crewReadout(state, iata)?.training.pilot.free ?? 0;
  buttons.append(actionButton(pilotSeats === 0 ? 'No free training seats' : `Hire 1 · ${money(hireFee(c.classCode))}`, !open || pilotSeats === 0 || state.cash < hireFee(c.classCode), () => ops.hireCrewsAt(state, iata, c.classCode, 1), changed, {
    title: `Hire 1 ${c.name} crew · ${iata}`,
    rows: [
      { label: 'Fee now', value: money(hireFee(c.classCode)) },
      { label: 'Joins', value: `day ${dayIndex(state) + hireLeadDays(state)}` },
      { label: 'Cash after', value: money(state.cash - hireFee(c.classCode)) },
    ],
    confirmLabel: `Hire · ${money(hireFee(c.classCode))}`,
  }));
  const donor = siblings.filter((s) => s.classCode !== c.classCode && s.crews - s.ideal > 0).sort((x, y) => y.crews - y.ideal - (x.crews - x.ideal))[0];
  if (donor && open) {
    buttons.append(actionButton(`Convert 1 from ${donor.name} · ${money(retrainFee(c.classCode))}`, pilotSeats === 0 || state.cash < retrainFee(c.classCode), () => ops.retrainCrewsAt(state, iata, donor.classCode, c.classCode, 1), changed, {
      title: `Convert 1 ${donor.name} → ${c.name} · ${iata}`,
      rows: [
        { label: 'Fee now', value: money(retrainFee(c.classCode)) },
        { label: 'Ready', value: `day ${dayIndex(state) + retrainDays(state)}` },
        { label: 'Cash after', value: money(state.cash - retrainFee(c.classCode)) },
      ],
      facts: [`A ${donor.name} crew leaves that roster and flies nothing while retraining.`],
      confirmLabel: `Convert · ${money(retrainFee(c.classCode))}`,
    }));
  }
  if (c.crews > c.ideal) buttons.append(
      actionButton('Release 1', false, () => ops.releaseCrewsAt(state, iata, c.classCode, 1), changed, {
        title: `Release 1 ${c.name} crew · ${iata}`,
        rows: [
          { label: 'Crews after', value: `${c.crews - 1} (need ${c.ideal}, min ${c.minimum})` },
          { label: 'Standby saved', value: `${money(standbyCost(c.classCode))}/day` },
        ],
        facts: ['Rehiring costs the fee again and takes days to join.'],
        confirmLabel: 'Release',
      }),
    );
  row.append(buttons);
  return row;
}

/** A class's cabin teams at a base: on hand against need, with hire and release. A short cabin flies, but every flight scores lower. */
function cabinRow(state: SimState, iata: string, c: ClassPlan, cabin: NonNullable<ReturnType<typeof ops.crewReadout>>['classes'][number]['cabin'] & {}, changed: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'crew-row';
  const short = cabin.teams < cabin.minimum;
  const head = document.createElement('div');
  head.className = 'crew-row-head';
  const label = document.createElement('span');
  label.append(planeIconElement(c.classCode), ` ${c.name} cabin`);
  head.append(label, chipElement(short ? { text: 'SHORT', tone: 'bad' } : cabin.teams < cabin.ideal ? { text: 'TIGHT', tone: 'warn' } : cabin.teams > cabin.ideal ? { text: `RESERVE +${cabin.teams - cabin.ideal}`, tone: 'info' } : { text: 'OK', tone: 'good' }));
  row.append(head);
  row.append(
    lineWithInfo(
      `${cabin.teams} teams${cabin.arriving > 0 ? ` +${cabin.arriving} joining` : ''} · need ${cabin.ideal} (min ${cabin.minimum}) · standby ${money(cabin.standbyPerDay)}/day`,
      `Cabin teams staff every Regional plane and up: ${CABIN_TEAMS_PER_SHIFT[c.classCode]} per shift its pilots fly. A short cabin never grounds a plane, but each of its flights loses up to ${CABIN_SHORT_NPS_PENALTY} NPS points in proportion to the teams missing. They train in ${ops.crewReadout(state, iata)?.cabinLeadDays ?? 0} days in a cabin training seat, and can't be converted between classes.`,
      short ? 'inspector-line is-over' : 'inspector-line crew-row-detail',
    ),
  );
  const readout = ops.crewReadout(state, iata);
  const seats = readout?.training.cabin.free ?? 0;
  const buttons = document.createElement('div');
  buttons.className = 'crew-buttons';
  buttons.append(actionButton(seats === 0 ? 'No free cabin seats' : `Hire 1 cabin · ${money(cabin.hireFee)}`, seats === 0 || state.cash < cabin.hireFee, () => ops.hireCabinAt(state, iata, c.classCode, 1), changed, {
    title: `Hire 1 ${c.name} cabin team · ${iata}`,
    rows: [
      { label: 'Fee now', value: money(cabin.hireFee) },
      { label: 'Joins', value: `day ${dayIndex(state) + (readout?.cabinLeadDays ?? 0)}` },
      { label: 'Cash after', value: money(state.cash - cabin.hireFee) },
    ],
    confirmLabel: `Hire · ${money(cabin.hireFee)}`,
  }));
  if (cabin.teams > cabin.ideal) {
    buttons.append(actionButton('Release 1', false, () => ops.releaseCabinAt(state, iata, c.classCode, 1), changed, {
      title: `Release 1 ${c.name} cabin team · ${iata}`,
      rows: [{ label: 'Teams after', value: `${cabin.teams - 1} (need ${cabin.ideal}, min ${cabin.minimum})` }, { label: 'Standby saved', value: `${money(cabin.standbyPerDay)}/day` }],
      facts: ['Rehiring costs the fee again and takes days to join.'],
      confirmLabel: 'Release',
    }));
  }
  row.append(buttons);
  return row;
}

/** A cabin row for a type the airline can't fly yet: greyed out, with what opens it. */
function lockedCabinRow(classCode: string): HTMLElement {
  const name = classByCode(classCode)?.name ?? classCode;
  const opener = tierThatOpens(classCode);
  const row = document.createElement('div');
  row.className = 'crew-row crew-row--locked';
  const head = document.createElement('div');
  head.className = 'crew-row-head';
  const label = document.createElement('span');
  label.append(planeIconElement(classCode), ` ${name} cabin`);
  head.append(label, chipElement({ text: 'LOCKED', tone: 'idle' }));
  row.append(head);
  const teams = CABIN_TEAMS_PER_SHIFT[classCode] ?? 0;
  row.append(line(`${teams} cabin team${teams === 1 ? '' : 's'} a shift · ${money(cabinHireFee(classCode))} a team · opens as ${opener?.name ?? 'you grow'}`, 'inspector-line crew-row-detail'));
  const buttons = document.createElement('div');
  buttons.className = 'crew-buttons';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub crew-action';
  button.textContent = `Hire 1 cabin · ${money(cabinHireFee(classCode))}`;
  button.disabled = true;
  button.title = `${name} planes aren't open to the airline yet.`;
  buttons.append(button);
  row.append(buttons);
  return row;
}
