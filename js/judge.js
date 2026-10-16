// Judge mode: a floating panel for the live finale demo. Play a synthetic
// soundscape (or use the microphone) and watch today's health, tomorrow's
// quota and the fee move in real time for the selected site.

import {
  bus, getCurrentSiteId, siteById, getState, measuredScore, setLive, getLive, resetDemo,
} from './store.js';
import { computeIndices } from './indices.js';
import {
  acousticQuality, healthScore, statusFor, quotaFor, priceFor, smooth,
} from './score.js';
import { SCENES } from './synth.js';
import {
  engine, playScene, startMic, stop, getSpec, setMuted, isMuted, SpectrogramView,
} from './audio.js';

const OWNER = 'judge';
const MIN_FRAMES = 20;
// Seeds picked so each scene reads clearly in a ~4.5 s live window.
const SEEDS = { forest: 8, crowd: 7, rain: 7 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Today's score for a site ignoring any live reading (same rule as siteStatus).
function nonLiveScore(siteId) {
  const hist = getState().history[siteId];
  const last = hist[hist.length - 1];
  const measured = measuredScore(siteId);
  return measured != null ? smooth(last.ema, measured) : last.ema;
}

export function initJudge(fab, panel) {
  if (!fab || !panel) return;

  let siteId = getCurrentSiteId();
  let running = null; // 'forest' | 'crowd' | 'rain' | 'mic' | null
  let preparing = false;
  let message = '';
  let messageIsError = false;
  let reading = null; // last live reading shown
  let rainPaused = false;
  let confirmReset = false;
  let timer = null;
  let specView = null;

  panel.innerHTML = `
    <div class="jd">
      <div class="jd-head">
        <h2 id="jd-title">Judge mode</h2>
        <button type="button" class="btn btn-sm" data-j="close">Close</button>
      </div>
      <p class="muted small">Play a soundscape and watch tomorrow's quota and fee for <strong data-j="site"></strong> respond. Sound is analysed live in this browser.</p>
      <div class="jd-scenes" role="group" aria-label="Soundscape">
        ${Object.entries(SCENES).map(([k, v]) => `<button type="button" class="btn btn-sm jd-scene" data-scene="${k}" aria-pressed="false">${esc(v)}</button>`).join('')}
      </div>
      <div class="jd-actions">
        <button type="button" class="btn btn-sm" data-j="mic" aria-pressed="false">Use microphone</button>
        <button type="button" class="btn btn-sm" data-j="stop">Stop</button>
        <label class="jd-mute small"><input type="checkbox" data-j="mute"> Mute speaker</label>
      </div>
      <p class="jd-status small" data-j="status" role="status" aria-live="polite"></p>
      <canvas class="jd-spec" data-j="canvas" aria-label="Live spectrogram"></canvas>
      <div class="jd-live" data-j="live"></div>
      <p class="muted small">Smoothing off in Judge mode: the live reading replaces today's score directly instead of the 3-day average.</p>
      <div class="jd-reset" data-j="reset"></div>
    </div>
  `;
  panel.setAttribute('aria-labelledby', 'jd-title');
  const $ = (k) => panel.querySelector(`[data-j="${k}"]`);
  const el = {
    close: $('close'), site: $('site'), mic: $('mic'), stop: $('stop'), mute: $('mute'),
    status: $('status'), canvas: $('canvas'), live: $('live'), reset: $('reset'),
  };

  // ---- Open / close ----
  const isOpen = () => !panel.hidden;
  function open() {
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    if (!specView) {
      specView = new SpectrogramView(el.canvas, { colPx: 3 });
      specView.follow();
    }
    specView.schedule();
    render();
    panel.querySelector('.jd-scene')?.focus();
  }
  function close() {
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    confirmReset = false;
  }
  fab.addEventListener('click', () => (isOpen() ? close() : open()));
  el.close.addEventListener('click', () => { close(); fab.focus(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { close(); fab.focus(); }
  });

  // ---- Sound control ----
  function clearLive(id = siteId) {
    if (getLive(id)) setLive(id, null);
  }

  async function startScene(scene) {
    message = '';
    messageIsError = false;
    rainPaused = false;
    running = scene;
    preparing = true;
    render();
    try {
      const ok = await playScene(scene, { owner: OWNER, seed: SEEDS[scene] });
      if (!ok) return;
      preparing = false;
      startTicking();
    } catch (err) {
      fail(err);
    }
    render();
  }

  async function startMicrophone() {
    message = '';
    messageIsError = false;
    rainPaused = false;
    running = 'mic';
    preparing = true;
    render();
    try {
      const ok = await startMic({ owner: OWNER });
      if (!ok) return;
      preparing = false;
      startTicking();
    } catch (err) {
      fail(err);
    }
    render();
  }

  function fail(err) {
    running = null;
    preparing = false;
    message = (err && err.message) || String(err);
    messageIsError = true;
    stopTicking();
    clearLive();
  }

  function stopAll() {
    stop(OWNER);
    running = null;
    preparing = false;
    rainPaused = false;
    reading = null;
    stopTicking();
    clearLive();
    message = 'Stopped. The site is back to its measured score.';
    messageIsError = false;
    render();
  }

  function startTicking() {
    stopTicking();
    timer = setInterval(tick, 500);
  }
  function stopTicking() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function tick() {
    if (!running || preparing) return;
    const spec = getSpec(90);
    if (spec.frames.length < MIN_FRAMES) {
      renderLive();
      return;
    }
    const ix = computeIndices(spec);
    if (!ix) return;
    if (ix.rain) {
      rainPaused = true;
      renderLive();
      return;
    }
    rainPaused = false;
    const site = siteById(siteId);
    const quality = acousticQuality(ix);
    const health = healthScore(quality, site.controlQuality);
    reading = {
      health,
      quality: +quality.toFixed(4),
      indices: {
        ndsi: +ix.ndsi.toFixed(4), aci: +ix.aci.toFixed(4), adi: +ix.adi.toFixed(4),
        bi: +ix.bi.toFixed(2), flatness: +ix.flatness.toFixed(4), anthroShare: +ix.anthroShare.toFixed(4),
      },
      scene: running,
    };
    setLive(siteId, reading);
    renderLive();
  }

  el.mute.addEventListener('change', () => setMuted(el.mute.checked));
  panel.addEventListener('click', (e) => {
    const sceneBtn = e.target.closest('[data-scene]');
    if (sceneBtn) { startScene(sceneBtn.dataset.scene); return; }
    if (e.target.closest('[data-j="mic"]')) { startMicrophone(); return; }
    if (e.target.closest('[data-j="stop"]')) { stopAll(); return; }
    const act = e.target.closest('[data-reset]')?.dataset.reset;
    if (act === 'ask') { confirmReset = true; renderReset(); el.reset.querySelector('[data-reset="cancel"]')?.focus(); }
    else if (act === 'cancel') { confirmReset = false; renderReset(); el.reset.querySelector('[data-reset="ask"]')?.focus(); }
    else if (act === 'yes') {
      confirmReset = false;
      reading = null;
      resetDemo();
      message = 'Demo data reset: history reseeded, today\'s recordings, bookings and passes cleared.';
      messageIsError = false;
      render();
    }
  });

  // Another part of the app (the Listen tab) took over the audio engine.
  engine.addEventListener('state', (e) => {
    const s = e.detail;
    if (running && s.owner !== OWNER) {
      running = null;
      preparing = false;
      reading = null;
      rainPaused = false;
      stopTicking();
      clearLive();
      if (s.owner) {
        message = 'The Listen tab is using the audio now. Judge mode stopped.';
        messageIsError = false;
      }
      render();
    }
  });

  bus.addEventListener('site', () => {
    clearLive(siteId);
    siteId = getCurrentSiteId();
    reading = null;
    render();
  });
  bus.addEventListener('change', () => { if (isOpen()) renderLive(); });

  // ---- Rendering ----
  function renderStatus() {
    let text = message;
    if (!text) {
      if (preparing) text = running === 'mic' ? 'Waiting for microphone permission...' : 'Preparing sound...';
      else if (running === 'mic') text = 'Listening to the microphone.';
      else if (running) text = `Playing: ${SCENES[running]}.`;
      else text = 'Not live. Pick a soundscape to start.';
    }
    el.status.textContent = text;
    el.status.classList.toggle('jd-error', messageIsError);
  }

  function delta(now, before, unit, prefix = '') {
    const d = now - before;
    if (d === 0) return `<span class="jd-delta">same as ${prefix}${before}${unit}</span>`;
    const dir = d > 0 ? 'up' : 'down';
    return `<span class="jd-delta jd-delta-${dir}">${dir} ${prefix}${Math.abs(d)}${unit} from ${prefix}${before}${unit}</span>`;
  }

  function renderLive() {
    const site = siteById(siteId);
    const base = nonLiveScore(siteId);
    const baseQuota = quotaFor(site, base);
    const basePrice = priceFor(site, base);
    const warming = running && !preparing && !reading && !rainPaused;

    if (!reading) {
      el.live.innerHTML = `
        <div class="jd-score">
          <div class="kpi">
            <span class="kpi-label">Score now (not live)</span>
            <span class="jd-big">${base}</span>
          </div>
          <span class="pill pill-${statusFor(base).key}">${esc(statusFor(base).label)}</span>
        </div>
        <div class="jd-kpis">
          <div class="kpi"><span class="kpi-label">Tomorrow's quota</span><span class="kpi-value">${baseQuota}</span></div>
          <div class="kpi"><span class="kpi-label">Fee per person</span><span class="kpi-value">&#8377;${basePrice}</span></div>
        </div>
        ${rainPaused ? '<p class="jd-rain small">Rain detected: reading paused (rain is filtered out).</p>' : ''}
        ${warming ? '<p class="muted small">Listening... first reading in about a second.</p>' : ''}
      `;
      return;
    }
    const h = reading.health;
    const st = statusFor(h);
    const quota = quotaFor(site, h);
    const price = priceFor(site, h);
    const ix = reading.indices;
    el.live.innerHTML = `
      <div class="jd-score">
        <div class="kpi">
          <span class="kpi-label">Live forest health</span>
          <span class="jd-big">${h}</span>
        </div>
        <div class="jd-pills">
          <span class="pill pill-${st.key}">${esc(st.label)}</span>
          ${running ? '<span class="pill pill-live">Live</span>' : ''}
        </div>
      </div>
      <div class="jd-kpis">
        <div class="kpi">
          <span class="kpi-label">Tomorrow's quota</span>
          <span class="kpi-value">${quota}</span>
          <span class="kpi-note">${delta(quota, baseQuota, '')}</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Fee per person</span>
          <span class="kpi-value">&#8377;${price}</span>
          <span class="kpi-note">${delta(price, basePrice, '', '&#8377;')}</span>
        </div>
      </div>
      ${rainPaused ? '<p class="jd-rain small">Rain detected: reading paused (rain is filtered out). Showing the last dry reading.</p>' : ''}
      <p class="mono small muted jd-ix">NDSI ${ix.ndsi.toFixed(2)} &middot; ACI ${ix.aci.toFixed(2)} &middot; ADI ${ix.adi.toFixed(2)} &middot; BI ${Math.round(ix.bi)}</p>
    `;
  }

  function renderReset() {
    el.reset.innerHTML = confirmReset
      ? `<div class="jd-confirm">
          <p class="small"><strong>Reset all demo data?</strong> This reseeds 30 days of history and clears today's recordings, bookings and passes.</p>
          <div class="row">
            <button type="button" class="btn btn-sm btn-danger" data-reset="yes">Yes, reset</button>
            <button type="button" class="btn btn-sm" data-reset="cancel">Cancel</button>
          </div>
        </div>`
      : '<button type="button" class="btn btn-sm" data-reset="ask">Reset demo data</button>';
  }

  function render() {
    el.site.textContent = siteById(siteId).name;
    panel.querySelectorAll('[data-scene]').forEach((b) => {
      b.setAttribute('aria-pressed', String(running === b.dataset.scene));
      b.disabled = preparing;
    });
    el.mic.setAttribute('aria-pressed', String(running === 'mic'));
    el.mic.disabled = preparing;
    el.stop.disabled = !running && !preparing;
    el.mute.checked = isMuted();
    fab.classList.toggle('is-live', !!running);
    fab.textContent = running ? 'Judge mode: live' : 'Judge mode';
    renderStatus();
    renderLive();
    renderReset();
  }

  render();
}
