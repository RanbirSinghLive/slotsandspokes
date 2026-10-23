import assert from 'node:assert/strict';
import { milestonesAtLastRollover, weekOnWeekLoad } from './milestones';
import type { SimState } from './state';

// Run with `npm test -- milestones`: a crossing fires on the one rollover
// where the trailing week passes a line, and never again while it stays over.
function stateWith(passengers: number[], seats: number[], onTime: number[], arrived: number[]): SimState {
  return {
    schedule: [{ origin: 'YHZ', dest: 'BOS' }],
    loadHistoryByMarket: { 'BOS-YHZ': { passengers, seats } },
    loadHistory: { passengers, seats },
    onTimeHistoryByMarket: { 'BOS-YHZ': { arrived, onTime, cancelled: arrived.map(() => 0) } },
  } as unknown as SimState;
}

const seats = Array(10).fill(100);
const arrived = Array(10).fill(2);
// Load climbs from 50% to 80%; the 7-day average crosses 60% partway through.
const climbing = [50, 50, 50, 50, 50, 50, 50, 80, 80, 80];
const fired: number[] = [];
for (let day = 4; day <= climbing.length; day++) {
  const found = milestonesAtLastRollover(stateWith(climbing.slice(0, day), seats.slice(0, day), arrived.slice(0, day), arrived.slice(0, day)));
  if (found.some((m) => m.kind === 'load' && m.level === 0.6)) fired.push(day);
}
assert.equal(fired.length, 1, `60% fired on days ${fired.join(', ')}`);

// On-time goes from 50% to all on time; it pops once when the week reaches 90%.
const late = [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2];
const otpFired: number[] = [];
for (let day = 4; day <= late.length; day++) {
  const found = milestonesAtLastRollover(stateWith(Array(day).fill(50), Array(day).fill(100), late.slice(0, day), Array(day).fill(2)));
  if (found.some((m) => m.kind === 'onTime')) otpFired.push(day);
}
assert.equal(otpFired.length, 1, `on-time fired on days ${otpFired.join(', ')}`);

// Each end of the route counts its passengers: at 40 a day rising to 120, both airports pop as the week passes 50 and 100.
const growing = [40, 40, 40, 40, 40, 40, 40, 120, 120, 120, 120, 120, 120, 120];
const airportPops: string[] = [];
for (let day = 5; day <= growing.length; day++) {
  const found = milestonesAtLastRollover(stateWith(growing.slice(0, day), Array(day).fill(200), Array(day).fill(2), Array(day).fill(2)));
  for (const m of found) if (m.kind === 'airport') airportPops.push(`${m.iata} ${m.level}`);
}
assert.deepEqual(airportPops.sort(), ['BOS 100', 'BOS 50', 'YHZ 100', 'YHZ 50'], airportPops.join(', '));

const trend = weekOnWeekLoad(stateWith([...Array(7).fill(40), ...Array(7).fill(70)], Array(14).fill(100), Array(14).fill(2), Array(14).fill(2)), 'YHZ', 'BOS');
assert.ok(trend && Math.abs(trend.now - 0.7) < 1e-9 && Math.abs(trend.before - 0.4) < 1e-9);
assert.equal(weekOnWeekLoad(stateWith([70], [100], [2], [2]), 'YHZ', 'BOS'), null, 'no trend without a week before');
console.log('milestones ok');
