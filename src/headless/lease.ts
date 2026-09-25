import aircraftTypesData from '../../data/aircraft-types.json';
import airportsData from '../../data/airports.json';
import { leaseAircraft, loadLeaseRates } from '../sim/leasing';
import { greatCircleDistanceNm } from '../sim/geo';
import { policyFare } from '../sim/pricing';
import { computeBlockMinutes, marketKey, MIN_TURN_MINUTES } from '../sim/schedule';
import { createNewGameState } from '../sim/state';
import { step } from '../sim/step';
import { USABLE_DAY_END_MINUTE, USABLE_DAY_START_MINUTE } from '../sim/utilisation';

/**
 * Lease-rate tuning: what does one plane of each class earn, per day,
 * before its lease, flying a market it suits? Lease rates are the whole
 * plane budget now that nothing can be bought (sim/leasing.ts), so they
 * should be read against this, not chosen by feel.
 *
 *   npm run lease            # the default experiments
 *   npm run lease -- 365     # a different horizon, in days
 *
 * Each experiment is one plane of one class flying back-to-back
 * round trips on one market for as many hours as fit in the usable day.
 * The plane's own lease is set to zero so the figures are earnings before
 * lease; the tool then prints the lease rate beside them. Same seed every
 * time, so rows are like-for-like (see sweep.ts for why).
 */

const MINUTES_PER_DAY = 1440;
const SEED = 1;
const HORIZON_DAYS = Number(process.argv[2]) || 180;
// Days at which to report the trailing 30-day average, so growth as the
// market matures is visible rather than averaged away.
const CHECKPOINTS = [30, 90, 180, 365].filter((d) => d <= HORIZON_DAYS);

type Classes = { code: string; name: string; seats: number; cruiseKts: number; rangeNm: number }[];
const classes = aircraftTypesData as Classes;
const airportByIata = new Map((airportsData as { iata: string; lat: number; lon: number }[]).map((a) => [a.iata, a]));
const rateByClass = new Map(loadLeaseRates().map((r) => [r.typeCode, r.leasePricePerDay]));

type Experiment = { typeCode: string; base: string; other: string; /** Cap on round trips a day; default is as many as fit. */ trips?: number };
const EXPERIMENTS: Experiment[] = [
  { typeCode: 'PROP', base: 'YUL', other: 'YOW' },
  { typeCode: 'PROP', base: 'YUL', other: 'YQB' },
  { typeCode: 'REGIONAL', base: 'YUL', other: 'YQB' },
  { typeCode: 'REGIONAL', base: 'YUL', other: 'YYZ' },
  { typeCode: 'REGIONAL', base: 'YYZ', other: 'YHZ' },
  { typeCode: 'NARROWBODY', base: 'YUL', other: 'YYZ' },
  { typeCode: 'NARROWBODY', base: 'YUL', other: 'LGA' },
  { typeCode: 'NARROWBODY', base: 'YYZ', other: 'YHZ' },
  { typeCode: 'WIDEBODY', base: 'YUL', other: 'YYZ' },
  { typeCode: 'WIDEBODY', base: 'YYZ', other: 'BOS' },
  // Long haul: the routes the bigger classes exist for.
  { typeCode: 'NARROWBODY', base: 'YYZ', other: 'LAX' },
  { typeCode: 'NARROWBODY', base: 'YYZ', other: 'DFW' },
  { typeCode: 'NARROWBODY', base: 'BOS', other: 'ATL' },
  { typeCode: 'WIDEBODY', base: 'YYZ', other: 'LHR' },
  { typeCode: 'WIDEBODY', base: 'BOS', other: 'LHR' },
  { typeCode: 'WIDEBODY', base: 'YUL', other: 'CDG' },
  { typeCode: 'WIDEBODY', base: 'DFW', other: 'LHR' },
  { typeCode: 'WIDEBODY', base: 'LHR', other: 'DXB' },
  { typeCode: 'WIDEBODY', base: 'LHR', other: 'JNB' },
  { typeCode: 'WIDEBODY', base: 'LAX', other: 'HND' },
  // Misuse: a big plane on a thin market. These should lose money.
  { typeCode: 'REGIONAL', base: 'YUL', other: 'YOW' },
  { typeCode: 'NARROWBODY', base: 'YUL', other: 'YOW' },
  { typeCode: 'WIDEBODY', base: 'YUL', other: 'YOW' },
];

function runExperiment(experiment: Experiment): { perDay: number[]; roundTrips: number; blockHours: number } {
  const type = classes.find((c) => c.code === experiment.typeCode)!;
  const state = createNewGameState(SEED);
  state.aircraft = [];
  const plane = leaseAircraft(state, type.code, experiment.base);
  plane.leaseCostPerDay = 0;

  const block = computeBlockMinutes(experiment.base, experiment.other, type.cruiseKts);
  const roundTripMinutes = 2 * (block + MIN_TURN_MINUTES);
  let depart = USABLE_DAY_START_MINUTE;
  let roundTrips = 0;
  while (depart + 2 * block + MIN_TURN_MINUTES <= USABLE_DAY_END_MINUTE && roundTrips < (experiment.trips ?? Infinity)) {
    for (const [origin, dest, at] of [
      [experiment.base, experiment.other, depart],
      [experiment.other, experiment.base, depart + block + MIN_TURN_MINUTES],
    ] as const) {
      state.schedule.push({
        legId: `L${state.schedule.length + 1}`,
        tail: plane.tail,
        origin,
        dest,
        departMinute: at,
        blockMinutes: block,
      });
    }
    roundTrips++;
    depart += roundTripMinutes;
  }
  // A rotation too long for the usable day is still one round trip around
  // the clock (see sim/utilisation.ts's isLongHaulRoundTrip()).
  if (roundTrips === 0 && roundTripMinutes <= MINUTES_PER_DAY) {
    for (const [origin, dest, at] of [
      [experiment.base, experiment.other, USABLE_DAY_START_MINUTE],
      [experiment.other, experiment.base, USABLE_DAY_START_MINUTE + block + MIN_TURN_MINUTES],
    ] as const) {
      state.schedule.push({ legId: `L${state.schedule.length + 1}`, tail: plane.tail, origin, dest, departMinute: at, blockMinutes: block });
    }
    roundTrips = 1;
  }
  state.routeSettings[marketKey(experiment.base, experiment.other)] = {
    fare: policyFare(state, experiment.base, experiment.other),
    fareIsOverridden: false,
    fareStance: null,
    marketingSpend: 0,
    turnBufferMinutes: 0,
  };

  const perDay: number[] = [];
  for (let day = 1; day <= HORIZON_DAYS; day++) {
    for (let minute = 0; minute < MINUTES_PER_DAY; minute++) step(state);
    perDay.push(state.todayMargin);
  }
  return { perDay, roundTrips, blockHours: (roundTrips * 2 * block) / 60 };
}

function trailingAverage(values: number[], day: number): number {
  const window = values.slice(Math.max(0, day - 30), day);
  return window.reduce((total, v) => total + v, 0) / window.length;
}

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;

console.log(`One plane, round trips all day, earnings per day BEFORE lease (trailing 30-day average at each day).\n`);
console.log(
  [
    'class',
    'market',
    'nm',
    'trips',
    ...CHECKPOINTS.map((d) => `day ${d}`),
    'per flight d30',
    'per flight d90',
    'lease/day',
    'breakeven flights d30',
    'breakeven flights d90',
  ].join('\t'),
);
for (const experiment of EXPERIMENTS) {
  const result = runExperiment(experiment);
  const nm = Math.round(greatCircleDistanceNm(airportByIata.get(experiment.base)!, airportByIata.get(experiment.other)!));
  const flights = result.roundTrips * 2;
  const lease = rateByClass.get(experiment.typeCode) ?? 0;
  const perFlight30 = trailingAverage(result.perDay, 30) / flights;
  const perFlight90 = trailingAverage(result.perDay, Math.min(90, HORIZON_DAYS)) / flights;
  console.log(
    [
      experiment.typeCode,
      `${experiment.base}-${experiment.other}`,
      nm,
      result.roundTrips,
      ...CHECKPOINTS.map((d) => money(trailingAverage(result.perDay, d))),
      money(perFlight30),
      money(perFlight90),
      money(lease),
      perFlight30 > 0 ? (lease / perFlight30).toFixed(1) : 'never',
      perFlight90 > 0 ? (lease / perFlight90).toFixed(1) : 'never',
    ].join('\t'),
  );
}

// How the plane a new game starts with does when it is not flown all day:
// cumulative profit AFTER its lease, by round trips a day.
console.log('\nStarting propeller on YUL-YOW, cumulative profit after lease:');
const EARLY_DAYS = [10, 30, 60, 90, 180, 365].filter((d) => d <= HORIZON_DAYS);
console.log(['round trips/day', ...EARLY_DAYS.map((d) => `day ${d}`)].join('\t'));
for (const trips of [1, 2, 3, 5]) {
  const result = runExperiment({ typeCode: 'PROP', base: 'YUL', other: 'YOW', trips });
  const lease = rateByClass.get('PROP') ?? 0;
  const cumulative = (day: number) => result.perDay.slice(0, day).reduce((t, v) => t + v - lease, 0);
  console.log([trips, ...EARLY_DAYS.map((d) => money(cumulative(d)))].join('\t'));
}
