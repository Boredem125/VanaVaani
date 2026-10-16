// App shell: hash router, site picker, Judge mode bootstrap.
//
// View contract: each module in js/views/ exports
//   mount(root: HTMLElement): void   called once, the first time its tab opens
//   show?(): void                    called every time its tab becomes visible
//   hide?(): void                    called when the user leaves its tab
// Views read/write state only through js/store.js and listen on store `bus`
// events: "change" (state saved), "live" (Judge mode reading), "site" (site picked).

import { SITES, bus, getCurrentSiteId, setCurrentSiteId, getState } from './store.js';

const VIEWS = {
  dashboard: () => import('./views/dashboard.js'),
  listen: () => import('./views/listen.js'),
  book: () => import('./views/book.js'),
  gate: () => import('./views/gate.js'),
  guardians: () => import('./views/guardians.js'),
  backtest: () => import('./views/backtest.js'),
  pitch: () => import('./views/pitch.js'),
};

const mounted = {};
let active = null;

function libsReady() {
  // CDN scripts are deferred; module scripts run after them, but wait just in case.
  return new Promise((resolve) => {
    if (document.readyState === 'complete') return resolve();
    window.addEventListener('load', resolve, { once: true });
  });
}

async function open(name) {
  if (!VIEWS[name]) name = 'dashboard';
  if (active === name) return;
  if (active && mounted[active]?.hide) mounted[active].hide();
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  active = name;
  const root = document.getElementById('view-' + name);
  try {
    if (!mounted[name]) {
      const mod = await VIEWS[name]();
      mounted[name] = mod;
      mod.mount(root);
    }
    mounted[name].show?.();
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="card error-card"><h2>This section failed to load</h2><p class="muted">${String(err.message || err)}</p></div>`;
  }
  document.querySelector('.tabs a[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function initSitePicker() {
  const sel = document.getElementById('site-select');
  sel.innerHTML = SITES.map((s) => `<option value="${s.id}">${s.name}, ${s.place}</option>`).join('');
  sel.value = getCurrentSiteId();
  sel.addEventListener('change', () => setCurrentSiteId(sel.value));
  bus.addEventListener('site', () => { sel.value = getCurrentSiteId(); });
}

async function initJudge() {
  try {
    const { initJudge } = await import('./judge.js');
    initJudge(document.getElementById('judge-fab'), document.getElementById('judge-panel'));
  } catch (err) {
    console.error('Judge mode failed to load', err);
  }
}

async function start() {
  getState();
  initSitePicker();
  await libsReady();
  window.addEventListener('hashchange', () => open(location.hash.slice(1)));
  open(location.hash.slice(1) || 'dashboard');
  initJudge();
  initTourSafe();
}

async function initTourSafe() {
  try {
    const { initTour } = await import('./tour.js?v=6');
    initTour();
  } catch (err) {
    console.error('Tour failed to load', err);
  }
}

start();
