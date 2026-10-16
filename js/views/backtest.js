// Back-test tab: one synthetic year at a site, "Fixed cap" vs "VanaVaani".
// runBacktest(site, seed) is pure (no DOM) so it also runs in Node.

import { mulberry32, gauss } from '../rng.js';
import { quotaFor, priceFor, feeSplit, smooth } from '../score.js';
import { bus, getCurrentSiteId, siteById } from '../store.js';
import {
  tokens, alpha, baseOptions, axis, makeChart, statusBandsPlugin, onThemeChange,
  fmt, inrCompact, esc,
} from '../charts.js';

// ---- Model -----------------------------------------------------------------

const YEAR = 2025; // a non-leap reference year; only weekdays and months matter
const DAYS = 365;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Seasonality multiplier by month (0 = Jan): peak Oct-Jan and Apr-Jun, monsoon low.
const SEASON = [1.2, 1.0, 0.95, 1.2, 1.2, 1.2, 0.6, 0.6, 0.6, 1.2, 1.2, 1.2];

// Festival / long-weekend days (month-day). Two 3-day clusters plus single days.
const FESTIVALS = new Set(['04-18', '04-19', '04-20', '08-15', '08-16', '08-17', '10-21', '12-25']);

export const BACKTEST_PARAMS = {
  weekend: 1.45,
  weekday: 0.8,
  festival: 2.3,
  demandNoiseSd: 0.22,
  recovery: 0.09, // fraction of the gap to 95 recovered each day
  ceiling: 95,
  damage: 10, // damage scale when load exceeds the tolerance
  tolerance: 0.6, // load (admitted / maxDaily) the forest absorbs without damage
  damageExp: 1.4,
  healthNoiseSd: 1.2,
  fixedCapX: 2, // Fixed scenario: gate closes at 2x maxDaily
  elasticity: -0.35,
  redirectShare: 0.45,
  altFeeShare: 0.8, // fee paid at the alternative village, as a share of baseFee
  overcrowdX: 1.2,
  critical: 50,
  // Reputation: a degraded, crowded site loses demand. Demand is scaled by
  // min(1, repFloor + (1 - repFloor) * mean14dHealth / repFull), the same for both scenarios.
  repFloor: 0.5,
  repFull: 75,
  repWindow: 14,
};

const clampH = (h) => Math.min(98, Math.max(5, h));
const p2 = (n) => String(n).padStart(2, '0');

export function runBacktest(site, seed = 1) {
  const P = BACKTEST_PARAMS;
  const rng = mulberry32((seed * 2654435761) ^ site.id.length * 7919);
  const max = site.maxDaily;

  // Shared randomness so both scenarios face the same demand and weather.
  const days = [];
  for (let d = 0; d < DAYS; d++) {
    const dt = new Date(YEAR, 0, 1 + d);
    const md = `${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`;
    const dow = dt.getDay();
    const weekend = dow === 0 || dow === 6;
    const festival = FESTIVALS.has(md);
    const noise = Math.exp(P.demandNoiseSd * gauss(rng) - (P.demandNoiseSd ** 2) / 2);
    const demand = max * SEASON[dt.getMonth()] * (weekend ? P.weekend : P.weekday) * (festival ? P.festival : 1) * noise;
    days.push({
      i: d,
      label: `${dt.getDate()} ${MONTHS[dt.getMonth()]}`,
      month: dt.getMonth(),
      weekend, festival,
      demand: Math.round(demand),
      hNoise: P.healthNoiseSd * gauss(rng),
    });
  }

  const rep = (hist) => {
    if (!hist.length) return 1;
    const w = hist.slice(-P.repWindow);
    const m = w.reduce((a, x) => a + x, 0) / w.length;
    return Math.min(1, P.repFloor + (1 - P.repFloor) * (m / P.repFull));
  };

  const step = (h, admitted, noise) => {
    const load = admitted / max;
    const dmg = P.damage * Math.max(0, load - P.tolerance) ** P.damageExp;
    return clampH(h + P.recovery * (P.ceiling - h) - dmg + noise);
  };

  // Scenario A: fixed cap, flat fee.
  let hA = site.seedScore;
  // Scenario B: VanaVaani, quota and fee from the smoothed score.
  let hB = site.seedScore;
  let ema = site.seedScore;

  const A = { health: [], admitted: [], fee: [] };
  const B = { health: [], admitted: [], fee: [], quota: [], ema: [], redirected: [] };
  const sumA = { visitors: 0, localIncome: 0, critical: 0, overcrowded: 0, healthSum: 0, redirected: 0, redirectedIncome: 0 };
  const sumB = { visitors: 0, localIncome: 0, critical: 0, overcrowded: 0, healthSum: 0, redirected: 0, redirectedIncome: 0, guardianIncome: 0, restoration: 0, turnedAway: 0 };

  for (const day of days) {
    // A
    const demandA = day.demand * rep(A.health);
    const admA = Math.round(Math.min(demandA, P.fixedCapX * max));
    A.admitted.push(admA);
    A.fee.push(site.baseFee);
    A.health.push(Math.round(hA));
    sumA.visitors += admA;
    sumA.localIncome += admA * site.baseFee;
    sumA.healthSum += hA;
    if (hA < P.critical) sumA.critical++;
    if (admA > P.overcrowdX * max) sumA.overcrowded++;
    hA = step(hA, admA, day.hNoise);

    // B: today's quota and fee were set from yesterday's smoothed score.
    const quota = quotaFor(site, ema);
    const fee = priceFor(site, ema);
    const split = feeSplit(site, fee);
    const demandB = day.demand * rep(B.health) * (fee / site.baseFee) ** P.elasticity;
    const admB = Math.round(Math.min(demandB, quota));
    const away = Math.max(0, demandB - admB);
    const redirected = Math.round(away * P.redirectShare);
    B.admitted.push(admB);
    B.fee.push(fee);
    B.quota.push(quota);
    B.ema.push(ema);
    B.redirected.push(redirected);
    B.health.push(Math.round(hB));
    sumB.visitors += admB;
    sumB.localIncome += admB * (split.village + split.guardians);
    sumB.guardianIncome += admB * split.guardians;
    sumB.restoration += admB * split.restoration;
    sumB.redirected += redirected;
    sumB.turnedAway += Math.round(away);
    sumB.redirectedIncome += redirected * site.baseFee * P.altFeeShare;
    sumB.healthSum += hB;
    if (hB < P.critical) sumB.critical++;
    if (admB > P.overcrowdX * max) sumB.overcrowded++;
    hB = step(hB, admB, day.hNoise);
    // Guides measure tonight; tomorrow's decision uses the 3-day EMA.
    ema = smooth(ema, Math.round(hB));
  }

  const finish = (s) => ({
    avgHealth: Math.round(s.healthSum / DAYS),
    criticalDays: s.critical,
    overcrowdedDays: s.overcrowded,
    visitors: s.visitors,
    localIncome: Math.round(s.localIncome),
    redirected: s.redirected,
    redirectedIncome: Math.round(s.redirectedIncome),
    ...(s.guardianIncome != null ? { guardianIncome: Math.round(s.guardianIncome), restoration: Math.round(s.restoration), turnedAway: s.turnedAway } : {}),
  });

  return {
    siteId: site.id,
    seed,
    labels: days.map((d) => d.label),
    demand: days.map((d) => d.demand),
    festival: days.map((d) => d.festival),
    fixed: { ...A, summary: finish(sumA) },
    vanavaani: { ...B, summary: finish(sumB) },
  };
}

// ---- View ------------------------------------------------------------------

let root = null;
let seed = 1;
let visible = false;
let dirty = true;
let lastResult = null;

const METRICS = [
  { key: 'avgHealth', label: 'Average forest health', better: 'higher', format: (v) => `${v}/100` },
  { key: 'criticalDays', label: 'Days in Critical (below 50)', better: 'lower', format: fmt },
  { key: 'overcrowdedDays', label: 'Overcrowded days (over 1.2x capacity)', better: 'lower', format: fmt },
  { key: 'visitors', label: 'Visitors at the site', better: 'higher', format: fmt },
  { key: 'localIncome', label: 'Income to locals (village + guardians)', better: 'higher', format: inrCompact },
  { key: 'redirected', label: 'Visitors redirected to other villages', better: 'higher', format: fmt },
];

function deltaText(m, a, b) {
  if (a === b) return 'no change';
  if (m.key === 'redirected') return `+${fmt(b - a)}`;
  if (m.key === 'criticalDays' || m.key === 'overcrowdedDays') return `${b - a > 0 ? '+' : ''}${fmt(b - a)} days`;
  if (m.key === 'avgHealth') return `${b - a > 0 ? '+' : ''}${b - a} pts`;
  if (a === 0) return `+${fmt(b)}`;
  const pct = Math.round(((b - a) / Math.abs(a)) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function deltaClass(m, a, b) {
  if (a === b) return '';
  const up = b > a;
  return (m.better === 'higher' ? up : !up) ? 'is-good' : 'is-bad';
}

function render() {
  if (!root) return;
  const site = siteById(getCurrentSiteId());
  const r = runBacktest(site, seed);
  lastResult = r;
  const A = r.fixed.summary;
  const B = r.vanavaani.summary;

  root.innerHTML = `
    <header class="view-head">
      <span class="eyebrow">Back-test &middot; one synthetic year <span class="sim-tag">Simulated</span></span>
      <h1>A year at ${esc(site.name)}: fixed cap vs VanaVaani</h1>
      <p>Same demand, same weather, same forest. One gate lets in up to twice the carrying capacity at a flat fee.
      The other sets each day's quota and fee from the forest's 3-day acoustic health.</p>
    </header>

    <div class="bt-controls row">
      <span class="muted small mono">Seed ${seed} &middot; capacity ${fmt(site.maxDaily)}/day &middot; base fee &#8377;${site.baseFee}</span>
      <button type="button" class="btn btn-sm" data-act="reseed">Run again with new seed</button>
    </div>

    <div class="bt-compare card" role="table" aria-label="Fixed cap versus VanaVaani, one year">
      <div class="bt-row bt-row-head" role="row">
        <span role="columnheader">Over the year</span>
        <span role="columnheader" class="bt-col-a">Fixed cap</span>
        <span role="columnheader" class="bt-col-b">VanaVaani</span>
      </div>
      ${METRICS.map((m) => `
        <div class="bt-row" role="row">
          <span role="rowheader" class="bt-label">${m.label}</span>
          <span role="cell" class="bt-val bt-col-a">${m.format(A[m.key])}</span>
          <span role="cell" class="bt-val bt-col-b">${m.format(B[m.key])}
            <small class="bt-delta ${deltaClass(m, A[m.key], B[m.key])}">${deltaText(m, A[m.key], B[m.key])}</small></span>
        </div>`).join('')}
    </div>
    <p class="muted small bt-note">Under VanaVaani, guardians earn ${inrCompact(B.guardianIncome)} from the surge and the restoration fund
      gets ${inrCompact(B.restoration)}. Redirected visitors bring about ${inrCompact(B.redirectedIncome)} to neighbouring villages;
      ${fmt(B.turnedAway - B.redirected)} visitors postpone or skip the trip.</p>

    <div class="grid-2">
      <section class="card">
        <h2>Forest health through the year</h2>
        <div class="chart-box chart-box-tall"><canvas data-chart="health" role="img" aria-label="Forest health over the year, both scenarios"></canvas></div>
      </section>
      <section class="card">
        <h2>Visitors admitted each day</h2>
        <div class="chart-box chart-box-tall"><canvas data-chart="visitors" role="img" aria-label="Daily admitted visitors, both scenarios"></canvas></div>
      </section>
    </div>

    <section class="card flat bt-assume">
      <h3>Synthetic simulation. Assumptions:</h3>
      <ul>
        <li>Demand = capacity x season (Oct-Jan and Apr-Jun 1.2, Jul-Sep monsoon 0.6) x weekend 1.45 or weekday 0.8 x festival 2.3 (8 days, incl. two long weekends) x random noise.</li>
        <li>Health recovers 9% of the gap to 95 each day; visitor load above 60% of capacity does damage that grows faster than linearly.</li>
        <li>A degraded site loses up to half its demand (14-day reputation lag), in both scenarios.</li>
        <li>VanaVaani uses this app's real quota and fee rules on the 3-day average. Demand falls 0.35% per 1% fee rise.</li>
        <li>45% of visitors turned away go to a neighbouring village and pay about 80% of the base fee there.</li>
        <li>Fixed cap: gate closes at 2x capacity, flat base fee, all to the village committee.</li>
      </ul>
    </section>
  `;
  root.querySelector('[data-act="reseed"]').addEventListener('click', () => {
    seed = 1 + Math.floor(Math.random() * 9999);
    render();
  });
  drawCharts(site, r);
  dirty = false;
}

function drawCharts(site, r) {
  const t = tokens();
  const base = baseOptions(t);
  const common = { pointRadius: 0, pointHoverRadius: 3, borderWidth: 1.6, tension: 0.25 };
  const xAxis = axis(t, {
    ticks: { color: t.muted, font: { family: t.fontMono, size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 },
    grid: { display: false },
  });

  makeChart(root.querySelector('[data-chart="health"]'), {
    type: 'line',
    data: {
      labels: r.labels,
      datasets: [
        { label: 'Fixed cap', data: r.fixed.health, borderColor: t.muted, backgroundColor: t.muted, ...common },
        { label: 'VanaVaani', data: r.vanavaani.health, borderColor: t.accent, backgroundColor: t.accent, ...common, borderWidth: 2.2 },
      ],
    },
    options: {
      ...base,
      plugins: { ...base.plugins, statusBands: { axis: 'y' } },
      scales: { x: xAxis, y: axis(t, { min: 0, max: 100, ticks: { ...axis(t).ticks, stepSize: 25 } }) },
    },
    plugins: [statusBandsPlugin],
  });

  makeChart(root.querySelector('[data-chart="visitors"]'), {
    type: 'line',
    data: {
      labels: r.labels,
      datasets: [
        { label: 'Fixed cap', data: r.fixed.admitted, borderColor: alpha(t.muted, 0.8), backgroundColor: t.muted, ...common, borderWidth: 1.1 },
        { label: 'VanaVaani', data: r.vanavaani.admitted, borderColor: t.accent, backgroundColor: t.accent, ...common, borderWidth: 1.8 },
        {
          label: 'Carrying capacity', data: r.labels.map(() => site.maxDaily),
          borderColor: t.bad, backgroundColor: t.bad, borderDash: [5, 4], borderWidth: 1, pointRadius: 0, pointHoverRadius: 0,
        },
      ],
    },
    options: { ...base, scales: { x: xAxis, y: axis(t, { min: 0 }) } },
  });
}

export function mount(el) {
  root = el;
  root.classList.add('insights', 'backtest');
  bus.addEventListener('site', () => { dirty = true; if (visible) render(); });
  onThemeChange(() => { if (visible && lastResult) drawCharts(siteById(getCurrentSiteId()), lastResult); });
}

export function show() {
  visible = true;
  if (dirty) render();
}

export function hide() {
  visible = false;
}
