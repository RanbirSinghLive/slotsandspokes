import assert from 'node:assert/strict';
import { chooseHome } from './homes';
import { entrySpacingDaysLeft, recentlyEnteredByRival, RIVAL_ENTRY_SPACING_DAYS } from './pressure';
import { createNewGameState } from './state';

// Rivals enter a market one at a time: a fresh opening holds every other
// rival off it for RIVAL_ENTRY_SPACING_DAYS, and pre-existing routes don't.
const state = createNewGameState(1, 'YYZ');
chooseHome(state, 'YYZ', 'summer', 'medium');
state.simMinute = 300 * 1440;
const seeded = state.competitorRoutes[0];
assert.equal(recentlyEnteredByRival(state, seeded.origin, seeded.dest), false, 'a pre-existing route holds no one off');

state.competitorRoutes.push({ ...seeded, origin: 'YYZ', dest: 'ATL', code: 'ZZ', openedAtMinute: state.simMinute - 5 * 1440 });
assert.equal(recentlyEnteredByRival(state, 'ATL', 'YYZ'), true, 'either direction');
assert.equal(entrySpacingDaysLeft(state, 'YYZ', 'ATL'), RIVAL_ENTRY_SPACING_DAYS - 5);
state.simMinute += (RIVAL_ENTRY_SPACING_DAYS - 5) * 1440;
assert.equal(recentlyEnteredByRival(state, 'YYZ', 'ATL'), false, 'the gap ends');

console.log('rivalspacingtest ok');
