import assert from 'node:assert/strict';
import airportCountries from '../../data/airport-countries.json';
import { makeOffers, rollDailyContracts } from './contracts';
import { eligibleRivals, minAskPerDay, placeBid, reservePerDay, TENDER_OPEN_DAYS } from './tenders';
import { chooseHome } from './homes';
import { createNewGameState } from './state';

// Run with `npm run contracttest`: a Halifax airline with legs at several
// US airports is never offered a contract between two of them, since
// cabotage is barred for a Canadian carrier (sim/rights.ts).
const country = airportCountries as Record<string, string>;
let offered = 0;
for (let seed = 1; seed <= 40; seed++) {
  const state = createNewGameState(seed, 'YHZ');
  chooseHome(state, 'YHZ', 'summer', 'medium');
  state.contracts = [];
  const usAirports = ['BOS', 'PWM', 'SYR', 'ROC', 'GRR', 'BUF'];
  state.knownAirports = [...new Set([...state.knownAirports, ...usAirports])];
  state.schedule = usAirports.map((iata, i) => ({ legId: `t-${i}`, tail: 'C-P001', origin: 'YHZ', dest: iata, departMinute: 360, blockMinutes: 100 }));
  makeOffers(state, false);
  for (const contract of state.contracts) {
    offered++;
    assert.ok(country[contract.a] !== 'US' || country[contract.b] !== 'US', `seed ${seed}: ${contract.a}-${contract.b} is US-US for a Canadian carrier`);
  }
}
assert.ok(offered > 0, 'the check made no offers to inspect');
console.log(`contract rights: ok (${offered} offers checked)`);

// --- Tenders (sim/tenders.ts) ------------------------------------------

function freshTender(seed: number): { state: ReturnType<typeof createNewGameState>; id: number } {
  const state = createNewGameState(seed, 'YHZ');
  chooseHome(state, 'YHZ', 'summer', 'medium');
  state.contracts = [];
  state.competitorRoutes = [];
  makeOffers(state, true);
  assert.ok(state.contracts.length > 0, `seed ${seed}: no tender to bid on`);
  return { state, id: state.contracts[0].id };
}

// A tender nobody else can bid on is awarded at the ask, within the band.
{
  const { state, id } = freshTender(3);
  const tender = state.contracts!.find((c) => c.id === id)!;
  const reserve = reservePerDay(tender, 1);
  assert.equal(placeBid(state, id, reserve + 5000, 1).ok, false, 'an ask over the reserve is refused');
  assert.equal(placeBid(state, id, 100, 1).ok, false, 'an ask under the lowest is refused');
  const outcome = placeBid(state, id, reserve, 1);
  assert.equal(outcome.ok, true);
  assert.equal(tender.awardedDay, 0, 'a solo bid is awarded at once');
  assert.equal(tender.paymentPerDay, reserve, 'pays the ask');
  assert.equal(placeBid(state, id, reserve, 1).ok, false, 'an awarded tender cannot be rebid');
}

// Twice-daily flying: bigger band, more riders, and it needs four legs to start.
{
  const { state, id } = freshTender(4);
  const tender = state.contracts!.find((c) => c.id === id)!;
  const ridersOnce = tender.ridersPerDay;
  assert.ok(reservePerDay(tender, 2) > reservePerDay(tender, 1) * 1.5);
  assert.equal(placeBid(state, id, minAskPerDay(tender, 2), 2).ok, true);
  assert.equal(tender.frequency, 2);
  assert.equal(tender.ridersPerDay, Math.round(ridersOnce * 1.5));
  const legsFor = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ legId: `f-${i}`, tail: 'C-P001', origin: tender.a, dest: tender.b, departMinute: 360 + i * 200, blockMinutes: 90 }));
  state.schedule = legsFor(2);
  state.simMinute += 1440;
  rollDailyContracts(state);
  assert.equal(tender.status, 'offered', 'two legs do not start a twice-daily contract');
  state.schedule = legsFor(4);
  rollDailyContracts(state);
  assert.equal(tender.status, 'active');
}

// Flying an unbid tender is a bid at the reference, as before bidding existed.
{
  const { state, id } = freshTender(5);
  const tender = state.contracts!.find((c) => c.id === id)!;
  const reference = tender.paymentPerDay;
  state.schedule = [
    { legId: 'x-0', tail: 'C-P001', origin: tender.a, dest: tender.b, departMinute: 360, blockMinutes: 90 },
    { legId: 'x-1', tail: 'C-P001', origin: tender.b, dest: tender.a, departMinute: 600, blockMinutes: 90 },
  ];
  state.simMinute += 1440;
  rollDailyContracts(state);
  assert.equal(tender.status, 'active');
  assert.equal(tender.paymentPerDay, reference);
}

// Rivals: one whose country may not fly the market never bids; one that does decides contested tenders.
{
  const { state, id } = freshTender(6);
  const tender = state.contracts!.find((c) => c.id === id)!;
  // Both ends in Canada, so a US carrier would be flying cabotage.
  tender.a = 'YHZ';
  tender.b = 'YSJ';
  const rivalRoute = (code: string, homeCountry: string) => ({
    airline: code,
    code,
    origin: tender.b,
    dest: 'BOS',
    dailyFrequency: 2,
    fare: 100,
    baseFare: 100,
    openedAtMinute: -999_999,
    homeCountry,
  });
  state.competitorRoutes = [rivalRoute('UU', 'US')];
  assert.deepEqual(eligibleRivals(state, tender), [], 'a US rival cannot fly a Canadian market');
  state.competitorRoutes = [rivalRoute('CC', 'CA')];
  assert.deepEqual(eligibleRivals(state, tender), ['CC']);
  assert.equal(placeBid(state, id, minAskPerDay(tender, 2), 2).ok, true);
  assert.equal(tender.awardedDay, undefined, 'a contested tender waits for its deadline');
}

// Across seeds: the cheapest twice-daily bid always beats a rival; the dearest once-daily bid loses to one sometimes.
{
  let lowWins = 0;
  let highWins = 0;
  let highLosses = 0;
  const runs = 60;
  for (const [ask, frequency] of [['low', 2], ['high', 1]] as const) {
    for (let seed = 1; seed <= runs; seed++) {
      const { state, id } = freshTender(seed);
      const tender = state.contracts!.find((c) => c.id === id)!;
      state.competitorRoutes = [{ airline: 'CC', code: 'CC', origin: tender.b, dest: 'BOS', dailyFrequency: 2, fare: 100, baseFare: 100, openedAtMinute: -999_999, homeCountry: 'CA' }];
      placeBid(state, id, ask === 'low' ? minAskPerDay(tender, frequency) : reservePerDay(tender, frequency), frequency);
      state.simMinute += 1440 * (TENDER_OPEN_DAYS + 1);
      rollDailyContracts(state);
      const won = tender.awardedDay !== undefined;
      if (ask === 'low') lowWins += won ? 1 : 0;
      else if (won) highWins++;
      else {
        highLosses++;
        assert.equal(tender.status, 'lapsed');
        assert.equal(tender.lostTo, 'CC');
      }
      assert.equal(JSON.stringify(JSON.parse(JSON.stringify(state.contracts))), JSON.stringify(state.contracts), 'contracts survive a save');
    }
  }
  assert.ok(highLosses > 0 && highWins > 0, `a dear bid should sometimes win (${highWins}) and sometimes lose (${highLosses})`);
  assert.ok(lowWins > 0, 'a cheap bid should win when the rival stays out');
}
console.log('tenders: ok');
