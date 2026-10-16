import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `npm run check` is the gate before a PR: everything cheap that CI or a
// review would otherwise find out later. It stops at the first failure and
// prints which step it was. `npm run check -- --ui` adds the browser check
// (npm run uicheck). It leaves out `npm run quick`, which is a slow balance
// read the owner asks for, not a pass/fail check.
const root = fileURLToPath(new URL('../../', import.meta.url));

type Step = { name: string; run: () => string | null };

function npmRun(script: string, extra: string[] = []): string | null {
  const result = spawnSync('npm', ['run', script, '--silent', ...(extra.length ? ['--', ...extra] : [])], { cwd: root, encoding: 'utf8' });
  if (result.status === 0) return null;
  return `${result.stdout}${result.stderr}`.trim() || `npm run ${script} exited ${result.status}`;
}

// Cloudflare's preview deploy cannot be run here and its log is unreadable
// to threads, so check the settings it has failed on before.
function wranglerConfig(): string | null {
  const text = readFileSync(`${root}wrangler.jsonc`, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const problems: string[] = [];
  if (!/"previews"\s*:\s*\{\s*\}/.test(text)) problems.push('wrangler.jsonc has no "previews": {} block (wrangler preview refuses to run)');
  if (!/"directory"\s*:\s*"\.\/dist"/.test(text)) problems.push('wrangler.jsonc assets.directory is not ./dist (vite build output)');
  return problems.length ? problems.join('\n') : null;
}

const steps: Step[] = [
  { name: 'build (tsc + vite)', run: () => npmRun('build') },
  { name: 'sim tests', run: () => npmRun('test') },
  { name: 'headless 30-day run', run: () => npmRun('headless', ['30']) },
  { name: 'determinism and save reload', run: () => npmRun('determinism') },
  { name: 'wrangler config', run: wranglerConfig },
];
if (process.argv.includes('--ui')) steps.push({ name: 'browser check (desktop + phone)', run: () => npmRun('uicheck') });

for (const step of steps) {
  const started = Date.now();
  const failure = step.run();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (failure) {
    console.log(`FAIL ${step.name} (${seconds}s)\n\n${failure}`);
    process.exit(1);
  }
  console.log(`ok   ${step.name} (${seconds}s)`);
}
console.log('\nAll checks passed. Balance was not measured; run `npm run quick` if the change touches economy numbers.');
