import assert from 'node:assert/strict';
import { handleApi, type KeyValueStore } from './saveRoutes';
import { newSyncCode, readSyncCode } from './syncCode';

// Run with `npm run cloudtest`: the cloud save API against an in-memory store.
const data = new Map<string, string>();
const store: KeyValueStore = { get: async (k) => data.get(k) ?? null, put: async (k, v) => void data.set(k, v) };
const save = JSON.stringify({ format: 2, gameVersion: 't', state: { simMinute: 0 } });
const code = newSyncCode();
const call = (method: string, path: string, body?: string, auth: string | null = code) =>
  handleApi(new Request(`https://x.test${path}`, { method, body, headers: auth ? { authorization: `Bearer ${auth}` } : {} }), store);

assert.equal(readSyncCode(code.toLowerCase().replace(/-/g, ' ')), readSyncCode(code));
assert.equal(readSyncCode(`https://x.test/#sync=${code}`), readSyncCode(code));
assert.equal(readSyncCode('nope'), null);
assert.equal((await (await handleApi(new Request('https://x.test/api/cloud'), undefined)).json()).configured, false);
assert.equal((await call('GET', '/api/save/meta', undefined, null)).status, 401);
assert.equal((await call('GET', '/api/save/meta')).status, 404);
assert.equal((await call('PUT', '/api/save?base=0&day=5&device=a', 'garbage')).status, 400);
const first = await call('PUT', '/api/save?base=0&day=5&device=a', save);
assert.equal((await first.json()).rev, 1);
assert.equal((await call('PUT', '/api/save?base=0&day=6&device=b', save)).status, 409);
const second = await call('PUT', '/api/save?base=1&day=9&device=b', save);
assert.equal((await second.json()).rev, 2);
const read = await call('GET', '/api/save');
assert.equal(read.headers.get('x-save-rev'), '2');
assert.equal(await read.text(), save);
const other = newSyncCode();
assert.equal((await call('GET', '/api/save', undefined, other)).status, 404);

// Backups: the player slots copy the live save; rolling slots wait for an hour-old save.
assert.equal((await call('POST', '/api/save/backup?slot=bogus')).status, 400);
assert.equal((await call('POST', '/api/save/backup?slot=newgame', undefined, other)).status, 404);
assert.equal((await call('POST', '/api/save/backup?slot=newgame')).status, 200);
const afterBackup = JSON.stringify({ format: 2, gameVersion: 't', state: { simMinute: 99 } });
assert.equal((await call('PUT', '/api/save?base=2&day=10&device=a', afterBackup)).status, 200);
assert.deepEqual((await (await call('GET', '/api/save/backups')).json()).map((b: { slot: string }) => b.slot), ['newgame']);
const restored = await call('GET', '/api/save?slot=newgame');
assert.equal(await restored.text(), save);
assert.equal(restored.headers.get('x-save-rev'), '3');
const metaKey = [...data.keys()].find((k) => k.startsWith('meta:'))!;
data.set(metaKey, JSON.stringify({ ...JSON.parse(data.get(metaKey)!), savedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }));
assert.equal((await call('PUT', '/api/save?base=3&day=11&device=a', save)).status, 200);
assert.deepEqual((await (await call('GET', '/api/save/backups')).json()).map((b: { slot: string }) => b.slot), ['prev1', 'newgame']);
assert.equal(await (await call('GET', '/api/save?slot=prev1')).text(), afterBackup);
console.log('cloud save API: ok');
