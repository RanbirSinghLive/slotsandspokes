import { dayIndex } from '../sim/clock';
import type { SimState } from '../sim/state';
import { soundContext, soundOutput, soundSettings, wakeSound } from './sound';

/**
 * The hangar sound when a C or D check goes in: two rattles of an impact
 * wrench and a light metal clank, played live with Web Audio like the
 * milestone chime (ui/popSound.ts) and on the same Pops switch. Checks start
 * by themselves at the morning rollover, so this is how the player hears a
 * plane leave the line without watching the pipeline. One sound per morning
 * however many planes went in.
 */

const RATTLE_S = 0.16;
const RATTLE_GAP_S = 0.07;
const RATTLE_HZ = 38;
const RATTLE_GAIN = 0.22;
const CLANK_PARTIALS = [523, 1307, 2213];
const CLANK_RING_S = 0.45;
const CLANK_GAIN = 0.07;

let noiseBuffer: AudioBuffer | null = null;

function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.5), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  // A fixed pseudo-random sequence: the sound is the same every time, and Math.random stays out of it.
  let seed = 12345;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    samples[i] = (seed / 1073741824) - 1;
  }
  noiseBuffer = buffer;
  return buffer;
}

/** One burst of the wrench: band-passed noise chopped into hammer blows by a square wave. */
function rattle(ctx: AudioContext, output: AudioNode, start: number): void {
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1800;
  band.Q.value = 1.2;
  const hammer = ctx.createGain();
  hammer.gain.value = 0.5;
  const blows = ctx.createOscillator();
  blows.type = 'square';
  blows.frequency.value = RATTLE_HZ;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  blows.connect(depth).connect(hammer.gain);
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(RATTLE_GAIN, start + 0.01);
  envelope.gain.setValueAtTime(RATTLE_GAIN, start + RATTLE_S - 0.03);
  envelope.gain.linearRampToValueAtTime(0, start + RATTLE_S);
  source.connect(band).connect(hammer).connect(envelope).connect(output);
  source.start(start);
  source.stop(start + RATTLE_S + 0.02);
  blows.start(start);
  blows.stop(start + RATTLE_S + 0.02);
}

/** A tool set down on the hangar floor: a few inharmonic partials, struck and fading. */
function clank(ctx: AudioContext, output: AudioNode, start: number): void {
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(CLANK_GAIN, start + 0.004);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + CLANK_RING_S);
  envelope.connect(output);
  CLANK_PARTIALS.forEach((frequency, index) => {
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const level = ctx.createGain();
    level.gain.value = 1 / (index + 1);
    oscillator.connect(level).connect(envelope);
    oscillator.start(start);
    oscillator.stop(start + CLANK_RING_S + 0.05);
  });
}

export function playCheckStartSound(): void {
  if (!soundSettings().pops || document.hidden) return;
  const ctx = soundContext();
  const output = soundOutput();
  if (!ctx || !output) return;
  wakeSound();
  const start = ctx.currentTime + 0.03;
  rattle(ctx, output, start);
  rattle(ctx, output, start + RATTLE_S + RATTLE_GAP_S);
  clank(ctx, output, start + 2 * (RATTLE_S + RATTLE_GAP_S) + 0.04);
}

let lastDay: number | null = null;
let lastState: SimState | null = null;
let inCheckYesterday = new Set<string>();

function checkTails(state: SimState): Set<string> {
  return new Set(state.aogs.filter((event) => event.check).map((event) => event.tail));
}

/**
 * Called every frame from main.ts. At each new day it compares the planes
 * in a check with the day before and plays the sound if one went in. A load,
 * a new game or a jump of more than a day just takes the new list silently.
 */
export function noteCheckStarts(state: SimState): void {
  const today = dayIndex(state);
  if (state === lastState && today === lastDay) return;
  const nextDay = state === lastState && lastDay !== null && today === lastDay + 1;
  const now = checkTails(state);
  const wentIn = [...now].some((tail) => !inCheckYesterday.has(tail));
  lastState = state;
  lastDay = today;
  inCheckYesterday = now;
  if (nextDay && wentIn) playCheckStartSound();
}
