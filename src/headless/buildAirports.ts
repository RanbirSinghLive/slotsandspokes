import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Builds the world-hub half of data/airports.json from public data, so the
 * coordinates and populations are reproducible rather than typed in.
 *
 *   npm run airports
 *
 * Sources (both public, per CLAUDE.md):
 *   - OurAirports (airports.csv): name, latitude, longitude, by IATA code.
 *   - GeoNames (cities15000): city populations and time zones.
 *
 * The 19 airports that were already in the file (eastern Canada plus LGA
 * and BOS) are left exactly as they are: their populations are census
 * metropolitan-area figures (StatsCan 2021) and everything tuned so far
 * rests on them. Only the entries listed in WORLD_HUBS below are written
 * or rewritten.
 *
 * **Population** is the sum of GeoNames city populations within
 * METRO_RADIUS_KM of the airport. That radius was chosen by checking the
 * method against the census figures for the 11 existing airports above
 * 100,000 people: at 30 km it lands within about 16% of them on average
 * (Toronto 1.20x, Montreal 1.31x, New York 1.25x, Boston 0.74x). It is a
 * consistent stand-in for "metro area", not a census, and the gravity
 * model (sim/demand.ts) is crude enough that this is the right level of
 * care. It is worse outside Canada, where a metro is split into many
 * small municipalities or none: Atlanta comes out at about 1.1 million
 * (a real metro of about 6), Mexico City at 30 million (about 22), Keflavik
 * at 36,000 because Reykjavik is 50 km away. Fix a bad one by editing the
 * number in data/airports.json; the script leaves the 19 hand-kept
 * airports alone but rewrites the ones it generates.
 *
 * **Time zones** are the *standard* offset (no daylight saving), the same
 * fixed offset every airport in this file carries (CLAUDE.md: DST is out
 * of scope). The smaller of the January and July offsets is the standard
 * one, whichever hemisphere the airport is in.
 *
 * One airport per metro area on purpose: a gravity model with two
 * airports serving one city (huge population, almost no distance) gives
 * absurd demand, which is what sim/suppressed-markets.json exists to
 * paper over for the one such pair already on the map.
 */

/** The airports to add. The first group is dense enough to hop between in a propeller. */
const WORLD_HUBS = [
  // North America
  'DTW', 'PHL', 'DCA', 'ORD', 'ATL', 'MIA', 'DFW', 'LAX', 'YVR', 'MEX',
  // Europe
  'LHR', 'CDG', 'AMS', 'FRA', 'DUB', 'KEF',
  // Rest of the world
  'DXB', 'HND', 'SIN', 'GRU', 'JNB',
];

/**
 * Display names, by hand. OurAirports names run to "Detroit Metropolitan
 * Wayne County" and "São Paulo/Guarulhos–Governor André Franco Montoro";
 * these match the short style the file already uses ("Toronto Pearson").
 * Only the label is hand-written: coordinates still come from the data.
 */
const DISPLAY_NAMES: Record<string, string> = {
  DTW: 'Detroit',
  PHL: 'Philadelphia',
  DCA: 'Washington Reagan',
  ORD: "Chicago O'Hare",
  ATL: 'Atlanta',
  MIA: 'Miami',
  DFW: 'Dallas Fort Worth',
  LAX: 'Los Angeles',
  YVR: 'Vancouver',
  MEX: 'Mexico City',
  LHR: 'London Heathrow',
  CDG: 'Paris Charles de Gaulle',
  AMS: 'Amsterdam Schiphol',
  FRA: 'Frankfurt',
  DUB: 'Dublin',
  KEF: 'Reykjavík Keflavík',
  DXB: 'Dubai',
  HND: 'Tokyo Haneda',
  SIN: 'Singapore Changi',
  GRU: 'São Paulo Guarulhos',
  JNB: 'Johannesburg O.R. Tambo',
};

const METRO_RADIUS_KM = 30;
const CACHE_DIR = fileURLToPath(new URL('../../data/.cache/', import.meta.url));
const AIRPORTS_FILE = fileURLToPath(new URL('../../data/airports.json', import.meta.url));

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

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const airportsCsv = `${CACHE_DIR}airports.csv`;
  const citiesZip = `${CACHE_DIR}cities15000.zip`;
  await download('https://davidmegginson.github.io/ourairports-data/airports.csv', airportsCsv);
  await download('https://download.geonames.org/export/dump/cities15000.zip', citiesZip);

  const cities = execFileSync('unzip', ['-p', citiesZip, 'cities15000.txt'], { maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const c = line.split('\t');
      return { lat: Number(c[4]), lon: Number(c[5]), population: Number(c[14]), timeZone: c[17] };
    });

  const [header, ...rows] = readFileSync(airportsCsv, 'utf8').split('\n').filter(Boolean).map(parseCsvLine);
  const column = (name: string) => header.indexOf(name);
  const byIata = new Map<string, string[]>();
  for (const row of rows) {
    const iata = row[column('iata_code')];
    if (iata && row[column('type')] === 'large_airport') byIata.set(iata, row);
  }

  const existing = JSON.parse(readFileSync(AIRPORTS_FILE, 'utf8')) as Record<string, unknown>[];
  const kept = existing.filter((airport) => !WORLD_HUBS.includes(airport.iata as string));

  const generated = WORLD_HUBS.map((iata) => {
    const row = byIata.get(iata);
    if (!row) throw new Error(`${iata} is not a large airport in OurAirports`);
    const point = { lat: Number(row[column('latitude_deg')]), lon: Number(row[column('longitude_deg')]) };
    const nearby = cities.filter((city) => distanceKm(point, city) <= METRO_RADIUS_KM);
    if (nearby.length === 0) throw new Error(`${iata}: no GeoNames city within ${METRO_RADIUS_KM} km`);
    const biggest = nearby.reduce((best, city) => (city.population > best.population ? city : best));
    return {
      iata,
      name: DISPLAY_NAMES[iata] ?? row[column('name')],
      lat: Number(point.lat.toFixed(4)),
      lon: Number(point.lon.toFixed(4)),
      utcOffsetMinutes: standardOffsetMinutes(biggest.timeZone),
      population: nearby.reduce((total, city) => total + city.population, 0),
    };
  });

  const output = [...kept, ...generated];
  writeFileSync(AIRPORTS_FILE, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${output.length} airports (${kept.length} kept, ${generated.length} generated).`);
  for (const airport of generated) {
    console.log(`  ${airport.iata}  ${airport.name}  pop ${airport.population.toLocaleString()}  utc ${airport.utcOffsetMinutes / 60}`);
  }
}

main();
