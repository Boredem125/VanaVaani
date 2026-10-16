// Ecoacoustic indices computed from a magnitude spectrogram.
// Pure functions: used by the browser (live analyser frames, uploaded files)
// and by the Node tests (synthetic scenes).
//
// NDSI  Kasten et al. 2012  (biophony 2-11 kHz vs anthrophony 1-2 kHz)
// ACI   Pieretti et al. 2011 (frame-to-frame intensity change per bin)
// ADI   Villanueva-Rivera et al. 2011 (Shannon evenness over 1 kHz bands)
// BI    Boelman et al. 2007 (area of mean spectrum above its floor, 2-8 kHz)

export const BANDS = {
  anthro: [1000, 2000],
  bio: [2000, 11000],
  biBand: [2000, 8000],
  flat: [500, 10000],
};

// In-place iterative radix-2 FFT. re/im are Float64Array of length 2^n.
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// Hann-windowed magnitude spectrogram, non-overlapping frames by default.
export function spectrogram(samples, sampleRate, nfft = 2048, hop = nfft) {
  const win = new Float64Array(nfft);
  for (let i = 0; i < nfft; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (nfft - 1));
  const frames = [];
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  for (let start = 0; start + nfft <= samples.length; start += hop) {
    for (let i = 0; i < nfft; i++) {
      re[i] = samples[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(nfft / 2);
    for (let k = 0; k < nfft / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    frames.push(mag);
  }
  return { frames, sampleRate, nfft };
}

// Convert an AnalyserNode dB frame into linear magnitude.
export function dbFrameToMagnitude(dbFrame) {
  const out = new Float32Array(dbFrame.length);
  for (let i = 0; i < dbFrame.length; i++) {
    const v = dbFrame[i];
    out[i] = Number.isFinite(v) ? Math.pow(10, v / 20) : 0;
  }
  return out;
}

function binRange(spec, [lo, hi]) {
  const binHz = spec.sampleRate / spec.nfft;
  const nBins = spec.nfft / 2;
  const a = Math.max(1, Math.round(lo / binHz));
  const b = Math.min(nBins, Math.round(hi / binHz));
  return [a, b];
}

export function computeIndices(spec) {
  const { frames } = spec;
  const nBins = spec.nfft / 2;
  const binHz = spec.sampleRate / spec.nfft;
  const T = frames.length;
  if (T < 3) return null;

  // Mean power spectrum and global max magnitude.
  const P = new Float64Array(nBins);
  let maxMag = 0;
  for (const f of frames) {
    for (let k = 0; k < nBins; k++) {
      P[k] += f[k] * f[k];
      if (f[k] > maxMag) maxMag = f[k];
    }
  }
  for (let k = 0; k < nBins; k++) P[k] /= T;
  const eps = 1e-20;

  // NDSI
  const sumBand = (range) => {
    const [a, b] = binRange(spec, range);
    let s = 0;
    for (let k = a; k < b; k++) s += P[k];
    return s;
  };
  const anthro = sumBand(BANDS.anthro);
  const bio = sumBand(BANDS.bio);
  const ndsi = bio + anthro > eps ? (bio - anthro) / (bio + anthro) : 0;

  // ACI, averaged over the biophony bins.
  const [ba, bb] = binRange(spec, BANDS.bio);
  let aciSum = 0;
  let aciBins = 0;
  for (let k = ba; k < bb; k++) {
    let d = 0;
    let s = 0;
    for (let t = 0; t < T; t++) {
      s += frames[t][k];
      if (t > 0) d += Math.abs(frames[t][k] - frames[t - 1][k]);
    }
    if (s > eps) {
      aciSum += d / s;
      aciBins++;
    }
  }
  const aci = aciBins ? aciSum / aciBins : 0;

  // ADI over ten 1 kHz bands from 0 to 10 kHz, -50 dB threshold.
  const thr = maxMag * Math.pow(10, -50 / 20);
  const occ = [];
  for (let band = 0; band < 10; band++) {
    const [a, b] = binRange(spec, [band * 1000, (band + 1) * 1000]);
    let hits = 0;
    let cells = 0;
    for (const f of frames) {
      for (let k = a; k < b; k++) {
        cells++;
        if (f[k] > thr) hits++;
      }
    }
    occ.push(cells ? hits / cells : 0);
  }
  const occSum = occ.reduce((x, y) => x + y, 0);
  let adi = 0;
  if (occSum > 0) {
    for (const o of occ) {
      const p = o / occSum;
      if (p > 0) adi -= p * Math.log(p);
    }
    adi /= Math.log(occ.length);
  }

  // BI: area (dB x kHz) of the normalised mean spectrum above its 2-8 kHz floor.
  let maxP = 0;
  for (let k = 1; k < nBins; k++) if (P[k] > maxP) maxP = P[k];
  const [ia, ib] = binRange(spec, BANDS.biBand);
  const db = [];
  for (let k = ia; k < ib; k++) db.push(10 * Math.log10((P[k] + eps) / (maxP + eps)));
  const floor = Math.min(...db);
  const bi = db.reduce((acc, v) => acc + (v - floor), 0) * (binHz / 1000);

  // Spectral flatness of the mean spectrum (rain and wind are flat, birds are not).
  const [fa, fb] = binRange(spec, BANDS.flat);
  let logSum = 0;
  let linSum = 0;
  for (let k = fa; k < fb; k++) {
    logSum += Math.log(P[k] + eps);
    linSum += P[k];
  }
  const nFlat = fb - fa;
  const flatness = linSum > eps ? Math.exp(logSum / nFlat) / (linSum / nFlat) : 0;

  // 500 Hz band fingerprint (log power, unit length) for duplicate detection.
  const fingerprint = [];
  for (let f0 = 0; f0 < 11000; f0 += 500) {
    const [a, b] = binRange(spec, [f0, f0 + 500]);
    let s = 0;
    for (let k = a; k < b; k++) s += P[k];
    fingerprint.push(Math.log10(s + 1e-12));
  }
  const mean = fingerprint.reduce((x, y) => x + y, 0) / fingerprint.length;
  const centered = fingerprint.map((v) => v - mean);
  const norm = Math.hypot(...centered) || 1;

  return {
    ndsi,
    aci,
    adi,
    bi,
    flatness,
    rain: flatness > RAIN_FLATNESS,
    anthroShare: anthro / (anthro + bio + eps),
    fingerprint: centered.map((v) => +(v / norm).toFixed(4)),
    frames: T,
  };
}

export const RAIN_FLATNESS = 0.35;

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}
