// Turns acoustic indices into a Forest Health Score, then into tomorrow's
// visitor quota and entry fee. Pure functions, shared with the Node tests.

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

// Calibrated on the synthetic scenes in synth.js (see tests/indices.test.mjs).
export const WEIGHTS = { ndsi: 0.45, aci: 0.25, adi: 0.2, bi: 0.1 };
export const RANGES = { aci: [0.5, 0.9], adi: [0.5, 0.95], bi: [0, 220] };

// Acoustic quality of one recording, 0..1.
export function acousticQuality(ix) {
  const s = {
    ndsi: (ix.ndsi + 1) / 2,
    aci: clamp((ix.aci - RANGES.aci[0]) / (RANGES.aci[1] - RANGES.aci[0])),
    adi: clamp((ix.adi - RANGES.adi[0]) / (RANGES.adi[1] - RANGES.adi[0])),
    bi: clamp((ix.bi - RANGES.bi[0]) / (RANGES.bi[1] - RANGES.bi[0])),
  };
  return WEIGHTS.ndsi * s.ndsi + WEIGHTS.aci * s.aci + WEIGHTS.adi * s.adi + WEIGHTS.bi * s.bi;
}

// Trail quality relative to the off-trail control post. The control strips out
// season and weather, so what remains is the effect of visitors.
export function healthScore(trailQuality, controlQuality) {
  if (!controlQuality || controlQuality <= 0) return 0;
  return Math.round(100 * clamp(trailQuality / controlQuality));
}

// ~3-day exponential moving average.
export const EMA_ALPHA = 0.5;
export function smooth(prevEma, today) {
  if (prevEma == null) return today;
  return Math.round(EMA_ALPHA * today + (1 - EMA_ALPHA) * prevEma);
}

export const STATUS = [
  { key: 'thriving', label: 'Thriving', min: 75 },
  { key: 'stressed', label: 'Stressed', min: 50 },
  { key: 'critical', label: 'Critical', min: 0 },
];

export function statusFor(score) {
  return STATUS.find((s) => score >= s.min);
}

// Full quota at 85+, falling linearly to a 25% floor at 30 and below.
export function quotaFor(site, score) {
  const f = clamp((score - 30) / (85 - 30), 0.25, 1);
  return Math.round((site.maxDaily * f) / 5) * 5;
}

// Fee rises with stress: base at 85+, up to 3.5x base at 30 and below.
export const SURGE_K = 2.5;
export function stressFor(score) {
  return clamp((85 - score) / 55);
}
export function priceFor(site, score) {
  return Math.round((site.baseFee * (1 + SURGE_K * stressFor(score))) / 5) * 5;
}

// Split of one visitor's fee: the base goes to the village committee; the surge
// goes 70% to forest guardians and 30% to the restoration fund.
export function feeSplit(site, price) {
  const surge = Math.max(0, price - site.baseFee);
  return {
    village: Math.min(price, site.baseFee),
    guardians: Math.round(surge * 0.7),
    restoration: surge - Math.round(surge * 0.7),
  };
}

// Pick alternatives that are healthier than the current site, nearest first.
export function pickAlternatives(site, statusById, limit = 2) {
  return (site.alternatives || [])
    .map((alt) => ({ ...alt, status: statusById[alt.id] }))
    .filter((a) => a.status && a.status.score >= 70)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}
