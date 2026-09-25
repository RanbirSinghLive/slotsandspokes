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
 * One airport per metro on purpose. Catchments keep two airports in one
 * city from double-counting its people, but the pair would still read as
 * a big market over almost no distance, which nobody would fly.
 * sim/demand.ts's MIN_MARKET_NM zeroes any such pair as a safety net.
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
  // Rest of the world
  ['DXB', 'Dubai'],
  ['HND', 'Tokyo Haneda'],
  ['SIN', 'Singapore Changi'],
  ['GRU', 'São Paulo Guarulhos'],
  ['JNB', 'Johannesburg O.R. Tambo'],
];

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

type Place = { lat: number; lon: number; population: number; timeZone: string };

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
 * The places that count: sections of cities dropped, and anything inside
 * a bigger place's built-up area dropped. Biggest first, so each place is
 * checked only against places already kept.
 */
function withoutDoubleCounting(places: Place[]): Place[] {
  const kept: Place[] = [];
  for (const place of [...places].sort((a, b) => b.population - a.population)) {
    const inside = kept.some((bigger) => distanceKm(place, bigger) < builtUpRadiusKm(bigger.population));
    if (!inside) kept.push(place);
  }
  return kept;
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
  const points = AIRPORTS.map(([iata]) => {
    const row = byIata.get(iata);
    if (!row) throw new Error(`${iata} is not an airport in OurAirports`);
    return { iata, lat: Number(row[column('latitude_deg')]), lon: Number(row[column('longitude_deg')]) };
  });

  // Only places near some airport matter, which keeps the double-counting
  // pass (every place against every bigger one) small.
  const nearAnAirport = execFileSync('unzip', ['-p', citiesZip, 'cities1000.txt'], { maxBuffer: 256 * 1024 * 1024 })
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter((c) => c[7] !== 'PPLX')
    .map((c): Place => ({ lat: Number(c[4]), lon: Number(c[5]), population: Number(c[14]), timeZone: c[17] }))
    .filter((place) => place.population > 0 && points.some((airport) => distanceKm(airport, place) <= CATCHMENT_MAX_KM));
  const places = withoutDoubleCounting(nearAnAirport);

  const catchments = new Map<string, Place[]>(points.map((airport) => [airport.iata, []]));
  for (const place of places) {
    let nearest = points[0];
    for (const airport of points) if (distanceKm(airport, place) < distanceKm(nearest, place)) nearest = airport;
    if (distanceKm(nearest, place) <= CATCHMENT_MAX_KM) catchments.get(nearest.iata)!.push(place);
  }

  const previous = existsSync(AIRPORTS_FILE)
    ? new Map((JSON.parse(readFileSync(AIRPORTS_FILE, 'utf8')) as { iata: string; population: number }[]).map((a) => [a.iata, a.population]))
    : new Map<string, number>();

  const output = AIRPORTS.map(([iata, name], index) => {
    const catchment = catchments.get(iata)!;
    if (catchment.length === 0) throw new Error(`${iata}: no GeoNames place within ${CATCHMENT_MAX_KM} km`);
    const biggest = catchment.reduce((best, place) => (place.population > best.population ? place : best));
    return {
      iata,
      name,
      lat: Number(points[index].lat.toFixed(4)),
      lon: Number(points[index].lon.toFixed(4)),
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
    console.log(`  ${airport.iata}  ${(before ?? 0).toLocaleString().padStart(11)} -> ${airport.population.toLocaleString().padStart(11)}  ${ratio.padStart(5)}  utc ${airport.utcOffsetMinutes / 60}`);
  }
}

main();
