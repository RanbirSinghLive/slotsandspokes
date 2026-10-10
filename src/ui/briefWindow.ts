import { briefSettings, buildDailyBrief, buildSeasonReview, dailyBriefDue, markSeasonReviewShown, seasonReviewDue, setBriefSetting, type BriefSettings, type DailyBrief, type SeasonReview } from '../sim/briefs';
import type { SimState } from '../sim/state';
import { select } from './selection';
import { shortMoney } from './format';

/**
 * The daily operations brief and the half-yearly season review share one
 * window that floats over the map, so the inspector stays usable behind it
 * (open a route from the review, change it, glance back). Minimizing folds
 * it into an icon tab in a strip under the map; on a phone the window docks
 * to the bottom edge instead of dragging. What each brief says is decided in
 * sim/briefs.ts; this file only draws it. Window position and tabs are
 * screen state, not saved.
 */

type BriefId = 'daily' | 'season';

const windowEl = document.querySelector<HTMLDivElement>('#brief-window')!;
const titleEl = document.querySelector<HTMLSpanElement>('#brief-title')!;
const bodyEl = document.querySelector<HTMLDivElement>('#brief-body')!;
const minimizeEl = document.querySelector<HTMLButtonElement>('#brief-minimize')!;
const headerEl = document.querySelector<HTMLDivElement>('#brief-header')!;
const tabsEl = document.querySelector<HTMLDivElement>('#brief-tabs')!;

const ICONS: Record<BriefId, string> = { daily: '☀', season: '📅' };
const NAMES: Record<BriefId, string> = { daily: 'Daily brief', season: 'Season review' };
const CHIP_ICONS: Record<string, string> = { weather: '🌩', closure: '⛔', aog: '🔧', hold: '⏸', crew: '👥', event: '★', late: '✕' };

type Slot = { exists: boolean; unread: boolean; build: () => HTMLElement };
const slots: Record<BriefId, Slot> = {
  daily: { exists: false, unread: false, build: () => document.createElement('div') },
  season: { exists: false, unread: false, build: () => document.createElement('div') },
};
let openId: BriefId | null = null;
/** The reply to the tick loop: true when a season review just opened and the clock should stop. */
let pauseRequested = false;
let quietTimer: number | undefined;
let stateRef: SimState | null = null;

const coarse = (): boolean => window.matchMedia('(pointer: coarse)').matches;

function renderTabs(): void {
  const tabs: HTMLElement[] = [];
  for (const id of ['daily', 'season'] as BriefId[]) {
    const slot = slots[id];
    if (!slot.exists) continue;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'brief-tab';
    tab.classList.toggle('is-open', openId === id);
    tab.classList.toggle('is-unread', slot.unread);
    tab.title = NAMES[id];
    tab.setAttribute('aria-label', NAMES[id]);
    tab.textContent = ICONS[id];
    tab.addEventListener('click', () => (openId === id ? minimize() : open(id)));
    tabs.push(tab);
  }
  tabsEl.replaceChildren(...tabs);
  tabsEl.hidden = tabs.length === 0;
}

function open(id: BriefId): void {
  window.clearTimeout(quietTimer);
  openId = id;
  slots[id].unread = false;
  titleEl.textContent = `${ICONS[id]} ${NAMES[id]}`;
  bodyEl.replaceChildren(slots[id].build());
  windowEl.hidden = false;
  renderTabs();
}

function minimize(): void {
  window.clearTimeout(quietTimer);
  openId = null;
  windowEl.hidden = true;
  renderTabs();
}

function jump(target: { screen: 'fleet' | 'crews' | 'maintenance' | 'routes' } | { airport: string } | null): void {
  if (!target) return;
  if ('airport' in target) select({ kind: 'airport', iata: target.airport });
  else if (target.screen === 'routes') select({ kind: 'routes', sort: 'completion' });
  else select({ kind: target.screen });
}

function dailyContent(brief: DailyBrief): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'brief-chips';
  if (brief.chips.length === 0) {
    const ok = document.createElement('span');
    ok.className = 'brief-chip is-ok';
    ok.textContent = '✓';
    ok.title = 'Nothing needs you this morning';
    wrap.append(ok);
  }
  for (const chip of brief.chips) {
    const el = document.createElement(chip.target ? 'button' : 'span');
    el.className = `brief-chip is-${chip.kind}`;
    el.title = chip.tip;
    el.textContent = `${CHIP_ICONS[chip.kind]} ${chip.count}`;
    if (chip.target) {
      const target = chip.target;
      (el as HTMLButtonElement).type = 'button';
      el.addEventListener('click', () => jump(target));
    }
    wrap.append(el);
  }
  if (brief.yesterday) {
    const y = brief.yesterday;
    const line = document.createElement('span');
    line.className = 'brief-yesterday';
    line.title = 'Yesterday: flights landed · on time · cancelled';
    line.textContent = `DEP ${y.flown} · OTP ${y.flown > 0 ? Math.round((y.onTime / y.flown) * 100) : 0}% · CNX ${y.cancelled}`;
    wrap.append(line);
  }
  return wrap;
}

function seasonContent(review: SeasonReview): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'brief-season';

  const total = document.createElement('div');
  total.className = 'brief-total';
  total.title = 'Route profit over the last half year: revenue less the flying costs charged to each route';
  total.textContent = `${review.total >= 0 ? '+' : '−'}${shortMoney(Math.abs(review.total))}`;
  total.classList.toggle('is-loss', review.total < 0);
  wrap.append(total);

  const biggest = Math.max(1, ...review.rows.map((row) => Math.abs(row.profit)));
  const list = document.createElement('div');
  list.className = 'brief-rows';
  review.rows.forEach((row, index) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'brief-row';
    el.classList.toggle('is-top', index < 3 && row.profit > 0);
    el.classList.toggle('is-bottom', index >= review.rows.length - 3 && row.profit < 0);
    el.title = `${row.a}–${row.b} · ${row.profit >= 0 ? '+' : '−'}${shortMoney(Math.abs(row.profit))} · ${row.passengers} pax · next half year demand ${row.outlook >= 0 ? '+' : ''}${Math.round(row.outlook * 100)}%${row.spilling ? ' · demand exceeds seats' : ''}${row.flying ? '' : ' · not flown now'}`;
    const name = document.createElement('span');
    name.className = 'brief-route';
    name.textContent = `${row.a}–${row.b}`;
    const bar = document.createElement('span');
    bar.className = 'brief-bar';
    const fill = document.createElement('span');
    fill.style.width = `${Math.max(2, (Math.abs(row.profit) / biggest) * 100)}%`;
    fill.className = row.profit >= 0 ? 'is-gain' : 'is-loss';
    bar.append(fill);
    const outlook = document.createElement('span');
    outlook.className = 'brief-outlook';
    const pct = Math.round(row.outlook * 100);
    outlook.classList.toggle('is-up', pct >= 3);
    outlook.classList.toggle('is-down', pct <= -3);
    outlook.textContent = pct >= 3 ? '▲' : pct <= -3 ? '▼' : '▬';
    const flags = document.createElement('span');
    flags.className = 'brief-flags';
    flags.textContent = `${row.spilling ? '●' : ''}${row.flying ? '' : '○'}`;
    el.append(name, bar, outlook, flags);
    el.addEventListener('click', () => select({ kind: 'route', a: row.a, b: row.b }));
    list.append(el);
  });
  if (review.rows.length === 0) list.textContent = '—';
  wrap.append(list);

  if (review.gaps.length > 0) {
    const gaps = document.createElement('div');
    gaps.className = 'brief-gaps';
    gaps.title = 'Most passengers a day nobody carries, among airports you can see';
    for (const gap of review.gaps) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'brief-chip';
      el.title = `${gap.iata}: about ${gap.passengers} passengers a day unserved`;
      el.textContent = `◎ ${gap.iata} ${gap.passengers}`;
      el.addEventListener('click', () => select({ kind: 'airport', iata: gap.iata }));
      gaps.append(el);
    }
    wrap.append(gaps);
  }
  return wrap;
}

/** Shows the daily brief now (a due one, or a reopen from the Game screen). */
function showDaily(state: SimState, collapsed: boolean): void {
  const brief = buildDailyBrief(state);
  slots.daily = { exists: true, unread: collapsed, build: () => dailyContent(brief) };
  if (collapsed) {
    renderTabs();
    return;
  }
  open('daily');
  // A quiet morning folds itself away.
  if (brief.chips.length === 0) quietTimer = window.setTimeout(() => openId === 'daily' && minimize(), 3500);
}

/** `review` is read before the half year's tally restarts, so it describes the half year just ended. */
function showSeason(review: SeasonReview): void {
  slots.season = { exists: true, unread: false, build: () => seasonContent(review) };
  open('season');
}

/**
 * Called every frame. Opens the daily brief from 05:30 and the season review
 * every half year, unless the player turned them off. At 100x the daily brief
 * arrives folded into its tab. Returns true when the clock should pause.
 */
export function updateBriefs(state: SimState, choosingHome: boolean, speed: number): boolean {
  if (choosingHome) return false;
  const settings = briefSettings(state);
  if (dailyBriefDue(state) && settings.daily) showDaily(state, speed >= 100 || openId === 'season');
  if (seasonReviewDue(state) && settings.season) {
    const review = buildSeasonReview(state);
    markSeasonReviewShown(state);
    showSeason(review);
    pauseRequested = settings.seasonPause;
  } else if (seasonReviewDue(state)) {
    markSeasonReviewShown(state); // off: skip this half year rather than ask again every frame
  }
  if (pauseRequested) {
    pauseRequested = false;
    return true;
  }
  return false;
}

function bindSettings(state: SimState): void {
  const switches: [string, keyof BriefSettings][] = [
    ['#brief-setting-daily', 'daily'],
    ['#brief-setting-season', 'season'],
    ['#brief-setting-pause', 'seasonPause'],
  ];
  stateRef = state;
  for (const [selector, key] of switches) {
    document.querySelector<HTMLInputElement>(selector)!.addEventListener('change', (event) => {
      setBriefSetting(state, key, (event.target as HTMLInputElement).checked);
    });
  }
  document.querySelector<HTMLButtonElement>('#brief-reopen-daily')!.addEventListener('click', () => showDaily(state, false));
  document.querySelector<HTMLButtonElement>('#brief-reopen-season')!.addEventListener('click', () => (slots.season.exists ? open('season') : showSeason(buildSeasonReview(state))));
  syncBriefSettings();
}

/** Shows the saved choices on the Game screen's switches; called whenever that screen opens. */
export function syncBriefSettings(): void {
  if (!stateRef) return;
  const settings = briefSettings(stateRef);
  document.querySelector<HTMLInputElement>('#brief-setting-daily')!.checked = settings.daily;
  document.querySelector<HTMLInputElement>('#brief-setting-season')!.checked = settings.season;
  document.querySelector<HTMLInputElement>('#brief-setting-pause')!.checked = settings.seasonPause;
}

/** Drag by the header with a mouse or pen; on touch the window stays docked above the tab strip. */
function bindDrag(): void {
  let start: { x: number; y: number; left: number; top: number } | null = null;
  headerEl.addEventListener('pointerdown', (event) => {
    if (coarse() || event.target === minimizeEl) return;
    const rect = windowEl.getBoundingClientRect();
    start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    headerEl.setPointerCapture(event.pointerId);
  });
  headerEl.addEventListener('pointermove', (event) => {
    if (!start) return;
    const left = Math.min(window.innerWidth - 60, Math.max(0, start.left + event.clientX - start.x));
    const top = Math.min(window.innerHeight - 60, Math.max(0, start.top + event.clientY - start.y));
    windowEl.style.left = `${left}px`;
    windowEl.style.top = `${top}px`;
    windowEl.style.right = 'auto';
    windowEl.style.bottom = 'auto';
  });
  const end = (): void => {
    start = null;
  };
  headerEl.addEventListener('pointerup', end);
  headerEl.addEventListener('pointercancel', end);
}

export function setupBriefs(state: SimState): void {
  minimizeEl.addEventListener('click', minimize);
  bindDrag();
  bindSettings(state);
  tabsEl.hidden = true;
}
