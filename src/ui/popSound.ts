import type { Milestone } from '../sim/milestones';
import { soundContext, soundOutput, soundSettings, wakeSound } from './sound';

/**
 * The chime that goes with a milestone pop on the map (render/milestones.ts),
 * played live with Web Audio like the music, in its key of D so the two sit
 * together. One chime per day however many pops it brought, picked by the
 * biggest: a rising D major arpeggio for an airport tier, a rising fourth for
 * a route's load, one high bell for on-time. Only with the Pops switch on.
 */

const NOTES_BY_KIND: Record<Milestone['kind'], number[]> = {
  airport: [587.33, 739.99, 880.0], // D5 F#5 A5
  load: [880.0, 1174.66], // A5 D6
  onTime: [1479.98], // F#6
};
const NOTE_GAP_S = 0.09;
const RING_S = 0.7;
const PEAK_GAIN = 0.16;

function playNote(ctx: AudioContext, output: AudioNode, frequency: number, start: number): void {
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(PEAK_GAIN, start + 0.006);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + RING_S);
  envelope.connect(output);
  // A sine with a quiet octave above reads as a soft bell rather than a beep.
  for (const [multiple, level] of [[1, 1], [2, 0.25]] as const) {
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency * multiple;
    const partial = ctx.createGain();
    partial.gain.value = level;
    oscillator.connect(partial).connect(envelope);
    oscillator.start(start);
    oscillator.stop(start + RING_S + 0.05);
  }
}

export function playMilestoneChime(milestones: Milestone[]): void {
  if (!soundSettings().pops || milestones.length === 0 || document.hidden) return;
  const ctx = soundContext();
  const output = soundOutput();
  if (!ctx || !output) return;
  // The context sleeps while music is off; a browser that still blocks it just stays silent.
  wakeSound();
  const kind = milestones.some((m) => m.kind === 'airport') ? 'airport' : milestones.some((m) => m.kind === 'load') ? 'load' : 'onTime';
  const start = ctx.currentTime + 0.03;
  NOTES_BY_KIND[kind].forEach((frequency, index) => playNote(ctx, output, frequency, start + index * NOTE_GAP_S));
}
