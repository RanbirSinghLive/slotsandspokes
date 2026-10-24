import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices, type Browser, type Page } from 'playwright-core';

// `npm run uicheck` opens a mid-game save in headless Chromium at desktop
// size and at phone size with touch (which makes (pointer: coarse) true, the
// way phone play is detected), visits every screen on the rail, and fails
// on any uncaught page error, console error, or sideways overflow on the
// phone. Screenshots go to ui-check-output/ (gitignored); copy the ones a PR
// needs into the project's review folder.
//
//   npm run uicheck                    75-day YYZ save, all screens
//   npm run uicheck -- --save f.json   a save you exported from the game
//   npm run uicheck -- --only fleet    one screen
//   npm run uicheck -- --url http://localhost:5173   use a server already running
//
// Real iPhone Safari is not covered: this is Chromium's touch emulation.
const root = fileURLToPath(new URL('../../', import.meta.url));
const SAVE_KEY = 'slotsandspokes-save';
// Marks the first-run tutorial as seen so its card does not cover the rail.
const TUTORIAL_KEY = 'slotsandspokes-tutorial';
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const outDir = `${root}ui-check-output/`;
mkdirSync(outDir, { recursive: true });

async function ensureSave(): Promise<string> {
  const given = option('save');
  if (given) return readFileSync(given, 'utf8');
  const path = `${root}data/.cache/midgame-YYZ-75.json`;
  if (!existsSync(path)) {
    console.log('making the 75-day YYZ save (npm run makesave)...');
    await new Promise<void>((resolve, reject) => {
      const child = spawn('npm', ['run', 'makesave', '--silent', '--', '75', 'YYZ'], { cwd: root, stdio: 'inherit' });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('makesave failed'))));
    });
  }
  return readFileSync(path, 'utf8');
}

async function startServer(): Promise<{ url: string; stop: () => void }> {
  const given = option('url');
  if (given) return { url: given, stop: () => {} };
  const port = 5199;
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
  const url = `http://localhost:${port}/`;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(url)).ok) return { url, stop: () => child.kill() };
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill();
  throw new Error('the dev server did not start');
}

const problems: string[] = [];

async function visit(browser: Browser, label: string, url: string, save: string, phone: boolean): Promise<void> {
  const context = await browser.newContext(phone ? devices['iPhone 13'] : { viewport: { width: 1280, height: 800 } });
  await context.addInitScript(([saveKey, text, tutorialKey]) => {
    localStorage.setItem(saveKey!, text!);
    localStorage.setItem(tutorialKey!, 'seen');
  }, [SAVE_KEY, save, TUTORIAL_KEY]);
  const page: Page = await context.newPage();
  const note = (what: string) => problems.push(`${label}: ${what}`);
  page.on('pageerror', (error) => note(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') note(`console error: ${message.text()}`);
  });

  await page.goto(url);
  await page.waitForSelector('#rail', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}${label}-map.png` });
  // A save near $0 opens the runway pop-up, which would cover the rail.
  if (await page.locator('#runway-modal').isVisible()) await page.locator('#runway-modal-close').click();

  const screens = await page.$$eval('#rail [data-go]', (buttons) => buttons.map((button) => (button as HTMLElement).dataset.go!));
  const only = option('only');
  for (const screen of screens.filter((name) => !only || name === only)) {
    const button = page.locator(`#rail [data-go="${screen}"]`);
    if (phone) await button.tap();
    else await button.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}${label}-${screen}.png` });
    if (phone) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) note(`${screen} overflows the page sideways by ${overflow}px`);
    }
  }
  console.log(`${label}: ${screens.length} screens visited`);
  await context.close();
}

const save = await ensureSave();
const server = await startServer();
const executablePath = process.env.CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath });
try {
  await visit(browser, 'desktop', server.url, save, false);
  await visit(browser, 'phone', server.url, save, true);
} finally {
  await browser.close();
  server.stop();
}

if (problems.length > 0) {
  console.log(`\nFAIL, ${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const problem of [...new Set(problems)]) console.log(`  ${problem}`);
  process.exit(1);
}
console.log(`ok, screenshots in ${outDir}`);
