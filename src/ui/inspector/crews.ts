import { dayIndex } from '../../sim/clock';
import { crewPlan, type ClassPlan, type PlaneEntry } from '../../sim/crewPlan';
import { CREWS_PER_NEW_PLANE, hireFee, hireLeadDays, retrainDays, retrainFee, standbyCost } from '../../sim/crews';
import type { SimState } from '../../sim/state';
import { money } from '../format';
import { linkToMap } from '../mapLink';
import { planeIconElement } from '../planeIcons';
import * as ops from '../routeActions';
import { select } from '../selection';
import { heading, line } from './dom';

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

function actionButton(label: string, disabled: boolean, act: () => void, changed: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-plan-hub crew-action';
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener('click', () => {
    act();
    changed();
  });
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
  if (plan.length === 0) {
    root.append(line('No crew bases yet · a base opens where you base a plane'));
    return root;
  }

  const classes = plan.flatMap((base) => base.classes);
  const crews = classes.reduce((sum, c) => sum + c.crews, 0);
  const joining = classes.reduce((sum, c) => sum + c.joining.reduce((s, j) => s + j.count, 0), 0);
  const reserveCost = plan.reduce(
    (sum, base) => sum + base.classes.reduce((s, c) => s + Math.max(0, c.crews - c.ideal) * standbyCost(c.classCode), 0),
    0,
  );
  root.append(
    line(
      `${crews} crews · ${plan.length} base${plan.length === 1 ? '' : 's'}` +
        (joining > 0 ? ` · +${joining} joining` : '') +
        (reserveCost > 0 ? ` · reserve ${money(reserveCost)}/day` : '') +
        ` · hire ${hireLeadDays(state)}d · conversion ${retrainDays(state)}d`,
    ),
  );

  root.append(...horizon(plan, today));
  root.append(...toDo(state, plan, today, changed));
  root.append(...roster(state, plan, today, changed));
  return root;
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
  const fee = hireFee(c.classCode) * entry.short;
  buttons.append(actionButton(`Hire ${entry.short} · ${money(fee)}`, state.cash < fee, () => ops.hireCrewsAt(state, iata, c.classCode, entry.short), changed));
  // Reserve of another type at this base, converted: slower, cheaper.
  const donor = siblings.filter((s) => s.classCode !== c.classCode && s.crews - s.ideal > 0).sort((x, y) => y.crews - y.ideal - (x.crews - x.ideal))[0];
  if (donor) {
    const n = Math.min(entry.short, donor.crews - donor.ideal);
    const ready = today + retrainDays(state);
    buttons.append(
      actionButton(
        `Convert ${n} from ${donor.name} · ${money(retrainFee(c.classCode) * n)} · ready day ${ready}${ready > entry.day ? ' (late)' : ''}`,
        false,
        () => ops.retrainCrewsAt(state, iata, donor.classCode, c.classCode, n),
        changed,
      ),
    );
  }
  row.append(buttons);
  return row;
}

/** Each base's roster, type by type. */
function roster(state: SimState, plan: ReturnType<typeof crewPlan>, today: number, changed: () => void): HTMLElement[] {
  const nodes: HTMLElement[] = [heading('Roster', 'Crews by type rating at each base. The bar is crews on hand (solid) and joining (hatched); the marks are the legal minimum (red), the comfortable number for 8-hour shifts (white), and what the planes on their way will need (amber). Short grounds planes; tight flies late legs tired; reserve crews stand by at a daily cost.')];
  for (const base of plan) {
    const card = document.createElement('div');
    card.className = 'crew-base';
    const name = linkToMap(document.createElement('button'), { kind: 'airport', iata: base.iata });
    name.type = 'button';
    name.className = 'inspector-link crew-base-name';
    name.textContent = `${base.iata} · crew base`;
    name.addEventListener('click', () => select({ kind: 'airport', iata: base.iata }));
    card.append(name);
    for (const c of base.classes) card.append(classRow(state, base.iata, c, base.classes, today, changed));
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

  const buttons = document.createElement('div');
  buttons.className = 'crew-buttons';
  const open = ops.crewReadout(state, iata)?.classes.find((r) => r.classCode === c.classCode)?.open ?? false;
  buttons.append(actionButton(`Hire 1 · ${money(hireFee(c.classCode))}`, !open || state.cash < hireFee(c.classCode), () => ops.hireCrewsAt(state, iata, c.classCode, 1), changed));
  const donor = siblings.filter((s) => s.classCode !== c.classCode && s.crews - s.ideal > 0).sort((x, y) => y.crews - y.ideal - (x.crews - x.ideal))[0];
  if (donor && open) {
    buttons.append(actionButton(`Convert 1 from ${donor.name} · ${money(retrainFee(c.classCode))}`, state.cash < retrainFee(c.classCode), () => ops.retrainCrewsAt(state, iata, donor.classCode, c.classCode, 1), changed));
  }
  if (c.crews > c.ideal) buttons.append(actionButton('Release 1', false, () => ops.releaseCrewsAt(state, iata, c.classCode, 1), changed));
  row.append(buttons);
  return row;
}
