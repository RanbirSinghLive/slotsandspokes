/**
 * Background music: a slow lounge loop played live with Web Audio, so the
 * game ships no audio files and owes no licence. It is a jazz-lounge
 * progression in D (major-ninth chords, the departures-lounge sound) on an
 * electric piano, a soft pad, a round bass and brushes, with a sparse bell
 * melody that changes every other pass and, every few minutes, the two-tone
 * terminal chime. Tempo and level are kept low so it sits under hours of play.
 *
 * Notes are scheduled a fraction of a second ahead on the audio clock, not
 * fired by timers, because timers drift and the audio clock does not. This
 * is a UI nicety, so its variation uses Math.random(); nothing here touches
 * the simulation.
 */

import { onSoundSettingsChange, soundContext, soundOutput, soundSettings, wakeSound } from './sound';

const BEATS_PER_MINUTE = 68;
const BEAT_SECONDS = 60 / BEATS_PER_MINUTE;
const STEPS_PER_BAR = 8; // eighth notes
const BARS_PER_CYCLE = 8;
const STEPS_PER_CYCLE = STEPS_PER_BAR * BARS_PER_CYCLE;
/** Off-beat eighths land late by this share of a beat: a lazy lounge swing. */
const SWING = 0.16;
/** One pass is about 28 seconds; the chime comes back every six (about three minutes). */
const CHIME_EVERY_CYCLES = 6;
const LOOKAHEAD_SECONDS = 0.3;
const SCHEDULER_INTERVAL_MS = 40;
/** The music's level into the master volume: background, about -24 dBFS average at full volume. */
const MUSIC_LEVEL = 1.8;

interface Chord {
  bass: number;
  voicing: number[];
}

/** MIDI note numbers. Dmaj9 Bm9 Em9 A9sus · Gmaj9 F#m7 Em9 A13. */
const PROGRESSION: Chord[] = [
  { bass: 38, voicing: [54, 57, 61, 64] },
  { bass: 47, voicing: [57, 61, 62, 66] },
  { bass: 40, voicing: [55, 59, 62, 66] },
  { bass: 45, voicing: [55, 59, 62, 64] },
  { bass: 43, voicing: [59, 62, 66, 69] },
  { bass: 42, voicing: [57, 61, 64, 66] },
  { bass: 40, voicing: [55, 59, 62, 66] },
  { bass: 45, voicing: [55, 59, 61, 66] },
];

/** D major pentatonic from A4 up: the melody never lands on a sour note. */
const MELODY_SCALE = [69, 71, 74, 76, 78, 81, 83, 86];

function frequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

let running = false;
let schedulerTimer: number | null = null;
let musicBus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let nextStepTime = 0;
let stepIndex = 0;
let cycleIndex = 0;
/** Melody notes for the current pair of passes, keyed by step within the cycle. */
let melody = new Map<number, number>();

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A small room: stereo noise fading out over a few seconds, used as a convolution reverb. */
function makeReverb(ctx: AudioContext): ConvolverNode {
  const seconds = 2.8;
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
  }
  const convolver = ctx.createConvolver();
  convolver.buffer = impulse;
  return convolver;
}

function composeMelody(): void {
  melody = new Map();
  let position = 3 + Math.floor(Math.random() * 3);
  for (let bar = 0; bar < BARS_PER_CYCLE; bar++) {
    // Leave about a third of the bars empty so the tune breathes.
    if (Math.random() < 0.35) continue;
    const notes = 1 + Math.floor(Math.random() * 3);
    const slots = [0, 2, 3, 5, 6].sort(() => Math.random() - 0.5).slice(0, notes).sort((a, b) => a - b);
    for (const slot of slots) {
      position = Math.min(MELODY_SCALE.length - 1, Math.max(0, position + Math.floor(Math.random() * 5) - 2));
      melody.set(bar * STEPS_PER_BAR + slot, MELODY_SCALE[position]);
    }
  }
}

function envelope(ctx: AudioContext, destination: AudioNode, time: number, peak: number, attack: number, decay: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, time + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  gain.connect(destination);
  return gain;
}

/** Electric piano by FM: a sine whose pitch is wobbled by another sine, the wobble dying away like a struck tine. */
function electricPiano(ctx: AudioContext, bus: AudioNode, midi: number, time: number, velocity: number): void {
  const f = frequency(midi);
  const amp = envelope(ctx, bus, time, velocity, 0.006, 2.6);
  const carrier = ctx.createOscillator();
  carrier.frequency.value = f;
  const modulator = ctx.createOscillator();
  modulator.frequency.value = f;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(f * 1.4, time);
  depth.gain.exponentialRampToValueAtTime(f * 0.15, time + 0.8);
  modulator.connect(depth);
  depth.connect(carrier.frequency);
  carrier.connect(amp);
  for (const osc of [carrier, modulator]) {
    osc.start(time);
    osc.stop(time + 2.8);
  }
}

function pad(ctx: AudioContext, bus: AudioNode, chord: Chord, time: number, length: number): void {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 650;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.018, time + 1.4);
  gain.gain.setValueAtTime(0.018, time + length);
  gain.gain.linearRampToValueAtTime(0, time + length + 1.6);
  filter.connect(gain);
  gain.connect(bus);
  for (const midi of chord.voicing) {
    for (const detune of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = frequency(midi);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + length + 1.7);
    }
  }
}

function bass(ctx: AudioContext, bus: AudioNode, midi: number, time: number, length: number): void {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.1, time + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.045, time + length * 0.7);
  gain.gain.linearRampToValueAtTime(0, time + length);
  // A triangle through a low filter rather than a pure sine: the few
  // overtones let a phone speaker, which cannot reproduce the fundamental,
  // still suggest the bass line.
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 480;
  filter.connect(gain);
  gain.connect(bus);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = frequency(midi);
  osc.connect(filter);
  osc.start(time);
  osc.stop(time + length + 0.05);
}

function brush(ctx: AudioContext, bus: AudioNode, time: number, accent: boolean): void {
  if (!noiseBuffer) return;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = accent ? 2600 : 6500;
  filter.Q.value = 0.8;
  const length = accent ? 0.22 : 0.07;
  const amp = envelope(ctx, bus, time, accent ? 0.05 : 0.018, 0.012, length);
  source.connect(filter);
  filter.connect(amp);
  source.start(time, Math.random() * 0.5);
  source.stop(time + length + 0.05);
}

/** A struck bell: a sine plus a quiet inharmonic overtone, ringing long. */
function bell(ctx: AudioContext, bus: AudioNode, midi: number, time: number, velocity: number, ring: number): void {
  const f = frequency(midi);
  const amp = envelope(ctx, bus, time, velocity, 0.004, ring);
  for (const [ratio, level] of [[1, 1], [2.76, 0.18], [5.4, 0.05]] as const) {
    const osc = ctx.createOscillator();
    osc.frequency.value = f * ratio;
    const partial = ctx.createGain();
    partial.gain.value = level;
    osc.connect(partial);
    partial.connect(amp);
    osc.start(time);
    osc.stop(time + ring + 0.1);
  }
}

/** The terminal PA's bing-bong, quietly, as if from the next gate. */
function terminalChime(ctx: AudioContext, bus: AudioNode, time: number): void {
  bell(ctx, bus, 78, time, 0.05, 3.2);
  bell(ctx, bus, 74, time + 0.75, 0.05, 3.6);
}

function scheduleStep(ctx: AudioContext, bus: AudioNode, step: number, time: number): void {
  const bar = Math.floor(step / STEPS_PER_BAR);
  const inBar = step % STEPS_PER_BAR;
  const chord = PROGRESSION[bar];
  const barSeconds = BEAT_SECONDS * 4;

  if (step === 0) {
    if (cycleIndex % 2 === 0) composeMelody();
    if (cycleIndex % CHIME_EVERY_CYCLES === 0) terminalChime(ctx, bus, time + BEAT_SECONDS * 0.5);
  }
  if (inBar === 0) {
    pad(ctx, bus, chord, time, barSeconds);
    bass(ctx, bus, chord.bass, time, BEAT_SECONDS * 1.6);
    chord.voicing.forEach((midi, i) => electricPiano(ctx, bus, midi, time + i * 0.012, 0.06));
  }
  if (inBar === 3 && bar % 2 === 1) {
    // A soft push on the and-of-two every other bar, the comping a lounge pianist does.
    chord.voicing.slice(1).forEach((midi) => electricPiano(ctx, bus, midi, time, 0.035));
  }
  if (inBar === 4) bass(ctx, bus, bar % 2 === 0 ? chord.bass + 7 : chord.bass, time, BEAT_SECONDS * 1.4);
  brush(ctx, bus, time, inBar === 2 || inBar === 6);
  const note = melody.get(step);
  if (note !== undefined) bell(ctx, bus, note, time, 0.045, 2.2);
}

function stepLength(step: number): number {
  // Swing: the on-beat eighth is long, the off-beat one short.
  return step % 2 === 0 ? (BEAT_SECONDS / 2) * (1 + SWING * 2) : (BEAT_SECONDS / 2) * (1 - SWING * 2);
}

function runScheduler(): void {
  const ctx = soundContext();
  if (!ctx || !musicBus) return;
  // After a pause or a throttled tab, pick up from now rather than racing to catch up.
  if (nextStepTime < ctx.currentTime) nextStepTime = ctx.currentTime + 0.05;
  while (nextStepTime < ctx.currentTime + LOOKAHEAD_SECONDS) {
    scheduleStep(ctx, musicBus, stepIndex, nextStepTime);
    nextStepTime += stepLength(stepIndex);
    stepIndex++;
    if (stepIndex === STEPS_PER_CYCLE) {
      stepIndex = 0;
      cycleIndex++;
    }
  }
}

function startMusic(): void {
  if (running) return;
  const ctx = soundContext();
  const output = soundOutput();
  if (!ctx || !output) return;
  wakeSound();
  running = true;
  noiseBuffer ??= makeNoise(ctx);
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0, ctx.currentTime);
  bus.gain.linearRampToValueAtTime(MUSIC_LEVEL, ctx.currentTime + 3);
  const reverb = makeReverb(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  bus.connect(output);
  bus.connect(reverb);
  reverb.connect(wet);
  wet.connect(output);
  musicBus = bus;
  stepIndex = 0;
  cycleIndex = 0;
  nextStepTime = ctx.currentTime + 0.1;
  runScheduler();
  schedulerTimer = window.setInterval(runScheduler, SCHEDULER_INTERVAL_MS);
}

function stopMusic(): void {
  if (!running) return;
  running = false;
  if (schedulerTimer !== null) window.clearInterval(schedulerTimer);
  schedulerTimer = null;
  const ctx = soundContext();
  const bus = musicBus;
  musicBus = null;
  if (!ctx || !bus) return;
  bus.gain.cancelScheduledValues(ctx.currentTime);
  bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
  bus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
  window.setTimeout(() => {
    bus.disconnect();
    // Nothing else is playing: park the audio clock so a phone's battery rests.
    if (!running) void ctx.suspend();
  }, 4000);
}

export function isMusicPlaying(): boolean {
  return running;
}

/**
 * Follow the Music switch. With music remembered on, nothing can play until
 * the player first presses something, so the first press anywhere starts it.
 */
export function setupMusic(): void {
  onSoundSettingsChange((next) => {
    if (next.music) startMusic();
    else stopMusic();
  });
  if (soundSettings().music) {
    const firstPress = (): void => {
      document.removeEventListener('pointerdown', firstPress, true);
      document.removeEventListener('keydown', firstPress, true);
      if (soundSettings().music) startMusic();
    };
    document.addEventListener('pointerdown', firstPress, true);
    document.addEventListener('keydown', firstPress, true);
  }
  // Hidden tab: park the audio clock so nothing plays in the background and the battery rests.
  document.addEventListener('visibilitychange', () => {
    if (!running) return;
    const ctx = soundContext();
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
}
