// Sound effects and background music, all made in code with Web Audio: no audio files to load or license.
// Browsers only allow sound after the player touches the page, so nothing plays until the first tap or key.

import { useSyncExternalStore } from 'react';

export type Sfx =
  | 'tap'
  | 'pickup'
  | 'drop'
  | 'cancel'
  | 'play'
  | 'whoosh'
  | 'gain'
  | 'steal'
  | 'give'
  | 'swap'
  | 'discard'
  | 'crisis'
  | 'preview'
  | 'bonus'
  | 'protect'
  | 'noEffect'
  | 'shuffle'
  | 'reveal'
  | 'yourTurn'
  | 'join'
  | 'error'
  | 'roundStart'
  | 'roundEnd'
  | 'win'
  | 'lose';

export interface SoundSettings {
  muted: boolean;
  /** 0 to 1 */
  sfx: number;
  /** 0 to 1 */
  music: number;
}

const SETTINGS_KEY = 'hh_sound';
const DEFAULTS: SoundSettings = { muted: false, sfx: 0.8, music: 0.5 };
/** Music sits under the effects, so full music volume is still quieter than effects. */
const MUSIC_LEVEL = 0.35;
const SFX_LEVEL = 0.9;

// ---------- synth building blocks ----------

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  /** frequency at the end of the note */
  slideTo?: number;
  attack?: number;
  /** low-pass cutoff, for a softer tone */
  cutoff?: number;
}

/** One note with a quick attack and an exponential fade. */
function tone(ctx: BaseAudioContext, out: AudioNode, freq: number, at: number, dur: number, o: ToneOpts = {}) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = o.type ?? 'triangle';
  osc.frequency.setValueAtTime(freq, at);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, at + dur);
  const attack = o.attack ?? 0.005;
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  let node: AudioNode = osc;
  if (o.cutoff) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.cutoff;
    osc.connect(lp);
    node = lp;
  }
  node.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

let noiseBuf: AudioBuffer | undefined;
/** One second of white noise, shared by every noise sound of a context. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return (noiseBuf = buf);
}

interface NoiseOpts {
  vol?: number;
  filter?: BiquadFilterType;
  freq?: number;
  /** filter frequency at the end */
  sweepTo?: number;
  q?: number;
}

/** A filtered burst of noise: swishes, hats, paper. */
function noise(ctx: BaseAudioContext, out: AudioNode, at: number, dur: number, o: NoiseOpts = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq ?? 2000, at);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, at + dur);
  f.Q.value = o.q ?? 1;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(o.vol ?? 0.2, at + Math.min(0.02, dur / 3));
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(env).connect(out);
  src.start(at);
  src.stop(at + dur + 0.02);
}

/** Notes one after another, `gap` seconds apart, each lasting `dur`. */
function arp(ctx: BaseAudioContext, out: AudioNode, freqs: number[], at: number, gap: number, dur: number, o: ToneOpts = {}) {
  freqs.forEach((f, i) => tone(ctx, out, f, at + i * gap, dur, o));
}

// note frequencies used below
const N = {
  F3: 174.61, C4: 261.63, E4: 329.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99,
  A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093,
};

/** Every effect, drawn into `out` starting at time `t`. Short, bright and bouncy: party game, not arcade. */
export const RECIPES: Record<Sfx, (ctx: BaseAudioContext, out: AudioNode, t: number) => void> = {
  tap: (c, o, t) => tone(c, o, 1200, t, 0.04, { type: 'square', vol: 0.08, cutoff: 3000 }),
  pickup: (c, o, t) => tone(c, o, 420, t, 0.1, { slideTo: 900, vol: 0.25 }),
  drop: (c, o, t) => {
    tone(c, o, 200, t, 0.14, { type: 'sine', slideTo: 70, vol: 0.6 });
    noise(c, o, t, 0.05, { filter: 'highpass', freq: 2500, vol: 0.08 });
  },
  cancel: (c, o, t) => tone(c, o, 600, t, 0.14, { slideTo: 280, vol: 0.2 }),
  play: (c, o, t) => {
    RECIPES.drop(c, o, t);
    tone(c, o, 660, t + 0.04, 0.09, { type: 'square', slideTo: 1320, vol: 0.12, cutoff: 4000 });
  },
  whoosh: (c, o, t) => noise(c, o, t, 0.4, { freq: 300, sweepTo: 3500, q: 1.2, vol: 0.7 }),
  gain: (c, o, t) => arp(c, o, [N.C5, N.E5, N.G5, N.C6], t, 0.065, 0.14, { vol: 0.25 }),
  steal: (c, o, t) => {
    // a sneaky "nyoom" down and back up
    tone(c, o, 800, t, 0.16, { type: 'sawtooth', slideTo: 220, vol: 0.14, cutoff: 1800 });
    tone(c, o, 220, t + 0.16, 0.14, { type: 'sawtooth', slideTo: 900, vol: 0.14, cutoff: 1800 });
  },
  give: (c, o, t) => {
    tone(c, o, N.C6, t, 0.5, { type: 'sine', vol: 0.25 });
    tone(c, o, N.G6, t + 0.08, 0.5, { type: 'sine', vol: 0.15 });
  },
  swap: (c, o, t) => arp(c, o, [N.C5, N.G5, N.C5, N.G5], t, 0.08, 0.07, { type: 'square', vol: 0.1, cutoff: 3000 }),
  discard: (c, o, t) => {
    noise(c, o, t, 0.28, { filter: 'lowpass', freq: 4000, sweepTo: 300, vol: 0.3 });
    tone(c, o, 320, t, 0.2, { type: 'sine', slideTo: 110, vol: 0.25 });
  },
  crisis: (c, o, t) => {
    // a short two-tone siren
    for (let i = 0; i < 4; i++) tone(c, o, i % 2 ? N.A4 : N.E5, t + i * 0.13, 0.13, { type: 'sawtooth', vol: 0.12, cutoff: 2200 });
  },
  preview: (c, o, t) => arp(c, o, [N.G6, N.C7, 2637], t, 0.04, 0.12, { type: 'sine', vol: 0.12 }),
  bonus: (c, o, t) => {
    // the classic coin: a short note jumping to a long higher one
    tone(c, o, N.B5, t, 0.08, { type: 'square', vol: 0.12, cutoff: 5000 });
    tone(c, o, N.E6, t + 0.08, 0.35, { type: 'square', vol: 0.12, cutoff: 5000 });
  },
  protect: (c, o, t) => [N.C5, N.E5, N.G5, N.C6].forEach((f) => tone(c, o, f, t, 0.45, { type: 'sine', vol: 0.1, attack: 0.06 })),
  noEffect: (c, o, t) => {
    // a little "wah-wah": playful, not a buzzer
    tone(c, o, 392, t, 0.16, { type: 'sawtooth', slideTo: 370, vol: 0.12, cutoff: 1200 });
    tone(c, o, 349, t + 0.17, 0.3, { type: 'sawtooth', slideTo: 311, vol: 0.12, cutoff: 1200 });
  },
  shuffle: (c, o, t) => {
    for (let i = 0; i < 6; i++) noise(c, o, t + i * 0.05, 0.04, { filter: 'highpass', freq: 3000 + i * 200, vol: 0.08 });
  },
  reveal: (c, o, t) => {
    tone(c, o, N.E5, t, 0.08, { vol: 0.22 });
    tone(c, o, N.B5, t + 0.08, 0.22, { vol: 0.22 });
  },
  yourTurn: (c, o, t) => {
    tone(c, o, N.E6, t, 0.35, { type: 'sine', vol: 0.25 });
    tone(c, o, N.B5, t + 0.18, 0.45, { type: 'sine', vol: 0.25 });
  },
  join: (c, o, t) => tone(c, o, 380, t, 0.08, { type: 'sine', slideTo: 950, vol: 0.3 }),
  error: (c, o, t) => {
    tone(c, o, 150, t, 0.12, { type: 'square', vol: 0.12, cutoff: 1200 });
    tone(c, o, 150, t + 0.15, 0.12, { type: 'square', vol: 0.12, cutoff: 1200 });
  },
  roundStart: (c, o, t) => {
    arp(c, o, [N.G4, N.C5, N.E5], t, 0.09, 0.1, { type: 'square', vol: 0.12, cutoff: 3500 });
    tone(c, o, N.G5, t + 0.27, 0.4, { type: 'square', vol: 0.12, cutoff: 3500 });
  },
  roundEnd: (c, o, t) => {
    tone(c, o, N.G5, t, 0.12, { vol: 0.2 });
    [N.C5, N.E5, N.G5].forEach((f) => tone(c, o, f, t + 0.14, 0.5, { vol: 0.14 }));
  },
  win: (c, o, t) => {
    arp(c, o, [N.C5, N.E5, N.G5, N.C6], t, 0.1, 0.12, { type: 'square', vol: 0.12, cutoff: 4000 });
    [N.C5, N.E5, N.G5, N.C6].forEach((f) => tone(c, o, f, t + 0.42, 0.9, { type: 'square', vol: 0.07, cutoff: 3000 }));
    noise(c, o, t + 0.4, 0.9, { freq: 1500, q: 0.5, vol: 0.08 });
  },
  lose: (c, o, t) => arp(c, o, [N.G5, N.E5, N.C5, N.G4], t, 0.12, 0.2, { vol: 0.2 }),
};

// ---------- background music ----------

const BPM = 124;
export const STEP = 60 / BPM / 4; // one 16th note
/** chords of the loop, one per bar: C, G, Am, F */
const BARS = [
  { root: N.C4 / 2, chord: [N.C5, N.E5, N.G5] },
  { root: N.G4 / 2, chord: [N.D5, N.G5, N.B5] },
  { root: N.A4 / 2, chord: [N.C5, N.E5, N.A5] },
  { root: N.F3, chord: [N.C5, N.F5, N.A5] },
];
/** lead melody per bar, 16 steps, as note frequency or 0 for rest */
const LEAD = [
  [N.E5, 0, N.G5, 0, N.C6, 0, N.G5, 0, N.A5, 0, N.G5, 0, N.E5, 0, 0, 0],
  [N.D5, 0, N.G5, 0, N.B5, 0, N.G5, 0, N.A5, 0, N.G5, 0, N.D5, 0, 0, 0],
  [N.E5, 0, N.A5, 0, N.C6, 0, N.A5, 0, N.G5, 0, N.E5, 0, N.C5, 0, 0, 0],
  [N.C5, 0, N.F5, 0, N.A5, 0, N.C6, 0, N.A5, 0, N.G5, 0, N.E5, 0, N.D5, 0],
];

/** Draws one 16th step of the loop into `out` at time `t`. */
export function musicStep(ctx: BaseAudioContext, out: AudioNode, step: number, t: number) {
  const bar = BARS[Math.floor(step / 16) % BARS.length]!;
  const s = step % 16;
  // kick on every beat
  if (s % 4 === 0) tone(ctx, out, 140, t, 0.16, { type: 'sine', slideTo: 45, vol: 0.5 });
  // hat on the off-beats
  if (s % 4 === 2) noise(ctx, out, t, 0.04, { filter: 'highpass', freq: 7000, vol: 0.08 });
  // bouncing octave bass on 8ths
  if (s % 2 === 0) tone(ctx, out, s % 4 === 0 ? bar.root : bar.root * 2, t, STEP * 1.6, { type: 'triangle', vol: 0.3 });
  // chord stabs on the "and" of each beat
  if (s % 4 === 2) bar.chord.forEach((f) => tone(ctx, out, f, t, STEP * 1.2, { type: 'square', vol: 0.03, cutoff: 1800 }));
  // the lead only plays every other time round the loop, so it does not tire
  const lead = LEAD[Math.floor(step / 16) % LEAD.length]![s]!;
  if (lead && Math.floor(step / 64) % 2 === 1) tone(ctx, out, lead, t, STEP * 1.8, { type: 'triangle', vol: 0.09 });
}

// ---------- engine ----------

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SoundSettings>) };
  } catch {
    // storage can be blocked; defaults are fine
  }
  return { ...DEFAULTS };
}

let settings = loadSettings();
const listeners = new Set<() => void>();

let ctx: AudioContext | undefined;
let sfxBus: GainNode | undefined;
let musicBus: GainNode | undefined;
let musicWanted = false;
let musicTimer: number | undefined;
let musicStepAt = 0;
let musicStepNo = 0;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Sets each bus to the current settings, smoothly so a slider does not click. */
function applyVolumes() {
  if (!ctx || !sfxBus || !musicBus) return;
  const now = ctx.currentTime;
  sfxBus.gain.setTargetAtTime(settings.muted ? 0 : settings.sfx * SFX_LEVEL, now, 0.02);
  musicBus.gain.setTargetAtTime(settings.muted ? 0 : settings.music * MUSIC_LEVEL, now, 0.05);
}

/** Creates the audio context on the first touch or key press, as browsers require. */
function unlock() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = ctx.createDynamicsCompressor();
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus.connect(master);
    musicBus.connect(master);
    applyVolumes();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  if (musicWanted) startMusic();
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, unlock, { capture: true });
}

/** Plays one effect now. Does nothing before the first touch, or while muted. */
export function sfx(name: Sfx, delay = 0) {
  if (!ctx || !sfxBus || settings.muted || settings.sfx === 0 || ctx.state !== 'running') return;
  RECIPES[name](ctx, sfxBus, ctx.currentTime + 0.01 + delay);
}

/** Schedules the loop a little ahead of time, so timers that run late do not stutter the beat. */
function scheduleMusic() {
  if (!ctx || !musicBus) return;
  while (musicStepAt < ctx.currentTime + 0.15) {
    musicStep(ctx, musicBus, musicStepNo++, musicStepAt);
    musicStepAt += STEP;
  }
}

function startMusic() {
  if (!ctx || musicTimer !== undefined) return;
  musicStepNo = 0;
  musicStepAt = ctx.currentTime + 0.1;
  musicTimer = window.setInterval(scheduleMusic, 30);
}

/** Turns the background loop on or off; it starts once sound is allowed. */
export function setMusic(on: boolean) {
  musicWanted = on;
  if (on) startMusic();
  else if (musicTimer !== undefined) {
    clearInterval(musicTimer);
    musicTimer = undefined;
  }
}

/** Changes and saves sound settings. */
export function updateSound(patch: Partial<SoundSettings>) {
  settings = { ...settings, ...patch, sfx: clamp(patch.sfx ?? settings.sfx), music: clamp(patch.music ?? settings.music) };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // not saved this time; the setting still applies until reload
  }
  applyVolumes();
  listeners.forEach((l) => l());
}

/** The current sound settings, re-rendering when they change. */
export function useSoundSettings(): SoundSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => settings,
  );
}
