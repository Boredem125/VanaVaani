// App state: demo sites, seeded history, recordings, bookings and passes.
// Kept in localStorage (wrapped in try/catch). Every change fires a
// "change" event on `bus`; Judge mode fires "live".

import { mulberry32, range, gauss } from './rng.js';
import {
  smooth, quotaFor, priceFor, statusFor, feeSplit, pickAlternatives,
} from './score.js';

export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

// Control-post acoustic quality for a healthy site (matches synth "forest" scene).
const CONTROL_QUALITY = 0.92;

export const SITES = [
  {
    id: 'nongriat',
    name: 'Nongriat Root Bridges',
    place: 'East Khasi Hills, Meghalaya',
    lat: 25.2475, lon: 91.672,
    maxDaily: 400, baseFee: 50, seedScore: 74, controlQuality: CONTROL_QUALITY,
    village: 'Nongriat Dorbar Shnong',
    posts: [
      { id: 'ng-steps', name: 'Tyrna steps (trail)', lat: 25.2531, lon: 91.6743, control: false },
      { id: 'ng-bridge', name: 'Double-decker bridge', lat: 25.2475, lon: 91.672, control: false },
      { id: 'ng-falls', name: 'Rainbow Falls path', lat: 25.2402, lon: 91.6698, control: false },
      { id: 'ng-grove', name: 'Sacred grove ridge (control)', lat: 25.2449, lon: 91.6771, control: true },
    ],
    guardians: [
      { id: 'g-ng-1', name: 'Wanshan L.' },
      { id: 'g-ng-2', name: 'Ibansara K.' },
      { id: 'g-ng-3', name: 'Daphisha N.' },
      { id: 'g-ng-4', name: 'Bandarisha M.' },
      { id: 'g-ng-5', name: 'Kyrshan S.' },
      { id: 'g-ng-6', name: 'Iaishah R.' },
      { id: 'g-ng-7', name: 'Treibor K.' },
      { id: 'g-ng-8', name: 'Phrangsngi D.' },
    ],
    species: ['Black-crested Bulbul', 'Streaked Spiderhunter', 'Blue-throated Barbet', 'Greater Racket-tailed Drongo', 'Grey-headed Canary-flycatcher', 'Asian Barred Owlet', 'Chestnut-headed Bee-eater', 'Rufous-necked Laughingthrush', 'Common Hill Myna', 'Black-naped Monarch'],
    alternatives: [
      { id: 'riwai', name: 'Riwai Root Bridge', village: 'Riwai Dorbar Shnong', km: 38, baseFee: 30, maxDaily: 250, seedScore: 88 },
      { id: 'padu', name: 'Padu Root Bridges', village: 'Padu Dorbar Shnong', km: 52, baseFee: 30, maxDaily: 150, seedScore: 91 },
    ],
  },
  {
    id: 'khecheopalri',
    name: 'Khecheopalri Lake',
    place: 'West Sikkim',
    lat: 27.35, lon: 88.195,
    maxDaily: 300, baseFee: 40, seedScore: 93, controlQuality: CONTROL_QUALITY,
    village: 'Khecheopalri Eco-Development Committee',
    posts: [
      { id: 'kp-jetty', name: 'Prayer-wheel jetty', lat: 27.3502, lon: 88.1948, control: false },
      { id: 'kp-trail', name: 'Lakeside forest trail', lat: 27.3517, lon: 88.1969, control: false },
      { id: 'kp-ridge', name: 'Monastery ridge forest (control)', lat: 27.3551, lon: 88.1921, control: true },
    ],
    guardians: [
      { id: 'g-kp-1', name: 'Pema D.' },
      { id: 'g-kp-2', name: 'Sonam B.' },
      { id: 'g-kp-3', name: 'Karma L.' },
      { id: 'g-kp-4', name: 'Dawa S.' },
      { id: 'g-kp-5', name: 'Mingma T.' },
      { id: 'g-kp-6', name: 'Yangchen B.' },
    ],
    species: ['Rufous Sibia', 'Green-tailed Sunbird', 'Grey-winged Blackbird', 'Black-throated Tit', 'Great Barbet', 'Verditer Flycatcher', 'Himalayan Bulbul', 'Large-billed Crow', 'Whistler\'s Warbler', 'Golden-throated Barbet'],
    alternatives: [
      { id: 'rinchenpong', name: 'Rinchenpong Village Walk', village: 'Rinchenpong village committee', km: 24, baseFee: 30, maxDaily: 200, seedScore: 86 },
      { id: 'hee-bermiok', name: 'Hee Bermiok Forest Trail', village: 'Hee Bermiok village committee', km: 31, baseFee: 30, maxDaily: 180, seedScore: 89 },
    ],
  },
  {
    id: 'ousteri',
    name: 'Ousteri Lake',
    place: 'Puducherry',
    lat: 11.957, lon: 79.745,
    maxDaily: 500, baseFee: 30, seedScore: 79, controlQuality: CONTROL_QUALITY,
    village: 'Ousteri Lake Village Panchayat',
    posts: [
      { id: 'os-boat', name: 'Boating jetty', lat: 11.9571, lon: 79.7466, control: false },
      { id: 'os-bund', name: 'East bund walkway', lat: 11.9622, lon: 79.7531, control: false },
      { id: 'os-reeds', name: 'North reed beds (control)', lat: 11.9701, lon: 79.7424, control: true },
    ],
    guardians: [
      { id: 'g-os-1', name: 'Kalaivani R.' },
      { id: 'g-os-2', name: 'Murugan S.' },
      { id: 'g-os-3', name: 'Anitha P.' },
      { id: 'g-os-4', name: 'Selvi K.' },
      { id: 'g-os-5', name: 'Ravi M.' },
      { id: 'g-os-6', name: 'Priya D.' },
      { id: 'g-os-7', name: 'Senthil V.' },
    ],
    species: ['Spot-billed Pelican', 'Purple Swamphen', 'Bronze-winged Jacana', 'White-throated Kingfisher', 'Asian Openbill', 'Indian Pond Heron', 'Little Cormorant', 'Pheasant-tailed Jacana', 'Ashy Prinia', 'Clamorous Reed Warbler'],
    alternatives: [
      { id: 'bahour', name: 'Bahour Lake', village: 'Bahour Commune Panchayat', km: 22, baseFee: 20, maxDaily: 200, seedScore: 84 },
      { id: 'chunnambar', name: 'Chunnambar Backwaters', village: 'Ariyankuppam Commune Panchayat', km: 14, baseFee: 30, maxDaily: 400, seedScore: 76 },
    ],
  },
];

export const siteById = (id) => SITES.find((s) => s.id === id);

export function dateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const todayStr = () => dateStr();
export function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  return dateStr(new Date(y, m - 1, d + n));
}

const KEY = 'vanavaani.v1';
let state = null;
let live = {}; // siteId -> { health, quality, indices, scene, at }

function lsGet() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function lsSet(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked: keep in memory */ }
}

// 30 days of synthetic history per site. A busy weekend and a festival spike
// pull the score down; quiet weekdays let it recover.
function seedHistory(site, today) {
  const rng = mulberry32(site.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const rows = [];
  let ema = site.seedScore;
  for (let i = 30; i >= 1; i--) {
    const date = addDays(today, -i);
    const dow = new Date(date + 'T12:00:00').getDay();
    const weekend = dow === 0 || dow === 6;
    const festival = i === 9 || i === 8;
    const pressure = (weekend ? 1.35 : 0.75) * (festival ? 1.7 : 1) * range(rng, 0.85, 1.15);
    const quota = quotaFor(site, ema);
    const price = priceFor(site, ema);
    const demand = Math.round(site.maxDaily * pressure);
    const footfall = Math.min(quota, demand);
    const raw = Math.max(20, Math.min(98, site.seedScore + 14 - 30 * (footfall / site.maxDaily) * (pressure > 1.2 ? 1.25 : 1) + 3 * gauss(rng)));
    const score = Math.round(raw);
    ema = smooth(ema, score);
    const split = feeSplit(site, price);
    rows.push({
      date, score, ema, quota, price, footfall,
      villageIncome: footfall * split.village,
      guardianIncome: footfall * split.guardians,
      restorationFund: footfall * split.restoration,
    });
  }
  return rows;
}

function freshState() {
  const today = todayStr();
  const history = {};
  for (const s of SITES) history[s.id] = seedHistory(s, today);
  return { version: 2, seededOn: today, history, recordings: [], bookings: [], usedPasses: [] };
}

export function getState() {
  if (!state) {
    const saved = lsGet();
    state = saved && saved.version === 2 && saved.seededOn === todayStr() ? saved : freshState();
    lsSet(state);
  }
  return state;
}

function commit(reason) {
  lsSet(state);
  emit('change', { reason });
}

export function resetDemo() {
  state = freshState();
  live = {};
  commit('reset');
  emit('live', { siteId: null });
}

// ---- Selected site (shared by all tabs) -----------------------------------

let currentSiteId = (() => {
  try { return localStorage.getItem(KEY + '.site') || SITES[0].id; } catch { return SITES[0].id; }
})();
export const getCurrentSiteId = () => currentSiteId;
export function setCurrentSiteId(id) {
  if (!siteById(id) || id === currentSiteId) return;
  currentSiteId = id;
  try { localStorage.setItem(KEY + '.site', id); } catch { /* ignore */ }
  emit('site', { siteId: id });
}

// ---- Recordings ----------------------------------------------------------

export function recordingsFor(siteId, date = todayStr()) {
  return getState().recordings.filter((r) => r.siteId === siteId && r.ts.slice(0, 10) === date);
}

// rec: { siteId, postId, guardianId, source, durationSec, indices, fingerprint,
//        quality, rain, gps, gpsOk, duplicate, accepted, pay }
export function addRecording(rec) {
  const full = { id: 'rec-' + Math.random().toString(36).slice(2, 9), ts: new Date().toISOString(), ...rec };
  getState().recordings.push(full);
  commit('recording');
  return full;
}

// Today's measured score from accepted, rain-free recordings, or null.
export function measuredScore(siteId, date = todayStr()) {
  const site = siteById(siteId);
  const recs = recordingsFor(siteId, date).filter((r) => r.accepted && !r.rain);
  const controlIds = new Set(site.posts.filter((p) => p.control).map((p) => p.id));
  const trail = recs.filter((r) => !controlIds.has(r.postId));
  const control = recs.filter((r) => controlIds.has(r.postId));
  if (!trail.length) return null;
  const mean = (xs) => xs.reduce((a, r) => a + r.quality, 0) / xs.length;
  const controlQ = control.length ? mean(control) : site.controlQuality;
  return Math.round(100 * Math.min(1, mean(trail) / controlQ));
}

// ---- Judge mode live override --------------------------------------------

export function setLive(siteId, reading) {
  if (reading) live[siteId] = { ...reading, at: Date.now() };
  else delete live[siteId];
  emit('live', { siteId, reading });
}
export const getLive = (siteId) => live[siteId] || null;

// ---- Status --------------------------------------------------------------

function altStatus(alt) {
  const rng = mulberry32(alt.id.length * 97 + new Date().getDate());
  const score = Math.round(alt.seedScore + range(rng, -4, 4));
  return { score, status: statusFor(score), quota: quotaFor(alt, score), price: priceFor(alt, score) };
}

// Everything the UI needs for one site. `score` drives tomorrow's quota and fee.
// In Judge mode (live reading present) smoothing is skipped so the change is instant.
export function siteStatus(siteId) {
  const site = siteById(siteId);
  const hist = getState().history[siteId];
  const last = hist[hist.length - 1];
  const measured = measuredScore(siteId);
  const liveReading = getLive(siteId);
  let today;
  let score;
  let source;
  if (liveReading) {
    today = liveReading.health;
    score = liveReading.health;
    source = 'live';
  } else if (measured != null) {
    today = measured;
    score = smooth(last.ema, measured);
    source = 'measured';
  } else {
    today = last.score;
    score = last.ema;
    source = 'history';
  }
  const quota = quotaFor(site, score);
  const price = priceFor(site, score);
  const booked = bookingsFor(siteId, todayStr()).reduce((a, b) => a + b.people, 0);
  const statusById = {};
  for (const alt of site.alternatives) statusById[alt.id] = altStatus(alt);
  return {
    site, today, score, source, quota, price,
    status: statusFor(score),
    split: feeSplit(site, price),
    booked,
    slotsLeft: Math.max(0, quota - booked),
    alternatives: score < 75 ? pickAlternatives(site, statusById) : [],
    history: hist,
    live: liveReading,
  };
}

// ---- Bookings and passes -------------------------------------------------

export function bookingsFor(siteId, date) {
  return getState().bookings.filter((b) => b.siteId === siteId && (!date || b.date === date));
}

// b: { siteId, siteName, date, people, pricePerHead, total, split:{village,guardians,restoration} (per head), lang, token }
export function addBooking(b) {
  const id = 'VV-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const full = { id, createdAt: new Date().toISOString(), ...b };
  getState().bookings.push(full);
  commit('booking');
  return full;
}
export const bookingById = (id) => getState().bookings.find((b) => b.id === id) || null;
export function updateBooking(id, patch) {
  const b = bookingById(id);
  if (b) { Object.assign(b, patch); commit('booking'); }
  return b;
}

export const isPassUsed = (id) => getState().usedPasses.includes(id);
export function markPassUsed(id) {
  if (!isPassUsed(id)) { getState().usedPasses.push(id); commit('pass'); }
}
