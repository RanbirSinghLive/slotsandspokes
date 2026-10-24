import assert from 'node:assert/strict';
import { cashRunway, checksOwed } from './forecast';
import { chooseHome } from './homes';
import { createNewGameState } from './state';

// The runway starts from cash less what is owed at checks, and its slope
// counts maintenance as flown, so a reserve paid this week isn't counted twice.
function newState() {
  const state = createNewGameState(1, 'YHZ');
  chooseHome(state, 'YHZ', 'summer', 'medium');
  return state;
}

// A plane's reserve is owed: it shortens the runway.
{
  const state = newState();
  state.cash = 100_000;
  state.cashHistory = [170_000, 160_000, 150_000, 140_000, 130_000, 120_000, 110_000, 100_000];
  state.maintenanceAccrualHistory = [0, 0, 0, 0, 0, 0, 0];
  for (const aircraft of state.aircraft) delete aircraft.maintenanceReserve;
  const before = checksOwed(state);
  const runway = cashRunway(state)!;
  assert.equal(runway.dailyDelta, -10_000);
  assert.equal(runway.daysLeft, Math.ceil((100_000 - before) / 10_000));

  state.aircraft[0].maintenanceReserve = 40_000;
  assert.equal(checksOwed(state), before + 40_000);
  assert.equal(cashRunway(state)!.daysLeft, Math.ceil((60_000 - before) / 10_000));
}

// Maintenance held back from flights this week isn't counted as cash earned.
{
  const state = newState();
  state.cash = 100_000;
  state.cashHistory = [100_000, 100_000];
  state.maintenanceAccrualHistory = [5_000];
  assert.equal(cashRunway(state)!.dailyDelta, -5_000);
}

// Owing more than cash is zero days left, even while cash rises.
{
  const state = newState();
  state.cash = 10_000;
  state.cashHistory = [5_000, 10_000];
  state.maintenanceAccrualHistory = [0];
  state.aircraft[0].maintenanceReserve = 50_000;
  assert.equal(cashRunway(state)!.daysLeft, 0);
}

console.log('runwaytest ok');
