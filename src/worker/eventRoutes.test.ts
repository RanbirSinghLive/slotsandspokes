/**
 * The play-stats endpoint without a Worker: `npm run eventtest`.
 */
import assert from 'node:assert/strict';
import { handleEvent, type EventWriter } from './eventRoutes';

const rows: { indexes?: string[]; blobs?: string[]; doubles?: number[] }[] = [];
const writer: EventWriter = { writeDataPoint: (point) => rows.push(point) };
const post = (body: unknown, userAgent = 'Mozilla/5.0 (iPhone)') =>
  new Request('https://example.test/api/event', {
    method: 'POST',
    headers: { 'user-agent': userAgent },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const ok = await handleEvent(post({ name: 'game_started', id: 'abc', home: 'YUL', difficulty: 'medium', source: 'reddit', day: 0 }), writer, 'CA');
assert.equal(ok.status, 204);
assert.equal(rows.length, 1);
assert.deepEqual(rows[0].indexes, ['abc']);
assert.equal(rows[0].blobs![0], 'game_started');
assert.equal(rows[0].blobs![2], 'CA');
assert.equal(rows[0].blobs![3], 'phone');
assert.equal(rows[0].blobs![4], 'reddit');
assert.equal(rows[0].blobs![8], 'YUL');

assert.equal((await handleEvent(post({ name: 'made_up', id: 'abc' }), writer, 'CA')).status, 400);
assert.equal((await handleEvent(post({ name: 'landed' }), writer, 'CA')).status, 400);
assert.equal((await handleEvent(post('not json'), writer, 'CA')).status, 400);
assert.equal((await handleEvent(post({ name: 'landed', id: 'x', detail: 'y'.repeat(3000) }), writer, 'CA')).status, 413);
assert.equal(rows.length, 1);

// Without the binding the call still succeeds and nothing is written.
assert.equal((await handleEvent(post({ name: 'landed', id: 'abc' }), undefined, 'CA')).status, 204);

// Long fields are cut, not refused.
await handleEvent(post({ name: 'landed', id: 'abc', campaign: 'c'.repeat(500) }, 'Mozilla/5.0 (Windows NT 10.0)'), writer, 'US');
assert.equal(rows[1].blobs![6].length, 64);
assert.equal(rows[1].blobs![3], 'desktop');

console.log('event endpoint ok');
