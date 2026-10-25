import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { nextSlotFees, rivalSlotQuote } from './slots';
import { step } from './step';

// Run with `npm test -- slotsOwnTraffic`: the player's own flights at a
// hub raise the player's next slot there less than a rival's, so a hub
// isn't priced out by its own growth but stays dear to move into.
const player = createPlayer('steady');
const state = startHeadlessGame('PHL', 1, player);
for (let day = 1; day <= 30; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}
const hub = state.homeAirport;
const [ours] = nextSlotFees(state, hub, 1);
assert.ok(ours !== null && ours > 0, 'the home field sells a pair');

// A rival's quote is both ends; price the same field at each end and halve it.
const rivals = rivalSlotQuote(state, hub, hub)!;
assert.ok(rivals / 2 > ours, `a rival pays more at ${hub} (${rivals / 2}) than the player (${ours})`);

// Twice the player's flights at the hub: the player's next pair rises, and still costs less than a rival's.
const doubled = structuredClone(state);
doubled.schedule = [...state.schedule, ...state.schedule.map((leg) => ({ ...leg, legId: `${leg.legId}-copy` }))];
const [oursDoubled] = nextSlotFees(doubled, hub, 1);
const rivalsDoubled = rivalSlotQuote(doubled, hub, hub)! / 2;
assert.ok(oursDoubled !== null && oursDoubled >= ours, 'more of your own flights never makes your next pair cheaper');
assert.ok(oursDoubled < rivalsDoubled, 'a rival still pays more after the hub doubles');

console.log(`slots own traffic ok: ${hub} next pair $${ours} yours, $${rivals / 2} a rival's; doubled $${oursDoubled} vs $${rivalsDoubled}`);
