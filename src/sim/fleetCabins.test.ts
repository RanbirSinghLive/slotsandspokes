import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { orderRefit, seatPlanOf } from './cabins';
import { deleteCabinTemplate, fitStandardOnDelivery, fleetCabinStatus, followFleetCabin, MAX_TEMPLATES_PER_TYPE, saveCabinTemplate, setFleetCabin, templatesFor } from './fleetCabins';
import { leaseAircraft } from './leasing';
import { step } from './step';

// Run with `npm test -- fleetCabins`: cabin templates, a type's standard cabin rolled out one plane per base at a time, and deliveries arriving with it.

const game = startHeadlessGame('YYZ', 4, createPlayer('bold'));
game.cash = 1e9;
const home = game.aircraft[0].baseAirport!;
// Four Regionals at home, all economy and flying nothing, so each refit can start the morning it's ordered.
game.aircraft = [];
game.schedule = [];
for (let i = 0; i < 4; i++) leaseAircraft(game, 'REGIONAL', home);
const plan = { business: 4, premium: 8 };

// Templates: saved once per plan, at most a few per type, and deleted.
assert.ok(saveCabinTemplate(game, 'REGIONAL', plan, 'Biz trunk').ok);
assert.match((saveCabinTemplate(game, 'REGIONAL', plan) as { reason: string }).reason, /already/);
assert.equal(saveCabinTemplate(game, 'PROP', plan).ok, false);
for (let business = 0; templatesFor(game, 'REGIONAL').length < MAX_TEMPLATES_PER_TYPE; business++) saveCabinTemplate(game, 'REGIONAL', { business, premium: 0 });
assert.equal(saveCabinTemplate(game, 'REGIONAL', { business: 0, premium: 2 }).ok, false);
const extra = templatesFor(game, 'REGIONAL').find((t) => t.name !== 'Biz trunk')!;
assert.ok(deleteCabinTemplate(game, extra.id).ok);
assert.equal(templatesFor(game, 'REGIONAL').length, MAX_TEMPLATES_PER_TYPE - 1);
assert.equal(JSON.stringify(JSON.parse(JSON.stringify(game.cabinTemplates))), JSON.stringify(game.cabinTemplates));

// A standard: nothing charged at once, then one refit at the base at a time, until all four have it.
const cashBefore = game.cash;
assert.ok(setFleetCabin(game, 'REGIONAL', plan).ok);
assert.equal(game.cash, cashBefore);
assert.equal(fleetCabinStatus(game, 'REGIONAL').waiting, 4);
let mostOutAtOnce = 0;
for (let minute = 0; minute < 1440 * 20; minute++) {
  step(game);
  mostOutAtOnce = Math.max(mostOutAtOnce, game.aogs.filter((event) => event.refitTo).length + game.aircraft.filter((a) => a.refitPending).length);
}
assert.equal(mostOutAtOnce, 1, 'more than one plane of the type out at the base at once');
assert.ok(game.aircraft.every((a) => seatPlanOf(a).business === 4 && seatPlanOf(a).premium === 8), 'not every plane got the standard');
assert.equal(fleetCabinStatus(game, 'REGIONAL').onStandard, 4);
assert.ok(game.cash < cashBefore, 'refits were not paid for');

// A plane refitted to something else keeps its own cabin, and isn't put back until told to follow.
const odd = game.aircraft[0];
assert.ok(orderRefit(game, odd.tail, { business: 0, premium: 0 }).ok);
assert.equal(odd.ownCabin, true);
for (let minute = 0; minute < 1440 * 6; minute++) step(game);
assert.deepEqual(seatPlanOf(odd), { business: 0, premium: 0 });
assert.equal(fleetCabinStatus(game, 'REGIONAL').own, 1);
assert.ok(followFleetCabin(game, odd.tail).ok);
assert.equal(odd.ownCabin, undefined);
assert.equal(fleetCabinStatus(game, 'REGIONAL').waiting, 1);

// A delivery arrives with the standard fitted.
const delivered = leaseAircraft(game, 'REGIONAL', home);
fitStandardOnDelivery(game, delivered);
assert.deepEqual(seatPlanOf(delivered), plan);

// Clearing the standard leaves every plane as it is.
assert.ok(setFleetCabin(game, 'REGIONAL', null).ok);
assert.equal(fleetCabinStatus(game, 'REGIONAL').waiting, 0);
console.log('ok: cabin templates, standard cabin rollout, deliveries');
