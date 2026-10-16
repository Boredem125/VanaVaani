// Listen tab: the guide's listening-post flow.
// Pick post and guardian, record (mic, demo scene or uploaded file), check GPS,
// compute acoustic indices, run integrity checks, save only the numbers.

import {
  bus, getCurrentSiteId, siteById, getState, recordingsFor, addRecording, measuredScore,
} from '../store.js';
import { computeIndices, cosine } from '../indices.js';
import { acousticQuality, healthScore, statusFor } from '../score.js';
import { SCENES } from '../synth.js';
import {
  engine, playScene, startMic, stop, recordFor, cancelRecording, analyseFile, SpectrogramView,
} from '../audio.js';

const OWNER = 'listen';
const GPS_RADIUS_M = 150;
const DUP_THRESHOLD = 0.995;
const PAY = 15;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const clamp01 = (x) => Math.min(1, Math.max(0, x));

let root = null;
let el = {};
let specView = null;

const ui = {
  siteId: null,
  postId: null,
  guardianId: null,
  source: 'demo', // 'mic' | 'demo' | 'file'
  scene: 'forest',
  duration: 10,
  override: true,
  file: null,
  busy: false,
  phase: '', // status text while busy
  error: '',
  gps: { status: 'idle' }, // idle | pending | ok | unavailable | denied | timeout | error
  cancelled: false,
  result: null, // { rec, ix, health, dupScore, site, post, guardian }
};

// ---- GPS -----------------------------------------------------------------

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

let gpsPromise = null;
function locate() {
  if (gpsPromise) return gpsPromise;
  if (!('geolocation' in navigator)) {
    ui.gps = { status: 'unavailable' };
    renderGps();
    return Promise.resolve(ui.gps);
  }
  ui.gps = { status: 'pending' };
  renderGps();
  gpsPromise = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        ui.gps = {
          status: 'ok',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        resolve(ui.gps);
      },
      (err) => {
        const status = err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'error';
        ui.gps = { status };
        resolve(ui.gps);
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 },
    );
  }).then((g) => {
    gpsPromise = null;
    renderGps();
    return g;
  });
  return gpsPromise;
}

function currentPost(site) {
  return site.posts.find((p) => p.id === ui.postId) || site.posts[0];
}

function gpsCheck(site) {
  const post = currentPost(site);
  const g = ui.gps;
  if (g.status !== 'ok') return { ok: false, distanceM: null, status: g.status };
  const distanceM = Math.round(haversine(g.lat, g.lon, post.lat, post.lon));
  return { ok: distanceM <= GPS_RADIUS_M, distanceM, status: distanceM <= GPS_RADIUS_M ? 'ok' : 'far' };
}

function distText(m) {
  if (m == null) return '';
  return m >= 10000 ? `${Math.round(m / 1000).toLocaleString('en-IN')} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

function gpsSentence(check) {
  switch (check.status) {
    case 'ok': return `Within ${GPS_RADIUS_M} m of the post (${distText(check.distanceM)} away).`;
    case 'far': return `${distText(check.distanceM)} from the post, outside the ${GPS_RADIUS_M} m limit.`;
    case 'pending': return 'Finding your location...';
    case 'denied': return 'Location permission was denied.';
    case 'timeout': return 'No GPS fix within 6 seconds.';
    case 'unavailable': return 'This browser has no location service.';
    case 'error': return 'Location could not be read.';
    default: return 'Location not checked yet. It is checked when you record.';
  }
}

// ---- Rendering -------------------------------------------------------------

function site() {
  return siteById(getCurrentSiteId());
}

function syncSite() {
  const s = site();
  if (ui.siteId !== s.id) {
    ui.siteId = s.id;
    ui.postId = (s.posts.find((p) => !p.control) || s.posts[0]).id;
    ui.guardianId = s.guardians[0].id;
    ui.result = null;
    ui.error = '';
  }
  return s;
}

function renderShell() {
  root.innerHTML = `
    <div class="view-head">
      <h1>Listening post</h1>
      <p>Stand at a marked post and record the forest. The phone turns the sound into four numbers; only those numbers are saved, never the audio.</p>
    </div>
    <div class="grid-2 lp-top">
      <div class="card lp-recorder">
        <h2>Record</h2>
        <div class="lp-fields">
          <label class="field">Listening post
            <select data-k="post"></select>
          </label>
          <label class="field">Guardian
            <select data-k="guardian"></select>
          </label>
        </div>
        <div class="lp-seg-wrap">
          <span class="lp-seg-label" id="lp-source-label">Sound source</span>
          <div class="lp-seg" role="radiogroup" aria-labelledby="lp-source-label" data-k="source">
            <label><input type="radio" name="lp-source" value="mic"><span>Microphone</span></label>
            <label><input type="radio" name="lp-source" value="demo"><span>Demo sound</span></label>
            <label><input type="radio" name="lp-source" value="file"><span>Upload file</span></label>
          </div>
        </div>
        <div class="lp-source-extra">
          <label class="field" data-show="demo">Demo scene
            <select data-k="scene">
              ${Object.entries(SCENES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
            </select>
          </label>
          <p class="muted small" data-show="demo">Synthetic soundscape played through this device and analysed live.</p>
          <p class="muted small" data-show="mic">Hold the phone still at chest height, away from wind. Your browser will ask for microphone access.</p>
          <label class="field" data-show="file">Audio file (first 60 s is analysed)
            <input type="file" accept="audio/*" data-k="file">
          </label>
        </div>
        <label class="field" data-hide="file">Duration
          <select data-k="duration">
            <option value="10">10 s (demo)</option>
            <option value="60">60 s (field standard)</option>
          </select>
        </label>
        <div class="lp-gps" data-k="gps"></div>
        <button type="button" class="btn btn-primary lp-record" data-k="record"></button>
        <div class="lp-progress" data-k="progress" hidden>
          <div class="lp-progress-bar"><span data-k="bar"></span></div>
          <span class="mono small" data-k="countdown"></span>
        </div>
        <p class="lp-msg small" data-k="msg" role="status" aria-live="polite"></p>
        <div class="lp-spec-wrap">
          <canvas class="lp-spec" data-k="canvas" aria-label="Live spectrogram: time runs left to right, pitch rises upward"></canvas>
        </div>
      </div>
      <div class="card lp-result" data-k="result" aria-live="polite"></div>
    </div>
    <div class="card lp-today" data-k="today"></div>
  `;
  el = {};
  root.querySelectorAll('[data-k]').forEach((n) => { el[n.dataset.k] = n; });

  el.post.addEventListener('change', () => { ui.postId = el.post.value; renderGps(); });
  el.guardian.addEventListener('change', () => { ui.guardianId = el.guardian.value; });
  el.source.addEventListener('change', (e) => {
    if (e.target.name === 'lp-source') { ui.source = e.target.value; ui.error = ''; renderControls(); }
  });
  el.scene.addEventListener('change', () => { ui.scene = el.scene.value; });
  el.duration.addEventListener('change', () => { ui.duration = Number(el.duration.value); });
  el.file.addEventListener('change', () => { ui.file = el.file.files[0] || null; ui.error = ''; renderControls(); });
  el.gps.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="locate"]')) locate();
  });
  el.gps.addEventListener('change', (e) => {
    if (e.target.matches('[data-act="override"]')) ui.override = e.target.checked;
  });
  el.record.addEventListener('click', onRecord);

  specView = new SpectrogramView(el.canvas);
}

function renderControls() {
  const s = syncSite();
  el.post.innerHTML = s.posts.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.control && !/control/i.test(p.name) ? ' (control)' : ''}</option>`).join('');
  el.post.value = ui.postId;
  el.guardian.innerHTML = s.guardians.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
  el.guardian.value = ui.guardianId;
  root.querySelectorAll('input[name="lp-source"]').forEach((r) => { r.checked = r.value === ui.source; });
  el.scene.value = ui.scene;
  el.duration.value = String(ui.duration);
  root.querySelectorAll('[data-show]').forEach((n) => { n.hidden = n.dataset.show !== ui.source; });
  root.querySelectorAll('[data-hide]').forEach((n) => { n.hidden = n.dataset.hide === ui.source; });

  const lock = ui.busy;
  [el.post, el.guardian, el.scene, el.duration, el.file].forEach((n) => { n.disabled = lock; });
  root.querySelectorAll('input[name="lp-source"]').forEach((r) => { r.disabled = lock; });

  if (ui.busy) {
    el.record.textContent = ui.source === 'file' ? 'Analysing...' : 'Stop';
    el.record.disabled = ui.source === 'file';
    el.record.classList.add('is-recording');
  } else {
    el.record.textContent = ui.source === 'file' ? 'Analyse file' : `Record ${ui.duration} s`;
    el.record.disabled = ui.source === 'file' && !ui.file;
    el.record.classList.remove('is-recording');
  }
  el.msg.textContent = ui.error || ui.phase || '';
  el.msg.classList.toggle('lp-msg-error', !!ui.error);
  renderGps();
}

function renderGps() {
  if (!el.gps) return;
  const s = site();
  const check = ui.gps.status === 'ok' ? gpsCheck(s) : { status: ui.gps.status, ok: false };
  const cls = check.ok ? 'lp-check-ok' : check.status === 'pending' || check.status === 'idle' ? '' : 'lp-check-warn';
  el.gps.innerHTML = `
    <div class="lp-gps-line">
      <span class="eyebrow">GPS</span>
      <span class="small ${cls}">${esc(gpsSentence(check))}</span>
      <button type="button" class="btn btn-sm" data-act="locate" ${ui.gps.status === 'pending' ? 'disabled' : ''}>Check location</button>
    </div>
    ${check.ok ? '' : `
    <label class="lp-override small">
      <input type="checkbox" data-act="override" ${ui.override ? 'checked' : ''} ${ui.busy ? 'disabled' : ''}>
      <span>Demo override: treat as recorded at the post</span>
      <span class="sim-tag">Demo</span>
    </label>`}
  `;
}

function meter(label, value, lo, hi, text, meaning) {
  const pct = clamp01((value - lo) / (hi - lo)) * 100;
  return `
    <div class="lp-meter">
      <div class="lp-meter-head"><span class="lp-meter-label">${esc(label)}</span><span class="mono">${esc(text)}</span></div>
      <div class="lp-meter-track" role="meter" aria-label="${esc(label)}" aria-valuemin="${lo}" aria-valuemax="${hi}" aria-valuenow="${fmt(value, 3)}">
        <span class="lp-meter-fill" style="width:${pct.toFixed(1)}%"></span>
      </div>
      <p class="muted small">${esc(meaning)}</p>
    </div>`;
}

function check(ok, title, detail, neutral = false) {
  const cls = ok ? 'lp-check-ok' : neutral ? 'lp-check-warn' : 'lp-check-bad';
  const word = ok ? 'Pass' : neutral ? 'Note' : 'Fail';
  return `<li><span class="lp-check-mark ${cls}">${word}</span><span><strong>${esc(title)}</strong> ${esc(detail)}</span></li>`;
}

function renderResult() {
  const r = ui.result;
  if (!r) {
    el.result.innerHTML = `
      <h2>Result</h2>
      <p class="muted">No recording yet. Choose a post and press Record. In about ${ui.duration} seconds you will see the four acoustic indices, a health estimate and whether the clip passed the integrity checks.</p>
      <ul class="lp-howto small muted">
        <li>Trail posts measure the effect of visitors.</li>
        <li>The control post is off-trail. It sets the reference that strips out season and weather.</li>
        <li>Each accepted clip pays the guardian &#8377;${PAY}.</li>
      </ul>`;
    return;
  }
  const { rec, ix, health, dupScore, siteName, postName, guardianName, gpsCheckInfo, isControl } = r;
  const st = statusFor(health);
  let gpsDetail;
  if (rec.gpsOk) gpsDetail = gpsSentence(gpsCheckInfo);
  else if (rec.gpsOverride) gpsDetail = `${gpsSentence(gpsCheckInfo)} Demo override used.`;
  else gpsDetail = `${gpsSentence(gpsCheckInfo)} Not accepted without a location at the post.`;

  let payLine;
  if (rec.accepted) {
    payLine = `<p class="lp-pay lp-pay-ok"><strong>&#8377;${rec.pay} credited to ${esc(guardianName)}</strong> <span class="sim-tag">Simulated payment</span></p>`;
  } else {
    const why = rec.duplicate
      ? 'this clip matches an earlier recording, so it looks like replayed audio.'
      : 'the location could not be confirmed at the post.';
    payLine = `<p class="lp-pay lp-pay-no"><strong>Not paid:</strong> ${esc(why)}</p>`;
  }

  el.result.innerHTML = `
    <div class="lp-result-head">
      <h2>Result</h2>
      <span class="muted small">${esc(postName)}${isControl ? ' (control)' : ''}, ${esc(new Date(rec.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}, ${esc(sourceLabel(rec.source))}, ${Math.round(rec.durationSec)} s</span>
    </div>
    <div class="lp-health">
      ${rec.rain ? `
      <div class="kpi">
        <span class="kpi-label">Health estimate</span>
        <span class="kpi-value">Not scored</span>
        <span class="kpi-note">Rain masks birds and insects, so this clip is left out of the forest score. Record again when it is dry.</span>
      </div>
      <span class="pill pill-stressed">Rain</span>` : `
      <div class="kpi">
        <span class="kpi-label">Health estimate</span>
        <span class="kpi-value">${health}<span class="lp-of">/100</span></span>
        <span class="kpi-note">Acoustic quality ${fmt(rec.quality, 2)} against the control reference ${fmt(r.controlQuality, 2)}</span>
      </div>
      <span class="pill pill-${st.key}">${esc(st.label)}</span>`}
    </div>
    <div class="lp-meters">
      ${meter('NDSI', ix.ndsi, -1, 1, fmt(ix.ndsi, 2), 'Nature sound (2-11 kHz) against people and engines (1-2 kHz). +1 is all nature, -1 is all noise.')}
      ${meter('ACI', ix.aci, 0, 1.2, fmt(ix.aci, 2), 'How much bird and insect song changes moment to moment. Lively song scores higher than a steady hum.')}
      ${meter('ADI', ix.adi, 0, 1, fmt(ix.adi, 2), 'How evenly sound fills the pitch bands. Many species at different pitches scores higher.')}
      ${meter('BI', ix.bi, 0, 250, fmt(ix.bi, 0), 'Strength of the bird band (2-8 kHz) above its quietest point.')}
    </div>
    <h3>Integrity checks</h3>
    <ul class="lp-checks">
      ${check(rec.gpsOk, 'Location.', gpsDetail, rec.gpsOverride)}
      ${check(!rec.duplicate, 'Duplicate.', rec.duplicate
        ? `Matches an earlier clip at this site (similarity ${fmt(dupScore, 3)}, limit ${DUP_THRESHOLD}).`
        : dupScore != null ? `New sound. Closest earlier clip similarity ${fmt(dupScore, 3)}.` : 'First clip at this site today.')}
      ${check(!rec.rain, 'Rain.', rec.rain
        ? `Rain detected (spectral flatness ${fmt(ix.flatness, 2)}). Saved, but left out of the score because rain hides wildlife sound.`
        : `No rain (spectral flatness ${fmt(ix.flatness, 2)}).`, rec.rain)}
    </ul>
    ${payLine}
    <p class="muted small">Saved: ${esc(siteName)}, the four indices, a 22-number spectral fingerprint and the GPS check. No audio was stored.</p>
  `;
}

function sourceLabel(src) {
  if (src === 'mic') return 'Microphone';
  if (src === 'file') return 'Uploaded file';
  if (src && src.startsWith('scene:')) return 'Demo: ' + (SCENES[src.slice(6)] || src.slice(6));
  return src || '';
}

function statusOf(r) {
  if (r.duplicate) return { text: 'Duplicate', cls: 'lp-tag-bad' };
  if (!r.accepted) return { text: 'GPS failed', cls: 'lp-tag-bad' };
  if (r.rain) return { text: 'Rain, not scored', cls: 'lp-tag-warn' };
  return { text: r.gpsOk ? 'Accepted' : 'Accepted (override)', cls: 'lp-tag-ok' };
}

function renderToday() {
  const s = site();
  const recs = recordingsFor(s.id).slice().sort((a, b) => b.ts.localeCompare(a.ts));
  const measured = measuredScore(s.id);
  const accepted = recs.filter((r) => r.accepted && !r.rain).length;
  const postName = (id) => s.posts.find((p) => p.id === id)?.name || id;
  const guardianName = (id) => s.guardians.find((g) => g.id === id)?.name || id;
  const paid = recs.reduce((a, r) => a + (r.pay || 0), 0);
  const st = measured != null ? statusFor(measured) : null;

  el.today.innerHTML = `
    <div class="lp-today-head">
      <h2>Today at ${esc(s.name)}</h2>
      <div class="lp-today-kpis">
        <div class="kpi">
          <span class="kpi-label">Measured score today</span>
          <span class="kpi-value">${measured != null ? measured : '-'}</span>
          <span class="kpi-note">${measured != null
            ? `<span class="pill pill-${st.key}">${esc(st.label)}</span>`
            : 'Needs one accepted, rain-free clip from a trail post'}</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Recordings today</span>
          <span class="kpi-value">${recs.length}</span>
          <span class="kpi-note">${accepted} counted in the score</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Paid to guardians</span>
          <span class="kpi-value">&#8377;${paid}</span>
          <span class="kpi-note"><span class="sim-tag">Simulated</span></span>
        </div>
      </div>
    </div>
    ${recs.length ? `
    <div class="table-wrap">
      <table class="data lp-table">
        <thead><tr>
          <th>Time</th><th>Post</th><th>Guardian</th><th>Source</th>
          <th class="num">NDSI</th><th class="num">Health</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${recs.map((r) => {
            const so = statusOf(r);
            const h = healthScore(r.quality, s.controlQuality);
            return `<tr>
              <td class="mono">${esc(new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</td>
              <td>${esc(postName(r.postId))}</td>
              <td>${esc(guardianName(r.guardianId))}</td>
              <td>${esc(sourceLabel(r.source))}</td>
              <td class="num">${fmt(r.indices?.ndsi, 2)}</td>
              <td class="num">${Number.isFinite(h) ? h : '-'}</td>
              <td><span class="lp-tag ${so.cls}">${esc(so.text)}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '<p class="muted">No recordings at this site yet today.</p>'}
    <p class="muted small">The site score is the mean quality of trail-post clips divided by the control-post mean (or the site reference ${fmt(s.controlQuality, 2)} if the control post has no clip yet). Rain clips and rejected clips are left out.</p>
  `;
}

function renderAll() {
  if (!root) return;
  renderControls();
  renderResult();
  renderToday();
}

// ---- Recording flow --------------------------------------------------------

function setPhase(text) {
  ui.phase = text;
  if (el.msg) {
    el.msg.textContent = ui.error || text;
    el.msg.classList.toggle('lp-msg-error', !!ui.error);
  }
}

function setProgress(p, seconds) {
  if (!el.progress) return;
  el.progress.hidden = p == null;
  if (p == null) return;
  el.bar.style.width = `${(p * 100).toFixed(1)}%`;
  const left = Math.max(0, Math.ceil(seconds * (1 - p)));
  el.countdown.textContent = `${left} s left`;
}

async function onRecord() {
  if (ui.busy) {
    if (ui.source !== 'file') {
      ui.cancelled = true;
      cancelRecording('Recording stopped before the end. Nothing was saved.');
    }
    return;
  }
  const s = syncSite();
  ui.error = '';
  ui.busy = true;
  ui.cancelled = false;
  const source = ui.source;
  const scene = ui.scene;
  const duration = ui.duration;
  const gpsP = locate();
  renderControls();

  try {
    let spec;
    if (source === 'file') {
      if (!ui.file) throw new Error('Choose an audio file first.');
      setPhase('Decoding and analysing the file...');
      spec = await analyseFile(ui.file);
      specView.showSpec(spec);
    } else {
      specView.clear();
      if (source === 'demo') {
        // A different seed per clip so each demo recording is a fresh soundscape.
        const seed = 8 + recordingsFor(s.id).length;
        setPhase('Preparing sound...');
        const ok = await playScene(scene, { owner: OWNER, seed });
        if (!ok) throw new Error('Another sound source started (Judge mode?). Nothing was saved.');
      } else {
        setPhase('Waiting for microphone permission...');
        const ok = await startMic({ owner: OWNER });
        if (!ok) throw new Error('Another sound source started (Judge mode?). Nothing was saved.');
      }
      if (ui.cancelled) throw new Error('Recording stopped before the end. Nothing was saved.');
      setPhase('Recording. Keep still and quiet.');
      setProgress(0, duration);
      spec = await recordFor(duration, (p) => setProgress(p, duration));
      stop(OWNER);
    }
    setProgress(null);
    setPhase(ui.gps.status === 'pending' ? 'Waiting for GPS...' : 'Scoring...');
    await gpsP;
    finish(s, spec, source === 'demo' ? `scene:${scene}` : source, source === 'file' ? spec.durationSec : duration);
    ui.phase = '';
  } catch (err) {
    stop(OWNER);
    setProgress(null);
    ui.phase = '';
    ui.error = (err && err.message) || String(err);
  } finally {
    ui.busy = false;
    if (root) renderAll();
  }
}

function finish(s, spec, source, durationSec) {
  if (siteById(getCurrentSiteId()).id !== s.id) throw new Error('The site changed during recording. Nothing was saved.');
  const ix = computeIndices(spec);
  if (!ix) throw new Error('The recording was too short to analyse. Nothing was saved.');
  const quality = acousticQuality(ix);
  const health = healthScore(quality, s.controlQuality);

  const earlier = getState().recordings.filter((r) => r.siteId === s.id && Array.isArray(r.fingerprint));
  let dupScore = null;
  for (const r of earlier) {
    const c = cosine(ix.fingerprint, r.fingerprint);
    if (dupScore == null || c > dupScore) dupScore = c;
  }
  const duplicate = dupScore != null && dupScore > DUP_THRESHOLD;

  const post = currentPost(s);
  const gpsInfo = gpsCheck(s);
  const gpsOk = gpsInfo.ok;
  const accepted = !duplicate && (gpsOk || ui.override);
  const guardian = s.guardians.find((g) => g.id === ui.guardianId) || s.guardians[0];
  const g = ui.gps.status === 'ok' ? ui.gps : null;

  const rec = addRecording({
    siteId: s.id,
    postId: post.id,
    guardianId: guardian.id,
    source,
    durationSec: Math.round(durationSec * 10) / 10,
    indices: {
      ndsi: +ix.ndsi.toFixed(4),
      aci: +ix.aci.toFixed(4),
      adi: +ix.adi.toFixed(4),
      bi: +ix.bi.toFixed(2),
      flatness: +ix.flatness.toFixed(4),
      anthroShare: +ix.anthroShare.toFixed(4),
    },
    fingerprint: ix.fingerprint,
    quality: +quality.toFixed(4),
    rain: !!ix.rain,
    gps: g ? {
      lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4),
      accuracyM: Math.round(g.accuracy || 0), distanceM: gpsInfo.distanceM,
    } : null,
    gpsOk,
    gpsOverride: !gpsOk && ui.override,
    duplicate,
    accepted,
    pay: accepted ? PAY : 0,
  });

  ui.result = {
    rec,
    ix,
    health,
    dupScore,
    siteName: s.name,
    postName: post.name,
    isControl: post.control,
    guardianName: guardian.name,
    gpsCheckInfo: gpsInfo,
    controlQuality: s.controlQuality,
  };
}

// ---- View contract -----------------------------------------------------------

export function mount(el0) {
  root = el0;
  syncSite();
  renderShell();
  renderAll();

  bus.addEventListener('site', () => {
    if (ui.busy && ui.source !== 'file') ui.cancelled = true;
    if (ui.busy && ui.source !== 'file') cancelRecording('The site changed during recording. Nothing was saved.');
    syncSite();
    renderAll();
  });
  bus.addEventListener('change', (e) => {
    if (e.detail?.reason === 'reset') ui.result = null;
    if (!ui.busy) renderAll();
    else renderToday();
  });
  engine.addEventListener('state', (e) => {
    if (!ui.busy || ui.source === 'file') return;
    if (e.detail.preparing) setPhase('Preparing sound...');
  });
}

export function show() {
  if (specView && !specView.unfollow) specView.follow();
  renderAll();
}

export function hide() {
  if (ui.busy && ui.source !== 'file') ui.cancelled = true;
  if (ui.busy && ui.source !== 'file') cancelRecording('Recording stopped because you left the Listen tab. Nothing was saved.');
  stop(OWNER);
  specView?.unfollow?.();
  if (specView) specView.unfollow = null;
}
