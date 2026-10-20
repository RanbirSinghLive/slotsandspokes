import { classByCode } from '../sim/aircraftClasses';
import { closureLine } from '../sim/airspace';
import { aogFor, daysUntilReturn, expediteCost, expediteRepair } from '../sim/aog';
import { dayIndex } from '../sim/clock';
import { contractsOf } from '../sim/contracts';
import { hireFee, hireLeadDays } from '../sim/crews';
import { crewPlan } from '../sim/crewPlan';
import { HEAVY_WINDOW_DAYS } from '../sim/mxChecks';
import { mandatesOf } from '../sim/mandates';
import { LANE_ORDER, PIPELINE_DAYS, pipelineItems, type PipelineItem, type PipelineLane } from '../sim/pipeline';
import type { SimState } from '../sim/state';
import { cashAfterRows, showConfirm } from './confirmModal';
import { money } from './format';
import { glyph, type GlyphName } from './glyphs';
import { confirmDBooking, confirmHeavyBooking } from './checkBooking';
import { linkToMap } from './mapLink';
import { wireDialogTips } from './mapTools';
import { planeIconElement } from './planeIcons';
import * as ops from './routeActions';
import { select, type Selection } from './selection';

/**
 * The pipeline (index.html's #pipeline, bottom left of the map): the next
 * PIPELINE_DAYS of everything dated coming at the airline, from
 * sim/pipeline.ts, on one axis with a lane per department. Each mark's tip
 * says what it is and carries the quick edits its own screen has (induct
 * or push a C check, book a D check, hire the crews a delivery is short,
 * expedite an AOG), and a link to that screen.
 *
 * On a desktop the tip shows on hover and stays while the pointer is on it;
 * a click pins it. On a touch screen a tap opens it and a second tap, or a
 * tap elsewhere, puts it away. The panel folds to its head; on a phone it
 * opens from a button in the map tools instead (style.css).
 */

const panel = document.querySelector<HTMLElement>('#pipeline')!;
const toggle = document.querySelector<HTMLButtonElement>('#pipeline-toggle');

const FOLD_KEY = 'slotsandspokes-pipeline-folded';
/** A mark's width in pixels, guessed from its text (and a glyph), so marks that would overlap take a row of their own. */
const markWidthPx = (item: PipelineItem, state: SimState): number =>
  markContent(item, state).reduce((width, part) => width + (typeof part === 'string' ? part.length * 6.2 : 13), 12);
const ROW_PX = 18;
const HIDE_DELAY_MS = 250;

const LANES: Record<PipelineLane, { glyph: GlyphName; name: string }> = {
  mtc: { glyph: 'wrench', name: 'Mtc · checks, hangar, AOG' },
  fleet: { glyph: 'plane', name: 'Fleet · deliveries, ferries, returns' },
  crew: { glyph: 'people', name: 'Crews · joining' },
  commercial: { glyph: 'contract', name: 'Sales · contracts, tenders, mandates' },
  network: { glyph: 'globe', name: 'Network · closures, events, stations' },
};

const isTouch = (): boolean => window.matchMedia('(pointer: coarse)').matches;

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

let folded = readFolded();
let liveState: SimState | null = null;
let onChanged: () => void = () => {};
let onOpen: () => void = () => {};
let items: PipelineItem[] = [];
let signature: string | null = null;
let lastMinute = -1;
let lastPollMs = 0;
/** The item whose tip is showing, by key, and whether a click pinned it. */
let openKey: string | null = null;
let pinned = false;
let hideTimer = 0;

function setFolded(next: boolean): void {
  folded = next;
  try {
    localStorage.setItem(FOLD_KEY, next ? '1' : '0');
  } catch {
    // A private window: the fold just isn't remembered.
  }
  closeTip();
  signature = null;
}

/** Unfold the pipeline (and on a phone, open it): for the links on the Crews and Mtc screens. */
export function openPipeline(): void {
  onOpen();
  document.documentElement.toggleAttribute('data-pipeline', true);
  toggle?.setAttribute('aria-expanded', 'true');
  toggle?.classList.add('active');
  if (folded) setFolded(false);
  signature = null;
}

/** Days from today, the way the board says them. */
function inDays(day: number, today: number): string {
  const d = day - today;
  return d <= 0 ? 'today' : `in ${d}d`;
}

function shortTail(tail: string | undefined): string {
  return (tail ?? '').slice(-4);
}

/** What the mark says on the axis: a glyph and a few characters. */
function markContent(item: PipelineItem, state: SimState): (string | Node)[] {
  const plane = () => (item.classCode ? planeIconElement(item.classCode) : glyph('plane'));
  switch (item.kind) {
    case 'C':
      return [`C ${shortTail(item.tail)}`];
    case 'D':
      return [`D ${shortTail(item.tail)}`];
    case 'hangar':
      return [glyph('hangar'), shortTail(item.tail)];
    case 'aog': {
      const event = aogFor(state, item.tail ?? '');
      return [event?.refitTo ? glyph('seat') : 'AOG', ` ${shortTail(item.tail)}`];
    }
    case 'eis':
      return [plane(), item.short ? `−${item.short}` : 'EIS'];
    case 'rebase':
      return [plane(), `→${item.iata}`];
    case 'return':
      return [plane(), '↩'];
    case 'crews':
      return [glyph('people'), `+${item.count}`];
    case 'contractEnd':
    case 'contractOffer':
    case 'tender':
    case 'takeover':
      return [glyph('contract'), item.iata ?? ''];
    case 'mandate':
      return [glyph('boarding'), item.iata ?? ''];
    case 'closure':
      return [glyph('alert')];
    case 'event':
      return [glyph('event'), item.iata ?? ''];
    case 'station':
      return [glyph('hub'), item.iata ?? ''];
  }
}

/** Where the mark points on the map while hovered, and what its tip's link opens. */
function targets(item: PipelineItem): { map: Selection | null; open: Selection | null; openLabel: string } {
  const plane: Selection | null = item.tail ? { kind: 'aircraft', tail: item.tail } : null;
  const airport: Selection | null = item.iata ? { kind: 'airport', iata: item.iata } : null;
  switch (item.kind) {
    case 'C':
    case 'D':
      return { map: plane, open: { kind: 'maintenance' }, openLabel: 'Mtc' };
    case 'hangar':
    case 'aog':
    case 'rebase':
    case 'return':
      return { map: plane, open: plane, openLabel: item.tail ?? 'Plane' };
    case 'eis':
    case 'crews':
      return { map: airport, open: { kind: 'crews' }, openLabel: 'Crews' };
    case 'contractEnd':
    case 'contractOffer':
    case 'tender':
    case 'takeover':
      return { map: airport, open: { kind: 'contracts' }, openLabel: 'Contracts' };
    case 'mandate':
      return { map: airport, open: { kind: 'fleet' }, openLabel: 'Fleet' };
    case 'closure':
      return { map: null, open: null, openLabel: '' };
    case 'event':
    case 'station':
      return { map: airport, open: airport, openLabel: item.iata ?? 'Airport' };
  }
}

function tipButton(label: string | Node, tip: string | null, ready: boolean, run: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pipeline-action';
  button.append(label);
  button.disabled = !ready;
  if (tip) button.dataset.tip = tip;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    run();
  });
  return button;
}

function changedNow(): void {
  signature = null;
  onChanged();
}

/** Hire a delivery's shortfall at its base, as the Crews screen's To do row does. */
function hireAction(state: SimState, item: PipelineItem): HTMLButtonElement | null {
  const short = item.short ?? 0;
  if (short === 0 || !item.iata || !item.classCode) return null;
  const today = dayIndex(state);
  const lead = hireLeadDays(state);
  const seats = ops.crewReadout(state, item.iata)?.training.pilot.free ?? 0;
  const count = Math.min(short, seats);
  const fee = hireFee(item.classCode) * count;
  const name = classByCode(item.classCode)?.name ?? item.classCode;
  if (count === 0) return tipButton('hire', 'No free training seats at this base', false, () => undefined);
  const late = today + lead - item.day;
  return tipButton(`hire ${count} · ${money(fee)}`, `Hire ${count} ${name} crew${count === 1 ? '' : 's'} · join day ${today + lead}${late > 0 ? ` · ${late}d after EIS` : ''}`, state.cash >= fee, () =>
    showConfirm({
      title: `Hire ${count} ${name} crew${count === 1 ? '' : 's'} · ${item.iata}`,
      rows: [{ label: 'Fee now', value: money(fee) }, { label: 'Join', value: `day ${today + lead} (${lead}d)` }, ...cashAfterRows(state, fee)],
      facts: [`Short ${short} at EIS day ${item.day}${late > 0 ? `: they join ${late}d late` : ''}.`, ...(count < short ? [`Training seats cap this hire at ${count}.`] : [])],
      confirmLabel: `Hire · ${money(fee)}`,
      run: () => {
        ops.hireCrewsAt(state, item.iata!, item.classCode!, count);
        changedNow();
      },
    }),
  );
}

/** The tip's lines and quick edits for one item. */
function tipBody(state: SimState, item: PipelineItem): { title: string; lines: string[]; actions: HTMLElement[] } {
  const today = dayIndex(state);
  const typeName = item.classCode ? (classByCode(item.classCode)?.name ?? item.classCode) : '';
  const readout = item.tail ? ops.heavyCheckReadouts(state).find((plane) => plane.tail === item.tail) : undefined;
  switch (item.kind) {
    case 'C': {
      if (!readout) break;
      const due = readout.dueIn > 0 ? `due in ${readout.dueIn}d` : readout.dueIn === 0 ? 'due today' : `${-readout.dueIn}d overdue`;
      const lines = [`${due} · days, hours or cycles, whichever first`];
      lines.push(readout.booked ? 'Booked · in tomorrow' : readout.open ? `In its ${HEAVY_WINDOW_DAYS}d booking window` : `Booking opens ${HEAVY_WINDOW_DAYS}d before due`);
      if (readout.shiftDays > 0) lines.push(`Pushed +${readout.shiftDays}/${readout.toleranceCap}d${readout.toleranceWear > 0 ? ` · wearing +${readout.toleranceWear.toFixed(1)}y` : ''}`);
      if (!readout.dInCheck && readout.dDueIn <= readout.dueIn) lines.push(`D check due first (${readout.dDueIn > 0 ? `in ${readout.dDueIn}d` : 'now'}) · it also does the C`);
      const actions: HTMLElement[] = [];
      if (readout.booked) {
        actions.push(tipButton('booked ✕', 'Cancel the booking', true, () => {
          ops.cancelBookedCheck(state, readout.tail);
          changedNow();
        }));
      } else {
        const induct = tipButton(glyph('wrench'), readout.canBook ? 'Induct now · books it for tomorrow' : (readout.bookBlocker ?? `Opens ${HEAVY_WINDOW_DAYS}d before due`), readout.canBook, () => confirmHeavyBooking(state, readout, changedNow));
        induct.append(' induct');
        actions.push(induct);
      }
      for (const step of readout.tolerance) {
        actions.push(tipButton(`+${step.days}d · ${money(step.cost)}`, step.blocker ?? `Push the C check ${step.days}d later for ${money(step.cost)}`, step.blocker === null, () => {
          ops.toleranceHeavyCheck(state, readout.tail, step.days);
          changedNow();
        }));
      }
      return { title: `C check · ${readout.tail} · ${readout.base}`, lines, actions };
    }
    case 'D': {
      if (!readout) break;
      const due = readout.dDueIn > 0 ? `due in ${readout.dDueIn}d` : `${-readout.dDueIn}d overdue`;
      const actions: HTMLElement[] = [];
      if (readout.dBooked) {
        actions.push(tipButton('booked ✕', 'Cancel the booking', true, () => {
          ops.cancelBookedDCheck(state, readout.tail);
          changedNow();
        }));
      } else {
        const book = tipButton(glyph('wrench'), readout.dCanBook ? 'Book the D check · also does the C check' : (readout.dBookBlocker ?? 'Opens 60d before due'), readout.dCanBook, () => confirmDBooking(state, readout, changedNow));
        book.append(' book D');
        actions.push(book);
      }
      return { title: `D check · ${readout.tail} · ${readout.base}`, lines: [`${due} · the overhaul, also clears C and A`, readout.dBooked ? 'Booked · in tomorrow' : readout.dOpen ? 'Booking open' : 'Booking not open yet'], actions };
    }
    case 'hangar':
    case 'aog': {
      const event = aogFor(state, item.tail ?? '');
      if (!event) break;
      const back = daysUntilReturn(state, event);
      const what = event.check ? `${event.checkKind ?? 'C'} check` : event.refitTo ? 'Refit' : `AOG · ${event.fault}`;
      const lines = [`back in ${back}d · ${event.base}`];
      if (event.uncoveredRoutes.length > 0) lines.push(`CNX ${event.uncoveredRoutes.join(', ')}`);
      const actions: HTMLElement[] = [];
      const cost = expediteCost(state, event.tail);
      if (cost !== null) {
        actions.push(tipButton(`expedite 1d · ${money(cost)}`, 'Pay to bring it back a day sooner', state.cash >= cost, () => {
          expediteRepair(state, event.tail);
          changedNow();
        }));
      }
      return { title: `${what} · ${event.tail}`, lines, actions };
    }
    case 'eis': {
      const lines = [`${typeName} · ${item.iata} · ${inDays(item.day, today)}`];
      if (item.short) {
        const entry = crewPlan(state).find((base) => base.iata === item.iata)?.classes.find((c) => c.classCode === item.classCode)?.entries.find((e) => e.day === item.day);
        lines.push(`Short ${item.short} crew${item.short === 1 ? '' : 's'} at EIS${entry ? (entry.hireBy >= today ? ` · hire by day ${entry.hireBy}` : ' · too late for a hire to land in time') : ''}`);
      } else {
        lines.push('Crewed');
      }
      const hire = hireAction(state, item);
      return { title: `Delivery · day ${item.day}`, lines, actions: hire ? [hire] : [] };
    }
    case 'rebase': {
      const aircraft = state.aircraft.find((a) => a.tail === item.tail);
      return { title: `Ferry · ${item.tail}`, lines: [`${aircraft?.rebase?.from ?? ''} → ${item.iata} · arrives ${inDays(item.day, today)}`, 'Flies nothing until it arrives'], actions: [] };
    }
    case 'return': {
      const aircraft = state.aircraft.find((a) => a.tail === item.tail);
      const seasonal = aircraft?.returningOnDay === undefined;
      return { title: `Back to lessor · ${item.tail}`, lines: [`${typeName} · ${item.iata} · ${inDays(item.day, today)}`, seasonal ? 'Seasonal lease ends' : 'Its crews are free after it goes'], actions: [] };
    }
    case 'crews': {
      const batch = crewPlan(state).find((base) => base.iata === item.iata)?.classes.find((c) => c.classCode === item.classCode)?.joining.find((j) => j.day === item.day && j.count === item.count);
      return { title: `Crews joining · ${item.iata}`, lines: [`+${item.count} ${typeName} · ${inDays(item.day, today)}`, batch?.kind === 'conversion' ? `Converting from ${batch.from ? (classByCode(batch.from)?.name ?? batch.from) : 'another type'}` : 'New hire, in training'], actions: [] };
    }
    case 'contractEnd':
    case 'contractOffer':
    case 'tender':
    case 'takeover': {
      const contract = contractsOf(state).find((c) => c.id === item.id);
      if (!contract) break;
      const market = `${contract.a}–${contract.b}`;
      const when = inDays(item.day, today);
      if (item.kind === 'contractEnd') return { title: `Contract · ${market}`, lines: [`Term ends ${when}`, `${money(contract.paymentPerDay)}/day · renewal in Contracts`], actions: [] };
      if (item.kind === 'takeover') return { title: `Takeover · ${market}`, lines: [`${contract.takeoverBy ?? 'A rival'} takes it ${when}`, 'Counter in Contracts'], actions: [] };
      if (item.kind === 'tender') return { title: `Tender · ${market}`, lines: [`Decided ${when}`, `${money(contract.paymentPerDay)}/day`], actions: [] };
      return { title: `${contract.awardedDay !== undefined ? 'Awarded' : 'Offer'} · ${market}`, lines: [`Lapses ${when} unless flown`, `${money(contract.paymentPerDay)}/day · ${contract.termDays}d term`], actions: [] };
    }
    case 'mandate': {
      const mandate = mandatesOf(state).find((m) => m.id === item.id);
      if (!mandate) break;
      const market = `${mandate.origin}–${mandate.dest}`;
      if (mandate.status === 'offered') return { title: `Mandate offer · ${market}`, lines: [`Lapses ${inDays(mandate.startDay, today)} unless accepted`, `${money(mandate.premium)} premium · ${money(mandate.penalty)} penalty`], actions: [] };
      return { title: `Mandate · ${market}`, lines: [mandate.startDay > today ? `Starts ${inDays(mandate.startDay, today)}` : `Running · ends ${inDays(mandate.endDay, today)}`, `${mandate.flown} flown · ${mandate.failed} failed`], actions: [] };
    }
    case 'closure': {
      const closure = (state.airspaceClosures ?? []).find((c) => c.id === item.id);
      if (!closure) break;
      return { title: `Airspace · ${closure.name}`, lines: [closureLine(closure, today), `Open again day ${closure.endDay}`], actions: [] };
    }
    case 'event': {
      const event = (state.demandEvents ?? []).find((e) => e.iata === item.iata && e.startDay === item.day);
      if (!event) break;
      return { title: `${event.name} · ${event.iata}`, lines: [`+${Math.round(event.lift * 100)}% demand · ${event.startDay > today ? `starts ${inDays(event.startDay, today)}` : 'running'} · ends day ${event.endDay}`], actions: [] };
    }
    case 'station': {
      const upgrade = state.stationUpgrades?.[item.iata ?? ''];
      return { title: `Station · ${item.iata}`, lines: [`${upgrade?.to === 'hub' ? 'Hub' : 'Own'} handling ready ${inDays(item.day, today)}`], actions: [] };
    }
  }
  return { title: item.key, lines: [], actions: [] };
}

const tipEl = document.createElement('div');
tipEl.className = 'pipeline-tip';
tipEl.hidden = true;
tipEl.addEventListener('mouseenter', () => window.clearTimeout(hideTimer));
tipEl.addEventListener('mouseleave', () => {
  if (!pinned) scheduleHide();
});

function closeTip(): void {
  window.clearTimeout(hideTimer);
  openKey = null;
  pinned = false;
  tipEl.hidden = true;
  for (const mark of panel.querySelectorAll('.pipeline-mark.is-open')) mark.classList.remove('is-open');
}

function scheduleHide(): void {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(closeTip, HIDE_DELAY_MS);
}

/** Fill and place the tip over `mark` for `item`. */
function showTip(item: PipelineItem, mark: HTMLElement): void {
  const state = liveState;
  if (!state) return;
  window.clearTimeout(hideTimer);
  openKey = item.key;
  for (const other of panel.querySelectorAll('.pipeline-mark.is-open')) other.classList.remove('is-open');
  mark.classList.add('is-open');
  const body = tipBody(state, item);
  const head = document.createElement('div');
  head.className = 'pipeline-tip-title';
  head.textContent = body.title;
  const nodes: HTMLElement[] = [head];
  for (const text of body.lines) {
    const line = document.createElement('div');
    line.className = 'pipeline-tip-line';
    line.textContent = text;
    nodes.push(line);
  }
  const target = targets(item);
  const row = document.createElement('div');
  row.className = 'pipeline-tip-actions';
  row.append(...body.actions);
  if (target.open) {
    const open = target.open;
    const link = tipButton(`${target.openLabel} ›`, null, true, () => {
      closeTip();
      select(open);
    });
    link.classList.add('is-link');
    row.append(link);
  }
  if (row.childElementCount > 0) nodes.push(row);
  tipEl.replaceChildren(...nodes);
  tipEl.hidden = false;
  // Above the panel, starting at the mark, kept inside the panel's width.
  const panelBox = panel.getBoundingClientRect();
  const markBox = mark.getBoundingClientRect();
  tipEl.style.left = '0px';
  const width = tipEl.getBoundingClientRect().width;
  tipEl.style.left = `${Math.max(0, Math.min(markBox.left - panelBox.left, panelBox.width - width))}px`;
}

function markFor(state: SimState, item: PipelineItem, today: number, row: number): HTMLElement {
  const mark = document.createElement('button');
  mark.type = 'button';
  const span = item.endDay !== undefined;
  mark.className = `pipeline-mark tone-${item.tone}${span ? ' is-span' : ''}${item.booked ? ' is-booked' : ''}${item.key === openKey ? ' is-open' : ''}`;
  const at = ((item.day - today) / PIPELINE_DAYS) * 100;
  mark.style.left = `${at}%`;
  mark.style.top = `${row * ROW_PX}px`;
  if (span) {
    const end = Math.min(PIPELINE_DAYS, item.endDay! - today);
    mark.style.minWidth = `${Math.max(0, ((end - (item.day - today)) / PIPELINE_DAYS) * 100)}%`;
  }
  mark.dataset.key = item.key;
  mark.append(...markContent(item, state));
  mark.setAttribute('aria-label', tipBody(state, item).title);
  const map = targets(item).map;
  if (map) linkToMap(mark, map);
  mark.addEventListener('mouseenter', () => {
    if (isTouch() || pinned) return;
    showTip(item, mark);
  });
  mark.addEventListener('mouseleave', () => {
    if (isTouch() || pinned) return;
    scheduleHide();
  });
  // Keyboard focus shows the tip; a tap focuses before its click, which does the showing there.
  mark.addEventListener('focus', () => {
    if (!pinned && !isTouch()) showTip(item, mark);
  });
  mark.addEventListener('click', (event) => {
    event.stopPropagation();
    if (openKey === item.key && (pinned || isTouch())) {
      closeTip();
      return;
    }
    showTip(item, mark);
    pinned = true;
  });
  return mark;
}

function build(state: SimState): void {
  const today = dayIndex(state);
  const bad = items.filter((item) => item.tone === 'bad').length;

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'pipeline-head';
  head.setAttribute('aria-expanded', String(!folded));
  head.dataset.tip = folded ? 'Open the pipeline · the next 30 days' : 'Fold the pipeline';
  head.append(glyph('timer'), ` Pipeline · ${PIPELINE_DAYS}d · ${items.length}`);
  if (bad > 0) {
    const flag = document.createElement('span');
    flag.className = 'pipeline-bad';
    flag.textContent = ` ● ${bad}`;
    head.append(flag);
  }
  const chevron = document.createElement('span');
  chevron.className = 'pipeline-chevron';
  chevron.textContent = folded ? '▴' : '▾';
  head.append(chevron);
  head.addEventListener('click', () => setFolded(!folded));

  const nodes: HTMLElement[] = [head];
  if (!folded) {
    const body = document.createElement('div');
    body.className = 'pipeline-body';
    const ticks = document.createElement('div');
    ticks.className = 'pipeline-ticks';
    ticks.append(document.createElement('span'));
    const tickTrack = document.createElement('div');
    tickTrack.className = 'pipeline-track';
    for (const d of [0, 10, 20, 30]) {
      const tick = document.createElement('span');
      tick.className = 'pipeline-tick';
      tick.style.left = `${(d / PIPELINE_DAYS) * 100}%`;
      tick.textContent = d === 0 ? 'today' : `${d}d`;
      tickTrack.append(tick);
    }
    ticks.append(tickTrack);
    body.append(ticks);

    // The track's width: the panel's, less the lane icon and the room kept for a mark on day 30.
    const trackPx = Math.max(160, (panel.clientWidth || 400) - 20 - 18 - 40);
    const lanes = LANE_ORDER.filter((lane) => items.some((item) => item.lane === lane));
    if (lanes.length === 0) {
      const none = document.createElement('div');
      none.className = 'pipeline-none';
      none.textContent = `Nothing dated in ${PIPELINE_DAYS}d`;
      body.append(none);
    }
    for (const lane of lanes) {
      const laneEl = document.createElement('div');
      laneEl.className = `pipeline-lane lane-${lane}`;
      laneEl.append(glyph(LANES[lane].glyph, LANES[lane].name, 'pipeline-lane-icon'));
      const track = document.createElement('div');
      track.className = 'pipeline-track';
      // Rows: a mark takes the first row whose last mark ends left of it.
      const rowEnds: number[] = [];
      for (const item of items.filter((i) => i.lane === lane)) {
        const at = ((item.day - today) / PIPELINE_DAYS) * 100;
        const labelEnd = at + ((markWidthPx(item, state) + 4) / trackPx) * 100;
        const end = item.endDay !== undefined ? Math.max(labelEnd, (Math.min(PIPELINE_DAYS, item.endDay - today) / PIPELINE_DAYS) * 100) : labelEnd;
        let row = rowEnds.findIndex((rowEnd) => at >= rowEnd);
        if (row === -1) row = rowEnds.length;
        rowEnds[row] = end;
        track.append(markFor(state, item, today, row));
      }
      track.style.height = `${rowEnds.length * ROW_PX}px`;
      laneEl.append(track);
      body.append(laneEl);
    }
    nodes.push(body);
  }
  tipEl.hidden = true;
  nodes.push(tipEl);
  panel.replaceChildren(...nodes);
  panel.classList.toggle('is-folded', folded);
  toggle?.classList.toggle('has-bad', bad > 0);
  // A narrow map stacks the lens key above the panel (style.css).
  document.documentElement.style.setProperty('--pipeline-height', `${panel.offsetHeight}px`);

  // Keep a tip open through a rebuild, over its mark's new self.
  if (openKey && !folded) {
    const item = items.find((i) => i.key === openKey);
    const mark = [...panel.querySelectorAll<HTMLElement>('.pipeline-mark')].find((el) => el.dataset.key === openKey);
    if (item && mark) showTip(item, mark);
    else closeTip();
  }
}

/**
 * Wire the panel once. `changed` is what an action calls after it: the
 * inspector rebuilds (the map redraws every frame anyway). `showMap` is
 * for the screens' links on a phone, where the panel covers the map.
 */
export function setupPipeline(changed: () => void, showMap: () => void): void {
  onChanged = changed;
  onOpen = showMap;
  wireDialogTips(panel);
  toggle?.addEventListener('click', () => {
    const open = !document.documentElement.hasAttribute('data-pipeline');
    document.documentElement.toggleAttribute('data-pipeline', open);
    toggle.setAttribute('aria-expanded', String(open));
    // On a phone the pipeline opens unfolded (its button is the fold), where the lens rows would open.
    if (open && folded) setFolded(false);
    if (open) {
      document.documentElement.removeAttribute('data-tools');
      document.querySelector('#map-tools-toggle')?.classList.remove('active');
    }
    toggle.classList.toggle('active', open);
    if (!open) closeTip();
  });
  // A tap or click anywhere else puts a pinned tip away.
  document.addEventListener('click', (event) => {
    if (openKey && event.target instanceof Node && !panel.contains(event.target) && !document.querySelector('.modal-overlay')?.contains(event.target)) closeTip();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openKey) closeTip();
  });
}

/**
 * Refresh the panel. Called every frame: the read-out is worked out again
 * only as sim time moves (at most a few times a second), and the DOM only
 * rebuilt when something on it changed.
 */
export function updatePipeline(state: SimState, hidden: boolean): void {
  liveState = state;
  panel.hidden = hidden;
  if (hidden) return;
  const now = performance.now();
  if (signature !== null && (state.simMinute === lastMinute || now - lastPollMs < 250)) return;
  lastMinute = state.simMinute;
  lastPollMs = now;
  items = pipelineItems(state);
  const next = `${dayIndex(state)}|${folded}|${JSON.stringify(items)}`;
  if (next === signature) return;
  signature = next;
  build(state);
}
