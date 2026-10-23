/**
 * The game's sound settings and its one Web Audio context. Every sound the
 * game makes (the music, and any later effect) goes through `soundOutput()`
 * so one volume and one switch board govern it all, and settings live under
 * one localStorage key so the Sound card on the Game screen is the single
 * place they are changed.
 *
 * Browsers only let a page start audio from a tap, click or key press, so the
 * context is created and resumed inside one: the switch itself, or the first
 * press anywhere after a reload with music remembered on.
 */

export interface SoundSettings {
  /** Background lounge music. Off by default: a game that starts making noise unasked is rude. */
  music: boolean;
  /** Master volume, 0 to 1. */
  volume: number;
}

const SOUND_KEY = 'airgame.sound';
const DEFAULT_SETTINGS: SoundSettings = { music: false, volume: 0.7 };

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(SOUND_KEY);
    if (raw === null) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      music: parsed.music === true,
      volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULT_SETTINGS.volume,
    };
  } catch {
    // Storage can be blocked or the value corrupt; fall back to silence.
    return { ...DEFAULT_SETTINGS };
  }
}

let settings: SoundSettings = loadSettings();
const listeners: ((next: SoundSettings) => void)[] = [];

export function soundSettings(): SoundSettings {
  return { ...settings };
}

export function setSoundSetting<K extends keyof SoundSettings>(key: K, value: SoundSettings[K]): void {
  settings = { ...settings, [key]: value };
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(settings));
  } catch {
    // Not remembered; fine.
  }
  if (master && context) master.gain.setTargetAtTime(masterLevel(), context.currentTime, 0.05);
  for (const listener of listeners) listener(soundSettings());
}

export function onSoundSettingsChange(listener: (next: SoundSettings) => void): void {
  listeners.push(listener);
}

let context: AudioContext | null = null;
let master: GainNode | null = null;

/** Squared so the slider feels even to the ear, which hears loudness logarithmically. */
function masterLevel(): number {
  return settings.volume * settings.volume;
}

/**
 * The shared context, created on first use. Call it from inside a user
 * gesture the first time, or the browser keeps it suspended.
 */
export function soundContext(): AudioContext | null {
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  // On iPhone, Web Audio is muted by the ring/silent switch unless the page
  // declares itself a player; Safari 17+ exposes that as audioSession.
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'playback';
  context = new Ctor();
  master = context.createGain();
  master.gain.value = masterLevel();
  // A gentle limiter so stacked chords never clip on cheap phone speakers.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.ratio.value = 4;
  master.connect(limiter);
  limiter.connect(context.destination);
  return context;
}

/** Where every sound connects to: through the master volume and limiter. */
export function soundOutput(): GainNode | null {
  soundContext();
  return master;
}

/** Resume the context if the browser parked it; safe to call from any gesture. */
export function wakeSound(): void {
  const ctx = soundContext();
  if (ctx && ctx.state !== 'running') void ctx.resume();
}
