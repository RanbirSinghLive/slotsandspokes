import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { FeatureCollection, Geometry } from 'geojson';

/**
 * Builds the globe view's Earth textures in public/globe/ (render/globe/):
 *
 *   npm run globetextures
 *
 * - earth-day.jpg: NASA Blue Marble, the Earth's true colour by day.
 * - earth-night.jpg: NASA Black Marble, city lights at night.
 * - earth-land.png: land white, water black, drawn from our own Natural
 *   Earth land and lakes (data/land-50m.json, data/lakes.json), so only
 *   water catches the sun's glint.
 *
 * Both NASA images are public domain. They come from the `three-globe`
 * package's examples, fetched from the npm registry as a tarball the same
 * way npm run land50 fetches world-atlas. Each is cut to 2048 by 1024, a
 * size every phone's graphics chip takes, and the browser draws them, so
 * no image library is needed.
 */

const TARBALL_URL = 'https://registry.npmjs.org/three-globe/-/three-globe-2.45.6.tgz';
const CACHE_DIR = fileURLToPath(new URL('../../data/.cache/three-globe/', import.meta.url));
const OUTPUT_DIR = fileURLToPath(new URL('../../public/globe/', import.meta.url));
const LAND_FILE = fileURLToPath(new URL('../../data/land-50m.json', import.meta.url));
const LAKES_FILE = fileURLToPath(new URL('../../data/lakes.json', import.meta.url));
const WIDTH = 2048;
const HEIGHT = 1024;

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const tarball = `${CACHE_DIR}three-globe.tgz`;
  if (!existsSync(tarball)) {
    console.log(`Downloading ${TARBALL_URL}`);
    const response = await fetch(TARBALL_URL);
    if (!response.ok) throw new Error(`${TARBALL_URL}: ${response.status}`);
    writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
  }
  execFileSync('tar', ['xzf', tarball, '-C', CACHE_DIR, 'package/example/img/earth-blue-marble.jpg', 'package/example/img/earth-night.jpg']);
  const jpegDataUrl = (name: string) =>
    'data:image/jpeg;base64,' + readFileSync(`${CACHE_DIR}package/example/img/${name}`).toString('base64');

  const landTopology = JSON.parse(readFileSync(LAND_FILE, 'utf8')) as Topology;
  const land = feature(landTopology, landTopology.objects.land!) as unknown as FeatureCollection<Geometry>;
  const lakes = JSON.parse(readFileSync(LAKES_FILE, 'utf8')) as FeatureCollection<Geometry>;
  const rings = (collection: FeatureCollection<Geometry>): number[][][] =>
    collection.features.flatMap((f) => {
      const g = f.geometry;
      if (g.type === 'Polygon') return g.coordinates;
      if (g.type === 'MultiPolygon') return g.coordinates.flat();
      return [];
    });

  const executablePath = process.env.CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage();
    // tsx keeps function names with a __name() helper that the page doesn't have.
    await page.addInitScript('window.__name = (f) => f');
    await page.goto('about:blank');
    const images = await page.evaluate(
      async ({ day, night, landRings, lakeRings, width, height }) => {
        const load = (src: string) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = src;
          });
        const resized = async (src: string) => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d')!;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(await load(src), 0, 0, width, height);
          return canvas.toDataURL('image/jpeg', 0.85);
        };
        // Equirectangular: longitude across, latitude down, the layout the globe's shader samples.
        const mask = document.createElement('canvas');
        mask.width = width;
        mask.height = height;
        const ctx = mask.getContext('2d')!;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        const fillRings = (ringsToFill: number[][][], colour: string) => {
          ctx.fillStyle = colour;
          for (const ring of ringsToFill) {
            // A ring that crosses the 180th meridian is unwrapped into one
            // continuous shape and drawn once each side, so it doesn't
            // streak across the whole map.
            let previous = ring[0]![0]!;
            const unwrapped = ring.map(([lon, lat]) => {
              let next = lon!;
              while (next - previous > 180) next -= 360;
              while (next - previous < -180) next += 360;
              previous = next;
              return [next, lat!] as const;
            });
            for (const shift of [-360, 0, 360]) {
              ctx.beginPath();
              unwrapped.forEach(([lon, lat], i) => {
                const x = ((lon + shift + 180) / 360) * width;
                const y = ((90 - lat) / 180) * height;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              });
              ctx.closePath();
              ctx.fill('evenodd');
            }
          }
        };
        fillRings(landRings, '#fff');
        fillRings(lakeRings, '#000');
        return { day: await resized(day), night: await resized(night), land: mask.toDataURL('image/png') };
      },
      { day: jpegDataUrl('earth-blue-marble.jpg'), night: jpegDataUrl('earth-night.jpg'), landRings: rings(land), lakeRings: rings(lakes), width: WIDTH, height: HEIGHT },
    );
    const write = (name: string, dataUrl: string) => {
      writeFileSync(`${OUTPUT_DIR}${name}`, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
      console.log(`Wrote public/globe/${name}`);
    };
    write('earth-day.jpg', images.day);
    write('earth-night.jpg', images.night);
    write('earth-land.png', images.land);
  } finally {
    await browser.close();
  }
}

main();
