import { readSyncCode, syncCodeKey } from './syncCode';

/**
 * The cloud save API, as plain functions over a key-value store so it runs
 * in Node for the test (src/worker/saveRoutes.test.ts) as well as in the
 * Worker (src/worker/index.ts). It never reads the save: it stores the
 * text it is given and numbers each write.
 *
 *   GET  /api/cloud            → { configured }
 *   GET  /api/save/meta        → { rev, savedAt, day, device } or 404
 *   GET  /api/save             → the save text, rev in the `x-save-rev` header, or 404
 *   PUT  /api/save?base=REV&day=N&device=ID
 *                              → writes if REV is the stored rev (0 when none yet),
 *                                else 409 with the stored meta (a newer save on another device)
 *
 * Every call but the first carries the sync code as `Authorization: Bearer CODE`.
 */
export type KeyValueStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

export type SaveMeta = { rev: number; savedAt: string; day: number; device: string };

const MAX_SAVE_BYTES = 5_000_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export async function handleApi(request: Request, store: KeyValueStore | undefined): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/cloud') return json({ configured: store !== undefined });
  if (store === undefined) return json({ error: 'Cloud saves are not set up on this deployment.' }, 503);

  const code = readSyncCode((request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  if (code === null) return json({ error: 'Missing or malformed sync code.' }, 401);
  const key = await syncCodeKey(code);
  const metaKey = `meta:${key}`;
  const saveKey = `save:${key}`;
  const readMeta = async (): Promise<SaveMeta | null> => {
    const raw = await store.get(metaKey);
    return raw === null ? null : (JSON.parse(raw) as SaveMeta);
  };

  if (url.pathname === '/api/save/meta' && request.method === 'GET') {
    const meta = await readMeta();
    return meta === null ? json({ error: 'No save yet.' }, 404) : json(meta);
  }

  if (url.pathname === '/api/save' && request.method === 'GET') {
    const [meta, text] = await Promise.all([readMeta(), store.get(saveKey)]);
    if (meta === null || text === null) return json({ error: 'No save yet.' }, 404);
    return new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-save-rev': String(meta.rev) } });
  }

  if (url.pathname === '/api/save' && request.method === 'PUT') {
    const text = await request.text();
    if (text.length > MAX_SAVE_BYTES) return json({ error: 'Save is too large.' }, 413);
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.format !== 'number' || typeof parsed.state !== 'object') throw new Error('shape');
    } catch {
      return json({ error: 'Not a Slots & Spokes save.' }, 400);
    }
    const base = Number(url.searchParams.get('base') ?? 0);
    const current = await readMeta();
    if ((current?.rev ?? 0) !== base) return json({ error: 'A newer save is on another device.', meta: current }, 409);
    const meta: SaveMeta = {
      rev: base + 1,
      savedAt: new Date().toISOString(),
      day: Number(url.searchParams.get('day') ?? 0) || 0,
      device: (url.searchParams.get('device') ?? '').slice(0, 40),
    };
    // The save first, then the number that announces it: a reader never sees a new rev without its save.
    await store.put(saveKey, text);
    await store.put(metaKey, JSON.stringify(meta));
    return json(meta);
  }

  return json({ error: 'Not found.' }, 404);
}
