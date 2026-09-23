import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Builds data/rivers.json for render/basemap.ts — a small, hand-curated
 * set of rivers, the same "public data, hand-picked which of it we want"
 * shape as buildAirports.ts's WORLD_HUBS list.
 *
 *   npm run rivers
 *
 * Source (public, per CLAUDE.md): Natural Earth's physical vectors,
 * "rivers_lake_centerlines" layer, via the maintainers' own GitHub mirror.
 * Two resolutions, combined, because the two jobs this layer does need
 * different detail:
 *   - The 110m file (WORLD_MAJOR_RIVERS below) has only the handful of
 *     globally massive rivers — same scale as the rest of the basemap,
 *     for whenever the world's actually in view.
 *   - None of those pass anywhere near this game's home region, so
 *     REGIONAL_RIVERS pulls a few named ones out of the 50m file instead
 *     — the St. Lawrence and Ottawa run through the middle of the
 *     starting map and would otherwise be the one major regional feature
 *     the basemap has nothing to show for.
 */

const WORLD_RIVERS_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_rivers_lake_centerlines.geojson';
const REGIONAL_RIVERS_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson';

const WORLD_MAJOR_RIVERS = ['Amazonas', 'Nile', 'Mississippi', 'Yangtze', 'Congo', 'Ob', 'Lena', 'Mekong'];
const REGIONAL_RIVERS = ['St. Lawrence', 'Ottawa', 'Hudson'];

const CACHE_DIR = fileURLToPath(new URL('../../data/.cache/', import.meta.url));
const RIVERS_FILE = fileURLToPath(new URL('../../data/rivers.json', import.meta.url));

async function download(url: string, path: string): Promise<void> {
  if (existsSync(path)) return;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

// Same rounding as buildLakes.ts — 3 decimal places is about 100m at the
// equator, far finer than this map ever needs, and most of what shrinks
// the file down from the source's full float precision.
type Coords = number | Coords[];
function roundCoords(coords: Coords): Coords {
  return typeof coords === 'number' ? Math.round(coords * 1000) / 1000 : coords.map(roundCoords);
}

type RiverFeature = { type: 'Feature'; properties: { name: string }; geometry: { type: string; coordinates: Coords } };
type RiverSource = { features: { properties: { name: string }; geometry: { type: string; coordinates: Coords } }[] };

function pick(source: RiverSource, names: string[]): RiverFeature[] {
  const wanted = new Set(names);
  const found = new Set<string>();
  const rivers: RiverFeature[] = [];
  for (const f of source.features) {
    if (!wanted.has(f.properties.name)) continue;
    found.add(f.properties.name);
    rivers.push({
      type: 'Feature',
      properties: { name: f.properties.name },
      geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
    });
  }
  const missing = names.filter((n) => !found.has(n));
  if (missing.length > 0) throw new Error(`Rivers not found in source: ${missing.join(', ')}`);
  return rivers;
}

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const worldPath = `${CACHE_DIR}ne_110m_rivers.geojson`;
  const regionalPath = `${CACHE_DIR}ne_50m_rivers.geojson`;
  await download(WORLD_RIVERS_URL, worldPath);
  await download(REGIONAL_RIVERS_URL, regionalPath);

  const worldSource = JSON.parse(readFileSync(worldPath, 'utf8')) as RiverSource;
  const regionalSource = JSON.parse(readFileSync(regionalPath, 'utf8')) as RiverSource;

  const rivers = [...pick(worldSource, WORLD_MAJOR_RIVERS), ...pick(regionalSource, REGIONAL_RIVERS)];

  writeFileSync(RIVERS_FILE, JSON.stringify({ type: 'FeatureCollection', features: rivers }));
  console.log(`Wrote ${rivers.length} rivers to ${RIVERS_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
