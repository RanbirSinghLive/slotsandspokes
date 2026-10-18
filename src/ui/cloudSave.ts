import type { SimState } from '../sim/state';
import { dayIndex } from '../sim/clock';
import { formatSyncCode, newSyncCode, readSyncCode } from '../worker/syncCode';
import type { SaveMeta } from '../worker/saveRoutes';
import { hasSavedState, importSaveText, onSaveWritten, saveFileText } from './save';

/**
 * Cloud saves: one game across phone and computer. The localStorage save
 * stays the working copy and the fallback; this module copies it to the
 * Worker's /api/save (worker/saveRoutes.ts) after each autosave and brings
 * a newer one back from another device.
 *
 * - **Account** = a sync code made on this device (worker/syncCode.ts). A
 *   second device joins by opening the share link (`/#sync=CODE`) or typing
 *   the code. No email, password or sign-in.
 * - **Revisions**: each device remembers the revision of the cloud save it
 *   last pushed or pulled. A push sends it as `base`; if the cloud has moved
 *   on, the server refuses (409) and the player chooses which game to keep.
 * - **`dirty`** means this device has saved since it last synced, so a
 *   differing cloud revision is a real conflict rather than just news.
 *
 * The game never depends on any of this: with no backend, no network or no
 * link, every path ends quietly and the local save carries on.
 */
const LINK_KEY = 'slotsandspokes-cloud';
const ASKED_KEY = 'slotsandspokes-cloud-asked';

/** The game day at which a player with no cloud save is asked once whether to turn it on: past the first few sectors, with something worth keeping. */
const ASK_FROM_DAY = 7;

/**
 * Each push costs two Workers KV writes, and the free tier allows 1,000
 * writes a day for the whole deployment. The game autosaves once per
 * simulated day, which at 100x is every two seconds, so pushes are spaced
 * out. The save stays `dirty` between pushes, so nothing is lost: the next
 * push carries the newest state.
 */
const MIN_PUSH_GAP_MS = 5 * 60 * 1000;

type Link = { code: string; rev: number; device: string; dirty: boolean };

let available = false;
let link: Link | null = null;
let state: SimState | null = null;
let statusText = '';
let pushing = false;
let pushAgain = false;
let conflictOpen = false;
let lastPushAt = 0;
/** The last text pushed, without its timestamp, so a save that hasn't changed isn't sent again. */
let lastPushedBody = '';
let pushTimer: ReturnType<typeof setTimeout> | null = null;
const listeners: Array<() => void> = [];

function readLink(): Link | null {
  try {
    const raw = localStorage.getItem(LINK_KEY);
    return raw === null ? null : (JSON.parse(raw) as Link);
  } catch {
    return null;
  }
}

function writeLink(next: Link | null): void {
  link = next;
  try {
    if (next === null) localStorage.removeItem(LINK_KEY);
    else localStorage.setItem(LINK_KEY, JSON.stringify(next));
  } catch {
    // Without storage the link lasts this visit only.
  }
}

function setStatus(text: string): void {
  statusText = text;
  listeners.forEach((listener) => listener());
}

function clockTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function api(path: string, code: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${code}` } });
}

async function fetchMeta(code: string): Promise<SaveMeta | null> {
  const response = await api('/api/save/meta', code);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`meta ${response.status}`);
  return (await response.json()) as SaveMeta;
}

/** Copy the cloud save over this device's and reload to play it. */
async function pullAndReload(code: string): Promise<void> {
  conflictOpen = false;
  try {
    const response = await api('/api/save', code);
    if (!response.ok) throw new Error(`save ${response.status}`);
    const rev = Number(response.headers.get('x-save-rev') ?? 0);
    const imported = importSaveText(await response.text());
    if (!imported.ok) {
      setStatus(`Cloud save not loaded · ${imported.reason}`);
      return;
    }
    writeLink({ code, rev, device: link?.device ?? newDevice(), dirty: false });
    window.location.reload();
  } catch {
    setStatus('Cloud save not loaded · offline');
  }
}

function newDevice(): string {
  return crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
}

/** Push now if the last push was long enough ago, otherwise once the gap has passed. */
function schedulePush(): void {
  if (pushTimer !== null) return;
  const wait = Math.max(0, lastPushAt + MIN_PUSH_GAP_MS - Date.now());
  if (wait === 0) {
    void push();
    return;
  }
  pushTimer = setTimeout(() => {
    pushTimer = null;
    schedulePush();
  }, wait);
}

async function push(): Promise<void> {
  if (link === null || state === null || conflictOpen || !hasSavedState()) return;
  if (pushing) {
    pushAgain = true;
    return;
  }
  pushing = true;
  lastPushAt = Date.now();
  try {
    const body = saveFileText(state);
    const comparable = body.replace(/"savedAt":"[^"]*"/, '');
    if (comparable === lastPushedBody) {
      writeLink({ ...link, dirty: false });
      return;
    }
    const params = new URLSearchParams({ base: String(link.rev), day: String(dayIndex(state)), device: link.device });
    const response = await api(`/api/save?${params}`, link.code, { method: 'PUT', body });
    if (response.status === 409) {
      const { meta } = (await response.json()) as { meta: SaveMeta | null };
      if (meta) askWhichSave(meta);
    } else if (response.ok) {
      const meta = (await response.json()) as SaveMeta;
      lastPushedBody = comparable;
      writeLink({ ...link, rev: meta.rev, dirty: false });
      setStatus(`Synced · day ${meta.day} · ${clockTime(meta.savedAt)}`);
    } else {
      setStatus(`Not synced · server ${response.status}`);
    }
  } catch {
    setStatus('Not synced · offline, will retry at the next save');
  } finally {
    pushing = false;
    if (pushAgain) {
      pushAgain = false;
      void push();
    }
  }
}

/** A small dialog over the page, built on the shared modal classes. */
function showDialog(title: string, lines: string[], buttons: Array<{ label: string; run: () => void; keepOpen?: boolean }>, input?: HTMLInputElement): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.classList.add('cloud-dialog');
  overlay.style.zIndex = '60';
  const box = document.createElement('div');
  box.className = 'modal-box';
  box.setAttribute('role', 'dialog');
  const heading = document.createElement('h2');
  heading.textContent = title;
  box.append(heading);
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    box.append(p);
  }
  if (input) box.append(input);
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const close = () => overlay.remove();
  for (const { label, run, keepOpen } of buttons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (!keepOpen) close();
      run();
    });
    actions.append(button);
  }
  box.append(actions);
  overlay.append(box);
  document.body.append(overlay);
  input?.focus();
  return close;
}

/** The cloud save and this device have both moved on: the player picks one. */
function askWhichSave(remote: SaveMeta): void {
  if (conflictOpen || link === null || state === null) return;
  conflictOpen = true;
  const code = link.code;
  showDialog(
    'Newer save on another device',
    [`Cloud · day ${remote.day} · ${clockTime(remote.savedAt)}`, `This device · day ${dayIndex(state)}`, 'The one you leave is overwritten.'],
    [
      {
        label: 'Keep this device',
        run: () => {
          conflictOpen = false;
          // The cloud game is about to be overwritten: keep a copy to restore from.
          void backupToSlot('conflict').finally(() => {
            if (link) writeLink({ ...link, rev: remote.rev, dirty: true });
            void push();
          });
        },
      },
      { label: 'Load cloud save', run: () => void pullAndReload(code) },
    ],
  );
}

/** Compare the cloud's revision with ours: quietly load news, ask about a real conflict. */
async function checkRemote(atStartup: boolean): Promise<void> {
  if (!available || link === null || state === null || conflictOpen || pushing) return;
  try {
    const meta = await fetchMeta(link.code);
    if (meta === null) {
      // The cloud has nothing (a fresh code): the first save creates it.
      if (link.rev !== 0) writeLink({ ...link, rev: 0, dirty: true });
      void push();
    } else if (meta.rev !== link.rev) {
      if (!link.dirty && atStartup) await pullAndReload(link.code);
      else askWhichSave(meta);
    } else if (link.dirty) {
      void push();
    } else {
      setStatus(`Synced · day ${meta.day} · ${clockTime(meta.savedAt)}`);
    }
  } catch {
    setStatus('Not synced · offline');
  }
}

/** Turn cloud saves on from this device: a new code, and the save already here goes up as the first copy. */
export function enableCloudSave(): void {
  if (!available) return;
  writeLink({ code: newSyncCode(), rev: 0, device: newDevice(), dirty: true });
  setStatus('Turning on…');
  void push().then(() => listeners.forEach((listener) => listener()));
  showCodeOnce();
}

/** The code is the only way back to the save from a new phone or a wiped browser, so it is shown once, big, with copy buttons. */
function showCodeOnce(): void {
  const info = cloudLinkInfo();
  if (info === null) return;
  const copyText = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);
  showDialog(
    'Cloud save on',
    [info.code, 'Copy or write this code down. It is the only way to get this game back on a new phone or after the browser clears its data. Anyone with the code can play your game.'],
    [
      { label: 'Copy code', run: () => copyText(info.code), keepOpen: true },
      { label: 'Copy link', run: () => copyText(info.shareLink), keepOpen: true },
      { label: 'Done', run: () => undefined },
    ],
  );
}

/** Copy the live cloud save into a backup slot; resolves either way, so a failure never blocks the player. */
async function backupToSlot(slot: 'newgame' | 'conflict'): Promise<void> {
  if (link === null) return;
  try {
    await api(`/api/save/backup?slot=${slot}`, link.code, { method: 'POST' });
  } catch {
    // Offline: the player's own action goes ahead without a backup.
  }
}

/** Before New Game replaces the cloud save: keep it as the "new game" backup, waiting at most three seconds. */
export async function backupBeforeNewGame(): Promise<void> {
  if (link === null) return;
  await Promise.race([backupToSlot('newgame'), new Promise((resolve) => setTimeout(resolve, 3000))]);
}

const SLOT_NAMES: Record<string, string> = { prev1: 'Earlier save', prev2: 'Earlier still', newgame: 'Before New Game', conflict: 'Replaced by this device' };

/** List the cloud's backups and load one: it becomes this device's game, and the next push makes it the cloud's. */
export async function showBackups(): Promise<void> {
  if (link === null) return;
  const code = link.code;
  let slots: Array<{ slot: string; meta: SaveMeta }> = [];
  try {
    const response = await api('/api/save/backups', code);
    if (!response.ok) throw new Error(`backups ${response.status}`);
    slots = (await response.json()) as Array<{ slot: string; meta: SaveMeta }>;
  } catch {
    showDialog('Cloud backups', ['Couldn\'t reach the cloud.'], [{ label: 'OK', run: () => undefined }]);
    return;
  }
  if (slots.length === 0) {
    showDialog('Cloud backups', ['No backups yet. One is kept when you start a new game, and earlier saves roll in hourly.'], [{ label: 'OK', run: () => undefined }]);
    return;
  }
  showDialog(
    'Cloud backups',
    ['Loading one replaces the game on this device and, at the next sync, the cloud save.'],
    [
      { label: 'Cancel', run: () => undefined },
      ...slots.map(({ slot, meta }) => ({
        label: `${SLOT_NAMES[slot] ?? slot} · day ${meta.day} · ${clockTime(meta.savedAt)}`,
        run: () => void restoreBackup(code, slot),
      })),
    ],
  );
}

async function restoreBackup(code: string, slot: string): Promise<void> {
  try {
    const response = await api(`/api/save?slot=${slot}`, code);
    if (!response.ok) throw new Error(`backup ${response.status}`);
    const rev = Number(response.headers.get('x-save-rev') ?? 0);
    const imported = importSaveText(await response.text());
    if (!imported.ok) {
      setStatus(`Backup not loaded · ${imported.reason}`);
      return;
    }
    writeLink({ code, rev, device: link?.device ?? newDevice(), dirty: true });
    window.location.reload();
  } catch {
    setStatus('Backup not loaded · offline');
  }
}

/** Once, at the first day worth keeping, offer cloud saves to a player who hasn't turned them on. */
function askToTurnOn(): void {
  if (!available || link !== null || state === null || conflictOpen || dayIndex(state) < ASK_FROM_DAY) return;
  try {
    if (localStorage.getItem(ASKED_KEY) !== null) return;
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    return;
  }
  showDialog(
    'Keep this game safe?',
    ['Browsers can wipe saved games, and iPhone Safari does after a week unused. Cloud save keeps a copy and lets you play on another device.'],
    [
      { label: 'Not now', run: () => undefined },
      { label: 'Turn on', run: enableCloudSave },
    ],
  );
}

export function disableCloudSave(): void {
  writeLink(null);
  setStatus('');
}

/** Join the save under a code from another device. */
export async function joinWithCode(text: string): Promise<string | null> {
  const code = readSyncCode(text);
  if (code === null) return 'That isn\'t a sync code. It is 20 letters and digits.';
  try {
    const meta = await fetchMeta(code);
    if (meta === null) return 'No save under that code yet. Open the game on the other device and turn on cloud save first.';
    const device = link?.device ?? newDevice();
    if (!hasSavedState()) {
      writeLink({ code, rev: meta.rev, device, dirty: false });
      await pullAndReload(code);
    } else {
      showDialog(
        'Join this cloud save?',
        [`Cloud · day ${meta.day} · ${clockTime(meta.savedAt)}`, 'The game on this device is replaced by it.'],
        [
          { label: 'Cancel', run: () => undefined },
          {
            label: 'Load cloud save',
            run: () => {
              writeLink({ code, rev: meta.rev, device, dirty: false });
              void pullAndReload(code);
            },
          },
        ],
      );
    }
    return null;
  } catch {
    return 'Couldn\'t reach the cloud. Check the connection and try again.';
  }
}

/** A dialog asking for a code, for the home picker (a new device with no game yet). */
export function askForCode(): void {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'XXXXX-XXXXX-XXXXX-XXXXX';
  input.setAttribute('aria-label', 'Sync code');
  input.autocapitalize = 'characters';
  input.autocomplete = 'off';
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.style.marginBottom = '12px';
  const run = async () => {
    const problem = await joinWithCode(input.value);
    if (problem) {
      showDialog('Sync code', [problem], [{ label: 'OK', run: askForCode }]);
    }
  };
  showDialog('Join your cloud save', ['Paste the sync code, or the link, from your other device.'], [{ label: 'Cancel', run: () => undefined }, { label: 'Join', run: () => void run() }], input);
}

export function isCloudAvailable(): boolean {
  return available;
}

export function cloudLinkInfo(): { code: string; shareLink: string; status: string } | null {
  if (link === null) return null;
  return { code: formatSyncCode(link.code), shareLink: `${window.location.origin}/#sync=${link.code}`, status: statusText };
}

export function onCloudChange(listener: () => void): void {
  listeners.push(listener);
}

/**
 * Called once at startup with the game state. Asks the server whether
 * cloud saves are set up, applies a `#sync=` link, reconciles with the
 * cloud, and then keeps it in step: after every autosave, and when the tab
 * comes back to the front (the phone-then-computer handoff).
 */
export async function startCloudSave(gameState: SimState): Promise<void> {
  state = gameState;
  onSaveWritten(() => {
    if (link === null) {
      askToTurnOn();
      return;
    }
    writeLink({ ...link, dirty: true });
    schedulePush();
  });
  try {
    const response = await fetch('/api/cloud');
    available = response.ok && (await response.json()).configured === true;
  } catch {
    available = false;
  }
  if (!available) return;
  link = readLink();
  const shared = /[#&]sync=([^&]+)/.exec(window.location.hash);
  if (shared) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    await joinWithCode(shared[1]);
  }
  listeners.forEach((listener) => listener());
  await checkRemote(true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkRemote(false);
    else if (link?.dirty && Date.now() - lastPushAt > 60_000) void push();
  });
}
