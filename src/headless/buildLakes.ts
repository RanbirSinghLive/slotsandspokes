import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Builds data/lakes.json: the world's major lakes, for render/basemap.ts to
 * draw as holes in the landmass — so far the map's only water is the ocean
 * (the page's own background, showing through wherever land isn't drawn).
 *
 *   npm run lakes
 *
 * Source (public, per CLAUDE.md): Natural Earth's 110m physical vectors,
 * "lakes" layer, via the maintainers' own GitHub mirror. Same 1:110,000,000
 * scale as data/world-110m.json's land/countries, so lake and coastline
 * detail match rather than one looking noticeably crisper than the other.
 * Natural Earth ships this file pre-curated to the world's roughly two
 * dozen most significant lakes at this scale (the Great Lakes, Baikal,
 * Victoria, and so on) — nothing here re-filters that judgment, just
 * strips it down to name + geometry, dropping scalerank/label-placement
 * fields the map has no use for.
 */

const SOURCE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_lakes.geojson';
const CACHE_DIR = fileURLToPath(new URL('../../data/.cache/', import.meta.url));
const LAKES_FILE = fileURLToPath(new URL('../../data/lakes.json', import.meta.url));

async function download(url: string, path: string): Promise<void> {
  if (existsSync(path)) return;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

// Coordinates arrive as nested arrays of [lon, lat] pairs at whatever depth
// the geometry type needs (Polygon: rings of points; MultiPolygon: polygons
// of rings of points). Rounding to 3 decimal places is about 100m at the
// equator — far finer than anything visible at this map's scale, and
// dropping the source's full float precision is most of what shrinks the
// file down from the raw download.
type Coords = number | Coords[];
function roundCoords(coords: Coords): Coords {
  return typeof coords === 'number' ? Math.round(coords * 1000) / 1000 : coords.map(roundCoords);
}

type LakeFeature = { type: 'Feature'; properties: { name: string }; geometry: { type: string; coordinates: Coords } };

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = `${CACHE_DIR}ne_110m_lakes.geojson`;
  await download(SOURCE_URL, cachePath);

  const source = JSON.parse(readFileSync(cachePath, 'utf8')) as {
    features: { properties: { name: string }; geometry: { type: string; coordinates: Coords } }[];
  };

  const lakes: LakeFeature[] = source.features.map((f) => ({
    type: 'Feature',
    properties: { name: f.properties.name },
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
  }));

  writeFileSync(LAKES_FILE, JSON.stringify({ type: 'FeatureCollection', features: lakes }));
  console.log(`Wrote ${lakes.length} lakes to ${LAKES_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
