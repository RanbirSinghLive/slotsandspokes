import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `npm test` runs every *.test.ts under src/ in parallel, one process each,
// and prints one line per file. A new test file is picked up by name, so it
// cannot be forgotten. `npm test -- rights` runs only files whose name
// contains "rights". Exits 1 if any file fails; a failing file's output is
// printed in full.
const root = fileURLToPath(new URL('../../', import.meta.url));
const filter = process.argv[2] ?? '';

function testFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(path));
    else if (entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

type Result = { file: string; ok: boolean; seconds: number; output: string };

function runOne(file: string): Promise<Result> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--import', 'tsx', file], { cwd: root });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ file, ok: code === 0, seconds: (Date.now() - started) / 1000, output }));
  });
}

const files = testFiles('src').filter((file) => file.includes(filter)).sort();
const results: Result[] = [];
let next = 0;

async function worker(): Promise<void> {
  while (next < files.length) {
    const file = files[next++]!;
    const result = await runOne(file);
    results.push(result);
    console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${file} (${result.seconds.toFixed(1)}s)`);
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: Math.max(1, Math.min(cpus().length, 4)) }, worker));

const failed = results.filter((result) => !result.ok);
for (const result of failed) console.log(`\n--- ${result.file} ---\n${result.output.trim()}`);
console.log(`\n${results.length - failed.length}/${results.length} test files passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failed.length > 0 ? 1 : 0);
