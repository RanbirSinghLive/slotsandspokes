import assert from 'node:assert/strict';
import { createPlayer } from '../headless/player';
import { startHeadlessGame } from '../headless/newGame';
import { dayIndex } from './clock';
import { type Crisis, openCrisis, previewCrisis, setCrisisWaived, shouldWaive } from './crisis';
import { setCallPolicy, setRoutePriority } from './priority';
import { step } from './step';

// Run with `npm run crisistest`: a storm forecast two days out is settled at
// its day's rollover. Flying on and meeting it closes the airport and costs a
// care bill; waiving cancels the day ahead for a quarter of that and a lighter
// NPS hit; a forecast that misses costs nothing unless it was waived.
const player = createPlayer('steady');
const state = startHeadlessGame('YYZ', 1, player);
state.callPolicy = 'ask'; // the tests set the policy they need
for (let day = 1; day <= 40; day++) {
  for (let minute = 0; minute < 1440; minute++) step(state);
  player.playDay(state);
}
const saved = JSON.stringify(state);
function restore(): void {
  for (const key of Object.keys(state)) delete (state as Record<string, unknown>)[key];
  Object.assign(state, JSON.parse(saved));
}

const counts = new Map<string, number>();
for (const leg of state.schedule) counts.set(leg.origin, (counts.get(leg.origin) ?? 0) + 1);
const airport = [...counts].sort((a, b) => b[1] - a[1])[0][0];

function forecast(chance: number, waived = false): Crisis {
  const crisis: Crisis = { id: 99, airport, announcedDay: dayIndex(state), day: dayIndex(state) + 1, chance, status: 'forecast', waived, paid: 0, flights: 0 };
  state.crises = [crisis];
  return crisis;
}

/** Every cancellation so far, whatever the cause. */
function cancelledTotal(): number {
  return Object.values(state.cancellationsByCause).reduce((sum, n) => sum + (n ?? 0), 0);
}

/** Plays to the next rollover, where the forecast is settled. */
function throughRollover(): void {
  const day = dayIndex(state);
  while (dayIndex(state) === day) step(state);
  // The rollover runs on the first minute of the new day.
  step(state);
}

const preview = previewCrisis(state, forecast(0.7));
assert.ok(preview.flights >= 4 && preview.passengers > 0 && preview.care > 0, 'the preview should price the airport\'s day');
assert.ok(preview.breakEven > 0 && preview.breakEven < 1);

// Fly on, storm comes.
restore();
let crisis = forecast(1);
let cash = state.cash;
let weatherBefore = state.cancellationsByCause.weather;
const cancelledBefore = cancelledTotal();
throughRollover();
assert.equal(crisis.status, 'hit');
assert.ok(crisis.paid > 0 && crisis.flights >= 4, 'a hit should cost a care bill');
assert.ok(state.cancellationsByCause.weather > weatherBefore, 'the storm should cancel flights as weather');
// A flight whose plane is already grounded for crew or an AOG, or held by a maintenance check, counts under that cause first, so all causes are summed.
assert.ok(cancelledTotal() - cancelledBefore >= crisis.flights - 1, 'the closed airport should cancel its flights');
assert.ok(state.cash < cash, 'cash should fall');
console.log(`fly on, hit: ok · ${crisis.flights} flights · care $${crisis.paid}`);
const careHit = crisis.paid;

// Waive, storm comes: cheaper care, lighter NPS, cancelled as waived.
restore();
crisis = forecast(1, true);
throughRollover();
assert.equal(crisis.status, 'hit');
assert.ok((state.cancellationsByCause.waived ?? 0) >= crisis.flights, 'waived flights should count under their own cause');
assert.ok(Math.abs(crisis.paid - careHit * 0.25) <= careHit * 0.02 + 1, 'a waived day pays a quarter of the care bill');
console.log('waive, hit: ok');

// Waive, storm misses: the day is lost anyway.
restore();
crisis = forecast(0, true);
throughRollover();
assert.equal(crisis.status, 'missed');
assert.ok(crisis.flights >= 4 && (state.cancellationsByCause.waived ?? 0) >= crisis.flights);
console.log('waive, miss: ok');

// Fly on, storm misses: nothing.
restore();
crisis = forecast(0);
cash = state.cash;
weatherBefore = state.cancellationsByCause.weather;
throughRollover();
assert.equal(crisis.status, 'missed');
assert.equal(crisis.paid, 0);
assert.equal(state.cancellationsByCause.weather, weatherBefore);
console.log('fly on, miss: ok');

// The player's choice, and its deadline.
restore();
crisis = forecast(0.9);
crisis.day = dayIndex(state) + 2;
assert.ok(setCrisisWaived(state, 99, true).ok && crisis.waived);
crisis.day = dayIndex(state);
assert.equal(setCrisisWaived(state, 99, false).ok, false, 'no changing your mind once the day has begun');

// The priority policy waives above the break-even, unless a route there is keep; ask never waives by itself.
restore();
crisis = forecast(0.95);
setCallPolicy(state, 'priority');
assert.ok(shouldWaive(state, crisis));
throughRollover();
assert.ok(crisis.waived, 'priority should waive a near-certain storm');
restore();
crisis = forecast(0.95);
setCallPolicy(state, 'priority');
for (const leg of state.schedule) if (leg.origin === crisis.airport || leg.dest === crisis.airport) setRoutePriority(state, leg.origin, leg.dest, 'keep');
throughRollover();
assert.equal(crisis.waived, false, 'a keep route at the airport flies on');
restore();
crisis = forecast(0.95);
setCallPolicy(state, 'ask');
throughRollover();
assert.equal(crisis.waived, false, 'ask never waives by itself');
assert.equal(openCrisis(state), undefined);
console.log('crisis policy: ok');
