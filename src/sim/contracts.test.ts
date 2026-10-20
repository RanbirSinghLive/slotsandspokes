import assert from 'node:assert/strict';
import airportCountries from '../../data/airport-countries.json';
import { counterRenewal, declineContract, GRACE_DAYS, setContractsOff, performanceFactor, counterTakeover, faceOf, graduation, makeOffers, renewalTerms, rollDailyContracts } from './contracts';
import { dayIndex } from './clock';
import { currentPotentialDemand } from './marketDemand';
import { marketKey } from './schedule';
import { standingOf } from './standing';
import { bidScore, BUYER_TYPES, buyerKey, buyerTypeOf, eligibleRivals, minAskPerDay, placeBid, reservePerDay, TENDER_OPEN_DAYS } from './tenders';
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

// Declining drops a tender; switching tenders off declines the open ones and stops new offers.
{
  const { state, id } = freshTender(3);
  assert.equal(declineContract(state, id).ok, true);
  const declined = state.contracts!.find((c) => c.id === id)!;
  assert.equal(declined.status, 'lapsed');
  assert.equal(declined.declined, true);
  assert.equal(declineContract(state, id).ok, false, 'a declined tender cannot be declined again');

  const fresh = freshTender(5);
  setContractsOff(fresh.state, true);
  assert.ok(fresh.state.contracts!.every((c) => c.status !== 'offered'), 'switching off declines open tenders');
  const before = fresh.state.contracts!.length;
  makeOffers(fresh.state, false);
  assert.equal(fresh.state.contracts!.length, before, 'no new offers while off');
  assert.ok(JSON.parse(JSON.stringify(fresh.state)).contractsOff, 'the switch is saved');
  setContractsOff(fresh.state, false);
  assert.equal(fresh.state.contractsOff, undefined);
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

// --- Satisfaction (sim/contracts.ts) -------------------------------------

{
  const { state, id } = freshTender(7);
  const tender = state.contracts!.find((c) => c.id === id)!;
  assert.equal(faceOf(tender), 'neutral', 'a new contract starts neutral');
  placeBid(state, id, tender.paymentPerDay, 1);
  state.schedule = [
    { legId: 's-0', tail: 'C-P001', origin: tender.a, dest: tender.b, departMinute: 360, blockMinutes: 90 },
    { legId: 's-1', tail: 'C-P001', origin: tender.b, dest: tender.a, departMinute: 600, blockMinutes: 90 },
  ];
  state.simMinute += 1440;
  rollDailyContracts(state);
  assert.equal(tender.status, 'active');
  // Days where nothing lands: the mood sinks slowly, not at once.
  rollDailyContracts(state);
  const afterOne = tender.satisfaction!;
  assert.ok(afterOne < 60 && afterOne > 55, `one missed day dents it (${afterOne})`);
  let days = 1;
  while (faceOf(tender) !== 'sad' && days < 60) {
    rollDailyContracts(state);
    days++;
  }
  assert.equal(faceOf(tender), 'sad');
  assert.ok(days > 5 && days < 30, `goes sad after a few weeks of missed days (${days})`);
  assert.ok((tender.sadDays ?? 0) >= 1);
  // Perfect flying brings the face back up.
  state.onTimeHistoryByMarket[marketKey(tender.a, tender.b)] = { arrived: [4], onTime: [4] } as never;
  const sadScore = tender.satisfaction!;
  tender.startedDay = dayIndex(state) - 30;
  rollDailyContracts(state);
  assert.ok(tender.satisfaction! > sadScore, 'a good day lifts it');
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(tender))), JSON.stringify(tender));
}
console.log('satisfaction: ok');

// --- Renewal, graduation, re-tender (sim/contracts.ts) -------------------

function runningContract(seed: number) {
  const { state, id } = freshTender(seed);
  const contract = state.contracts!.find((c) => c.id === id)!;
  // A big pair, so the market has room to build.
  contract.a = 'YHZ';
  contract.b = 'YYZ';
  placeBid(state, id, contract.paymentPerDay, 1);
  state.schedule = [
    { legId: 'r-0', tail: 'C-P001', origin: 'YHZ', dest: 'YYZ', departMinute: 360, blockMinutes: 90 },
    { legId: 'r-1', tail: 'C-P001', origin: 'YYZ', dest: 'YHZ', departMinute: 600, blockMinutes: 90 },
  ];
  state.simMinute += 1440;
  rollDailyContracts(state);
  assert.equal(contract.status, 'active');
  return { state, contract };
}

{
  const { state, contract } = runningContract(8);
  const base = contract.basePaymentPerDay!;
  assert.equal(base, contract.paymentPerDay);
  contract.satisfaction = 55;
  assert.equal(renewalTerms(state, contract).paymentPerDay, Math.round(base / 100) * 100, 'a neutral buyer renews at the first term');
  contract.satisfaction = 100;
  assert.ok(renewalTerms(state, contract).paymentPerDay > base * 1.1, 'a happy buyer pays more');
  contract.satisfaction = 25;
  const sadTerms = renewalTerms(state, contract);
  assert.ok(sadTerms.paymentPerDay < base, 'a sad buyer pays less');
  assert.equal(sadTerms.outcome, 'renew');

  // Counter: only in the window, only inside the band.
  contract.satisfaction = 90;
  assert.equal(counterRenewal(state, contract.id, base).ok, false, 'no counter before the window opens');
  contract.endsDay = dayIndex(state) + 10;
  const happy = renewalTerms(state, contract);
  assert.equal(counterRenewal(state, contract.id, happy.maxAsk + 1000).ok, false);
  assert.equal(counterRenewal(state, contract.id, happy.maxAsk).ok, true);
  // The mood keeps moving until the term ends; a low counter stays inside the band.
  assert.equal(counterRenewal(state, contract.id, happy.minAsk).ok, true);

  // Term end: renews on the counter, and again next term without compounding.
  contract.endsDay = dayIndex(state);
  rollDailyContracts(state);
  assert.equal(contract.status, 'active');
  assert.equal(contract.renewals, 1);
  assert.equal(contract.paymentPerDay, happy.minAsk, 'renewed on the counter');
  assert.equal(contract.renewalAsk, undefined);
  contract.endsDay = dayIndex(state);
  rollDailyContracts(state);
  assert.ok(contract.paymentPerDay <= Math.round((base * 1.15) / 100) * 100, 'repeat renewals do not compound');
}

{
  // Graduation: a market that has built to its potential no longer needs the contract.
  const { state, contract } = runningContract(9);
  const key = marketKey(contract.a, contract.b);
  state.marketDemand[key] = currentPotentialDemand(state, contract.a, contract.b) * 2;
  assert.ok(graduation(state, contract) < 0.25, 'a built market has graduated');
  const before = state.marketDemand[key];
  const count = state.contracts!.length;
  contract.endsDay = dayIndex(state);
  rollDailyContracts(state);
  assert.equal(contract.status, 'ended');
  assert.equal(state.marketDemand[key], before, 'a graduated market keeps what it built');
  assert.equal(state.contracts!.filter((c) => c.status === 'offered' && c.b === 'YYZ').length, 0, 'no new tender');
  void count;
}

{
  // An unhappy buyer ends it, the market snaps back, and the route goes out to tender.
  const { state, contract } = runningContract(10);
  const key = marketKey(contract.a, contract.b);
  state.marketDemand[key] = 30;
  contract.satisfaction = 10;
  contract.endsDay = dayIndex(state);
  rollDailyContracts(state);
  assert.equal(contract.status, 'ended');
  assert.ok(state.marketDemand[key] < 30, 'the market snaps back');
  const again = state.contracts!.find((c) => c.status === 'offered' && c.a === 'YHZ' && c.b === 'YYZ');
  assert.ok(again, 'the route is out to tender again');
  assert.equal(again!.paymentPerDay, contract.basePaymentPerDay);
}
console.log('renewal: ok');

// --- Takeover (sim/contracts.ts) ----------------------------------------

function circledContract(seed: number) {
  const { state, contract } = runningContract(seed);
  // A Canadian rival already at the far end may take a sad buyer's contract.
  state.competitorRoutes = [
    { airline: 'CC', code: 'CC', origin: 'YYZ', dest: 'YUL', dailyFrequency: 2, fare: 100, baseFare: 100, openedAtMinute: -999_999, homeCountry: 'CA' },
  ];
  contract.satisfaction = 10;
  contract.sadDays = 14;
  return { state, contract };
}

{
  // A buyer sad for 14 days opens a window; with no rival eligible nothing happens.
  const { state, contract } = circledContract(11);
  state.competitorRoutes = [];
  rollDailyContracts(state);
  assert.equal(contract.takeoverEndsDay, undefined, 'no rival, no takeover');
}

{
  // The window opens, then the rival takes the contract at the end and opens the market.
  const { state, contract } = circledContract(12);
  const key = marketKey(contract.a, contract.b);
  state.marketDemand[key] = 30;
  state.simMinute += 1440;
  rollDailyContracts(state);
  assert.equal(contract.takeoverBy, 'CC');
  assert.equal(contract.takeoverEndsDay, dayIndex(state) + 14);
  assert.equal(contract.status, 'active', 'the airline still has the contract during the window');
  state.simMinute += 1440 * 14;
  rollDailyContracts(state);
  assert.equal(contract.status, 'ended');
  assert.equal(contract.lostTo, 'CC');
  assert.ok(state.marketDemand[key] < 30, 'the market snaps back');
  assert.ok(state.competitorRoutes.some((r) => r.code === 'CC' && marketKey(r.origin, r.dest) === key), 'the rival opens the market');
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(contract))), JSON.stringify(contract));
}

{
  // A recovered buyer closes the window.
  const { state, contract } = circledContract(13);
  state.simMinute += 1440;
  rollDailyContracts(state);
  assert.ok(contract.takeoverEndsDay !== undefined);
  contract.satisfaction = 80;
  rollDailyContracts(state);
  assert.equal(contract.takeoverEndsDay, undefined);
  assert.equal(contract.status, 'active');
}

{
  // A price cut keeps it, lowers the renewal base, and restarts the sad streak.
  const { state, contract } = circledContract(14);
  state.simMinute += 1440;
  rollDailyContracts(state);
  const pay = contract.paymentPerDay;
  assert.equal(counterTakeover(state, contract.id, pay).ok, false, 'no cut is refused');
  assert.equal(counterTakeover(state, contract.id, pay * 0.5).ok, false, 'too deep a cut is refused');
  const base = contract.basePaymentPerDay!;
  assert.equal(counterTakeover(state, contract.id, pay * 0.8).ok, true);
  assert.ok(contract.paymentPerDay < pay);
  assert.ok(contract.basePaymentPerDay! < base);
  assert.equal(contract.takeoverEndsDay, undefined);
  assert.equal(contract.sadDays, 0);
}
console.log('takeover: ok');

// --- Buyer types and standing -------------------------------------------

{
  // A buyer's type is fixed by the community, and the types score bids differently.
  const { contract } = runningContract(20);
  assert.equal(buyerTypeOf(contract), buyerTypeOf({ ...contract }));
  assert.ok(BUYER_TYPES.includes(buyerTypeOf(contract)));
  assert.ok(bidScore(0.8, 1, 'province') > bidScore(0.8, 1, 'mine'), 'a province prizes the price of a once-daily bid');
  assert.ok(bidScore(1.3, 2, 'mine') > bidScore(1.3, 2, 'province'), 'a mine prizes twice-daily flying');
  assert.ok(bidScore(1, 1, 'health', 100) > bidScore(1, 1, 'health', 0), 'standing lifts the airline\'s score');
}

{
  // A happy term earns standing with the buyer, which then lifts the renewal ask.
  const { state, contract } = runningContract(21);
  const key = buyerKey(contract);
  assert.equal(standingOf(state, key), 0);
  contract.satisfaction = 90;
  contract.endsDay = dayIndex(state);
  rollDailyContracts(state);
  assert.ok(standingOf(state, key) >= 11, `a happy term earns standing (${standingOf(state, key)})`);
  const withStanding = renewalTerms(state, contract).priceMultiplier;
  state.standing = {};
  assert.ok(withStanding > renewalTerms(state, contract).priceMultiplier, 'standing raises the renewal ask');
}

{
  // A bad term, and losing the contract to a rival, cost standing.
  const { state, contract } = runningContract(22);
  const key = buyerKey(contract);
  state.standing = { [key]: 30 };
  contract.satisfaction = 30;
  contract.endsDay = dayIndex(state);
  rollDailyContracts(state);
  assert.ok(standingOf(state, key) < 30, 'a sad term costs standing');
  const second = circledContract(23);
  const rivalKey = buyerKey(second.contract);
  second.state.standing = { [rivalKey]: 40 };
  second.state.simMinute += 1440;
  rollDailyContracts(second.state);
  second.state.simMinute += 1440 * 14;
  rollDailyContracts(second.state);
  assert.equal(second.contract.status, 'ended');
  assert.ok(standingOf(second.state, rivalKey) < 40, 'losing it to a rival costs standing');
}
console.log('buyers: ok');

// --- Grace period and completion smoothing ------------------------------

{
  // Bad flying in the first two weeks is not judged; after that it is.
  const { state, contract } = runningContract(30);
  const key = marketKey(contract.a, contract.b);
  state.onTimeHistoryByMarket[key] = { arrived: Array(14).fill(2), onTime: Array(14).fill(0), cancelled: Array(14).fill(0) };
  assert.equal(performanceFactor(state, contract), 1, 'a new contract is not judged yet');
  const mood = contract.satisfaction ?? 60;
  contract.startedDay = dayIndex(state) - GRACE_DAYS;
  assert.ok(performanceFactor(state, contract) < 0.2, 'judged once the grace is over');
  contract.startedDay = dayIndex(state) - 1;
  state.simMinute += 1440;
  state.onTimeHistoryByMarket[key].arrived.push(4);
  state.onTimeHistoryByMarket[key].onTime.push(0);
  state.onTimeHistoryByMarket[key].cancelled.push(0);
  rollDailyContracts(state);
  assert.equal(contract.satisfaction ?? 60, mood, 'flown days in the grace do not move the mood');
}

{
  // One grounded day on a small sample dents performance but does not zero it.
  const { state, contract } = runningContract(31);
  contract.startedDay = dayIndex(state) - 30;
  const key = marketKey(contract.a, contract.b);
  state.onTimeHistoryByMarket[key] = {
    arrived: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0],
    onTime: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0],
    cancelled: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4],
  };
  assert.ok(performanceFactor(state, contract) > 0.3, `a grounded day is dented, not zeroed (${performanceFactor(state, contract)})`);
}
console.log('grace: ok');
