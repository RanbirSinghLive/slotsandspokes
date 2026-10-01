import type { SimState } from '../sim/state';
import { yearReport, type RouteResult } from '../sim/yearReport';
import { feedbackUrl } from './feedback';
import { money } from './format';

/**
 * The year one report as a card (sim/yearReport.ts reads it off the
 * state): shown when the airline reaches day 365, inside the game-over
 * screen, and on demand from the Game screen ("Report so far"). It's the
 * natural moment to ask for feedback, so the form is one click away, and
 * it ends with a line to share.
 */

function stat(label: string, value: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'report-stat';
  const v = document.createElement('span');
  v.className = 'report-stat-value';
  v.textContent = value;
  const l = document.createElement('span');
  l.className = 'report-stat-label';
  l.textContent = label;
  el.append(v, l);
  return el;
}

function routeLine(label: string, route: RouteResult, good: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = `report-route ${good ? 'is-good' : 'is-bad'}`;
  el.textContent = `${label} · ${route.market} · ${route.margin >= 0 ? '+' : '−'}${money(Math.abs(route.margin))} · ${route.passengers.toLocaleString()} pax`;
  return el;
}

const percent = (share: number | null) => (share === null ? '—' : `${Math.round(share * 100)}%`);

/** The report's body: the numbers, the best and worst routes, and the line to share. */
export function buildReportBody(state: SimState): HTMLElement {
  const report = yearReport(state);
  const body = document.createElement('div');
  body.className = 'report-body';

  const headline = document.createElement('div');
  headline.className = 'report-headline';
  const cash = document.createElement('span');
  cash.className = 'report-cash';
  cash.textContent = money(report.cash);
  const gained = document.createElement('span');
  gained.className = report.gained >= 0 ? 'report-gained is-good' : 'report-gained is-bad';
  gained.textContent = `${report.gained >= 0 ? '+' : '−'}${money(Math.abs(report.gained))} since day 0`;
  headline.append(cash, gained);
  body.append(headline);
  if (report.standing) {
    const standing = document.createElement('div');
    standing.className = 'report-standing';
    standing.textContent = `${report.home} · ${report.standing[0].toUpperCase()}${report.standing.slice(1)} · ${report.milestones} milestones`;
    body.append(standing);
  }

  const grid = document.createElement('div');
  grid.className = 'report-grid';
  grid.append(
    stat('planes', String(report.planes)),
    stat('routes', String(report.routes)),
    stat('flights/day', String(report.flightsPerDay)),
    stat('passengers', report.passengers.toLocaleString()),
    stat('on time', percent(report.onTime)),
    stat('completed', percent(report.completion)),
    stat('NPS', report.nps),
    stat('days', String(report.days)),
  );
  body.append(grid);
  if (report.fleet.length > 0) {
    const fleet = document.createElement('div');
    fleet.className = 'report-fleet';
    fleet.textContent = report.fleet.map((f) => `${f.count} ${f.name}`).join(' · ');
    body.append(fleet);
  }
  if (report.best) body.append(routeLine('Best', report.best, report.best.margin >= 0));
  if (report.worst) body.append(routeLine('Worst', report.worst, report.worst.margin >= 0));

  const share = document.createElement('div');
  share.className = 'report-share';
  const text = document.createElement('span');
  text.textContent = report.shareLine;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(report.shareLine).then(() => {
      copy.textContent = 'Copied';
    });
  });
  share.append(text, copy);
  body.append(share);
  return body;
}

/** The feedback form, pre-filled, as a link that opens beside the game. */
export function feedbackLink(state: SimState, label = 'Tell us how it went'): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'report-feedback';
  link.href = feedbackUrl(state);
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = label;
  return link;
}

let openCard: HTMLElement | null = null;

/** Show the report over everything. `onClose` runs when it's put away (the game carries on). */
export function showYearReport(state: SimState, title: string, onClose: () => void = () => {}): void {
  openCard?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay report-overlay';
  const box = document.createElement('div');
  box.className = 'modal-box report-card';
  box.setAttribute('role', 'dialog');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Keep flying';
  close.addEventListener('click', () => {
    overlay.remove();
    openCard = null;
    onClose();
  });
  actions.append(feedbackLink(state), close);
  box.append(heading, buildReportBody(state), actions);
  overlay.append(box);
  document.body.append(overlay);
  openCard = overlay;
}

export function isYearReportOpen(): boolean {
  return openCard !== null;
}
