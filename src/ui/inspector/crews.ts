import { dayIndex } from '../../sim/clock';
import { execNudge } from '../execNudge';
import { cabinShortToday, crewPlan, type ClassPlan, type PlaneEntry } from '../../sim/crewPlan';
import { AIRCRAFT_CLASSES, classByCode } from '../../sim/aircraftClasses';
import { classOpen, tierThatOpens } from '../../sim/ladder';
import { cabinHireFee, cabinLeadDays, needsCabinCrew, CABIN_SHORT_NPS_PENALTY, SEATS_PER_ATTENDANT, SERVICE_SEATS_PER_ATTENDANT, typeAttendants, CREWS_PER_NEW_PLANE, crewReadiness, hireFee, hireLeadDays, retrainDays, retrainFee, SICK_BASE_CHANCE, SICK_STRAIN_CHANCE, standbyCost } from '../../sim/crews';
import type { SimState } from '../../sim/state';
import { money } from '../format';
import { linkToMap } from '../mapLink';
import { planeIconElement } from '../planeIcons';
import { cashAfterRows, showConfirm } from '../confirmModal';
import * as ops from '../routeActions';
import { select } from '../selection';
import { foldHeader, isFolded } from './crewsFold';
import { glyph } from '../glyphs';
import { heading, info, line, lineWithInfo, titleWithSwitch, viewSwitch } from './dom';
import { pairingsSection } from './pairings';
import { pipelineLink } from '../pipelineLink';

/**
 * The Crews screen as a crew planner's board (sim/crewPlan.ts): what's
 * coming over the next month, what needs doing about it, and each base's
 * roster by type rating.
 *
 * - **The pipeline link**: what's coming over the next month (deliveries,
 *   crews joining, planes going back) is on the map's pipeline
 *   (ui/pipeline.ts).
 * - **To do**: planes grounded now for want of attendants, and every
 *   plane that would enter service short of pilots or attendants, with the last
 *   day a hire still lands in time and a button to hire the shortfall, or
 *   to convert reserve crews of another type at the base.
 * - **Roster**: per base, per type, a bar of crews on hand and joining
 *   against the minimum and comfortable marks, with a status chip.
 */

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

/** The cabin's part of a folded base's chip: attendants under the floor now, or short for a plane on its way. */
function cabinChipFor(plan: ClassPlan): Chip {
  if (cabinShortToday(plan) - (plan.cabin?.joining ?? 0) > 0) return { text: 'CABIN SHORT', tone: 'bad' };
  if (plan.entries.some((entry) => entry.cabinShort > 0)) return { text: 'CABIN SHORT AT EIS', tone: 'bad' };
  return { text: '', tone: 'idle' };
}

function chipElement(chip: Chip): HTMLElement {
  const el = document.createElement('span');
  el.className = `crew-chip crew-chip--${chip.tone}`;
  el.textContent = chip.text;
  return el;
}

/** A confirm window before an action that spends money or lets crews go; `confirm` null runs it at once. */
type CrewConfirm = { title: string; rows: { label: string; value: string }[]; facts?: string[]; confirmLabel: string; quantity?: { max: number; rowsFor: (count: number) => { label: string; value: string }[]; confirmLabelFor: (count: number) => string } };

function actionButton(label: string, disabled: boolean, act: (count: number) => void, changed: () => void, confirm: CrewConfirm | null = null, tip?: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub crew-action';
  button.textContent = label;
  // The label is a glyph; the tip says it in full, with the fee, for hover, tap and screen readers.
  button.title = tip ?? confirm?.title ?? label;
  button.setAttribute('aria-label', button.title);
  button.disabled = disabled;
  const run = (_choice = 0, count = 1) => {
    act(count);
    changed();
  };
  button.addEventListener('click', () => {
    if (!confirm) return run();
    const { quantity, ...rest } = confirm;
    showConfirm({ ...rest, run, quantity: quantity && { min: 1, max: Math.max(1, quantity.max), value: 1, rowsFor: quantity.rowsFor, confirmLabelFor: quantity.confirmLabelFor } });
  });
  return button;
}

/** Days from today as the board says them: "today", "in 5d", "2d ago". */
function when(day: number, today: number): string {
  const d = day - today;
  return d === 0 ? 'today' : d > 0 ? `in ${d}d` : `${-d}d ago`;
}

/** The two halves of the Crews screen: where crews live and who to hire, or the duty the schedule asks of them. */
type CrewsView = 'bases' | 'pairings';

const VIEW_KEY = 'slotsandspokes-crews-view';

// Remembered in the browser so the screen opens the way it was left; a
// blocked localStorage (private window) just means the default each time.
function readView(): CrewsView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'pairings' ? 'pairings' : 'bases';
  } catch {
    return 'bases';
  }
}

let view = readView();

function setView(next: CrewsView): void {
  view = next;
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch {
    // Not remembered; the switch still works for this visit.
  }
}

export function buildCrewsView(state: SimState, changed: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inspector-view';
  const views = viewSwitch<CrewsView>(
    [
      { id: 'bases', icon: glyph('people'), tip: 'Bases & hiring: each crew base\'s roster, with hire, convert and release' },
      { id: 'pairings', icon: glyph('timer'), tip: 'Pairings: the duty the schedule asks of crews, by type' },
    ],
    view,
    (next) => {
      setView(next);
      changed();
    },
  );
  root.append(titleWithSwitch('Crews', views, execNudge(state, ['cpo-solheim'])));

  const today = dayIndex(state);
  const plan = crewPlan(state);

  const classes = plan.flatMap((base) => base.classes);
  const crews = classes.reduce((sum, c) => sum + c.crews, 0);
  const joining = classes.reduce((sum, c) => sum + c.joining.reduce((s, j) => s + j.count, 0), 0);
  const reserveCost = plan.reduce(
    (sum, base) => sum + base.classes.reduce((s, c) => s + Math.max(0, c.crews - c.ideal) * standbyCost(c.classCode), 0),
    0,
  );
  const baseCount = ops.crewBaseReadout(state).bases.length;
  root.append(
    line(
      `${crews} crews · ${baseCount} base${baseCount === 1 ? '' : 's'}` +
        (joining > 0 ? ` · +${joining} joining` : '') +
        (reserveCost > 0 ? ` · reserve ${money(reserveCost)}/day` : '') +
        ` · hire ${hireLeadDays(state)}d · conversion ${retrainDays(state)}d`,
    ),
  );

  if (view === 'pairings') {
    root.append(...pairingsSection(state, changed));
    return root;
  }
  root.append(pipelineLink('Deliveries and crews joining'));
  root.append(...toDo(state, plan, today, changed));
  root.append(...roster(state, plan, today, changed));
  return root;
}

/** Planes grounded now for want of attendants, and every plane that would enter service short, with what to do and by when. */
function toDo(state: SimState, plan: ReturnType<typeof crewPlan>, today: number, changed: () => void): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const base of plan) {
    for (const c of base.classes) {
      const groundedNow = cabinShortToday(c) - (c.cabin?.joining ?? 0);
      if (groundedNow > 0) rows.push(cabinNowRow(state, base.iata, c, groundedNow, changed));
      // The first entry short is the one to act on: fixing it fixes the order after.
      const entry = c.entries.find((e) => e.short > 0 || e.cabinShort > 0);
      if (!entry) continue;
      rows.push(entryRow(state, base.iata, c, entry, base.classes, today, changed));
    }
  }
  if (rows.length === 0) return [];
  return [heading('To do', 'Planes grounded or entering service short of pilots or attendants. A crew hired today joins after the hiring lead time, an attendant after the cabin lead time; a conversion takes longer but uses a reserve crew of another type at the same base.'), ...rows];
}

/** Hire `count` attendants of a class at a base, capped by its free cabin training seats. */
function cabinHireButton(state: SimState, iata: string, c: ClassPlan, count: number, fact: string, changed: () => void): HTMLButtonElement {
  const seats = ops.crewReadout(state, iata)?.training.cabin.free ?? 0;
  const hireCount = Math.min(count, seats);
  const fee = cabinHireFee(c.classCode) * hireCount;
  const lead = cabinLeadDays(state);
  return actionButton(hireCount === 0 ? 'No free cabin seats' : `Hire ${hireCount}${hireCount < count ? ` of ${count}` : ''} attendant${hireCount === 1 ? '' : 's'} · ${money(fee)}`, hireCount === 0 || state.cash < fee, () => ops.hireCabinAt(state, iata, c.classCode, hireCount), changed, {
    title: `Hire ${hireCount} ${c.name} attendant${hireCount === 1 ? '' : 's'} · ${iata}`,
    rows: [
      { label: 'Fee now', value: money(fee) },
      { label: 'Join', value: `day ${dayIndex(state) + lead} (${lead}d)` },
      ...cashAfterRows(state, fee),
    ],
    facts: [fact, ...(hireCount < count ? [`Cabin training seats cap this hire at ${hireCount}.`] : [])],
    confirmLabel: `Hire · ${money(fee)}`,
  });
}

/** A class with planes on the ground today because its attendants are under the legal floor. */
function cabinNowRow(state: SimState, iata: string, c: ClassPlan, short: number, changed: () => void): HTMLElement {
  const row = linkToMap(document.createElement('div'), { kind: 'airport', iata });
  row.className = 'crew-todo';
  const head = document.createElement('div');
  head.className = 'crew-todo-head';
  const grounded = state.crewDay?.cabinShortTails?.filter((tail) => state.aircraft.find((a) => a.tail === tail)?.typeCode === c.classCode && state.aircraft.find((a) => a.tail === tail)?.baseAirport === iata) ?? [];
  head.append(planeIconElement(c.classCode), ` ${iata} ${c.name} · ${grounded.length > 0 ? `${grounded.join(' ')} grounded` : 'grounded'} · short ${short} attendant${short === 1 ? '' : 's'}`);
  row.append(head);
  row.append(line(`Legal floor ${c.cabin?.minimum ?? 0} · on hand ${c.cabin?.attendants ?? 0} · flies again once hires join`, 'inspector-line is-warn'));
  const buttons = document.createElement('div');
  buttons.className = 'crew-buttons';
  buttons.append(cabinHireButton(state, iata, c, short, `Short ${short} of the legal floor today: its planes stay on the ground until they join.`, changed));
  row.append(buttons);
  return row;
}

function entryRow(state: SimState, iata: string, c: ClassPlan, entry: PlaneEntry, siblings: ClassPlan[], today: number, changed: () => void): HTMLElement {
  const row = linkToMap(document.createElement('div'), { kind: 'airport', iata });
  row.className = 'crew-todo';
  const head = document.createElement('div');
  head.className = 'crew-todo-head';
  const shortBy = [entry.short > 0 ? `${entry.short} crew${entry.short === 1 ? '' : 's'}` : '', entry.cabinShort > 0 ? `${entry.cabinShort} attendant${entry.cabinShort === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  head.append(planeIconElement(c.classCode), ` ${iata} ${c.name} · EIS day ${entry.day} (${when(entry.day, today)}) · short ${shortBy}`);
  row.append(head);

  const buttons = document.createElement('div');
  buttons.className = 'crew-buttons';
  if (entry.short > 0) {
    const lead = hireLeadDays(state);
    const late = today + lead - entry.day;
    row.append(
      line(
        late <= 0 ? `Hire by day ${entry.hireBy} (${when(entry.hireBy, today)}) to join in time` : `Too late to hire in time · a hire today joins day ${today + lead}, ${late}d after EIS`,
        late <= 0 ? 'inspector-line' : 'inspector-line is-warn',
      ),
    );
    // Only as many as the base has training seats for; the rest can follow as seats free up.
    const seats = ops.crewReadout(state, iata)?.training.pilot.free ?? 0;
    const hireCount = Math.min(entry.short, seats);
    const fee = hireFee(c.classCode) * hireCount;
    buttons.append(actionButton(hireCount === 0 ? 'No free training seats' : `Hire ${hireCount}${hireCount < entry.short ? ` of ${entry.short}` : ''} · ${money(fee)}`, hireCount === 0 || state.cash < fee, () => ops.hireCrewsAt(state, iata, c.classCode, hireCount), changed, {
      title: `Hire ${hireCount} ${c.name} crew${hireCount === 1 ? '' : 's'} · ${iata}`,
      rows: [
        { label: 'Fee now', value: money(fee) },
        { label: 'Join', value: `day ${today + lead} (${lead}d)` },
        ...cashAfterRows(state, fee),
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
              ...cashAfterRows(state, retrainFee(c.classCode) * n),
            ],
            facts: [`${donor.name} reserve drops by ${n}; they fly nothing while retraining.`],
            confirmLabel: `Convert · ${money(retrainFee(c.classCode) * n)}`,
          },
        ),
      );
    }
  }
  if (entry.cabinShort > 0) {
    const late = today + cabinLeadDays(state) - entry.day;
    row.append(
      line(
        late <= 0 ? `Attendants by day ${entry.cabinHireBy} (${when(entry.cabinHireBy, today)}) · legal floor or it stays on the ground` : `Attendants hired today join ${late}d after EIS`,
        late <= 0 ? 'inspector-line' : 'inspector-line is-warn',
      ),
    );
    buttons.append(cabinHireButton(state, iata, c, entry.cabinShort, `Short ${entry.cabinShort} attendant${entry.cabinShort === 1 ? '' : 's'} at EIS day ${entry.day}${late > 0 ? `: they join ${late}d late` : ''}.`, changed));
  }
  row.append(buttons);
  return row;
}

/** The worst chip among a base's types, so a folded base still says whether it needs anything. */
const TONE_ORDER: Chip['tone'][] = ['bad', 'warn', 'info', 'good', 'idle'];

/**
 * Each crew base's roster, type by type, folding on its header. A base with
 * no crews or planes yet has hire buttons for every open type instead.
 * Bases open and close from the airport's menu on the map.
 */
function roster(state: SimState, plan: ReturnType<typeof crewPlan>, today: number, changed: () => void): HTMLElement[] {
  const readout = ops.crewBaseReadout(state);
  const nodes: HTMLElement[] = [
    heading(
      'Roster',
      `Crews by type rating at each crew base; tap a base to fold it. The bar is crews on hand (solid) and joining (hatched); the marks are the legal minimum (red), the comfortable number for 8-hour shifts (white), and what the planes on their way will need (amber). Short grounds planes; tight flies late legs tired; reserve crews stand by at a daily cost. Regional and bigger types have a cabin row under their pilots: attendants by the seat plan, where under the legal floor grounds a plane and under full service costs NPS. A crew base is where crews live and the only place planes can be leased or based: open one (${money(readout.fee)} + ${money(readout.perDay)}/day) or close an empty one from the airport's menu on the map. It is not a maintenance base: line checks happen only at a line base, opened on the Mtc screen.`,
    ),
  ];
  // Home first, then the rest as the crew planner orders them, then bases with nothing on them yet.
  const order = [...plan.map((entry) => entry.iata), ...readout.bases.map((base) => base.iata).filter((iata) => !plan.some((entry) => entry.iata === iata))];
  for (const iata of order) {
    const base = plan.find((entry) => entry.iata === iata);
    const baseInfo = readout.bases.find((entry) => entry.iata === iata);
    const card = document.createElement('div');
    card.className = 'crew-base';
    const key = `base:${iata}`;

    const code = document.createElement('b');
    code.className = 'iata-plate';
    code.textContent = iata;
    code.title = baseInfo?.name ?? iata;
    const crews = base?.classes.reduce((sum, c) => sum + c.crews, 0) ?? 0;
    const summary = document.createElement('span');
    summary.className = 'crew-fold-detail';
    const planes = baseInfo?.planes ?? 0;
    summary.textContent = `${crews} crew${crews === 1 ? '' : 's'} · ✈ ${planes}` + (baseInfo && baseInfo.perDay > 0 ? ` · ${money(baseInfo.perDay)}/day` : '');
    summary.title = `${crews} crews · ${planes} plane${planes === 1 ? '' : 's'} based · crew room ${baseInfo && baseInfo.perDay > 0 ? `${money(baseInfo.perDay)}/day` : 'free at home'}`;
    const chips = (base?.classes ?? []).flatMap((c) => [chipFor(c), cabinChipFor(c)]);
    const worst = chips.sort((x, y) => TONE_ORDER.indexOf(x.tone) - TONE_ORDER.indexOf(y.tone))[0];
    const header = foldHeader(key, changed, code, summary);
    if (worst && (worst.tone === 'bad' || worst.tone === 'warn')) header.append(chipElement(worst));
    // The map pin sits beside the fold header, not inside it: a button can't hold a button.
    const head = document.createElement('div');
    head.className = 'crew-base-head';
    head.append(header);
    card.append(head);
    const toMap = linkToMap(document.createElement('button'), { kind: 'airport', iata });
    toMap.type = 'button';
    toMap.className = 'inspector-link crew-base-map';
    toMap.append(glyph('mapPin'));
    toMap.dataset.tip = `${iata} on the map · open or close bases from its menu`;
    toMap.setAttribute('aria-label', toMap.dataset.tip);
    toMap.addEventListener('click', () => select({ kind: 'airport', iata }));
    head.append(toMap);
    if (isFolded(key)) {
      nodes.push(card);
      continue;
    }

    const training = ops.crewReadout(state, iata)?.training;
    if (training) {
      card.append(
        lineWithInfo(
          `Training seats · pilots ${training.pilot.used}/${training.pilot.seats} · cabin ${training.cabin.used}/${training.cabin.seats}`,
          'Crews hired or retraining take a training seat until they join. A base has 2 pilot seats and 6 cabin seats plus 1 for every 2 crews or attendants it already has, so a small base can only grow so fast: ask for more crews than seats and the rest wait. A crew academy shortens hiring courses and a chief pilot retraining ones, which frees seats sooner.',
          training.pilot.free === 0 || training.cabin.free === 0 ? 'inspector-line is-warn' : 'inspector-line',
        ),
      );
    }
    if (base) {
      for (const c of base.classes) {
        card.append(classRow(state, iata, c, base.classes, today, changed));
        const cabin = ops.crewReadout(state, iata)?.classes.find((r) => r.classCode === c.classCode)?.cabin;
        if (cabin) card.append(cabinRow(state, iata, c, cabin, changed));
      }
    } else {
      card.append(emptyBaseHire(state, iata, changed));
    }
    // Types the airline can't fly yet still show, greyed out: a hint of what comes later.
    for (const cls of AIRCRAFT_CLASSES) {
      if (classOpen(state, cls.code)) continue;
      card.append(lockedRow(state, cls.code, 'pilot'));
      if (needsCabinCrew(cls.code)) card.append(lockedRow(state, cls.code, 'cabin'));
    }
    nodes.push(card);
  }
  return nodes;
}

/** A base with no roster yet (no crews, no planes): a hire button per open type, to crew it before its first plane. */
function emptyBaseHire(state: SimState, iata: string, changed: () => void): HTMLElement {
  const buttons = document.createElement('div');
  buttons.className = 'crew-buttons';
  buttons.append(line('No crews yet', 'inspector-line crew-row-detail'));
  const classes = ops.crewReadout(state, iata)?.classes.filter((c) => c.open) ?? [];
  const emptySeats = ops.crewReadout(state, iata)?.training.pilot.free ?? 0;
  for (const c of classes) {
    const hire = actionButton('+', emptySeats === 0 || state.cash < hireFee(c.classCode), () => ops.hireCrewsAt(state, iata, c.classCode, 1), changed, {
      title: `Hire 1 ${c.name} crew · ${iata}`,
      rows: [{ label: 'Fee now', value: money(hireFee(c.classCode)) }, ...cashAfterRows(state, hireFee(c.classCode))],
      confirmLabel: `Hire · ${money(hireFee(c.classCode))}`,
    }, emptySeats === 0 ? 'No free training seats' : `Hire 1 ${c.name} crew · ${money(hireFee(c.classCode))}`);
    hire.prepend(planeIconElement(c.classCode), ' ');
    buttons.append(hire);
  }
  return buttons;
}

function classRow(state: SimState, iata: string, c: ClassPlan, siblings: ClassPlan[], today: number, changed: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'crew-row';
  const joining = c.joining.reduce((sum, j) => sum + j.count, 0);
  const coming = c.entries.length * CREWS_PER_NEW_PLANE;

  row.classList.add('crew-row--line');
  const label = document.createElement('span');
  label.className = 'crew-row-name';
  label.title = c.name;
  label.append(planeIconElement(c.classCode));
  row.append(label);

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

  const parts = [`${c.crews} of ${c.ideal}`];
  if (neededAtLastEis > 0) parts.push(`→ ${neededAtLastEis}`);
  for (const j of c.joining) parts.push(`+${j.count} ${j.kind === 'conversion' ? `from ${j.from ?? '?'} ` : ''}day ${j.day}`);
  if (c.entries.length > 0) parts.push(`✈ ${c.entries.length} EIS from day ${c.entries[0].day}`);
  for (const day of c.returningDays) parts.push(`↩ plane back day ${day} (${when(day, today)})`);
  const count = document.createElement('span');
  count.className = 'crew-row-count';
  count.textContent = `${c.crews}/${c.ideal}`;
  count.title = parts.join(' · ');
  const chip = chipElement(chipFor(c));
  // Readiness (sim/crews.ts): sick, reserve and the weekly grounding risk ride on the chip's tip; only a real risk shows as a dot.
  let riskPercent = 0;
  if (c.minimum > 0) {
    const ready = crewReadiness(state, iata, c.classCode);
    riskPercent = Math.round(ready.weeklyRisk * 100);
    chip.title = `Sick ${ready.sick} · reserve ${Math.max(0, ready.reserve)} · grounding risk ${ready.weeklyRisk < 0.01 ? '<1' : riskPercent}%/wk`;
  }
  const explain = info(
    `Crews rated for this type against the comfortable number (legal minimum ${c.minimum}); → is what the planes on their way will need. + joining crews with their day, ✈ planes arriving, ↩ a grounded plane back. The marks on the bar say the same. Crews call in sick for 1–3 days: about ${Math.round(SICK_BASE_CHANCE * 100)}% a crew a day on an easy roster, up to ${Math.round((SICK_BASE_CHANCE + SICK_STRAIN_CHANCE) * 100)}% when shifts run to the 13-hour limit. Sick crews fly nothing: with fewer than the legal minimum fit, a plane is grounded and its flights cancel. Reserve crews over the minimum cover them, at standby cost. The chip's tip has sick, reserve and the chance of a grounding in the next 7 days.`,
  );
  row.append(count, chip);
  if (riskPercent >= 10) {
    const dot = document.createElement('span');
    dot.className = `crew-risk-dot ${riskPercent >= 25 ? 'is-over' : 'is-warn'}`;
    dot.title = chip.title;
    row.append(dot);
  }
  row.append(explain);

  const buttons = document.createElement('div');
  buttons.className = 'crew-buttons';
  const open = ops.crewReadout(state, iata)?.classes.find((r) => r.classCode === c.classCode)?.open ?? false;
  const pilotSeats = ops.crewReadout(state, iata)?.training.pilot.free ?? 0;
  const hireJoins = dayIndex(state) + hireLeadDays(state);
  const hireRows = (n: number) => [
    { label: 'Fee now', value: money(hireFee(c.classCode) * n) },
    { label: 'Joins', value: `day ${hireJoins}` },
    ...cashAfterRows(state, hireFee(c.classCode) * n),
  ];
  buttons.append(actionButton('+', !open || pilotSeats === 0 || state.cash < hireFee(c.classCode), (n) => ops.hireCrewsAt(state, iata, c.classCode, n), changed, {
    title: `Hire ${c.name} crews · ${iata}`,
    rows: hireRows(1),
    confirmLabel: `Hire · ${money(hireFee(c.classCode))}`,
    quantity: { max: Math.min(pilotSeats, Math.floor(state.cash / hireFee(c.classCode))), rowsFor: hireRows, confirmLabelFor: (n) => `Hire ${n} · ${money(hireFee(c.classCode) * n)}` },
  }, pilotSeats === 0 ? 'No free training seats' : `Hire ${c.name} crews · ${money(hireFee(c.classCode))} each`));
  const donor = siblings.filter((s) => s.classCode !== c.classCode && s.crews - s.ideal > 0).sort((x, y) => y.crews - y.ideal - (x.crews - x.ideal))[0];
  if (donor && open) {
    const convertRows = (n: number) => [
      { label: 'Fee now', value: money(retrainFee(c.classCode) * n) },
      { label: 'Ready', value: `day ${dayIndex(state) + retrainDays(state)}` },
      ...cashAfterRows(state, retrainFee(c.classCode) * n),
    ];
    buttons.append(actionButton('⇄', pilotSeats === 0 || state.cash < retrainFee(c.classCode), (n) => ops.retrainCrewsAt(state, iata, donor.classCode, c.classCode, n), changed, {
      title: `Convert ${donor.name} → ${c.name} crews · ${iata}`,
      rows: convertRows(1),
      facts: [`${donor.name} crews leave that roster and fly nothing while retraining.`],
      confirmLabel: `Convert · ${money(retrainFee(c.classCode))}`,
      quantity: { max: Math.min(donor.crews - donor.ideal, pilotSeats, Math.floor(state.cash / retrainFee(c.classCode))), rowsFor: convertRows, confirmLabelFor: (n) => `Convert ${n} · ${money(retrainFee(c.classCode) * n)}` },
    }, `Convert ${donor.name} crews → ${c.name} · ${money(retrainFee(c.classCode))} each`));
  }
  if (c.crews > c.ideal) buttons.append(
      actionButton('−1', false, () => ops.releaseCrewsAt(state, iata, c.classCode, 1), changed, {
        title: `Release 1 ${c.name} crew · ${iata}`,
        rows: [
          { label: 'Crews after', value: `${c.crews - 1} (need ${c.ideal}, min ${c.minimum})` },
          { label: 'Standby saved', value: `${money(standbyCost(c.classCode))}/day` },
        ],
        facts: ['Rehiring costs the fee again and takes days to join.'],
        confirmLabel: 'Release',
      }, `Release 1 ${c.name} crew · saves ${money(standbyCost(c.classCode))}/day`),
    );
  row.append(buttons);
  return row;
}

/** A class's attendants at a base: on hand against the legal floor and full service, with hire and release. Under the floor a plane stays on the ground; under full service its flights score lower. */
function cabinRow(state: SimState, iata: string, c: ClassPlan, cabin: NonNullable<ReturnType<typeof ops.crewReadout>>['classes'][number]['cabin'] & {}, changed: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'crew-row';
  // Attendants already in training count: a base with its seats full of hires isn't short, it is waiting.
  const short = cabin.attendants + cabin.arriving < cabin.minimum;
  row.classList.add('crew-row--line', 'crew-row--cabin');
  const label = document.createElement('span');
  label.className = 'crew-row-name';
  label.title = `${c.name} cabin · ${cabin.perNewShift.floor} attendant${cabin.perNewShift.floor === 1 ? '' : 's'} a shift by law, ${cabin.perNewShift.full} for full service in the standard cabin`;
  label.append(planeIconElement(c.classCode), ' ☺');
  const count = document.createElement('span');
  count.className = 'crew-row-count';
  count.textContent = `${cabin.attendants}/${cabin.full}`;
  count.title = `${cabin.attendants} attendants${cabin.arriving > 0 ? ` +${cabin.arriving} joining` : ''} · full service ${cabin.full} · legal ${cabin.minimum} · ${money(cabin.wagePerDay)}/day each`;
  const reserve = cabin.attendants - cabin.full;
  const chip = chipElement(
    short
      ? { text: 'SHORT', tone: 'bad' }
      : c.entries.some((entry) => entry.cabinShort > 0)
        ? { text: 'SHORT AT EIS', tone: 'bad' }
        : cabin.attendants < cabin.minimum
          ? { text: `JOINING +${cabin.arriving}`, tone: 'info' }
          : cabin.attendants < cabin.full
            ? { text: 'THIN', tone: 'warn' }
            : reserve > 0
              ? { text: `RESERVE +${reserve}`, tone: 'info' }
              : { text: 'OK', tone: 'good' },
  );
  const riskPercent = Math.round(cabin.weeklyRisk * 100);
  if (cabin.minimum > 0) chip.title = `Sick ${cabin.sick} · over legal ${Math.max(0, cabin.attendants - cabin.minimum)} · grounding risk ${cabin.weeklyRisk < 0.01 ? '<1' : riskPercent}%/wk`;
  // Same bar as the pilots': attendants on hand and joining against the legal floor and full service.
  const scale = Math.max(1, cabin.attendants + cabin.arriving, cabin.full, cabin.minimum);
  const pct = (n: number) => `${(n / scale) * 100}%`;
  const bar = document.createElement('div');
  bar.className = 'crew-bar';
  const onHand = document.createElement('span');
  onHand.className = 'crew-bar-onhand';
  onHand.style.width = pct(cabin.attendants);
  const joining = document.createElement('span');
  joining.className = 'crew-bar-joining';
  joining.style.left = pct(cabin.attendants);
  joining.style.width = pct(cabin.arriving);
  bar.append(onHand, joining);
  for (const [n, className, text] of [
    [cabin.minimum, 'is-minimum', `Legal minimum ${cabin.minimum}`],
    [cabin.full, 'is-ideal', `Full service ${cabin.full}`],
  ] as const) {
    if (n <= 0) continue;
    const markEl = document.createElement('span');
    markEl.className = `crew-bar-mark ${className}`;
    markEl.style.left = pct(n);
    markEl.title = text;
    bar.append(markEl);
  }
  row.append(label, bar, count, chip);
  if (cabin.minimum > 0 && riskPercent >= 10) {
    const dot = document.createElement('span');
    dot.className = `crew-risk-dot ${riskPercent >= 25 ? 'is-over' : 'is-warn'}`;
    dot.title = chip.title;
    row.append(dot);
  }
  row.append(
    info(
      `Attendants by the seat plan, on every shift a plane's pilots fly. By law 1 for every ${SEATS_PER_ATTENDANT} seats or part of them: under that a plane stays on the ground, so a cabin of 50 seats needs one fewer than 51. Full service needs 1 for every ${SERVICE_SEATS_PER_ATTENDANT.economy} Y, ${SERVICE_SEATS_PER_ATTENDANT.premium} W or ${SERVICE_SEATS_PER_ATTENDANT.business} J seats; between the two a plane flies with a thin cabin and its flights lose up to ${CABIN_SHORT_NPS_PENALTY} NPS points. Each is paid ${money(cabin.wagePerDay)} a day, flying or not, and they fall sick like pilots. They train in ${ops.crewReadout(state, iata)?.cabinLeadDays ?? 0} days in a cabin training seat, and can't be converted between types.`,
    ),
  );
  const readout = ops.crewReadout(state, iata);
  const seats = readout?.training.cabin.free ?? 0;
  const buttons = document.createElement('div');
  buttons.className = 'crew-buttons';
  const cabinJoins = dayIndex(state) + (readout?.cabinLeadDays ?? 0);
  const cabinRows = (n: number) => [
    { label: 'Fee now', value: money(cabin.hireFee * n) },
    { label: 'Pay', value: `${money(cabin.wagePerDay * n)}/day` },
    { label: 'Joins', value: `day ${cabinJoins}` },
    ...cashAfterRows(state, cabin.hireFee * n),
  ];
  buttons.append(actionButton('+', seats === 0 || state.cash < cabin.hireFee, (n) => ops.hireCabinAt(state, iata, c.classCode, n), changed, {
    title: `Hire ${c.name} attendants · ${iata}`,
    rows: cabinRows(1),
    confirmLabel: `Hire · ${money(cabin.hireFee)}`,
    quantity: { max: Math.min(seats, Math.floor(state.cash / cabin.hireFee)), rowsFor: cabinRows, confirmLabelFor: (n) => `Hire ${n} · ${money(cabin.hireFee * n)}` },
  }, seats === 0 ? `No free cabin seats · ${readout?.training.cabin.used ?? 0} in training` : `Hire ${c.name} attendants · ${money(cabin.hireFee)} each`));
  if (cabin.attendants > cabin.minimum) {
    buttons.append(actionButton('−1', false, () => ops.releaseCabinAt(state, iata, c.classCode, 1), changed, {
      title: `Release 1 ${c.name} attendant · ${iata}`,
      rows: [{ label: 'After', value: `${cabin.attendants - 1} (full ${cabin.full}, legal ${cabin.minimum})` }, { label: 'Pay saved', value: `${money(cabin.wagePerDay)}/day` }],
      facts: ['Rehiring costs the fee again and takes days to join.'],
      confirmLabel: 'Release',
    }, `Release 1 ${c.name} attendant · saves ${money(cabin.wagePerDay)}/day`));
  }
  row.append(buttons);
  return row;
}

/** A pilot or cabin row for a type the airline can't fly yet: greyed out, with what opens it. */
function lockedRow(state: SimState, classCode: string, role: 'pilot' | 'cabin'): HTMLElement {
  const name = classByCode(classCode)?.name ?? classCode;
  const opener = tierThatOpens(classCode);
  const row = document.createElement('div');
  row.className = 'crew-row crew-row--locked';
  row.classList.add('crew-row--line');
  const label = document.createElement('span');
  label.className = 'crew-row-name';
  label.title = role === 'cabin' ? `${name} cabin` : name;
  label.append(planeIconElement(classCode), role === 'cabin' ? ' ☺' : '');
  const attendants = typeAttendants(state, classCode).floor;
  const fee = role === 'cabin' ? cabinHireFee(classCode) : hireFee(classCode);
  const detail = document.createElement('span');
  detail.className = 'crew-row-count';
  detail.textContent = money(fee);
  detail.title = role === 'cabin'
    ? `${attendants} attendant${attendants === 1 ? '' : 's'} a shift by law · ${money(fee)} each · opens as ${opener?.name ?? 'you grow'}`
    : `${money(fee)} a crew · opens as ${opener?.name ?? 'you grow'}`;
  row.append(label, detail, chipElement({ text: 'LOCKED', tone: 'idle' }));
  const buttons = document.createElement('div');
  buttons.className = 'crew-buttons';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub crew-action';
  button.textContent = '+';
  button.disabled = true;
  button.title = `${name} planes aren't open to the airline yet.`;
  buttons.append(button);
  row.append(buttons);
  return row;
}
