import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { costWeek, flownMarkets, smoothedMarginHistory, networkMargin, routeGroups, routeMarginShare, routeTags, routeWeek } from './networkMargin';
import { regionOf } from './regions';
import { step } from './step';

// Run with `npm run margintest`: the week's margin figures add up to the
// books, groups cover every route once, and an old save without the new
// history fields reads as "nothing to judge yet" rather than failing.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
assert.equal(networkMargin(state), null, 'no margin before a day has closed');
for (let day = 1; day <= 60; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}

const margin = networkMargin(state);
assert.ok(margin, 'a margin after two months');
assert.equal(margin.days, 7);
assert.ok(margin.previousFlying !== null, 'a week before it');
const revenue = state.routeRevenueHistory!.slice(-7).reduce((a, b) => a + b, 0);
const routeMargin = state.routeMarginHistory!.slice(-7).reduce((a, b) => a + b, 0);
assert.ok(Math.abs(margin.flying - routeMargin / revenue) < 1e-9);
assert.ok(margin.flying <= 1 && margin.allIn <= 1);

// Each route is in exactly one group of either kind, and the groups add up to the routes.
const markets = flownMarkets(state);
for (const by of ['hub', 'sector', 'region'] as const) {
  const groups = routeGroups(state, by);
  const keys = groups.flatMap((group) => group.keys).sort();
  assert.deepEqual(keys, markets.map((m) => m.key).sort(), `${by} groups cover every route once`);
  const total = groups.reduce((sum, group) => sum + group.perDay, 0);
  const routes = markets.reduce((sum, m) => sum + (routeWeek(state, m.key).perDay ?? 0), 0);
  assert.ok(Math.abs(total - routes) < 1e-6, `${by} groups add up`);
}

// A route's week matches its own history.
const first = markets[0];
const week = routeWeek(state, first.key);
const revenueHistory = state.revenueHistoryByMarket[first.key];
const costHistory = state.costHistoryByMarket[first.key];
const expected = revenueHistory.slice(-7).reduce((s, r, i) => s + r - costHistory.slice(-7)[i], 0) / 7;
assert.ok(Math.abs((week.perDay ?? 0) - expected) < 1e-6);
assert.equal(week.series.length, 14);
assert.ok(routeMarginShare(week) === null || Math.abs(routeMarginShare(week)!) < 5);
assert.equal(typeof routeTags(state, first.a, first.b).new, 'boolean');

// The week's costs add up to the days' costs.
const cw = costWeek(state);
assert.ok(cw, 'costs by kind after two months');
const weekCost = state.costHistory.slice(-cw.days).reduce((a, b) => a + b, 0) / cw.days;
const kindsTotal = cw.perDay.reduce((a, row) => a + row.amount, 0);
assert.ok(Math.abs(kindsTotal - weekCost) < 1, `kinds ${kindsTotal} vs days ${weekCost}`);

// Spreading the checks keeps each day's other costs and revenue, and moves only the lump.
const smooth = smoothedMarginHistory(state);
assert.equal(smooth.length, state.marginHistory.length);
const maintenance = state.costHistoryByCategory!.maintenance;
for (let i = 0; i < smooth.length; i++) {
  const withoutChecks = state.marginHistory[i] + maintenance[i];
  const spread = withoutChecks - smooth[i];
  assert.ok(spread >= -1e-6, 'a day pays at least nothing for checks');
}
const rawSwing = Math.max(...state.marginHistory.slice(-14)) - Math.min(...state.marginHistory.slice(-14));
const smoothSwing = Math.max(...smooth.slice(-14)) - Math.min(...smooth.slice(-14));
assert.ok(smoothSwing <= rawSwing + 1e-6, 'spreading checks never widens the swing');

// An older save has none of the new fields.
// The movers add up to the change in profit a day, and say so only with two full weeks on record.
{
  const { marginMovers } = await import('./marginMovers');
  const movers = marginMovers(state);
  assert.ok(movers, 'movers after two months');
  const total = movers.movers.reduce((s, m) => s + m.perDay, 0);
  assert.ok(Math.abs(total - (movers.now - movers.before)) < 1e-6, 'movers add up to the change');
  const named = movers.movers.filter((m) => m.label === 'other').reduce((s, m) => s + Math.abs(m.perDay), 0);
  assert.ok(named < Math.abs(movers.now - movers.before) * 0.2 + 1000, 'little is left unexplained ');
  const young = startHeadlessGame('YYZ', 2, createPlayer('steady'));
  assert.equal(marginMovers(young), null);
}

delete state.routeRevenueHistory;
delete state.routeMarginHistory;
delete state.bonusRevenueHistory;
delete state.bonusHistoryByMarket;
delete state.costHistoryByCategory;
assert.deepEqual(smoothedMarginHistory(state), state.marginHistory, 'no category history: days as they were');
assert.equal(costWeek(state), null);
assert.equal(networkMargin(state), null);
assert.equal(routeWeek(state, first.key).paidPerDay, 0);

// The same game round-trips through a save.
const copy = JSON.parse(JSON.stringify(state));
assert.deepEqual(routeWeek(copy, first.key), routeWeek(state, first.key));

// Regions follow the far end of the route from the hub, and the big airports land where expected.
const expectedRegions: Record<string, string> = { YUL: 'Quebec', YQB: 'Quebec', YYZ: 'Ontario', YOW: 'Ontario', YHZ: 'Atlantic Canada', YFC: 'Atlantic Canada', YVR: 'Western Canada', BOS: 'US Northeast', ATL: 'US Southeast', ORD: 'US Central', LAX: 'US West', MEX: 'MX' };
for (const [iata, region] of Object.entries(expectedRegions)) assert.equal(regionOf(iata), region, iata);
for (const market of markets) {
  assert.equal(market.region, regionOf(market.hub === market.a ? market.b : market.a));
}

console.log('margintest ok');
