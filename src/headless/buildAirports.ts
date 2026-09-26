import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Builds data/airports.json from public data, so every coordinate,
 * population and time zone is reproducible rather than typed in.
 *
 *   npm run airports
 *
 * Sources (both public, per CLAUDE.md):
 *   - OurAirports (airports.csv): latitude and longitude, by IATA code.
 *   - GeoNames (cities1000): populations and time zones of every place
 *     over 1,000 people.
 *
 * **Population is a catchment.** Every GeoNames place is given to the one
 * airport nearest to it, if that airport is within CATCHMENT_MAX_KM, and
 * an airport's population is the total of the places it was given. So
 * every person is counted once: two airports near each other split the
 * towns between them rather than both claiming them, which is what the
 * gravity model (sim/demand.ts) needs to stay sane as the map fills in.
 * That split is a Voronoi partition: each point on the map belongs to
 * whichever airport is closest.
 *
 * GeoNames lists some cities *and* their districts (New York City and
 * also Brooklyn, Queens, Manhattan and the Bronx), so a plain total would
 * count those people twice. Two rules stop that. Places marked as a
 * section of a city (feature code PPLX) are left out. And any place
 * inside a bigger place's built-up area is left out: the area is taken as
 * a circle holding that population at URBAN_DENSITY_PER_KM2, so New York
 * City (8.8 million) covers about 24 km and swallows its boroughs, while
 * Laval, 13 km from Montreal's centre, lies outside Montreal's 11 km and
 * counts. A separate city that close in (Newark, next to New York) is
 * lost too, which is a small error against its metro.
 *
 * **Time zones** are the *standard* offset (no daylight saving), from the
 * biggest place in the catchment (CLAUDE.md: DST is out of scope). The
 * smaller of the January and July offsets is the standard one, whichever
 * hemisphere the airport is in.
 *
 * People count only toward an airport in their own country, so El Paso
 * doesn't take Ciudad Juárez, nor Singapore Johor Bahru.
 *
 * **Which airports.** The hand-kept list below (AIRPORTS), then a
 * fill-out of the US and Canada from every large or medium airport with
 * scheduled service (FILL_COUNTRIES), FILL_ADDED_COUNT of them. The main hubs in FILL_HUBS go first, so a metro
 * with two big airports keeps the one people know (San Francisco, not
 * Oakland). After them, airports are added one at a time, each time the
 * one that would take the most people not already nearer another airport
 * on the map. Ranking by everyone within reach instead would favour
 * small fields on the edge of a big city (Islip, beside New York) over
 * real cities further out.
 *
 * All the large airports are added before any medium one. Otherwise a
 * small field beside a city can take the city's people first, keep the
 * city's own airport off the map by being too close to it, and end up
 * serving the city from the wrong place (Truckee instead of Reno).
 *
 * One airport per metro on purpose: a candidate within
 * METRO_SEPARATION_KM of an airport already chosen is skipped.
 * Catchments keep two airports in one city from double-counting its
 * people, but the pair would still read as a big market over almost no
 * distance, which nobody would fly. sim/demand.ts's MIN_MARKET_NM zeroes
 * any such pair as a safety net.
 */

/**
 * Every airport on the map, in file order, with its display name.
 * OurAirports names run to "Detroit Metropolitan Wayne County" and
 * "São Paulo/Guarulhos–Governor André Franco Montoro"; these keep the
 * short style ("Toronto Pearson"). Only the label is hand-written:
 * coordinates, population and time zone come from the data.
 */
const AIRPORTS: [iata: string, name: string][] = [
  // Eastern Canada, New York and Boston: the propeller-scale core
  ['YUL', 'Montréal–Trudeau'],
  ['YYZ', 'Toronto Pearson'],
  ['YOW', 'Ottawa Macdonald'],
  ['YQB', 'Québec City Lesage'],
  ['YHZ', 'Halifax Stanfield'],
  ['YSJ', 'Saint John'],
  ['YFC', 'Fredericton'],
  ['YQM', 'Greater Moncton'],
  ['YYG', 'Charlottetown'],
  ['YYT', "St. John's"],
  ['YDF', 'Deer Lake'],
  ['YQX', 'Gander'],
  ['YYR', 'Goose Bay'],
  ['YQY', 'Sydney'],
  ['YUY', 'Rouyn-Noranda'],
  ['YBG', 'Saguenay–Bagotville'],
  ['LGA', 'LaGuardia'],
  ['BOS', 'Boston Logan'],
  // The rest of North America
  ['DTW', 'Detroit'],
  ['PHL', 'Philadelphia'],
  ['DCA', 'Washington Reagan'],
  ['ORD', "Chicago O'Hare"],
  ['ATL', 'Atlanta'],
  ['MIA', 'Miami'],
  ['DFW', 'Dallas Fort Worth'],
  ['LAX', 'Los Angeles'],
  ['YVR', 'Vancouver'],
  ['MEX', 'Mexico City'],
  // Europe
  ['LHR', 'London Heathrow'],
  ['CDG', 'Paris Charles de Gaulle'],
  ['AMS', 'Amsterdam Schiphol'],
  ['FRA', 'Frankfurt'],
  ['DUB', 'Dublin'],
  ['KEF', 'Reykjavík Keflavík'],
  ['MAN', 'Manchester'],
  ['BHX', 'Birmingham'],
  ['EDI', 'Edinburgh'],
  ['GLA', 'Glasgow'],
  ['MAD', 'Madrid Barajas'],
  ['BCN', 'Barcelona'],
  ['AGP', 'Málaga'],
  ['PMI', 'Palma de Mallorca'],
  ['LIS', 'Lisbon'],
  ['OPO', 'Porto'],
  ['FCO', 'Rome Fiumicino'],
  ['MXP', 'Milan Malpensa'],
  ['VCE', 'Venice'],
  ['NAP', 'Naples'],
  ['MUC', 'Munich'],
  ['BER', 'Berlin Brandenburg'],
  ['HAM', 'Hamburg'],
  ['DUS', 'Düsseldorf'],
  ['BRU', 'Brussels'],
  ['ZRH', 'Zürich'],
  ['GVA', 'Geneva'],
  ['VIE', 'Vienna'],
  ['NCE', 'Nice'],
  ['LYS', 'Lyon'],
  ['MRS', 'Marseille'],
  ['TLS', 'Toulouse'],
  ['CPH', 'Copenhagen'],
  ['ARN', 'Stockholm Arlanda'],
  ['OSL', 'Oslo'],
  ['HEL', 'Helsinki'],
  ['WAW', 'Warsaw Chopin'],
  ['PRG', 'Prague'],
  ['BUD', 'Budapest'],
  ['ATH', 'Athens'],
  ['IST', 'Istanbul'],
  // Rest of the world
  ['DXB', 'Dubai'],
  ['HND', 'Tokyo Haneda'],
  ['SIN', 'Singapore Changi'],
  ['GRU', 'São Paulo Guarulhos'],
  ['JNB', 'Johannesburg O.R. Tambo'],
];

/**
 * The fill-out: which countries, and how many airports it adds (the hubs
 * in FILL_HUBS included). A count to add rather than a total for the map,
 * so adding to the hand-kept list elsewhere (Europe) doesn't take airports
 * away from North America.
 */
const FILL_COUNTRIES = ['US', 'CA'];
const FILL_ADDED_COUNT = 111;
/**
 * The closest two airports on the map may be. A little over
 * sim/demand.ts's MIN_MARKET_NM (30 nm, 56 km), so every pair of airports
 * has a market. It also makes each big metro one airport: Newark, JFK,
 * Midway, Dulles, Baltimore and Fort Lauderdale all sit inside it.
 */
const METRO_SEPARATION_KM = 60;

/**
 * Main hubs, chosen before the ranked fill-out and named by hand. The
 * other fill-out airports are named after OurAirports' municipality
 * ("Boise"), which reads well for most of them.
 */
const FILL_HUBS: [iata: string, name: string][] = [
  ['SFO', 'San Francisco'],
  ['IAH', 'Houston Intercontinental'],
  ['SEA', 'Seattle–Tacoma'],
  ['DEN', 'Denver'],
  ['MSP', 'Minneapolis–St Paul'],
  ['PHX', 'Phoenix Sky Harbor'],
  ['LAS', 'Las Vegas'],
  ['SAN', 'San Diego'],
  ['MCO', 'Orlando'],
  ['CLT', 'Charlotte'],
  ['SLC', 'Salt Lake City'],
  ['PDX', 'Portland, Oregon'],
  ['STL', 'St. Louis'],
  ['MCI', 'Kansas City'],
  ['TPA', 'Tampa'],
  ['AUS', 'Austin'],
  ['SAT', 'San Antonio'],
  ['MSY', 'New Orleans'],
  ['BNA', 'Nashville'],
  ['CLE', 'Cleveland'],
  ['PIT', 'Pittsburgh'],
  ['CVG', 'Cincinnati'],
  ['CMH', 'Columbus'],
  ['IND', 'Indianapolis'],
  ['RDU', 'Raleigh–Durham'],
  ['HNL', 'Honolulu'],
  ['YYC', 'Calgary'],
  ['YEG', 'Edmonton'],
  ['YWG', 'Winnipeg'],
];

/**
 * Names for fill-out airports whose municipality reads badly: a city that
 * shares a name with somewhere better known, or a field named after a
 * suburb rather than the city it serves.
 */
const FILL_NAMES: Record<string, string> = {
  ONT: 'Ontario, California',
  YXU: 'London, Ontario',
  PWM: 'Portland, Maine',
  RFD: 'Rockford',
};

/**
 * Game rules set by hand for particular airports, copied into the output
 * as they are: the biggest class allowed (sim/schedule.ts's
 * isAircraftTypeAllowedAt()) and a fixed daily capacity in place of the
 * population-based one (sim/airports.ts's airportCapacityPerDay()).
 * LaGuardia's perimeter and gate rules keep widebodies out, and its
 * room is set where New York's size says little about one field.
 */
const AIRPORT_RULES: Record<string, { maxAircraftType?: string; capacityPerDay?: number }> = {
  LGA: { maxAircraftType: 'NARROWBODY', capacityPerDay: 120 },
};

/**
 * How far a place can be from its nearest airport and still count toward
 * it. 60 km and the density below were picked together by comparing
 * against 2021 census metro populations (12 Canadian cities from
 * StatsCan, plus Boston): Montreal comes out at 0.90 of its census
 * figure, Toronto 1.22, Boston 0.96. The Maritimes read high (Moncton
 * 2.2, Sydney 1.8, Halifax 1.5) because GeoNames lists their
 * neighbourhoods as separate towns as well as inside the city's total. A
 * lower density or a smaller radius trims those but shrinks every big
 * metro more (New York to about 10 million), so the error stays about
 * the same, only moved.
 */
const CATCHMENT_MAX_KM = 60;
/** People per km² assumed inside a city's built-up area, for the "inside a bigger place" rule. */
const URBAN_DENSITY_PER_KM2 = 5000;

const CACHE_DIR = fileURLToPath(new URL('../../data/.cache/', import.meta.url));
const AIRPORTS_FILE = fileURLToPath(new URL('../../data/airports.json', import.meta.url));

/** A GeoNames place. `country` is its ISO code, compared with OurAirports' iso_country. */
type Place = { lat: number; lon: number; population: number; timeZone: string; country: string };
type AirportPoint = { iata: string; name: string; lat: number; lon: number; country: string; large: boolean };

async function download(url: string, path: string): Promise<void> {
  if (existsSync(path)) return;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

/** A small CSV reader: quoted fields, doubled quotes, commas inside quotes. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      fields.push(field);
      field = '';
    } else field += char;
  }
  fields.push(field);
  return fields;
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Standard (non-DST) UTC offset in minutes for an IANA zone: the smaller of the January and July offsets. */
function standardOffsetMinutes(timeZone: string): number {
  const offsetAt = (month: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(
      new Date(Date.UTC(2027, month, 15)),
    );
    const label = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const match = label.match(/GMT([+-])(\d\d):(\d\d)/);
    if (!match) return 0;
    return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
  };
  return Math.min(offsetAt(0), offsetAt(6));
}

/** Radius of a circle holding `population` people at URBAN_DENSITY_PER_KM2. */
function builtUpRadiusKm(population: number): number {
  return Math.sqrt(population / (Math.PI * URBAN_DENSITY_PER_KM2));
}

/**
 * Places bucketed into squares of CELL_DEGREES, so "what is near this
 * point" looks at a few squares instead of every place on Earth. With
 * tens of thousands of places around 800 candidate airports, comparing
 * everything with everything would take minutes; this takes a second.
 */
const CELL_DEGREES = 1;

class PlaceGrid {
  private cells = new Map<string, Place[]>();

  add(place: Place): void {
    const key = `${Math.floor(place.lat / CELL_DEGREES)},${Math.floor(place.lon / CELL_DEGREES)}`;
    const cell = this.cells.get(key);
    if (cell) cell.push(place);
    else this.cells.set(key, [place]);
  }

  /** Every place within `km` of `point`. */
  near(point: { lat: number; lon: number }, km: number): Place[] {
    // How many squares out to look: a degree of longitude shrinks toward
    // the poles, so it takes more squares east-west than north-south.
    const latSpan = Math.ceil(km / 111 / CELL_DEGREES);
    const highestLat = Math.min(89, Math.abs(point.lat) + km / 111);
    const lonSpan = Math.ceil(km / (111 * Math.cos((highestLat * Math.PI) / 180)) / CELL_DEGREES);
    const latCell = Math.floor(point.lat / CELL_DEGREES);
    const lonCell = Math.floor(point.lon / CELL_DEGREES);
    const found: Place[] = [];
    for (let dLat = -latSpan; dLat <= latSpan; dLat++) {
      for (let dLon = -lonSpan; dLon <= lonSpan; dLon++) {
        for (const place of this.cells.get(`${latCell + dLat},${lonCell + dLon}`) ?? []) {
          if (distanceKm(point, place) <= km) found.push(place);
        }
      }
    }
    return found;
  }
}

/**
 * The places that count: sections of cities dropped, and anything inside
 * a bigger place's built-up area dropped. Biggest first, so each place is
 * checked only against places already kept. No built-up area is wider
 * than the biggest place's, so that is as far as the search needs to go.
 * A city never swallows one across a border: Ciudad Juárez's built-up
 * area reaches downtown El Paso, but El Paso is not one of its districts.
 */
function withoutDoubleCounting(places: Place[]): Place[] {
  const sorted = [...places].sort((a, b) => b.population - a.population);
  const widestKm = sorted.length > 0 ? builtUpRadiusKm(sorted[0].population) : 0;
  const kept: Place[] = [];
  const keptGrid = new PlaceGrid();
  for (const place of sorted) {
    const inside = keptGrid
      .near(place, widestKm)
      .some((bigger) => bigger.country === place.country && distanceKm(place, bigger) < builtUpRadiusKm(bigger.population));
    if (!inside) {
      kept.push(place);
      keptGrid.add(place);
    }
  }
  return kept;
}

/** Places within CATCHMENT_MAX_KM of any of `airports`, double counts removed. */
function placesServing(allPlaces: Place[], airports: AirportPoint[]): Place[] {
  const airportGrid = new PlaceGrid();
  for (const airport of airports) airportGrid.add({ ...airport, population: 0, timeZone: '' });
  return withoutDoubleCounting(allPlaces.filter((place) => airportGrid.near(place, CATCHMENT_MAX_KM).length > 0));
}

/**
 * The fill-out airports, in the order they're added. `alreadyChosen` is
 * the hand-kept list; see "Which airports" at the top of the file.
 */
function chooseFillAirports(alreadyChosen: AirportPoint[], candidates: AirportPoint[], places: Place[]): AirportPoint[] {
  const grid = new PlaceGrid();
  for (const place of places) grid.add(place);
  // For every place, how far it is to the nearest airport chosen so far
  // in its own country. A candidate takes a place only by being nearer.
  const nearestChosenKm = new Map<Place, number>();
  const claim = (airport: AirportPoint) => {
    for (const place of grid.near(airport, CATCHMENT_MAX_KM)) {
      if (place.country !== airport.country) continue;
      const km = distanceKm(airport, place);
      if (km < (nearestChosenKm.get(place) ?? Infinity)) nearestChosenKm.set(place, km);
    }
  };
  const peopleGained = (candidate: AirportPoint) =>
    grid
      .near(candidate, CATCHMENT_MAX_KM)
      .filter((place) => place.country === candidate.country && distanceKm(candidate, place) < (nearestChosenKm.get(place) ?? Infinity))
      .reduce((total, place) => total + place.population, 0);

  const chosen = [...alreadyChosen];
  const tooClose = (candidate: AirportPoint) => chosen.some((airport) => distanceKm(airport, candidate) < METRO_SEPARATION_KM);
  for (const airport of chosen) claim(airport);

  const added: AirportPoint[] = [];
  const add = (airport: AirportPoint) => {
    chosen.push(airport);
    added.push(airport);
    claim(airport);
  };

  for (const [iata] of FILL_HUBS) {
    const hub = candidates.find((c) => c.iata === iata);
    if (!hub) throw new Error(`${iata} is in FILL_HUBS but not a scheduled large or medium airport in ${FILL_COUNTRIES.join('/')}`);
    if (tooClose(hub)) throw new Error(`${iata} is in FILL_HUBS but within ${METRO_SEPARATION_KM} km of an airport already on the map`);
    add(hub);
  }

  for (const tier of [true, false]) {
    let remaining = candidates.filter((c) => c.large === tier && !chosen.includes(c));
    while (added.length < FILL_ADDED_COUNT) {
      remaining = remaining.filter((c) => !tooClose(c));
      if (remaining.length === 0) break;
      let best = remaining[0];
      let bestGain = peopleGained(best);
      for (const candidate of remaining.slice(1)) {
        const gain = peopleGained(candidate);
        if (gain > bestGain) {
          best = candidate;
          bestGain = gain;
        }
      }
      add(best);
      remaining = remaining.filter((c) => c !== best);
    }
  }
  return added;
}

/**
 * The short name for a fill-out airport: FILL_NAMES if it has one, or else
 * its municipality up to any comma or slash ("Honolulu, Oahu",
 * "Providence/Warwick").
 */
function fillName(iata: string, row: string[], column: (name: string) => number): string {
  const hub = FILL_HUBS.find(([code]) => code === iata);
  if (hub) return hub[1];
  if (FILL_NAMES[iata]) return FILL_NAMES[iata];
  return (row[column('municipality')] || row[column('name')]).split(/[,/]/)[0].trim();
}

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const airportsCsv = `${CACHE_DIR}airports.csv`;
  const citiesZip = `${CACHE_DIR}cities1000.zip`;
  await download('https://davidmegginson.github.io/ourairports-data/airports.csv', airportsCsv);
  await download('https://download.geonames.org/export/dump/cities1000.zip', citiesZip);

  const [header, ...rows] = readFileSync(airportsCsv, 'utf8').split('\n').filter(Boolean).map(parseCsvLine);
  const column = (name: string) => header.indexOf(name);
  const byIata = new Map<string, string[]>();
  for (const row of rows) {
    const iata = row[column('iata_code')];
    if (iata && ['large_airport', 'medium_airport', 'small_airport'].includes(row[column('type')])) byIata.set(iata, row);
  }
  const pointOf = (iata: string, name: string): AirportPoint => {
    const row = byIata.get(iata);
    if (!row) throw new Error(`${iata} is not an airport in OurAirports`);
    return {
      iata,
      name,
      lat: Number(row[column('latitude_deg')]),
      lon: Number(row[column('longitude_deg')]),
      country: row[column('iso_country')],
      large: row[column('type')] === 'large_airport',
    };
  };

  const allPlaces = execFileSync('unzip', ['-p', citiesZip, 'cities1000.txt'], { maxBuffer: 256 * 1024 * 1024 })
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter((c) => c[7] !== 'PPLX')
    .map((c): Place => ({ lat: Number(c[4]), lon: Number(c[5]), population: Number(c[14]), timeZone: c[17], country: c[8] }))
    .filter((place) => place.population > 0);

  const handKept = AIRPORTS.map(([iata, name]) => pointOf(iata, name));
  const candidates = [...byIata.values()]
    .filter(
      (row) =>
        FILL_COUNTRIES.includes(row[column('iso_country')]) &&
        ['large_airport', 'medium_airport'].includes(row[column('type')]) &&
        row[column('scheduled_service')] === 'yes' &&
        !handKept.some((airport) => airport.iata === row[column('iata_code')]),
    )
    .map((row) => pointOf(row[column('iata_code')], fillName(row[column('iata_code')], row, column)));
  const points = [...handKept, ...chooseFillAirports(handKept, candidates, placesServing(allPlaces, [...handKept, ...candidates]))];

  // Every place to the nearest airport in its own country, within reach.
  const places = placesServing(allPlaces, points);
  const catchments = new Map<string, Place[]>(points.map((airport) => [airport.iata, []]));
  for (const place of places) {
    let nearest: AirportPoint | undefined;
    for (const airport of points) {
      if (airport.country !== place.country) continue;
      if (!nearest || distanceKm(airport, place) < distanceKm(nearest, place)) nearest = airport;
    }
    if (nearest && distanceKm(nearest, place) <= CATCHMENT_MAX_KM) catchments.get(nearest.iata)!.push(place);
  }

  const previous = existsSync(AIRPORTS_FILE)
    ? new Map((JSON.parse(readFileSync(AIRPORTS_FILE, 'utf8')) as { iata: string; population: number }[]).map((a) => [a.iata, a.population]))
    : new Map<string, number>();

  const output = points.map(({ iata, name, lat, lon }) => {
    const catchment = catchments.get(iata)!;
    if (catchment.length === 0) throw new Error(`${iata}: no GeoNames place within ${CATCHMENT_MAX_KM} km`);
    const biggest = catchment.reduce((best, place) => (place.population > best.population ? place : best));
    return {
      iata,
      name,
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
      utcOffsetMinutes: standardOffsetMinutes(biggest.timeZone),
      population: catchment.reduce((total, place) => total + place.population, 0),
      ...AIRPORT_RULES[iata],
    };
  });

  writeFileSync(AIRPORTS_FILE, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${output.length} airports.`);
  console.log('        population before -> after');
  for (const airport of output) {
    const before = previous.get(airport.iata);
    const ratio = before ? `${(airport.population / before).toFixed(2)}x` : 'new';
    console.log(`  ${airport.iata}  ${(before ?? 0).toLocaleString().padStart(11)} -> ${airport.population.toLocaleString().padStart(11)}  ${ratio.padStart(5)}  utc ${airport.utcOffsetMinutes / 60}  ${airport.name}`);
  }
}

main();
