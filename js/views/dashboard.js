// Forest health tab: today's driving score, tomorrow's quota and fee, 30-day
// history, listening posts, map and all-sites table.

import {
  SITES, bus, siteStatus, recordingsFor, getCurrentSiteId, setCurrentSiteId,
} from '../store.js';
import {
  tokens, alpha, baseOptions, axis, makeChart, statusBandsPlugin, onThemeChange, statusColor,
  inr, fmt, esc, debounce,
} from '../charts.js';

let root = null;
let visible = false;
let dirty = true;
let chart = null;
let map = null;
const markers = {};
const slot = (name) => root.querySelector(`[data-slot="${name}"]`);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (s) => { const [, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };

// ---- Dial ------------------------------------------------------------------

function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function dialSvg(score, statusKey, label) {
  const [sx, sy] = polar(100, 100, 80, 135);
  const [ex, ey] = polar(100, 100, 80, 45);
  const arc = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A 80 80 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  const v = Math.max(0, Math.min(100, score));
  const tick = (val) => {
    const deg = 135 + (270 * val) / 100;
    const [x1, y1] = polar(100, 100, 66, deg);
    const [x2, y2] = polar(100, 100, 94, deg);
    return `<line class="dial-tick" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  };
  return `
    <svg class="dial" data-status="${statusKey}" viewBox="0 0 200 172" role="img"
      aria-label="Forest Health Score ${Math.round(v)} out of 100, ${esc(label)}">
      <path class="dial-track" d="${arc}" pathLength="100"/>
      <path class="dial-value" d="${arc}" pathLength="100" stroke-dasharray="${v.toFixed(1)} 100"/>
      ${tick(50)}${tick(75)}
      <text class="dial-num" x="100" y="108" text-anchor="middle">${Math.round(v)}</text>
      <text class="dial-of" x="100" y="132" text-anchor="middle">of 100</text>
      <text class="dial-end" x="38" y="170" text-anchor="middle">0</text>
      <text class="dial-end" x="162" y="170" text-anchor="middle">100</text>
    </svg>`;
}

function sourceLabel(st) {
  if (st.source === 'live') return '<span class="pill pill-live">Live: Judge mode</span>';
  if (st.source === 'measured') {
    const n = recordingsFor(st.site.id).filter((r) => r.accepted && !r.rain).length;
    return `<span class="dash-source">Measured today from ${n} recording${n === 1 ? '' : 's'}</span>`;
  }
  return '<span class="dash-source">Last 3-day average (seeded history)</span>';
}

// ---- Slots -----------------------------------------------------------------

function renderHead(st) {
  slot('head').innerHTML = `
    <span class="eyebrow">Forest health &middot; ${esc(st.site.place)}</span>
    <h1>${esc(st.site.name)}</h1>
    <p>Guides record a minute of sound at each listening post. The trail is scored against an off-trail
    control post, smoothed over 3 days, and that one number sets tomorrow's visitor quota and entry fee.</p>`;
}

function renderHero(st) {
  const { site, split } = st;
  const surge = Math.max(0, st.price - site.baseFee);
  const mult = st.price / site.baseFee;
  const pctQuota = Math.round((100 * st.quota) / site.maxDaily);
  const parts = [
    ['village', 'Village', split.village],
    ['guardians', 'Guardians', split.guardians],
    ['restoration', 'Restoration', split.restoration],
  ];
  const total = Math.max(1, split.village + split.guardians + split.restoration);
  const reading = st.source === 'measured'
    ? `<p class="small muted">Today's reading ${st.today}, smoothed with the last 3 days to ${st.score}.</p>`
    : st.source === 'live'
      ? '<p class="small muted">Judge mode applies the live reading instantly, without smoothing.</p>'
      : `<p class="small muted">No recordings yet today. Last day's reading was ${st.today}.</p>`;

  slot('hero').innerHTML = `
    <div class="dash-dial-wrap">
      ${dialSvg(st.score, st.status.key, st.status.label)}
      <div class="dash-dial-meta">
        <span class="eyebrow">Forest Health Score</span>
        <div class="row"><span class="pill pill-${st.status.key}">${st.status.label}</span>${sourceLabel(st)}</div>
        ${reading}
      </div>
    </div>
    <div class="dash-kpis">
      <div class="kpi">
        <span class="kpi-label">Tomorrow's visitor quota</span>
        <span class="kpi-value">${fmt(st.quota)}</span>
        <span class="kpi-note">${pctQuota}% of the ${fmt(site.maxDaily)} daily maximum</span>
        <span class="meter" aria-hidden="true"><span style="width:${pctQuota}%"></span></span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Slots left</span>
        <span class="kpi-value">${fmt(st.slotsLeft)}</span>
        <span class="kpi-note">${fmt(st.booked)} booked so far</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Fee per person</span>
        <span class="kpi-value">${inr(st.price)}</span>
        <span class="kpi-note">${surge > 0
          ? `Base ${inr(site.baseFee)} + ${inr(surge)} surge (${mult.toFixed(2)}x)`
          : `Base fee, no surge`}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Where each fee goes</span>
        <span class="split-bar" aria-hidden="true">
          ${parts.map(([k, , v]) => (v > 0 ? `<span class="split-${k}" style="flex:${v / total}"></span>` : '')).join('')}
        </span>
        <span class="split-legend">
          ${parts.map(([k, name, v]) => `<span><i class="split-dot split-${k}"></i>${name} <b class="mono">${inr(v)}</b></span>`).join('')}
        </span>
      </div>
    </div>`;
}

function renderAlts(st) {
  const el = slot('alts');
  if (!st.alternatives.length) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `
    <div class="dash-callout" data-status="${st.status.key}" role="status">
      <strong>Forest under stress: redirecting visitors to</strong>
      <ul>
        ${st.alternatives.map((a) => `
          <li><span class="dash-alt-name">${esc(a.name)}</span>
            <span class="muted mono small">${a.km} km &middot; health ${a.status.score} &middot; fee ${inr(a.status.price)}</span></li>`).join('')}
      </ul>
      <a class="small" href="#book">Book a quieter trail</a>
    </div>`;
}

function chartSeries(st) {
  const h = st.history;
  const labels = h.map((r) => shortDate(r.date));
  const score = h.map((r) => r.score);
  const ema = h.map((r) => r.ema);
  const foot = h.map((r) => r.footfall);
  if (st.source !== 'history') {
    labels.push('Today');
    score.push(st.today);
    ema.push(st.score);
    foot.push(null);
  }
  return { labels, score, ema, foot };
}

function renderChart(st) {
  const canvas = root.querySelector('[data-chart="history"]');
  const t = tokens();
  const base = baseOptions(t);
  const s = chartSeries(st);
  chart = makeChart(canvas, {
    data: {
      labels: s.labels,
      datasets: [
        {
          type: 'line', label: '3-day average (drives quota)', data: s.ema, yAxisID: 'y', order: 1,
          borderColor: t.accent, backgroundColor: t.accent, borderWidth: 2.6, pointRadius: 0, pointHoverRadius: 4, tension: 0.3,
        },
        {
          type: 'line', label: 'Daily score', data: s.score, yAxisID: 'y', order: 2,
          borderColor: alpha(t.ink, 0.55), backgroundColor: alpha(t.ink, 0.55), borderWidth: 1.2, pointRadius: 2, pointHoverRadius: 4, tension: 0.2,
        },
        {
          type: 'bar', label: 'Visitors', data: s.foot, yAxisID: 'y1', order: 3,
          backgroundColor: alpha(t.muted, 0.22), hoverBackgroundColor: alpha(t.muted, 0.4), borderRadius: 2, barPercentage: 0.8,
        },
      ],
    },
    options: {
      ...base,
      plugins: { ...base.plugins, statusBands: { axis: 'y' } },
      scales: {
        x: axis(t, { grid: { display: false }, ticks: { color: t.muted, font: { family: t.fontMono, size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }),
        y: axis(t, { min: 0, max: 100, position: 'left', ticks: { ...axis(t).ticks, stepSize: 25 }, title: { display: true, text: 'Health', color: t.muted } }),
        y1: axis(t, { min: 0, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Visitors', color: t.muted } }),
      },
    },
    plugins: [statusBandsPlugin],
  });
}

// Live mode: patch the last point instead of rebuilding.
function patchChart(st) {
  if (!chart) return renderChart(st);
  const s = chartSeries(st);
  if (chart.data.labels.length !== s.labels.length) return renderChart(st);
  chart.data.datasets[0].data = s.ema;
  chart.data.datasets[1].data = s.score;
  chart.update('none');
}

function renderPosts(st) {
  const { site } = st;
  const recs = recordingsFor(site.id);
  const good = (r) => r.accepted && !r.rain;
  const controlIds = new Set(site.posts.filter((p) => p.control).map((p) => p.id));
  const ctrl = recs.filter((r) => good(r) && controlIds.has(r.postId));
  const controlQ = ctrl.length ? ctrl.reduce((a, r) => a + r.quality, 0) / ctrl.length : site.controlQuality;

  slot('posts').innerHTML = `
    <ul class="post-list">
      ${site.posts.map((p) => {
        const mine = recs.filter((r) => r.postId === p.id);
        const ok = mine.filter(good);
        const filtered = mine.length - ok.length;
        const latest = ok[ok.length - 1];
        let reading = '<span class="muted small">No reading yet today</span>';
        if (latest && p.control) {
          reading = `<span class="small">Reference quality <b class="mono">${latest.quality.toFixed(2)}</b></span>`;
        } else if (latest) {
          const h = Math.round(100 * Math.min(1, latest.quality / controlQ));
          const key = h >= 75 ? 'thriving' : h >= 50 ? 'stressed' : 'critical';
          reading = `<span class="post-health" data-status="${key}"><b class="mono">${h}</b><span class="meter"><span style="width:${h}%"></span></span></span>`;
        }
        return `
          <li class="post${p.control ? ' is-control' : ''}">
            <div class="post-name">
              <span>${esc(p.name.replace(' (control)', ''))}</span>
              ${p.control ? '<span class="post-tag">Control</span>' : ''}
            </div>
            <span class="post-count mono small">${mine.length} today${filtered ? ` <span class="muted">(${filtered} filtered)</span>` : ''}</span>
            <div class="post-reading">${reading}</div>
          </li>`;
      }).join('')}
    </ul>
    <p class="small muted">The control post sits off-trail in the same forest. Comparing to it removes season and weather, leaving the effect of visitors.</p>`;
}

function renderTable() {
  const cur = getCurrentSiteId();
  slot('table').innerHTML = `
    <div class="table-wrap">
      <table class="data dash-sites">
        <thead><tr><th>Site</th><th class="num">Health</th><th class="num">Quota</th><th class="num">Fee</th><th>Status</th></tr></thead>
        <tbody>
          ${SITES.map((s) => {
            const st = siteStatus(s.id);
            return `
              <tr data-site="${s.id}" tabindex="0" ${s.id === cur ? 'aria-current="true"' : ''}>
                <td><span class="dash-site-name">${esc(s.name)}</span><span class="muted small">${esc(s.place.split(', ').pop())}</span></td>
                <td class="num">${st.score}</td>
                <td class="num">${fmt(st.quota)}</td>
                <td class="num">${inr(st.price)}</td>
                <td><span class="pill pill-${st.status.key}">${st.status.label}</span>${st.source === 'live' ? ' <span class="pill pill-live">Live</span>' : ''}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ---- Map -------------------------------------------------------------------

function popupHtml(st) {
  return `<strong>${esc(st.site.name)}</strong><br>
    Health ${st.score} (${st.status.label})<br>
    Quota ${fmt(st.quota)} &middot; fee ${inr(st.price)}`;
}

function initMap() {
  const L = window.L;
  const el = root.querySelector('[data-slot="map"]');
  if (!L || !el) {
    if (el) el.innerHTML = '<p class="muted small dash-map-missing">Map library did not load.</p>';
    return;
  }
  map = L.map(el, { scrollWheelZoom: false, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  for (const s of SITES) {
    const m = L.circleMarker([s.lat, s.lon], { radius: 10, weight: 2, fillOpacity: 0.85 });
    m.bindPopup('');
    m.bindTooltip(s.name, { direction: 'top', offset: [0, -8] });
    m.on('click', () => setCurrentSiteId(s.id));
    m.addTo(map);
    markers[s.id] = m;
  }
  map.fitBounds(SITES.map((s) => [s.lat, s.lon]), { padding: [36, 36] });
  updateMarkers();
}

function updateMarkers() {
  if (!map) return;
  const t = tokens();
  const cur = getCurrentSiteId();
  for (const s of SITES) {
    const st = siteStatus(s.id);
    const c = statusColor(st.status.key, t);
    const sel = s.id === cur;
    markers[s.id].setStyle({
      color: sel ? t.ink : c, fillColor: c, weight: sel ? 3 : 2,
    });
    markers[s.id].setRadius(sel ? 13 : 9);
    markers[s.id].setPopupContent(popupHtml(st));
  }
}

// ---- Render orchestration --------------------------------------------------

function renderAll() {
  if (!root) return;
  const st = siteStatus(getCurrentSiteId());
  renderHead(st);
  renderHero(st);
  renderAlts(st);
  renderChart(st);
  renderPosts(st);
  renderTable();
  updateMarkers();
  dirty = false;
}

function renderLive() {
  if (!root) return;
  const st = siteStatus(getCurrentSiteId());
  renderHero(st);
  renderAlts(st);
  patchChart(st);
  renderTable();
  updateMarkers();
}

const fullSoon = debounce(() => { if (visible) renderAll(); else dirty = true; }, 100);
const liveSoon = debounce(() => { if (visible) renderLive(); else dirty = true; }, 100);

export function mount(el) {
  root = el;
  root.classList.add('insights', 'dashboard');
  root.innerHTML = `
    <header class="view-head" data-slot="head"></header>
    <section class="card dash-hero" data-slot="hero" aria-live="polite"></section>
    <div data-slot="alts" hidden></div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head">
          <h2>Last 30 days</h2>
          <span class="sim-tag">Synthetic demo history</span>
        </div>
        <div class="chart-box"><canvas data-chart="history" role="img" aria-label="Daily forest health, 3-day average and visitors over the last 30 days"></canvas></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Listening posts</h2><span class="muted small">today</span></div>
        <div data-slot="posts"></div>
      </section>
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Sites on the map</h2><span class="muted small">tap a site to open it</span></div>
        <div class="dash-map" data-slot="map"></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>All sites</h2></div>
        <div data-slot="table"></div>
      </section>
    </div>`;

  slot('table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-site]');
    if (tr) setCurrentSiteId(tr.dataset.site);
  });
  slot('table').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('tr[data-site]');
    if (tr) { e.preventDefault(); setCurrentSiteId(tr.dataset.site); }
  });

  initMap();
  bus.addEventListener('change', fullSoon);
  bus.addEventListener('site', fullSoon);
  bus.addEventListener('live', liveSoon);
  onThemeChange(() => {
    if (!visible) { dirty = true; return; }
    renderChart(siteStatus(getCurrentSiteId()));
    updateMarkers();
  });
}

export function show() {
  visible = true;
  if (dirty) renderAll();
  if (map) setTimeout(() => map.invalidateSize(), 50);
}

export function hide() {
  visible = false;
}
