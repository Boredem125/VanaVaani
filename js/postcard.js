// Forest postcard: a 1080x1350 PNG drawn procedurally for each booking.
// Deterministic per booking id, so the same pass always gives the same card.

import { SITES, siteById } from './store.js';
import { statusFor } from './score.js';
import { mulberry32 } from './rng.js';

const W = 1080;
const H = 1350;
const M = 90;
const DISPLAY = "'Bricolage Grotesque', 'Segoe UI', sans-serif";
const BODY = "'Source Sans 3', 'Segoe UI', sans-serif";

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Booking may be for a listed site or for one of its nearby alternatives.
function resolveSite(booking) {
  const direct = siteById(booking.siteId);
  if (direct) return { site: direct, parent: direct, alt: null, km: null };
  const parent = siteById(booking.parentSiteId)
    || SITES.find((s) => (s.alternatives || []).some((a) => a.id === booking.siteId))
    || SITES[0];
  const alt = (parent.alternatives || []).find((a) => a.id === booking.siteId);
  return { site: null, parent, alt, km: alt ? alt.km : null };
}

function fmtDate(str) {
  const d = new Date(str + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

function wrapLines(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function pickSpecies(list, rng) {
  const pool = list.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const n = Math.min(pool.length, 6 + Math.floor(rng() * 3));
  return pool.slice(0, n);
}

function drawRidges(ctx, rng) {
  // Two layers of conifer silhouettes along the lower edge.
  const layers = [
    { base: H - 40, h: 120, color: 'rgba(20, 70, 50, 0.55)' },
    { base: H + 10, h: 150, color: 'rgba(6, 26, 18, 0.9)' },
  ];
  for (const L of layers) {
    ctx.fillStyle = L.color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    let x = -20;
    while (x < W + 40) {
      const w = 34 + rng() * 40;
      const h = L.h * (0.55 + rng() * 0.45);
      ctx.lineTo(x, L.base);
      ctx.lineTo(x + w / 2, L.base - h);
      ctx.lineTo(x + w, L.base);
      x += w * (0.6 + rng() * 0.3);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }
}

function drawSoundBand(ctx, rng, top, height, health) {
  const left = M;
  const width = W - 2 * M;
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(left, top, width, height, 22); else ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.fillStyle = '#04110c';
  ctx.fillRect(left, top, width, height);

  // Spectrogram-style cells: low band hum, mid-high band bird calls.
  const cols = 120;
  const rows = 36;
  const cw = width / cols;
  const rh = height / rows;
  const richness = Math.max(0.25, Math.min(1, (health || 60) / 100));
  const calls = [];
  const nCalls = 8 + Math.floor(rng() * 8 * richness + 4 * richness);
  for (let i = 0; i < nCalls; i++) {
    calls.push({
      c: Math.floor(rng() * cols),
      len: 3 + Math.floor(rng() * 9),
      r: 8 + Math.floor(rng() * (rows - 14)),
      slope: (rng() - 0.5) * 1.6,
      amp: 0.55 + rng() * 0.45,
    });
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const fromBottom = rows - 1 - r;
      let v = 0.06 + rng() * 0.08;
      if (fromBottom < 5) v += 0.35 * (1 - fromBottom / 5) * (0.6 + 0.4 * Math.sin(c * 0.21 + fromBottom));
      for (const k of calls) {
        const dc = c - k.c;
        if (dc >= 0 && dc < k.len) {
          const rr = k.r + Math.round(dc * k.slope);
          const d = Math.abs(r - rr);
          if (d < 2) v += k.amp * (d === 0 ? 1 : 0.4) * (1 - dc / (k.len + 2));
        }
      }
      v = Math.min(1, v);
      if (v < 0.08) continue;
      // Dark teal -> mint -> pale gold.
      const hue = 170 - 120 * v;
      const light = 14 + 58 * v;
      ctx.fillStyle = `hsla(${hue}, 70%, ${light}%, ${0.35 + 0.65 * v})`;
      ctx.fillRect(left + c * cw, top + r * rh, cw + 0.6, rh + 0.6);
    }
  }

  // Waveform overlay.
  ctx.strokeStyle = 'rgba(233, 244, 238, 0.85)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  const mid = top + height / 2;
  for (let x = 0; x <= width; x += 3) {
    const env = 0.35 + 0.65 * Math.abs(Math.sin(x / 70 + rng() * 0.2));
    const y = mid + Math.sin(x / 9) * env * height * 0.14 * (0.6 + rng() * 0.4);
    if (x === 0) ctx.moveTo(left + x, y); else ctx.lineTo(left + x, y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = 'rgba(233, 244, 238, 0.6)';
  ctx.font = `500 22px ${BODY}`;
  ctx.textAlign = 'left';
  ctx.fillText('Soundscape art, generated from your booking', left, top + height + 34);
  ctx.textAlign = 'right';
  ctx.fillText('low hum  |  bird calls  |  waveform', left + width, top + height + 34);
  ctx.textAlign = 'left';
}

export async function drawPostcard(canvas, booking) {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch { /* draw with fallbacks */ }
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(hashStr(String(booking.id || 'VV')));
  const { site, parent, alt, km } = resolveSite(booking);
  const siteName = booking.siteName || (site && site.name) || 'Forest site';
  const place = site ? site.place : (km != null ? `${km} km from ${parent.name}, ${parent.place}` : parent.place);
  const village = (alt && alt.village) || parent.village;
  const health = booking.healthAtBooking;
  const statusLabel = health != null ? statusFor(health).label : null;

  // Background.
  const bg = ctx.createLinearGradient(0, 0, W * 0.3, H);
  bg.addColorStop(0, '#0f3a2c');
  bg.addColorStop(0.55, '#0a2a1f');
  bg.addColorStop(1, '#04140d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, 120, 10, W * 0.85, 120, 520);
  glow.addColorStop(0, 'rgba(103, 212, 184, 0.22)');
  glow.addColorStop(1, 'rgba(103, 212, 184, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // Faint canopy dots.
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = `rgba(160, 230, 200, ${0.03 + rng() * 0.06})`;
    ctx.beginPath();
    ctx.arc(rng() * W, rng() * H * 0.9, 2 + rng() * 10, 0, Math.PI * 2);
    ctx.fill();
  }
  drawRidges(ctx, rng);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Header.
  ctx.fillStyle = '#67d4b8';
  ctx.font = `600 26px ${BODY}`;
  ctx.fillText('VANAVAANI  |  FOREST POSTCARD', M, 124);

  ctx.fillStyle = '#f2f8f4';
  let titleSize = 84;
  ctx.font = `800 ${titleSize}px ${DISPLAY}`;
  while (ctx.measureText(siteName).width > W - 2 * M && titleSize > 56) {
    titleSize -= 4;
    ctx.font = `800 ${titleSize}px ${DISPLAY}`;
  }
  let y = 222;
  for (const line of wrapLines(ctx, siteName, W - 2 * M).slice(0, 2)) {
    ctx.fillText(line, M, y);
    y += titleSize + 4;
  }
  ctx.fillStyle = 'rgba(233, 244, 238, 0.78)';
  ctx.font = `500 34px ${BODY}`;
  ctx.fillText(place, M, y - 30);
  y += 22;

  ctx.fillStyle = 'rgba(233, 244, 238, 0.92)';
  ctx.font = `600 32px ${BODY}`;
  const visit = `Visit: ${fmtDate(booking.date)}`;
  ctx.fillText(visit, M, y);
  if (health != null) {
    const txt = `Forest health at booking: ${health}/100${statusLabel ? ' (' + statusLabel + ')' : ''}`;
    ctx.fillText(txt, M, y + 46);
  }

  // Sound art band.
  const bandTop = 470;
  drawSoundBand(ctx, rng, bandTop, 270, health);

  // Birds.
  let by = 860;
  ctx.fillStyle = '#f2f8f4';
  ctx.font = `700 46px ${DISPLAY}`;
  ctx.fillText('Birds the forest sang for you', M, by);
  const species = pickSpecies(parent.species || [], rng);
  ctx.font = `500 31px ${BODY}`;
  const colW = (W - 2 * M) / 2;
  species.forEach((name, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * colW;
    const yy = by + 62 + row * 52;
    ctx.fillStyle = '#67d4b8';
    ctx.beginPath();
    ctx.arc(x + 8, yy - 10, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(233, 244, 238, 0.92)';
    let label = name;
    while (ctx.measureText(label).width > colW - 40 && label.length > 4) label = label.slice(0, -2);
    if (label !== name) label = label.trimEnd() + '.';
    ctx.fillText(label, x + 26, yy);
  });
  by += 62 + Math.ceil(species.length / 2) * 52;
  ctx.fillStyle = 'rgba(233, 244, 238, 0.55)';
  ctx.font = `italic 400 22px ${BODY}`;
  ctx.fillText('Species list simulated; BirdNET identification is the next step', M, by - 10);

  // Fee split.
  const people = Number(booking.people) || 1;
  const split = booking.split || { village: 0, guardians: 0, restoration: 0 };
  const v = split.village * people;
  const g = split.guardians * people;
  const r = split.restoration * people;
  const splitY = Math.max(by + 40, 1176);
  ctx.strokeStyle = 'rgba(103, 212, 184, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, splitY - 42);
  ctx.lineTo(W - M, splitY - 42);
  ctx.stroke();
  ctx.fillStyle = '#f2f8f4';
  ctx.font = `600 29px ${BODY}`;
  const splitText = `₹${v} reached ${village} · ₹${g} paid forest guardians · ₹${r} restoration fund`;
  let sy = splitY;
  for (const line of wrapLines(ctx, splitText, W - 2 * M).slice(0, 3)) {
    ctx.fillText(line, M, sy);
    sy += 40;
  }

  // Footer on the ridge.
  ctx.fillStyle = 'rgba(233, 244, 238, 0.7)';
  ctx.font = `500 22px ${BODY}`;
  ctx.fillText(`Pass ${booking.id}  ·  ${people} ${people === 1 ? 'visitor' : 'visitors'}  ·  VanaVaani prototype`, M, H - 40);
  return canvas;
}

let openDialog = null;

export function openPostcard(booking) {
  if (!booking) return;
  if (openDialog) openDialog.close();
  const opener = document.activeElement;

  const dlg = document.createElement('dialog');
  dlg.className = 'vv-modal';
  dlg.setAttribute('aria-labelledby', 'vv-postcard-title');

  const head = document.createElement('div');
  head.className = 'vv-modal-head';
  const h = document.createElement('h2');
  h.id = 'vv-postcard-title';
  h.textContent = 'Your forest postcard';
  const tag = document.createElement('span');
  tag.className = 'sim-tag';
  tag.textContent = 'Species simulated';
  head.append(h, tag);

  const frame = document.createElement('div');
  frame.className = 'vv-postcard-frame';
  const canvas = document.createElement('canvas');
  canvas.className = 'vv-postcard-canvas';
  canvas.width = W;
  canvas.height = H;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Postcard for ${booking.siteName || 'your visit'} on ${booking.date}`);
  frame.appendChild(canvas);

  const actions = document.createElement('div');
  actions.className = 'row vv-modal-actions';
  const dl = document.createElement('button');
  dl.type = 'button';
  dl.className = 'btn btn-primary';
  dl.textContent = 'Download PNG';
  dl.disabled = true;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn';
  close.textContent = 'Close';
  actions.append(dl, close);

  dlg.append(head, frame, actions);
  document.body.appendChild(dlg);
  openDialog = dlg;

  const finish = () => {
    if (dlg.open) dlg.close();
  };
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (openDialog === dlg) openDialog = null;
    if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(); });
  close.addEventListener('click', finish);
  // Fallback for browsers without <dialog>: handle Escape ourselves.
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(); } });

  dl.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vanavaani-postcard-${booking.id}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  });

  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  close.focus();

  drawPostcard(canvas, booking).then(() => { dl.disabled = false; dl.focus(); }).catch((err) => {
    console.error(err);
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Could not draw the postcard in this browser.';
    frame.replaceChildren(p);
  });
}
