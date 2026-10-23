import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { feedViaHubs, newRouteConnecting, spokeFlowsFrom, routesFedAt } from './spokeFlows';

// Run with `npm test -- spokeFlows`: a Halifax airline flying Boston and
// Québec City, seen from Moncton (YQM), which it doesn't fly yet.
const state = startHeadlessGame('YHZ', 7, createPlayer('steady'));
const tail = state.aircraft[0].tail;
state.schedule = [
  { legId: 'T-1', tail, origin: 'YHZ', dest: 'BOS', departMinute: 420, blockMinutes: 90 },
  { legId: 'T-2', tail, origin: 'BOS', dest: 'YHZ', departMinute: 560, blockMinutes: 90 },
  { legId: 'T-3', tail, origin: 'YHZ', dest: 'YQB', departMinute: 700, blockMinutes: 90 },
  { legId: 'T-4', tail, origin: 'YQB', dest: 'YHZ', departMinute: 840, blockMinutes: 90 },
] as typeof state.schedule;

const flows = spokeFlowsFrom(state, 'YQM', 12);
const byOther = new Map(flows.map((flow) => [flow.other, flow]));
assert.equal(byOther.get('BOS')?.kind, 'viaHub', 'YQM–BOS could connect at Halifax');
assert.equal(byOther.get('BOS')?.hub, 'YHZ');
assert.equal(byOther.get('BOS')?.spokeFlown, false);
assert.equal(byOther.get('LGA')?.kind, 'needsTrunk', 'YQM–LGA needs a Halifax–LaGuardia trunk');
assert.equal(byOther.get('YHZ')?.kind, 'open', 'YQM–YHZ itself is local, not a connection');
console.log('ok: YQM flows', flows.slice(0, 6).map((flow) => `${flow.other} ${flow.kind}${flow.hub ? ` ${flow.hub}` : ''} +${flow.connecting.toFixed(1)}`).join(', '));

const feed = feedViaHubs(state, 'YQM')[0];
assert.equal(feed?.hub, 'YHZ');
assert.equal(feed.parts[0].other, 'BOS', 'Boston is the bigger onward flow');
assert.ok(feed.total > 3 && feed.total < 40, `YQM via YHZ feeds ${feed.total.toFixed(1)}/day`);
const added = newRouteConnecting(state, 'YQM', 'YHZ');
assert.ok(Math.abs(added - feed.total) < 0.01, `a new YQM–YHZ route carries what the feed says (${added} vs ${feed.total})`);
console.log(`ok: YQM via YHZ +${feed.total.toFixed(1)}/day`);

const ideas = routesFedAt(state, 'YHZ', 3);
assert.equal(ideas[0]?.other, 'YQM', 'Boston and Québec City people onward to Moncton make it the next spoke');
assert.equal(ideas[0].trunkClass, undefined, 'Moncton is in propeller range');
console.log('ok: routes YHZ would feed', ideas.map((idea) => `${idea.other} +${idea.connecting.toFixed(1)}`).join(', '));

// A flown pair is nonstop, and adds nothing new.
state.schedule.push(
  { legId: 'T-5', tail, origin: 'YHZ', dest: 'YQM', departMinute: 980, blockMinutes: 40 },
  { legId: 'T-6', tail, origin: 'YQM', dest: 'YHZ', departMinute: 1040, blockMinutes: 40 },
);
assert.equal(newRouteConnecting(state, 'YQM', 'YHZ'), 0);
assert.equal(spokeFlowsFrom(state, 'YQM', 12).find((flow) => flow.other === 'BOS')?.spokeFlown, true);
assert.equal(feedViaHubs(state, 'YQM').find((entry) => entry.hub === 'YHZ'), undefined, 'a flown spoke has real connections, not a what-if');
console.log('ok: flown spoke');

// With Moncton flown, LaGuardia is the trunk its people would ride, and it needs a bigger plane.
const laGuardia = routesFedAt(state, 'YHZ', 5).find((idea) => idea.other === 'LGA');
assert.ok(laGuardia, 'LaGuardia is among the routes Halifax would feed');
assert.equal(laGuardia.trunkClass, 'Regional', 'a 25-seat propeller cannot reach LaGuardia from Halifax');
console.log('ok: routes YHZ would feed', routesFedAt(state, 'YHZ', 5).map((idea) => `${idea.other} +${idea.connecting.toFixed(1)}${idea.trunkClass ? ` ${idea.trunkClass}` : ''}`).join(', '));
