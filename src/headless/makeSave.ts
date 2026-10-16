import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveFileText } from '../ui/save';
import { startHeadlessGame } from './newGame';
import { createPlayer } from './player';
import { playDays } from './simulate';

// `npm run makesave -- 75 YYZ [out.json]` plays the steady headless player
// for that many days from that home and writes an importable save file
// (the same text the Game screen's export gives), default
// data/.cache/midgame-<home>-<days>.json. The browser check loads it, and
// so can anyone via the Game screen's import. Same seed every time, so the
// same arguments always give the same game.
const days = Number(process.argv[2]) || 75;
const home = process.argv[3] || 'YYZ';
const out = process.argv[4] ?? fileURLToPath(new URL(`../../data/.cache/midgame-${home}-${days}.json`, import.meta.url));

const player = createPlayer('steady');
const state = startHeadlessGame(home, 1, player);
const played = playDays(state, player, days);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, saveFileText(state));
console.log(`${home} day ${played}: ${state.aircraft.length} aircraft, ${state.schedule.length} daily legs, cash $${Math.round(state.cash).toLocaleString()} -> ${out}`);
