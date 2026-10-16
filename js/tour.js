// Guided judge tour: a spotlight glides from feature to feature, an animated
// cursor "taps" the controls, and a step card explains what to look at.
// Start it from the top-bar button, the first-visit nudge, or a ?tour link.
// The page stays usable underneath: the dimmed layer never blocks clicks.

const SEEN_KEY = 'vanavaani.tourSeen';
const AUTO_DWELL_MS = 7000;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const $ = (sel) => document.querySelector(sel);
const judgePanel = () => $('#judge-panel');
const judgeOpen = () => judgePanel() && !judgePanel().hidden;
const judgeButton = (label) => [...(judgePanel()?.querySelectorAll('button') || [])]
  .find((b) => b.textContent.trim() === label);
const cardWith = (root, inner) => document.querySelector(`${root} ${inner}`)?.closest('.card');

function setJudge(open) {
  if (judgeOpen() === open) return;
  if (!open) judgeButton('Stop')?.click();
  $('#judge-fab')?.click();
}

// Each step: tab to show, how to find the target, the words, optional actions.
// `judge: true` keeps the Judge panel open for that step; other steps close it.
const STEPS = [
  {
    tab: 'dashboard',
    target: () => $('#view-dashboard .dash-dial-wrap'),
    title: 'One number runs the site',
    body: 'This is the Forest Health Score, 0 to 100. It comes from what the forest sounds like, measured against an off-trail control post.',
  },
  {
    tab: 'dashboard',
    target: () => $('#view-dashboard .dash-kpis'),
    title: 'It sets tomorrow\'s quota and fee',
    body: 'A healthy forest gets the full visitor quota at the base fee. A stressed one gets fewer slots and a surge fee. Here you can also see where each rupee goes.',
  },
  {
    tab: 'dashboard',
    target: () => $('#view-dashboard .dash-callout'),
    optional: true,
    title: 'Stressed days send visitors elsewhere',
    body: 'When the score drops, nearby villages with healthier forests are suggested, so tourist income spreads instead of piling up in one place.',
  },
  {
    tab: 'dashboard',
    target: () => cardWith('#view-dashboard', 'canvas'),
    title: '30 days of the forest',
    body: 'Daily score, the 3-day average that actually drives the quota, and visitor numbers. Look for the dip after the festival weekend. This history is synthetic demo data.',
  },
  {
    tab: 'dashboard',
    target: () => $('#judge-fab'),
    title: 'Judge mode: try it live',
    body: 'Judge mode plays a soundscape through your speaker and analyses it in the browser, in real time. The next step opens it for you.',
    tap: true,
  },
  {
    tab: 'dashboard',
    judge: true,
    target: () => $('#judge-panel .jd-scenes'),
    title: 'Play a healthy forest, then a crowd',
    body: 'Press Healthy forest and the score climbs to about 90. Press Tourist crowd and it falls to about 25. The quota and fee change with it. Heavy rain is detected and ignored.',
    actions: [
      { label: 'Play forest', run: () => demoTap(judgeButton('Healthy forest')) },
      { label: 'Play crowd', run: () => demoTap(judgeButton('Tourist crowd')) },
      { label: 'Stop', run: () => demoTap(judgeButton('Stop')) },
    ],
    auto: async (alive) => {
      await demoTap(judgeButton('Healthy forest'));
      await sleep(6500);
      if (!alive()) return;
      await demoTap(judgeButton('Tourist crowd'));
      await sleep(6500);
    },
  },
  {
    tab: 'listen',
    target: () => $('#view-listen .lp-recorder'),
    title: 'How guides record',
    body: 'A guide stands at a marked post and records one minute on any phone. Only four numbers are saved, never the audio. Choose Demo sound and press Record to try it.',
  },
  {
    tab: 'book',
    target: () => $('#view-book .vv-phone-col'),
    title: 'Visitors book on chat',
    body: 'A WhatsApp-style bot in English or Hindi quotes the live fee, suggests quieter villages on stressed days, takes a simulated UPI payment and issues a signed QR pass.',
  },
  {
    tab: 'gate',
    target: () => $('#view-gate .grid-2'),
    title: 'The guide checks the pass',
    body: 'Scan the QR with the camera, or press "Use my latest booking". The signature is checked offline. A second scan says "Already used", and an edited pass is caught as fake.',
  },
  {
    tab: 'guardians',
    target: () => cardWith('#view-guardians', 'table'),
    title: 'Who gets paid',
    body: 'Forest guardians earn ₹15 per verified recording, 70% of every surge fee, and a monthly bonus when the forest\'s score improves.',
  },
  {
    tab: 'backtest',
    target: () => $('#view-backtest .bt-compare'),
    title: 'A year with and without VanaVaani',
    body: 'A one-year simulation against a fixed cap: zero critical days and zero overcrowded days, in exchange for about 15% fewer visitors at the main site.',
  },
  {
    tab: 'pitch',
    target: () => $('#view-pitch .pitch-hero'),
    title: 'The science and what is real',
    body: 'The method, the four acoustic indices and their papers, the safeguards, and a plain list of what is real in this prototype and what is simulated. Thanks for taking the tour.',
  },
];

let ui = null;
let idx = 0;
let active = false;
let autoplay = false;
let autoToken = 0;
let rafId = 0;
let currentTarget = null;
let cursorPos = null;

function build() {
  const ring = document.createElement('div');
  ring.className = 'tour-ring';
  const cursor = document.createElement('div');
  cursor.className = 'tour-cursor';
  cursor.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8-6 1.6L10 19z"/></svg><span class="tour-ripple"></span>';
  const card = document.createElement('section');
  card.className = 'tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false');
  card.setAttribute('aria-labelledby', 'tour-title');
  card.innerHTML = `
    <div class="tour-progress"><span class="tour-bar"></span></div>
    <div class="tour-meta">
      <span class="tour-step mono"></span>
      <button type="button" class="tour-x" aria-label="End tour">&times;</button>
    </div>
    <h2 id="tour-title" class="tour-title"></h2>
    <p class="tour-body"></p>
    <div class="tour-actions row"></div>
    <div class="tour-nav">
      <label class="tour-auto small"><input type="checkbox" id="tour-auto"> Auto-play</label>
      <div class="row">
        <button type="button" class="btn btn-sm tour-back">Back</button>
        <button type="button" class="btn btn-sm btn-primary tour-next">Next</button>
      </div>
    </div>`;
  document.body.append(ring, cursor, card);
  ui = {
    ring, cursor, card,
    bar: card.querySelector('.tour-bar'),
    step: card.querySelector('.tour-step'),
    title: card.querySelector('.tour-title'),
    body: card.querySelector('.tour-body'),
    actions: card.querySelector('.tour-actions'),
    back: card.querySelector('.tour-back'),
    next: card.querySelector('.tour-next'),
    auto: card.querySelector('#tour-auto'),
  };
  card.querySelector('.tour-x').addEventListener('click', end);
  ui.back.addEventListener('click', () => go(idx - 1, -1));
  ui.next.addEventListener('click', () => (idx >= STEPS.length - 1 ? end() : go(idx + 1)));
  ui.auto.addEventListener('change', () => setAutoplay(ui.auto.checked));
}

function onKey(e) {
  if (!active) return;
  if (e.key === 'Escape') end();
  else if (e.key === 'ArrowRight' && !e.target.closest('input, textarea, select')) ui.next.click();
  else if (e.key === 'ArrowLeft' && !e.target.closest('input, textarea, select')) ui.back.click();
}

async function waitFor(fn, ms = 3000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const el = fn();
    if (el && el.getBoundingClientRect().width > 0) return el;
    await sleep(80);
  }
  return null;
}

const isFixed = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (getComputedStyle(n).position === 'fixed') return true;
  }
  return false;
};

// Keep the ring and card glued to the target while the page scrolls or reflows.
// rAF covers smooth scrolling and layout shifts; scroll/resize and a slow timer
// cover tabs where rAF is paused.
const onMove = () => { if (active) place(); };
let timerId = 0;
function track() {
  cancelAnimationFrame(rafId);
  clearInterval(timerId);
  const loop = () => {
    if (!active) return;
    place();
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
  timerId = setInterval(onMove, 250);
  window.addEventListener('scroll', onMove, { passive: true });
  window.addEventListener('resize', onMove);
}
function untrack() {
  cancelAnimationFrame(rafId);
  clearInterval(timerId);
  window.removeEventListener('scroll', onMove);
  window.removeEventListener('resize', onMove);
}

function place() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let r;
  if (currentTarget && currentTarget.isConnected) {
    const b = currentTarget.getBoundingClientRect();
    const pad = 8;
    r = { x: b.left - pad, y: b.top - pad, w: b.width + pad * 2, h: b.height + pad * 2 };
    // Very tall targets: spotlight only what is on screen.
    const top = Math.max(r.y, 4);
    const bottom = Math.min(r.y + r.h, vh - 4);
    r = { ...r, y: top, h: Math.max(40, bottom - top) };
  } else {
    r = { x: vw / 2, y: vh / 2, w: 0, h: 0 };
  }
  Object.assign(ui.ring.style, { transform: `translate(${r.x}px, ${r.y}px)`, width: `${r.w}px`, height: `${r.h}px` });

  const cw = Math.min(380, vw - 32);
  const ch = ui.card.offsetHeight || 220;
  const gap = 14;
  let x = Math.min(Math.max(16, r.x + r.w / 2 - cw / 2), vw - cw - 16);
  let y;
  if (r.y + r.h + gap + ch <= vh - 12) y = r.y + r.h + gap;
  else if (r.y - gap - ch >= 12) y = r.y - gap - ch;
  else if (r.x - gap - cw >= 16) { x = r.x - gap - cw; y = Math.min(Math.max(12, r.y), vh - ch - 12); }
  else if (r.x + r.w + gap + cw <= vw - 16) { x = r.x + r.w + gap; y = Math.min(Math.max(12, r.y), vh - ch - 12); }
  else {
    // No free side: sit on the half of the screen the target uses least.
    const above = Math.max(0, r.y);
    const below = Math.max(0, vh - (r.y + r.h));
    y = vw < 640 || above <= below ? vh - ch - 12 : 12;
  }
  y = Math.min(Math.max(12, y), Math.max(12, vh - ch - 12));
  ui.card.style.width = `${cw}px`;
  ui.card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function cursorTo(x, y) {
  ui.cursor.hidden = false;
  if (!cursorPos || reduceMotion()) ui.cursor.classList.add('no-anim');
  else ui.cursor.classList.remove('no-anim');
  ui.cursor.style.transform = `translate(${x}px, ${y}px)`;
  cursorPos = { x, y };
  // Force the "no-anim" jump to apply before re-enabling transitions.
  void ui.cursor.offsetWidth;
  ui.cursor.classList.remove('no-anim');
}

async function pointAt(el) {
  if (!el) return;
  const b = el.getBoundingClientRect();
  cursorTo(b.left + Math.min(b.width * 0.5, 60), b.top + Math.min(b.height * 0.55, 28));
  await sleep(reduceMotion() ? 0 : 650);
}

async function ripple() {
  ui.cursor.classList.remove('tap');
  void ui.cursor.offsetWidth;
  ui.cursor.classList.add('tap');
  await sleep(reduceMotion() ? 0 : 260);
}

// Move the cursor onto a control and press it.
async function demoTap(el) {
  if (!el) return;
  await pointAt(el);
  await ripple();
  el.click();
}

async function go(n, dir = 1) {
  if (n < 0 || n >= STEPS.length) return;
  const myToken = ++autoToken;
  idx = n;
  const step = STEPS[n];

  if (location.hash.slice(1) !== step.tab) location.hash = '#' + step.tab;
  setJudge(!!step.judge);

  let el = await waitFor(step.target, step.optional ? 1500 : 3000);
  if (myToken !== autoToken) return;
  if (!el && step.optional) return go(n + dir, dir);
  if (!el) el = document.getElementById('view-' + step.tab);

  if (!isFixed(el)) {
    const b = el.getBoundingClientRect();
    const topbar = document.querySelector('.topbar')?.offsetHeight || 0;
    const wantTop = Math.max(topbar + 16, (window.innerHeight - Math.min(b.height, window.innerHeight * 0.55)) / 2 - 60);
    window.scrollBy({ top: b.top - wantTop, behavior: reduceMotion() ? 'auto' : 'smooth' });
    // Smooth scrolling can be skipped or cut short; make sure the target ends up on screen.
    setTimeout(() => {
      if (myToken !== autoToken) return;
      const nb = el.getBoundingClientRect();
      if (nb.top < 0 || nb.top > window.innerHeight * 0.6) window.scrollBy({ top: nb.top - wantTop, behavior: 'auto' });
    }, reduceMotion() ? 0 : 700);
  }
  currentTarget = el;
  render(step);
  place();
  ui.card.classList.remove('enter');
  void ui.card.offsetWidth;
  ui.card.classList.add('enter');

  await sleep(reduceMotion() ? 0 : 450);
  if (myToken !== autoToken) return;
  if (step.tap) { await pointAt(el); await ripple(); }
  else await pointAt(el);

  if (autoplay) runAuto(step, myToken);
}

async function runAuto(step, token) {
  const alive = () => active && autoplay && token === autoToken;
  if (step.auto) await step.auto(alive);
  else await sleep(AUTO_DWELL_MS);
  if (!alive()) return;
  if (idx >= STEPS.length - 1) setAutoplay(false);
  else go(idx + 1);
}

function setAutoplay(on) {
  autoplay = on;
  ui.auto.checked = on;
  ui.card.classList.toggle('is-auto', on);
  if (on) runAuto(STEPS[idx], autoToken);
  else autoToken++;
}

function render(step) {
  ui.step.textContent = `Step ${idx + 1} of ${STEPS.length}`;
  ui.bar.style.width = `${((idx + 1) / STEPS.length) * 100}%`;
  ui.title.textContent = step.title;
  ui.body.textContent = step.body;
  ui.actions.innerHTML = '';
  for (const a of step.actions || []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm';
    b.textContent = a.label;
    b.addEventListener('click', () => a.run());
    ui.actions.append(b);
  }
  ui.actions.hidden = !(step.actions || []).length;
  ui.back.disabled = idx === 0;
  ui.next.textContent = idx === STEPS.length - 1 ? 'Finish' : 'Next';
  ui.next.focus({ preventScroll: true });
}

export function startTour(from = 0) {
  if (!ui) build();
  dismissNudge();
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
  active = true;
  cursorPos = null;
  ui.ring.hidden = false;
  ui.card.hidden = false;
  ui.cursor.hidden = true;
  document.body.classList.add('touring');
  document.addEventListener('keydown', onKey);
  track();
  go(from);
}

export function end() {
  if (!active) return;
  active = false;
  autoplay = false;
  autoToken++;
  untrack();
  setJudge(false);
  ui.ring.hidden = true;
  ui.card.hidden = true;
  ui.cursor.hidden = true;
  ui.auto.checked = false;
  document.body.classList.remove('touring');
  document.removeEventListener('keydown', onKey);
  document.getElementById('tour-btn')?.focus({ preventScroll: true });
}

// ---- First-visit nudge ------------------------------------------------------

let nudge = null;
function dismissNudge() {
  if (!nudge) return;
  nudge.remove();
  nudge = null;
}

function showNudge() {
  nudge = document.createElement('aside');
  nudge.className = 'tour-nudge';
  nudge.setAttribute('aria-label', 'Guided tour');
  nudge.innerHTML = `
    <p><strong>Judging VanaVaani?</strong> Take the 2-minute guided tour.</p>
    <div class="row">
      <button type="button" class="btn btn-sm btn-primary" data-act="start">Start tour</button>
      <button type="button" class="btn btn-sm" data-act="later">Not now</button>
    </div>`;
  nudge.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'start') startTour();
    if (act === 'later') {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
      dismissNudge();
    }
  });
  document.body.append(nudge);
}

export function initTour() {
  document.getElementById('tour-btn')?.addEventListener('click', () => startTour());
  const params = new URLSearchParams(location.search);
  if (params.has('tour')) {
    setTimeout(() => startTour(), 600);
    return;
  }
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { /* ignore */ }
  if (!seen) setTimeout(showNudge, 1200);
}
