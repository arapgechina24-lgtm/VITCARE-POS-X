'use client';
/**
 * Tasteful synthesized sound feedback via the Web Audio API.
 * No audio assets to load — works fully offline and respects the
 * user's sound toggle (settings.soundOn).
 */
let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean) { enabled = on; }

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur = 0.12, type: OscillatorType = 'sine', gain = 0.06, when = 0) {
  const c = ac();
  if (!c || !enabled) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + when);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + when);
  o.stop(c.currentTime + when + dur + 0.05);
}

export const sounds = {
  /** subtle beep — item added / barcode scanned */
  add: () => tone(880, 0.07, 'square', 0.03),
  /** soft two-note chime — sale completed */
  success: () => { tone(659, 0.14, 'sine', 0.06); tone(988, 0.22, 'sine', 0.05, 0.11); },
  /** pleasant rising tone — payment confirmed */
  payment: () => { tone(523, 0.1); tone(659, 0.1, 'sine', 0.06, 0.09); tone(784, 0.2, 'sine', 0.06, 0.18); },
  /** gentle low error tone */
  error: () => { tone(220, 0.18, 'triangle', 0.06); tone(185, 0.22, 'triangle', 0.05, 0.12); },
  tap: () => tone(1320, 0.04, 'sine', 0.02),
};
