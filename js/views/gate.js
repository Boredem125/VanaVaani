// Gate tab: the local guide checks a visitor's pass at the trail head.
// Verification is offline: the HMAC signature proves the pass came from
// VanaVaani; the used-pass list stops the same QR being used twice.

import {
  bookingById, isPassUsed, markPassUsed, todayStr, getState,
} from '../store.js';
import { verifyPass } from '../pass.js';

const READER_ID = 'vv-gate-reader';
let root = null;
let els = {};
let scanner = null;
let scanning = false;
const scans = []; // session log: { time, code, label, kind }

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

function fmtDate(str) {
  const d = new Date(str + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return String(str);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function nowTime() {
  return new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

// ---- Result rendering ------------------------------------------------------

function showResult(kind, title, detail, payload) {
  const card = els.result;
  card.hidden = false;
  card.className = `card vv-gate-result vv-gate-${kind}`;
  const icon = kind === 'ok'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
    : kind === 'warn'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 16.5v.5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
  card.innerHTML = '';
  const head = el('div', { class: 'vv-gate-result-head' });
  const ic = el('span', { class: 'vv-gate-icon' });
  ic.innerHTML = icon;
  head.append(ic, el('h2', { text: title }));
  card.append(head);
  if (detail) card.append(el('p', { class: 'vv-gate-detail', text: detail }));
  if (payload) {
    const dl = el('dl', { class: 'vv-gate-facts' });
    const add = (k, v) => { if (v != null && v !== '') dl.append(el('dt', { text: k }), el('dd', { text: String(v) })); };
    add('Pass', payload.id);
    add('Site', payload.siteName);
    add('Date', fmtDate(payload.date));
    add('People', payload.people);
    add('Paid', payload.total != null ? `₹${payload.total}` : null);
    card.append(dl);
  }
  card.focus();
  scans.unshift({ time: nowTime(), code: payload && payload.id ? payload.id : '(unreadable)', label: title, kind });
  if (scans.length > 12) scans.pop();
  renderLog();
}

function renderLog() {
  const list = els.log;
  list.innerHTML = '';
  if (!scans.length) {
    list.append(el('li', { class: 'muted small', text: 'No passes checked yet in this session.' }));
    return;
  }
  for (const s of scans) {
    list.append(el('li', { class: `vv-gate-log-item vv-gate-${s.kind}` },
      el('span', { class: 'mono small', text: s.time }),
      el('span', { class: 'mono', text: s.code }),
      el('span', { class: 'vv-gate-log-label', text: s.label })));
  }
}

// ---- Verification ----------------------------------------------------------

async function check(raw) {
  const input = String(raw || '').trim();
  if (!input) {
    showResult('warn', 'Nothing to check', 'Scan a QR code or paste a pass code or booking ID first.', null);
    return;
  }
  let token = input.replace(/\s+/g, '');
  if (/^VV-[A-Z0-9]{5}$/i.test(token)) {
    const b = bookingById(token.toUpperCase());
    if (!b) {
      showResult('bad', 'Booking not found', `No booking ${token.toUpperCase()} exists on this device. Scan the visitor's QR instead; it can be checked without the booking list.`, { id: token.toUpperCase() });
      return;
    }
    if (!b.token) {
      showResult('warn', 'Pass not issued yet', 'This booking has no signed pass yet. Payment may not have finished.', { id: b.id, siteName: b.siteName, date: b.date, people: b.people, total: b.total });
      return;
    }
    token = b.token;
  }
  const res = await verifyPass(token);
  if (!res.ok) {
    if (res.reason === 'signature' || token.startsWith('VV1.')) {
      showResult('bad', 'Fake or altered pass', 'The signature does not match. Someone made or edited this pass. Do not allow entry.', res.payload);
    } else {
      showResult('bad', 'Not a VanaVaani pass', 'This code is not in the VanaVaani pass format.', null);
    }
    return;
  }
  const p = res.payload;
  const today = todayStr();
  if (today < p.date) {
    showResult('warn', `Valid from ${fmtDate(p.date)}`, 'The pass is genuine but is for a later day. Ask the visitor to come back on that date.', p);
    return;
  }
  if (today > p.date) {
    showResult('bad', 'Expired', `This pass was for ${fmtDate(p.date)}. It cannot be used today.`, p);
    return;
  }
  if (isPassUsed(p.id)) {
    showResult('bad', 'Already used', 'This pass has already been scanned at the gate today. A pass works once.', p);
    return;
  }
  markPassUsed(p.id);
  const n = Number(p.people) || 1;
  showResult('ok', `Entry allowed: ${n} ${n === 1 ? 'person' : 'people'}, ${p.siteName}`, 'Signature valid and checked offline. Pass is now marked as used.', p);
}

// ---- Camera scanning -------------------------------------------------------

function setScanStatus(text) {
  els.scanStatus.textContent = text;
}

async function stopScan() {
  const s = scanner;
  scanning = false;
  els.scanBtn.hidden = false;
  els.stopBtn.hidden = true;
  els.reader.classList.remove('is-active');
  if (!s) return;
  try {
    if (s.isScanning) await s.stop();
  } catch { /* already stopped */ }
  try { s.clear(); } catch { /* nothing rendered */ }
}

async function startScan() {
  if (scanning) return;
  if (typeof Html5Qrcode === 'undefined') {
    setScanStatus('The QR scanner library did not load (offline?). Paste the pass code below instead.');
    return;
  }
  if (!window.isSecureContext) {
    setScanStatus('Camera needs https or localhost. Paste the pass code below instead.');
    return;
  }
  scanning = true;
  els.scanBtn.hidden = true;
  els.stopBtn.hidden = false;
  els.reader.classList.add('is-active');
  setScanStatus('Starting camera. Point it at the visitor\'s QR.');
  try {
    if (!scanner) scanner = new Html5Qrcode(READER_ID, { verbose: false });
    let handled = false;
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; } },
      async (text) => {
        if (handled) return;
        handled = true;
        setScanStatus('QR read. Checking pass.');
        await stopScan();
        await check(text);
        setScanStatus('Scan finished. Tap "Scan QR with camera" for the next visitor.');
      },
      () => { /* no QR in this frame */ },
    );
    if (!scanning) await stopScan(); // hide() ran while the camera was starting
    else setScanStatus('Camera on. Hold the QR inside the box.');
  } catch (err) {
    const name = err && (err.name || '');
    const msg = String((err && err.message) || err || '');
    await stopScan();
    if (name === 'NotAllowedError' || /permission|denied/i.test(msg)) {
      setScanStatus('Camera permission was denied. Allow it in the browser, or paste the pass code below.');
    } else if (name === 'NotFoundError' || /not ?found|no camera|requested device/i.test(msg)) {
      setScanStatus('No camera found on this device. Paste the pass code below, or use "Use my latest booking".');
    } else {
      setScanStatus('Could not start the camera. Paste the pass code below instead.');
    }
  }
}

// ---- View ------------------------------------------------------------------

export function mount(r) {
  root = r;
  root.innerHTML = '';

  const head = el('header', { class: 'view-head' },
    el('p', { class: 'eyebrow', text: 'For the local guide' }),
    el('h1', { text: 'Gate check' }),
    el('p', { text: 'Scan the visitor\'s QR pass or paste its code. The signature is checked on this phone, with no internet needed. Each pass opens the gate once, on its own date.' }));

  // Camera card.
  const scanBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Scan QR with camera' });
  const stopBtn = el('button', { type: 'button', class: 'btn', text: 'Stop camera', hidden: true });
  const reader = el('div', { id: READER_ID, class: 'vv-gate-reader' });
  const scanStatus = el('p', { class: 'muted small', 'aria-live': 'polite', text: 'The camera starts only when you tap the button.' });
  const camCard = el('section', { class: 'card stack', 'aria-labelledby': 'vv-gate-cam-h' },
    el('h2', { id: 'vv-gate-cam-h', text: '1. Scan the QR' }),
    el('div', { class: 'row' }, scanBtn, stopBtn),
    reader, scanStatus);

  // Paste card.
  const ta = el('textarea', { id: 'vv-gate-input', rows: '4', class: 'vv-gate-input', spellcheck: 'false', autocomplete: 'off', placeholder: 'VV-AB12C or VV1.eyJ...' });
  const verifyBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Verify' });
  const latestBtn = el('button', { type: 'button', class: 'btn', text: 'Use my latest booking' });
  const pasteCard = el('section', { class: 'card stack', 'aria-labelledby': 'vv-gate-paste-h' },
    el('h2', { id: 'vv-gate-paste-h', text: '2. Or type the code' }),
    el('label', { class: 'field', for: 'vv-gate-input' }, 'Paste pass code or booking ID'),
    ta,
    el('div', { class: 'row' }, verifyBtn, latestBtn),
    el('p', { class: 'muted small', text: 'One-device demo: book on the Book tab, then press "Use my latest booking". Try editing a character of the pass code to see a forged pass get caught.' }));

  const result = el('section', { class: 'card vv-gate-result', tabindex: '-1', 'aria-live': 'assertive', hidden: true });
  const log = el('ul', { class: 'vv-gate-log' });
  const logCard = el('section', { class: 'card', 'aria-labelledby': 'vv-gate-log-h' },
    el('h2', { id: 'vv-gate-log-h', text: 'Recent checks this session' }), log);

  root.append(head, el('div', { class: 'grid-2' }, camCard, pasteCard), result, logCard);
  els = { scanBtn, stopBtn, reader, scanStatus, ta, result, log };

  scanBtn.addEventListener('click', startScan);
  stopBtn.addEventListener('click', () => { stopScan(); setScanStatus('Camera stopped.'); });
  verifyBtn.addEventListener('click', () => check(ta.value));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); check(ta.value); }
  });
  latestBtn.addEventListener('click', () => {
    const list = getState().bookings.filter((b) => b.token);
    const latest = list[list.length - 1];
    if (!latest) {
      showResult('warn', 'No bookings yet', 'Make a booking on the Book tab first, then come back here.', null);
      return;
    }
    ta.value = latest.token;
    check(latest.token);
  });
  renderLog();
}

export function show() { /* camera starts only on tap */ }

export function hide() {
  if (scanning || scanner) stopScan();
}
