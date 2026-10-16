// Synthetic soundscapes for the demo and tests. Pure: returns Float32Array samples.
// Scenes: "forest" (birds + insects + stream), "crowd" (voices, horns, speaker music,
// engines, a few distant birds) and "rain" (broadband rain + droplets + few birds).
// Everything is generated here, so there are no third-party recordings to license.

import { mulberry32, range, pick, gauss } from './rng.js';

class Biquad {
  constructor(type, freq, q, sr) {
    const w = (2 * Math.PI * freq) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    let b0, b1, b2;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    } else {
      b0 = alpha; b1 = 0; b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0; this.a2 = (1 - alpha) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const SPECIES = ['whistler', 'trill', 'warbler', 'scops', 'bulbul', 'barbet'];

// One bird phrase written into buf starting at sample s0.
function birdPhrase(buf, sr, s0, rng, amp) {
  const kind = pick(rng, SPECIES);
  let notes;
  if (kind === 'whistler') {
    const base = range(rng, 2600, 3600);
    notes = Array.from({ length: 3 + Math.floor(rng() * 4) }, (_, i) => ({
      dur: 0.12, gap: 0.07, f0: base + i * 120, f1: base + i * 120 + 400, vib: 0, vd: 0,
    }));
  } else if (kind === 'trill') {
    const base = range(rng, 4800, 6200);
    notes = Array.from({ length: 10 + Math.floor(rng() * 10) }, () => ({
      dur: 0.03, gap: 0.02, f0: base, f1: base - 600, vib: 0, vd: 0,
    }));
  } else if (kind === 'warbler') {
    const base = range(rng, 3500, 5500);
    notes = [{ dur: range(rng, 0.5, 0.9), gap: 0, f0: base, f1: base + range(rng, -800, 800), vib: range(rng, 30, 60), vd: range(rng, 500, 1100) }];
  } else if (kind === 'scops') {
    const base = range(rng, 2200, 2500);
    notes = [{ dur: 0.18, gap: 0.5, f0: base, f1: base - 150, vib: 0, vd: 0 }, { dur: 0.18, gap: 0, f0: base, f1: base - 150, vib: 0, vd: 0 }];
  } else if (kind === 'barbet') {
    // Low repeated "kutroo" note, the one forest voice inside the 1-2 kHz band.
    const base = range(rng, 1300, 1700);
    notes = Array.from({ length: 3 + Math.floor(rng() * 3) }, () => ({
      dur: 0.14, gap: 0.12, f0: base, f1: base - 120, vib: 0, vd: 0,
    }));
  } else {
    const base = range(rng, 2400, 3200);
    notes = Array.from({ length: 4 }, (_, i) => ({
      dur: 0.09, gap: 0.05, f0: base + (i % 2) * 700, f1: base + (i % 2) * 700 + 300, vib: 0, vd: 0,
    }));
  }
  let s = s0;
  for (const n of notes) {
    const len = Math.floor(n.dur * sr);
    let phase = rng() * 6.28;
    for (let i = 0; i < len && s + i < buf.length; i++) {
      const t = i / len;
      const f = n.f0 + (n.f1 - n.f0) * t + (n.vib ? n.vd * Math.sin(2 * Math.PI * n.vib * (i / sr)) : 0);
      phase += (2 * Math.PI * f) / sr;
      const env = Math.pow(Math.sin(Math.PI * t), 2);
      buf[s + i] += amp * env * (Math.sin(phase) + 0.18 * Math.sin(2 * phase));
    }
    s += len + Math.floor(n.gap * sr);
  }
}

function addBirds(buf, sr, rng, perSecond, amp) {
  const seconds = buf.length / sr;
  const count = Math.round(seconds * perSecond);
  for (let i = 0; i < count; i++) {
    birdPhrase(buf, sr, Math.floor(rng() * buf.length), rng, amp * range(rng, 0.4, 1));
  }
}

function addInsects(buf, sr, rng, amp) {
  // Cricket: 4.8 kHz carrier pulsed at 30 Hz inside 0.3 s chirps every ~0.8 s.
  const fc = range(rng, 4500, 5200);
  for (let i = 0; i < buf.length; i++) {
    const t = i / sr;
    const chirp = (t % 0.8) < 0.3 ? 1 : 0;
    const pulse = Math.sin(2 * Math.PI * 30 * t) > 0.2 ? 1 : 0;
    buf[i] += amp * chirp * pulse * Math.sin(2 * Math.PI * fc * t);
  }
  // Cicada: band-limited noise around 6.5 kHz with an 80 Hz flutter.
  const bp = new Biquad('bandpass', 6500, 6, sr);
  for (let i = 0; i < buf.length; i++) {
    const t = i / sr;
    buf[i] += amp * 0.9 * bp.run(gauss(rng)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 80 * t));
  }
}

function addStream(buf, sr, rng, amp) {
  const lp = new Biquad('lowpass', 500, 0.7, sr);
  for (let i = 0; i < buf.length; i++) buf[i] += amp * lp.run(gauss(rng));
}

function addFloor(buf, rng, amp) {
  for (let i = 0; i < buf.length; i++) buf[i] += amp * gauss(rng);
}

function addVoices(buf, sr, rng, count, amp) {
  for (let v = 0; v < count; v++) {
    const f1 = new Biquad('bandpass', range(rng, 500, 850), 3, sr);
    const f2 = new Biquad('bandpass', range(rng, 1100, 1900), 4, sr);
    const lp = new Biquad('lowpass', 2000, 0.7, sr);
    let f0 = range(rng, 105, 240);
    let phase = 0;
    let talking = rng() < 0.6;
    let nextSwitch = Math.floor(range(rng, 0.6, 2.5) * sr);
    const syl = range(rng, 3.5, 5.5);
    for (let i = 0; i < buf.length; i++) {
      if (i >= nextSwitch) {
        talking = !talking;
        nextSwitch = i + Math.floor(range(rng, talking ? 1.0 : 0.3, talking ? 3.0 : 1.2) * sr);
        f0 = range(rng, 105, 240);
      }
      if (!talking) { lp.run(0); continue; }
      const t = i / sr;
      phase += (2 * Math.PI * f0 * (1 + 0.04 * Math.sin(2 * Math.PI * 0.7 * t))) / sr;
      const saw = ((phase / (2 * Math.PI)) % 1) * 2 - 1;
      const src = saw + 0.3 * gauss(rng);
      const env = Math.max(0, Math.sin(2 * Math.PI * syl * t + v));
      buf[i] += amp * env * lp.run(1.4 * f1.run(src) + f2.run(src));
    }
  }
}

function addHorns(buf, sr, rng, amp) {
  const lp = new Biquad('lowpass', 2000, 0.7, sr);
  let s = Math.floor(range(rng, 0.2, 1.5) * sr);
  const on = new Uint8Array(buf.length);
  while (s < buf.length) {
    const len = Math.floor(range(rng, 0.3, 1.0) * sr);
    for (let i = s; i < Math.min(buf.length, s + len); i++) on[i] = 1;
    s += len + Math.floor(range(rng, 0.8, 3.0) * sr);
  }
  const fa = range(rng, 400, 440);
  const fb = fa * 1.25;
  for (let i = 0; i < buf.length; i++) {
    const t = i / sr;
    let x = 0;
    if (on[i]) {
      for (let h = 1; h <= 5; h++) x += (Math.sin(2 * Math.PI * fa * h * t) + Math.sin(2 * Math.PI * fb * h * t)) / h;
    }
    buf[i] += amp * lp.run(x);
  }
}

function addSpeakerMusic(buf, sr, rng, amp) {
  const lpBass = new Biquad('lowpass', 400, 0.7, sr);
  const lpLead = new Biquad('lowpass', 1800, 0.7, sr);
  const bpm = 124;
  const beat = 60 / bpm;
  const scale = [392, 440, 494, 523, 587, 659, 698, 784];
  let note = pick(rng, scale);
  for (let i = 0; i < buf.length; i++) {
    const t = i / sr;
    const tb = t % beat;
    if (tb < 1 / sr) note = pick(rng, scale);
    const kick = Math.exp(-tb * 18) * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-tb * 30)) * tb);
    const bass = lpBass.run(Math.sign(Math.sin(2 * Math.PI * 98 * t)));
    const lead = lpLead.run(Math.sign(Math.sin(2 * Math.PI * note * t)) * (tb < beat * 0.7 ? 1 : 0));
    buf[i] += amp * (0.9 * kick + 0.5 * bass + 0.45 * lead);
  }
}

function addRain(buf, sr, rng, amp) {
  const hp = new Biquad('highpass', 400, 0.7, sr);
  for (let i = 0; i < buf.length; i++) buf[i] += amp * hp.run(gauss(rng));
  const drops = Math.round((buf.length / sr) * 180);
  for (let d = 0; d < drops; d++) {
    const s = Math.floor(rng() * buf.length);
    const len = Math.floor(0.003 * sr);
    const a = amp * range(rng, 1, 3);
    for (let i = 0; i < len && s + i < buf.length; i++) buf[s + i] += a * gauss(rng) * Math.exp(-i / (len / 4));
  }
}

function normalise(buf, peak = 0.85) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
}

export const SCENES = {
  forest: 'Healthy forest',
  crowd: 'Tourist crowd',
  rain: 'Heavy rain',
};

export function synthScene(scene, seconds, sr, seed = 7) {
  const rng = mulberry32(seed);
  const buf = new Float32Array(Math.floor(seconds * sr));
  addFloor(buf, rng, 0.0015);
  if (scene === 'forest') {
    addStream(buf, sr, rng, 0.03);
    addInsects(buf, sr, rng, 0.03);
    addBirds(buf, sr, rng, 4.5, 0.35);
  } else if (scene === 'crowd') {
    addStream(buf, sr, rng, 0.03);
    addVoices(buf, sr, rng, 14, 0.09);
    addHorns(buf, sr, rng, 0.12);
    addSpeakerMusic(buf, sr, rng, 0.22);
    addBirds(buf, sr, rng, 0.6, 0.05);
  } else if (scene === 'rain') {
    addRain(buf, sr, rng, 0.12);
    addBirds(buf, sr, rng, 0.8, 0.12);
  }
  return normalise(buf);
}
