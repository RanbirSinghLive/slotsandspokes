/**
 * Anonymous play stats: a handful of events sent to /api/event
 * (src/worker/eventRoutes.ts) so the owner can see where players come
 * from, whether they start a game and how far they get. HOW-IT-WORKS.md
 * ("Play stats") lists the events; public/privacy.html says the same to
 * players.
 *
 * Kept deliberately small, because Quebec's Law 25 and PIPEDA ask that
 * tracking be limited to its purpose and easy to refuse:
 * - the id is random, made here, and never tied to a name, email or save;
 * - no cookies, no third-party script, nothing sent but the fields below;
 * - one switch turns it off, on the start screen and on the Game screen,
 *   and a browser sending Global Privacy Control starts with it off;
 * - automated browsers (Playwright, crawlers) are never counted.
 *
 * Where a visit came from is read once, on the first visit, from the
 * `utm_source` / `utm_medium` / `utm_campaign` (or `ref`) in the link and the
 * referring site, then sent with every later event so a day-30 player can
 * be traced back to the ad that brought them.
 */

const STATS_KEY = 'airgame.playStats';

interface StatsRecord {
  id: string;
  /** 'off' once the player turns stats off; absent means on. */
  off?: boolean;
  firstVisitMs: number;
  visits: number;
  source: string;
  medium: string;
  campaign: string;
  referrer: string;
}

export interface StatsGameContext {
  home?: string;
  difficulty?: string;
  day?: number;
}

type EventName = 'landed' | 'game_started' | 'day_reached' | 'bust' | 'cloud_on' | 'stats_off';

/** The game days worth a "reached" event: the first morning, a week, a month, a hundred days, a year. */
export const STATS_MILESTONE_DAYS = [1, 7, 30, 100, 365];

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function firstTouch(): Pick<StatsRecord, 'source' | 'medium' | 'campaign' | 'referrer'> {
  const params = new URLSearchParams(window.location.search);
  let referrer = '';
  try {
    const host = document.referrer ? new URL(document.referrer).hostname : '';
    referrer = host === window.location.hostname ? '' : host;
  } catch {
    referrer = '';
  }
  return {
    source: params.get('utm_source') ?? params.get('ref') ?? '',
    medium: params.get('utm_medium') ?? '',
    campaign: params.get('utm_campaign') ?? '',
    referrer,
  };
}

function save(next: StatsRecord): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(next));
  } catch {
    // Not remembered; a fresh id next visit, which only overcounts players.
  }
}

function load(): StatsRecord {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw !== null) return JSON.parse(raw) as StatsRecord;
  } catch {
    // Blocked storage or a corrupt value: start a new record.
  }
  const globalPrivacyControl = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  const fresh: StatsRecord = { id: randomId(), firstVisitMs: Date.now(), visits: 0, ...firstTouch() };
  if (globalPrivacyControl) fresh.off = true;
  return fresh;
}

let record: StatsRecord = load();
const listeners: (() => void)[] = [];

export function playStatsOn(): boolean {
  return record.off !== true;
}

export function setPlayStatsOn(on: boolean): void {
  if (on === playStatsOn()) return;
  // The one event sent on the way out, so the owner can see how many say no.
  if (!on) send('stats_off', {});
  record = { ...record, off: on ? undefined : true };
  save(record);
  for (const listener of listeners) listener();
}

export function onPlayStatsChange(listener: () => void): void {
  listeners.push(listener);
}

function send(name: EventName, game: StatsGameContext, detail = ''): void {
  if (!playStatsOn() || navigator.webdriver) return;
  const body = JSON.stringify({
    name,
    id: record.id,
    source: record.source,
    medium: record.medium,
    campaign: record.campaign,
    referrer: record.referrer,
    home: game.home ?? '',
    difficulty: game.difficulty ?? '',
    day: game.day ?? 0,
    daysSinceFirst: Math.floor((Date.now() - record.firstVisitMs) / 86_400_000),
    visit: record.visits,
    detail,
  });
  try {
    // keepalive lets the last event of a closing tab still go out.
    void fetch('/api/event', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
  } catch {
    // Offline or blocked: stats are never worth an error.
  }
}

/** How long a page must stay open, untouched, before it counts as a visit. */
const LANDED_AFTER_MS = 5_000;

/**
 * Once per page load: counts the visit, and says whether a game was already
 * saved here. Held until the first tap, click or key press, or until the
 * page has been open 5 seconds, because ad networks' review bots load the
 * page for a second or two and would otherwise swamp the visit count.
 */
export function trackLanded(game: StatsGameContext, hasSave: boolean): void {
  let sent = false;
  const interactions = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
  const sendOnce = (): void => {
    if (sent) return;
    sent = true;
    window.clearTimeout(timer);
    for (const name of interactions) window.removeEventListener(name, sendOnce, true);
    record = { ...record, visits: record.visits + 1 };
    save(record);
    send('landed', game, hasSave ? 'resumed' : 'new');
  };
  const timer = window.setTimeout(sendOnce, LANDED_AFTER_MS);
  for (const name of interactions) window.addEventListener(name, sendOnce, { capture: true, passive: true });
}

export function trackGameStarted(game: StatsGameContext): void {
  send('game_started', game);
}

/** Called each new game day with the day just left and the day now; sends a milestone crossed in between. */
export function trackDayReached(game: StatsGameContext, previousDay: number, currentDay: number): void {
  for (const milestone of STATS_MILESTONE_DAYS) {
    if (previousDay < milestone && currentDay >= milestone) send('day_reached', { ...game, day: milestone });
  }
}

export function trackBust(game: StatsGameContext): void {
  send('bust', game);
}

export function trackCloudOn(game: StatsGameContext): void {
  send('cloud_on', game);
}
