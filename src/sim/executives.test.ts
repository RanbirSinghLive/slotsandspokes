import assert from 'node:assert/strict';
import {
  appointBlockedReason,
  appointExecutive,
  candidateById,
  executiveMaintenanceMultiplier,
  executiveNetPerDay,
  executiveNpsBonus,
  executiveSalariesPerDay,
  executiveWorthPerDay,
  EXECUTIVE_ROLES,
  loadExecutives,
  migrateExecutives,
  seatOpensAt,
} from './executives';
import { AIRCRAFT_CLASSES } from './aircraftClasses';
import { chooseHome } from './homes';
import { LADDER } from './ladder';
import { createNewGameState } from './state';

// Run with `npm run executivetest`: three chairs and a board seat that
// opens at Network airline, effects that land by aircraft class, and old
// saves' seven chairs folded into the new ones.
function newState() {
  const state = createNewGameState(1, 'YUL');
  chooseHome(state, 'YUL', 'summer', 'medium');
  state.cash = 10_000_000;
  return state;
}

// Ids are unique, every candidate sits in a real chair, and each chair has four people with a weight per class.
const everyone = loadExecutives();
assert.equal(new Set(everyone.map((candidate) => candidate.id)).size, everyone.length);
for (const role of EXECUTIVE_ROLES) assert.equal(everyone.filter((candidate) => candidate.role === role).length, 4, role);
for (const candidate of everyone) assert.equal(candidate.classWeights.length, AIRCRAFT_CLASSES.length, candidate.id);
// Each effect kind belongs to one candidate, so two seated never stack the same lever.
assert.equal(new Set(everyone.map((candidate) => candidate.effect.kind)).size, everyone.length);

// The board seat waits for Network airline; a chair takes only its own people, the board anyone.
{
  const state = newState();
  assert.equal(seatOpensAt(state, 'coo'), null);
  assert.equal(seatOpensAt(state, 'board'), 'Network airline');
  assert.match(appointBlockedReason(state, candidateById('cco-lindqvist')!, 'board') ?? '', /Needs Network airline/);
  assert.match(appointBlockedReason(state, candidateById('cco-lindqvist')!, 'coo') ?? '', /Not a Operations candidate/);
  state.milestonesMet = Object.fromEntries(
    LADDER.slice(0, 2).flatMap((tier) => tier.milestones.filter((milestone) => !milestone.extra).map((milestone) => [milestone.id, 0])),
  );
  assert.equal(seatOpensAt(state, 'board'), null);
  assert.equal(appointExecutive(state, 'cco-lindqvist').ok, true);
  // The same person can't take two seats.
  assert.match(appointBlockedReason(state, candidateById('cco-lindqvist')!, 'board') ?? '', /Sits in Commercial/);
  assert.equal(appointExecutive(state, 'coo-maintenance', 'board').ok, true);
  assert.equal(state.executives.board?.candidateId, 'coo-maintenance');
  // Salaries: base plus a share per plane, for both.
  const planes = state.aircraft.length;
  assert.equal(executiveSalariesPerDay(state), 1500 + 100 * planes + 1500 + 100 * planes);
}

// Effects land by class: line maintenance is strongest on propellers; the inflight director does nothing on one.
{
  const state = newState();
  state.executives.coo = { candidateId: 'coo-maintenance', hiredAtMinute: 0 };
  state.executives.cco = { candidateId: 'coo-inflight', hiredAtMinute: 0 };
  const [prop, , , wide] = AIRCRAFT_CLASSES.map((aircraftClass) => aircraftClass.code);
  assert.ok(Math.abs(executiveMaintenanceMultiplier(state, prop) - 0.7) < 1e-9);
  assert.ok(executiveMaintenanceMultiplier(state, wide) > 0.9);
  assert.equal(executiveNpsBonus(state, prop), 0);
  assert.equal(executiveNpsBonus(state, wide), 10);
}

// The best fit moves with the fleet: on a propeller airline line maintenance out-earns the inflight director; on widebodies the reverse.
{
  const state = newState();
  state.revenueHistory = Array(7).fill(150_000);
  const [prop, , , wide] = AIRCRAFT_CLASSES.map((aircraftClass) => aircraftClass.code);
  const line = candidateById('coo-maintenance')!;
  const inflight = candidateById('coo-inflight')!;
  for (const aircraft of state.aircraft) aircraft.typeCode = prop;
  assert.equal(executiveWorthPerDay(state, inflight), 0);
  assert.ok(executiveWorthPerDay(state, line) > executiveWorthPerDay(state, inflight));
  for (const aircraft of state.aircraft) aircraft.typeCode = wide;
  assert.ok(executiveWorthPerDay(state, inflight) > executiveWorthPerDay(state, line));
  assert.ok(executiveNetPerDay(state, inflight) > 0);
}

// An old save's seven chairs fold into three and the board: each hire goes to whoever does their job now.
{
  const state = newState();
  (state as { executives: unknown }).executives = {
    coo: { candidateId: 'coo-inflight', hiredAtMinute: 10 },
    cfo: { candidateId: 'cfo-mercer', hiredAtMinute: 5 },
    cco: { candidateId: 'cco-sato', hiredAtMinute: 20 },
    cpo: { candidateId: 'cpo-malhotra', hiredAtMinute: 30 },
    dom: null,
    hoc: { candidateId: 'hoc-lindahl', hiredAtMinute: 40 },
    hga: null,
  };
  migrateExecutives(state);
  assert.deepEqual(Object.keys(state.executives).sort(), ['board', 'cco', 'cfo', 'coo']);
  // Whoever already sat in their own chair keeps it: Sato's job is the revenue manager's, still Commercial.
  assert.equal(state.executives.cco?.candidateId, 'cco-mensah');
  assert.equal(state.executives.cfo?.candidateId, 'cfo-mercer');
  // The inflight director, Commercial now, finds that chair taken and goes to the board, earliest hire first;
  // the chief pilot takes the Operations chair she left; freight (now the network planner) finds no seat.
  assert.equal(state.executives.board?.candidateId, 'coo-inflight');
  assert.equal(state.executives.coo?.candidateId, 'cpo-solheim');
  // Running it again changes nothing.
  const before = JSON.stringify(state.executives);
  migrateExecutives(state);
  assert.equal(JSON.stringify(state.executives), before);
}

console.log('executive tests passed');
