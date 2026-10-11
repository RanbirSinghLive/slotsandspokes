import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { costWeek, flownMarkets, networkMargin, routeGroups, routeMarginShare, routeTags, routeWeek } from './networkMargin';
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
for (const by of ['hub', 'sector'] as const) {
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

// An older save has none of the new fields.
delete state.routeRevenueHistory;
delete state.routeMarginHistory;
delete state.bonusRevenueHistory;
delete state.bonusHistoryByMarket;
delete state.costHistoryByCategory;
assert.equal(costWeek(state), null);
assert.equal(networkMargin(state), null);
assert.equal(routeWeek(state, first.key).paidPerDay, 0);

// The same game round-trips through a save.
const copy = JSON.parse(JSON.stringify(state));
assert.deepEqual(routeWeek(copy, first.key), routeWeek(state, first.key));

console.log('margintest ok');
