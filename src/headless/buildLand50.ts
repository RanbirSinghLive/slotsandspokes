import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Builds data/land-50m.json: Natural Earth's 1:50,000,000 land polygon as
 * TopoJSON, for render/basemap.ts to swap in when the player zooms in
 * (the 110m coastline turns into flat polygons at city zoom).
 *
 *   npm run land50
 *
 * Source (public, per CLAUDE.md): the `world-atlas` package's
 * land-50m.json, a TopoJSON conversion of Natural Earth, fetched from the
 * npm registry as a tarball. The file is lazy-loaded by the page, so it
 * costs nothing on first load.
 */

const TARBALL_URL = 'https://registry.npmjs.org/world-atlas/-/world-atlas-2.0.2.tgz';
const CACHE_DIR = fileURLToPath(new URL('../../data/.cache/world-atlas/', import.meta.url));
const OUTPUT_FILE = fileURLToPath(new URL('../../data/land-50m.json', import.meta.url));

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const tarball = `${CACHE_DIR}world-atlas.tgz`;
  if (!existsSync(tarball)) {
    console.log(`Downloading ${TARBALL_URL}`);
    const response = await fetch(TARBALL_URL);
    if (!response.ok) throw new Error(`${TARBALL_URL}: ${response.status}`);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
  }
  execFileSync('tar', ['xzf', tarball, '-C', CACHE_DIR, 'package/land-50m.json']);
  copyFileSync(`${CACHE_DIR}package/land-50m.json`, OUTPUT_FILE);
  console.log(`Wrote ${OUTPUT_FILE}`);
}

main();
