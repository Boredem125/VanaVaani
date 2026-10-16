// Browser audio engine shared by the Listen tab and Judge mode.
//
// One AudioContext, one AnalyserNode (fftSize 2048, no smoothing). A source is
// either a looped synthetic scene (synth.js) or the microphone. Every ~50 ms the
// analyser frame is converted to linear magnitude and kept in a rolling buffer
// (~4.5 s) for live readings; recordFor() collects every frame over a window.
//
// Graph: scene BufferSource -> analyser -> outGain -> destination
//        mic MediaStreamSource -> analyser (outGain muted, so no feedback)
// The analyser sits before the output gain, so analysis still works when muted.
//
// Only numbers come out of this module. No raw audio is stored or sent anywhere.

import { synthScene } from './synth.js';
import { dbFrameToMagnitude, spectrogram } from './indices.js';

export const NFFT = 2048;
export const FRAME_MS = 50;
export const LIVE_FRAMES = 90; // ~4.5 s

// Fired on `engine`: "state" (source/preparing changed), "frame" (new frame).
export const engine = new EventTarget();
const emit = (type, detail) => engine.dispatchEvent(new CustomEvent(type, { detail }));

let ctx = null;
let analyser = null;
let outGain = null;
let dbBuf = null;
let bufSource = null;
let micStream = null;
let micNode = null;
let timer = null;
let frames = [];
let muted = false;
let token = 0;
const recorders = new Set();
const sceneCache = new Map(); // `${scene}:${seed}` -> AudioBuffer

const state = { mode: null, scene: null, owner: null, preparing: false };

export const getEngineState = () => ({ ...state, frames: frames.length });

function setState(patch) {
  Object.assign(state, patch);
  emit('state', getEngineState());
}

// Must be called synchronously inside a user gesture the first time.
export function ensureContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('This browser has no Web Audio support.');
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = NFFT;
    analyser.smoothingTimeConstant = 0;
    outGain = ctx.createGain();
    analyser.connect(outGain);
    outGain.connect(ctx.destination);
    dbBuf = new Float32Array(analyser.frequencyBinCount);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function applyGain() {
  if (!outGain) return;
  outGain.gain.value = state.mode === 'scene' && !muted ? 1 : 0;
}

export function setMuted(on) {
  muted = !!on;
  applyGain();
}
export const isMuted = () => muted;

function nextPaint() {
  // Let the browser paint "Preparing sound..." before heavy synthesis.
  // The timeout covers background tabs where rAF does not fire.
  return new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; setTimeout(resolve, 0); } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    setTimeout(go, 120);
  });
}

function failRecorders(message) {
  for (const rec of recorders) {
    const err = new Error(message);
    err.name = 'AbortError';
    rec.reject(err);
  }
  recorders.clear();
}

function stopSources(reason) {
  if (bufSource) {
    try { bufSource.stop(); } catch { /* already stopped */ }
    try { bufSource.disconnect(); } catch { /* ignore */ }
    bufSource = null;
  }
  if (micNode) {
    try { micNode.disconnect(); } catch { /* ignore */ }
    micNode = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  frames = [];
  if (recorders.size) failRecorders(reason || 'Recording stopped.');
}

function tick() {
  if (!analyser || !state.mode || state.preparing) return;
  analyser.getFloatFrequencyData(dbBuf);
  const mag = dbFrameToMagnitude(dbBuf);
  frames.push(mag);
  if (frames.length > LIVE_FRAMES) frames.splice(0, frames.length - LIVE_FRAMES);
  const now = performance.now();
  for (const rec of [...recorders]) {
    rec.frames.push(mag);
    const p = Math.min(1, (now - rec.start) / rec.dur);
    try { rec.onProgress?.(p, rec.frames.length); } catch (e) { console.error(e); }
    if (p >= 1) {
      recorders.delete(rec);
      rec.resolve({ frames: rec.frames, sampleRate: ctx.sampleRate, nfft: NFFT, durationSec: rec.dur / 1000 });
    }
  }
  emit('frame', { mag, sampleRate: ctx.sampleRate, nfft: NFFT });
}

function startTimer() {
  if (!timer) timer = setInterval(tick, FRAME_MS);
}

// Play a looped synthetic scene: 'forest' | 'crowd' | 'rain'.
// opts: { owner, seed }. Resolves once sound is playing.
export async function playScene(scene, opts = {}) {
  const c = ensureContext();
  const seed = opts.seed ?? 7;
  stopSources('Sound source changed during recording.');
  const my = ++token;
  setState({ mode: 'scene', scene, owner: opts.owner || null, preparing: true });
  applyGain();
  const key = `${scene}:${seed}`;
  let buf = sceneCache.get(key);
  if (!buf) {
    await nextPaint();
    if (my !== token) return false;
    const samples = synthScene(scene, 10, c.sampleRate, seed);
    buf = c.createBuffer(1, samples.length, c.sampleRate);
    buf.copyToChannel(samples, 0);
    if (sceneCache.size >= 8) sceneCache.delete(sceneCache.keys().next().value);
    sceneCache.set(key, buf);
  }
  if (my !== token) return false;
  bufSource = c.createBufferSource();
  bufSource.buffer = buf;
  bufSource.loop = true;
  bufSource.connect(analyser);
  bufSource.start();
  frames = [];
  setState({ preparing: false });
  applyGain();
  startTimer();
  return true;
}

// Listen to the microphone (analysis only; never routed to the speakers).
export async function startMic(opts = {}) {
  const c = ensureContext();
  stopSources('Sound source changed during recording.');
  const my = ++token;
  setState({ mode: 'mic', scene: null, owner: opts.owner || null, preparing: true });
  applyGain();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setState({ mode: null, owner: null, preparing: false });
    throw new Error('Microphone access needs a secure page (https or localhost) and a browser that supports it. Use Demo sound instead.');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    if (my === token) setState({ mode: null, owner: null, preparing: false });
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('Microphone permission was denied. Allow it in the browser site settings, or use Demo sound.');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new Error('No microphone was found on this device. Use Demo sound or upload a file.');
    }
    if (name === 'NotReadableError') {
      throw new Error('The microphone is busy in another app. Close it and try again.');
    }
    throw new Error('Could not open the microphone: ' + ((err && err.message) || String(err)));
  }
  if (my !== token) {
    stream.getTracks().forEach((t) => t.stop());
    return false;
  }
  micStream = stream;
  micNode = c.createMediaStreamSource(stream);
  micNode.connect(analyser);
  frames = [];
  setState({ preparing: false });
  applyGain();
  startTimer();
  return true;
}

// Stop the active source. With an owner, only stops if that owner started it.
export function stop(owner) {
  if (owner && state.owner && state.owner !== owner) return false;
  token++;
  stopSources('Recording stopped.');
  setState({ mode: null, scene: null, owner: null, preparing: false });
  applyGain();
  return true;
}

export const isActive = () => !!state.mode && !state.preparing;

// Last n frames of the live buffer, ready for computeIndices().
export function getSpec(nFrames = LIVE_FRAMES) {
  return {
    frames: frames.slice(-nFrames),
    sampleRate: ctx ? ctx.sampleRate : 48000,
    nfft: NFFT,
  };
}

// Collect every frame for `seconds` from the active source.
// onProgress(fraction 0..1, framesSoFar). Rejects (name AbortError) if the
// source stops or changes, or cancelRecording() is called.
export function recordFor(seconds, onProgress) {
  return new Promise((resolve, reject) => {
    if (!state.mode || state.preparing) {
      reject(new Error('No sound source is playing.'));
      return;
    }
    recorders.add({ frames: [], start: performance.now(), dur: seconds * 1000, resolve, reject, onProgress });
  });
}

export function cancelRecording(message = 'Recording cancelled.') {
  if (recorders.size) failRecorders(message);
}

// Decode an uploaded audio file and return its magnitude spectrogram (first 60 s).
// Returns { frames, sampleRate, nfft, durationSec, truncated }.
export async function analyseFile(file, maxSeconds = 60) {
  const c = ensureContext();
  const data = await file.arrayBuffer();
  let audio;
  try {
    audio = await new Promise((resolve, reject) => {
      const p = c.decodeAudioData(data, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  } catch {
    throw new Error('This file could not be decoded as audio. Try WAV, MP3, M4A or OGG.');
  }
  const sr = audio.sampleRate;
  const n = Math.min(audio.length, Math.floor(maxSeconds * sr));
  if (n < NFFT * 3) throw new Error('This file is too short to analyse (under a quarter second).');
  const mono = new Float32Array(n);
  const ch = audio.numberOfChannels;
  for (let k = 0; k < ch; k++) {
    const d = audio.getChannelData(k);
    for (let i = 0; i < n; i++) mono[i] += d[i] / ch;
  }
  await nextPaint();
  const spec = spectrogram(mono, sr, NFFT);
  return { ...spec, durationSec: n / sr, truncated: audio.length > n };
}

// ---- Spectrogram canvas --------------------------------------------------

function parseColor(str, fallback) {
  const s = (str || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return m[1].split('').map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  return fallback;
}

function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fb) => parseColor(cs.getPropertyValue(name), fb);
  return {
    low: get('--surface-2', [227, 234, 226]),
    mid: get('--accent', [10, 117, 132]),
    high: get('--warn', [185, 122, 12]),
    ink: cs.getPropertyValue('--ink').trim() || '#12231b',
    surface: cs.getPropertyValue('--surface').trim() || '#f9fbf7',
    bad: cs.getPropertyValue('--bad').trim() || '#bf3d2a',
    ok: cs.getPropertyValue('--ok').trim() || '#2b8a4b',
    mono: cs.getPropertyValue('--font-mono').trim() || 'monospace',
  };
}

// 256-entry colour table packed as little-endian RGBA uint32.
function buildLut(t) {
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let a;
    let b;
    let f;
    if (x < 0.6) { a = t.low; b = t.mid; f = x / 0.6; } else { a = t.mid; b = t.high; f = (x - 0.6) / 0.4; }
    const r = Math.round(a[0] + (b[0] - a[0]) * f);
    const g = Math.round(a[1] + (b[1] - a[1]) * f);
    const bl = Math.round(a[2] + (b[2] - a[2]) * f);
    lut[i] = (255 << 24) | (bl << 16) | (g << 8) | r;
  }
  return lut;
}

const DB_RANGE = 70;

// Scrolling waterfall: newest column on the right, 0 Hz at the bottom.
// new SpectrogramView(canvas, { maxHz, colPx, labels })
//   .follow()        subscribe to engine frames (returns unsubscribe)
//   .push(mag, sr, nfft)
//   .showSpec(spec)  draw a whole spectrogram (uploaded file) across the width
//   .clear(), .destroy()
export class SpectrogramView {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.maxHz = opts.maxHz || 12000;
    this.colPx = opts.colPx || 4;
    this.labels = opts.labels !== false;
    this.maxCols = 400;
    this.cols = []; // { db: Float32Array, max }
    this.staticSpec = null;
    this.sampleRate = 48000;
    this.nfft = NFFT;
    this.raf = 0;
    this.unfollow = null;
    this.tokens = readTokens();
    this.lut = buildLut(this.tokens);
    this.resize();
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { this.resize(); this.schedule(); }) : null;
    this.ro?.observe(canvas);
    this.mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    this.onTheme = () => { this.tokens = readTokens(); this.lut = buildLut(this.tokens); this.schedule(); };
    this.mq?.addEventListener?.('change', this.onTheme);
    this.draw();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.canvas.width && h === this.canvas.height && this.img) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.dpr = dpr;
    this.img = this.g.createImageData(w, h);
    this.px = new Uint32Array(this.img.data.buffer);
  }

  follow() {
    const fn = (e) => this.push(e.detail.mag, e.detail.sampleRate, e.detail.nfft);
    engine.addEventListener('frame', fn);
    this.unfollow = () => engine.removeEventListener('frame', fn);
    return this.unfollow;
  }

  toDb(mag) {
    const nBins = Math.min(mag.length, Math.ceil((this.maxHz / this.sampleRate) * this.nfft) + 1);
    const db = new Float32Array(nBins);
    let max = -240;
    for (let k = 0; k < nBins; k++) {
      const v = 20 * Math.log10(mag[k] + 1e-12);
      db[k] = v;
      if (k > 0 && v > max) max = v;
    }
    return { db, max };
  }

  push(mag, sampleRate = this.sampleRate, nfft = this.nfft) {
    this.sampleRate = sampleRate;
    this.nfft = nfft;
    this.staticSpec = null;
    this.cols.push(this.toDb(mag));
    if (this.cols.length > this.maxCols) this.cols.splice(0, this.cols.length - this.maxCols);
    this.schedule();
  }

  showSpec(spec) {
    this.sampleRate = spec.sampleRate;
    this.nfft = spec.nfft;
    this.staticSpec = spec.frames.map((f) => this.toDb(f));
    this.schedule();
  }

  clear() {
    this.cols = [];
    this.staticSpec = null;
    this.schedule();
  }

  schedule() {
    if (this.raf) return;
    const run = () => { this.raf = 0; this.draw(); };
    if (typeof requestAnimationFrame === 'function') this.raf = requestAnimationFrame(run);
    else run();
  }

  draw() {
    if (!this.canvas.isConnected || this.canvas.clientWidth === 0) return;
    this.resize();
    const W = this.canvas.width;
    const H = this.canvas.height;
    const px = this.px;
    px.fill(this.lut[0]);

    const binHz = this.sampleRate / this.nfft;
    // Row -> [binLo, binHi) with row 0 at the top (maxHz).
    const rowLo = new Int32Array(H);
    const rowHi = new Int32Array(H);
    for (let y = 0; y < H; y++) {
      const fTop = (1 - y / H) * this.maxHz;
      const fBot = (1 - (y + 1) / H) * this.maxHz;
      const lo = Math.max(1, Math.floor(fBot / binHz));
      rowLo[y] = lo;
      rowHi[y] = Math.max(lo + 1, Math.ceil(fTop / binHz));
    }

    let columns;
    let colW;
    if (this.staticSpec) {
      const T = this.staticSpec.length;
      columns = [];
      const n = Math.min(W, T);
      for (let i = 0; i < n; i++) columns.push(this.staticSpec[Math.floor((i * T) / n)]);
      colW = W / Math.max(1, n);
    } else {
      colW = Math.max(1, Math.round(this.colPx * (this.dpr || 1)));
      const visible = Math.ceil(W / colW);
      columns = this.cols.slice(-visible);
    }

    let ref = -240;
    for (const c of columns) if (c.max > ref) ref = c.max;
    const floor = ref - DB_RANGE;

    const n = columns.length;
    for (let i = 0; i < n; i++) {
      const c = columns[i];
      const db = c.db;
      // Right-aligned: newest at the right edge.
      const x0 = this.staticSpec ? Math.floor(i * colW) : W - (n - i) * colW;
      const x1 = this.staticSpec ? Math.floor((i + 1) * colW) : x0 + colW;
      const xa = Math.max(0, x0);
      const xb = Math.min(W, x1);
      if (xb <= xa) continue;
      for (let y = 0; y < H; y++) {
        let v = -240;
        const hi = Math.min(rowHi[y], db.length);
        for (let k = rowLo[y]; k < hi; k++) if (db[k] > v) v = db[k];
        let t = (v - floor) / DB_RANGE;
        t = t <= 0 ? 0 : t >= 1 ? 1 : t;
        const color = this.lut[(t * 255) | 0];
        const row = y * W;
        for (let x = xa; x < xb; x++) px[row + x] = color;
      }
    }
    this.g.putImageData(this.img, 0, 0);
    if (this.labels) this.overlay(W, H);
  }

  overlay(W, H) {
    const g = this.g;
    const d = this.dpr || 1;
    const t = this.tokens;
    const yOf = (hz) => Math.round((1 - hz / this.maxHz) * H) + 0.5;
    const fs = Math.round(10 * d);
    g.save();
    g.font = `500 ${fs}px ${t.mono}`;
    g.textBaseline = 'middle';
    g.lineWidth = Math.max(1, d);

    const label = (text, y, color) => {
      const padX = 4 * d;
      const w = g.measureText(text).width + padX * 2;
      const h = fs + 4 * d;
      g.globalAlpha = 0.82;
      g.fillStyle = t.surface;
      g.fillRect(4 * d, y - h / 2, w, h);
      g.globalAlpha = 1;
      g.fillStyle = color;
      g.fillText(text, 4 * d + padX, y);
    };

    // Anthrophony band 1-2 kHz
    g.strokeStyle = t.bad;
    g.setLineDash([4 * d, 3 * d]);
    for (const hz of [1000, 2000]) {
      g.beginPath(); g.moveTo(0, yOf(hz)); g.lineTo(W, yOf(hz)); g.stroke();
    }
    // Biophony band 2-11 kHz (top edge)
    g.strokeStyle = t.ok;
    g.beginPath(); g.moveTo(0, yOf(11000)); g.lineTo(W, yOf(11000)); g.stroke();
    g.setLineDash([]);

    const small = H < 140 * d;
    label(small ? 'people 1-2k' : 'People, engines 1-2 kHz', (yOf(1000) + yOf(2000)) / 2, t.bad);
    label(small ? 'birds 2-11k' : 'Birds, insects 2-11 kHz', (yOf(2000) + yOf(11000)) / 2, t.ok);

    g.textAlign = 'right';
    g.fillStyle = t.ink;
    g.globalAlpha = 0.75;
    g.fillText('12 kHz', W - 4 * d, fs * 0.8);
    g.fillText('0', W - 4 * d, H - fs * 0.8);
    g.restore();
  }

  destroy() {
    this.unfollow?.();
    this.unfollow = null;
    this.ro?.disconnect();
    this.mq?.removeEventListener?.('change', this.onTheme);
    if (this.raf) cancelAnimationFrame(this.raf);
  }
}
