import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Builds data/airport-countries.json: the ISO country code of every
 * airport in data/airports.json, from OurAirports (public, per CLAUDE.md).
 *
 *   npm run countries
 *
 * It is its own file rather than a field in airports.json so the country
 * can be added without re-running the whole airport build (which re-reads
 * GeoNames and can move populations). It reads the same `iso_country`
 * column buildAirports.ts uses for its catchments.
 *
 * Where OurAirports lists one IATA code twice, the row nearest the
 * airport's coordinates in airports.json wins, and any match further than
 * MAX_MISMATCH_KM is an error: a wrong country would bar the wrong routes.
 */

const CSV_URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';
const CACHE_DIR = fileURLToPath(new URL('../../data/.cache/', import.meta.url));
const AIRPORTS_FILE = fileURLToPath(new URL('../../data/airports.json', import.meta.url));
const OUTPUT_FILE = fileURLToPath(new URL('../../data/airport-countries.json', import.meta.url));
const MAX_MISMATCH_KM = 30;

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

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const csvPath = `${CACHE_DIR}airports.csv`;
  if (!existsSync(csvPath)) {
    console.log(`Downloading ${CSV_URL}`);
    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error(`${CSV_URL}: ${response.status}`);
    writeFileSync(csvPath, Buffer.from(await response.arrayBuffer()));
  }

  const [header, ...rows] = readFileSync(csvPath, 'utf8').split('\n').filter(Boolean).map(parseCsvLine);
  const column = (name: string) => header.indexOf(name);
  const byIata = new Map<string, { lat: number; lon: number; country: string }[]>();
  for (const row of rows) {
    const iata = row[column('iata_code')];
    if (!iata || !['large_airport', 'medium_airport', 'small_airport'].includes(row[column('type')])) continue;
    const list = byIata.get(iata) ?? [];
    list.push({ lat: Number(row[column('latitude_deg')]), lon: Number(row[column('longitude_deg')]), country: row[column('iso_country')] });
    byIata.set(iata, list);
  }

  const airports = JSON.parse(readFileSync(AIRPORTS_FILE, 'utf8')) as { iata: string; lat: number; lon: number }[];
  const output: Record<string, string> = {};
  for (const airport of airports) {
    const candidates = byIata.get(airport.iata);
    if (!candidates) throw new Error(`${airport.iata} is not an airport in OurAirports`);
    const nearest = candidates.reduce((best, c) => (distanceKm(c, airport) < distanceKm(best, airport) ? c : best));
    if (distanceKm(nearest, airport) > MAX_MISMATCH_KM) throw new Error(`${airport.iata}: nearest OurAirports row is ${Math.round(distanceKm(nearest, airport))} km away`);
    output[airport.iata] = nearest.country;
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n');
  const counts = new Map<string, number>();
  for (const country of Object.values(output)) counts.set(country, (counts.get(country) ?? 0) + 1);
  console.log(`Wrote ${airports.length} airports in ${counts.size} countries.`);
  console.log([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([country, n]) => `${country} ${n}`).join(' · '));
}

await main();
