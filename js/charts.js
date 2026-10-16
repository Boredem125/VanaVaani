// Shared Chart.js theming. Colors are read from CSS tokens at render time, so
// charts follow light/dark mode. Call makeChart() on every re-render: it
// destroys whatever chart already owns the canvas.

export function token(name, fallback = '#888') {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function tokens() {
  return {
    ink: token('--ink', '#12231b'),
    muted: token('--muted', '#56685e'),
    line: token('--line', '#cfd9cf'),
    surface: token('--surface', '#f9fbf7'),
    surface2: token('--surface-2', '#e3eae2'),
    accent: token('--accent', '#0a7584'),
    ok: token('--ok', '#2b8a4b'),
    warn: token('--warn', '#b97a0c'),
    bad: token('--bad', '#bf3d2a'),
    fontBody: token('--font-body', 'system-ui, sans-serif'),
    fontMono: token('--font-mono', 'monospace'),
  };
}

// Hex (#rgb / #rrggbb) or rgb() to rgba with the given alpha.
export function alpha(color, a) {
  const c = String(color).trim();
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(/[\s,/]+/).filter(Boolean);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return c;
}

export const statusColor = (key, t = tokens()) => (
  key === 'thriving' ? t.ok : key === 'stressed' ? t.warn : t.bad
);

// Faint status bands (0-50 bad, 50-75 warn, 75-100 ok) and dashed lines at 50 and 75
// drawn behind the datasets on the given axis.
export const statusBandsPlugin = {
  id: 'statusBands',
  beforeDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.display === false) return;
    const scale = chart.scales[opts.axis || 'y'];
    const area = chart.chartArea;
    if (!scale || !area) return;
    const t = tokens();
    const a = opts.alpha ?? 0.07;
    const bands = [
      { from: 0, to: 50, color: t.bad },
      { from: 50, to: 75, color: t.warn },
      { from: 75, to: 100, color: t.ok },
    ];
    const { ctx } = chart;
    ctx.save();
    for (const b of bands) {
      const y1 = Math.max(area.top, Math.min(area.bottom, scale.getPixelForValue(b.to)));
      const y2 = Math.max(area.top, Math.min(area.bottom, scale.getPixelForValue(b.from)));
      ctx.fillStyle = alpha(b.color, a);
      ctx.fillRect(area.left, y1, area.right - area.left, y2 - y1);
    }
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    for (const [v, c] of [[50, t.bad], [75, t.ok]]) {
      const y = scale.getPixelForValue(v);
      if (y < area.top || y > area.bottom) continue;
      ctx.strokeStyle = alpha(c, 0.55);
      ctx.beginPath();
      ctx.moveTo(area.left, y);
      ctx.lineTo(area.right, y);
      ctx.stroke();
    }
    ctx.restore();
  },
};

// Base options shared by every chart. Merge per-chart scales on top.
export function baseOptions(t = tokens()) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: t.muted, boxWidth: 12, boxHeight: 12, font: { family: t.fontBody, size: 12 } },
      },
      tooltip: {
        backgroundColor: t.ink,
        titleColor: t.surface,
        bodyColor: t.surface,
        titleFont: { family: t.fontBody, weight: '600' },
        bodyFont: { family: t.fontMono, size: 12 },
        padding: 10,
        cornerRadius: 6,
      },
    },
  };
}

export function axis(t = tokens(), extra = {}) {
  return {
    grid: { color: alpha(t.line, 0.7), drawTicks: false },
    border: { display: false },
    ticks: { color: t.muted, font: { family: t.fontMono, size: 11 }, padding: 6 },
    ...extra,
  };
}

export const chartsAvailable = () => typeof window !== 'undefined' && typeof window.Chart === 'function';

// Create (or recreate) a chart on a canvas. Returns null if Chart.js is missing.
export function makeChart(canvas, config) {
  if (!canvas || !chartsAvailable()) {
    if (canvas && canvas.parentElement && !canvas.parentElement.querySelector('.chart-missing')) {
      const p = document.createElement('p');
      p.className = 'muted small chart-missing';
      p.textContent = 'Chart library did not load (offline?). Numbers above are still live.';
      canvas.parentElement.appendChild(p);
    }
    return null;
  }
  const existing = window.Chart.getChart(canvas);
  if (existing) existing.destroy();
  return new window.Chart(canvas, config);
}

// Call fn when the color scheme changes (OS setting or data-theme attribute).
export function onThemeChange(fn) {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const handler = () => fn();
  mq?.addEventListener?.('change', handler);
  const mo = new MutationObserver(handler);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => { mq?.removeEventListener?.('change', handler); mo.disconnect(); };
}

// Formatting helpers shared by the insight views.
export const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
export const fmt = (n) => Math.round(n).toLocaleString('en-IN');
export function inrCompact(n) {
  const v = Math.round(n);
  if (Math.abs(v) >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' cr';
  if (Math.abs(v) >= 1e5) return '₹' + (v / 1e5).toFixed(1) + ' lakh';
  return inr(v);
}
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function debounce(fn, ms = 100) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
export function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
