// Guardians tab: payout ledger for the current site's forest guardians.

import {
  bus, siteStatus, recordingsFor, bookingsFor, getCurrentSiteId,
} from '../store.js';
import { inr, esc, debounce, toast } from '../charts.js';

const PER_RECORDING = 15;
const BONUS = 500;

let root = null;
let visible = false;
let dirty = true;

const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);

export function ledgerFor(siteId) {
  const st = siteStatus(siteId);
  const { site, history } = st;
  const n = Math.max(1, site.guardians.length);
  const recs = recordingsFor(siteId);
  const bookings = bookingsFor(siteId);
  const surgePool = sum(bookings, (b) => (b.split?.guardians || 0) * (b.people || 0));
  const hist30 = sum(history, (r) => r.guardianIncome);
  const last7 = mean(history.slice(-7).map((r) => r.score));
  const prev7 = mean(history.slice(-14, -7).map((r) => r.score));
  const improved = last7 > prev7;

  const rows = site.guardians.map((g) => {
    const mine = recs.filter((r) => r.guardianId === g.id && r.accepted);
    const recPay = sum(mine, (r) => (r.pay != null ? r.pay : PER_RECORDING));
    const surge = surgePool / n;
    const seeded = hist30 / n;
    const bonus = improved ? BONUS : 0;
    return {
      guardian: g, recCount: mine.length, recPay, surge, seeded, bonus,
      total: recPay + surge + seeded + bonus,
    };
  });

  return {
    st, rows, improved, last7, prev7, surgePool,
    village30: sum(history, (r) => r.villageIncome),
    guardians30: hist30,
    restoration30: sum(history, (r) => r.restorationFund),
    total: sum(rows, (r) => r.total),
  };
}

function render() {
  if (!root) return;
  const L = ledgerFor(getCurrentSiteId());
  const { site } = L.st;

  root.innerHTML = `
    <header class="view-head">
      <span class="eyebrow">Guardians &middot; ${esc(site.village)}</span>
      <h1>Who gets paid at ${esc(site.name)}</h1>
      <p>Forest guardians are local guides who record at the listening posts. When the forest is stressed the
      fee goes up, and most of that surge goes to them.</p>
    </header>

    <div class="g-kpis">
      <div class="kpi card flat">
        <span class="kpi-label">Village committee, last 30 days</span>
        <span class="kpi-value">${inr(L.village30)}</span>
        <span class="kpi-note">base fee on every ticket</span>
      </div>
      <div class="kpi card flat">
        <span class="kpi-label">Guardians, last 30 days</span>
        <span class="kpi-value">${inr(L.guardians30)}</span>
        <span class="kpi-note">70% of surge, ${site.guardians.length} guardians</span>
      </div>
      <div class="kpi card flat">
        <span class="kpi-label">Restoration fund, last 30 days</span>
        <span class="kpi-value">${inr(L.restoration30)}</span>
        <span class="kpi-note">30% of surge</span>
      </div>
    </div>

    <ol class="g-rules">
      <li><b class="mono">${inr(PER_RECORDING)}</b> for every verified recording (GPS-locked, not a duplicate).</li>
      <li><b class="mono">70%</b> of the surge on every ticket is split equally among the site's guardians.</li>
      <li><b class="mono">${inr(BONUS)}</b> monthly bonus each when the forest's health improves.</li>
    </ol>

    <section class="card">
      <div class="card-head">
        <h2>Payout ledger</h2>
        <span class="sim-tag">Seeded history + this session</span>
      </div>
      <div class="table-wrap">
        <table class="data g-ledger">
          <thead>
            <tr>
              <th>Guardian</th>
              <th class="num">Recordings today</th>
              <th class="num">Surge share</th>
              <th class="num">Last 30 days</th>
              <th class="num">Bonus</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            ${L.rows.map((r) => `
              <tr>
                <td>${esc(r.guardian.name)}</td>
                <td class="num">${r.recCount} &middot; ${inr(r.recPay)}</td>
                <td class="num">${inr(r.surge)}</td>
                <td class="num">${inr(r.seeded)}</td>
                <td class="num">${r.bonus ? inr(r.bonus) : '&ndash;'}</td>
                <td class="num"><b>${inr(r.total)}</b></td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr><td colspan="5">Total to guardians</td><td class="num"><b>${inr(L.total)}</b></td></tr>
          </tfoot>
        </table>
      </div>
      <p class="small muted g-bonus-note">
        Health bonus: last 7 days averaged <b class="mono">${L.last7.toFixed(1)}</b> vs
        <b class="mono">${L.prev7.toFixed(1)}</b> the week before,
        ${L.improved ? 'so the bonus is earned this month.' : 'so no bonus yet this month.'}
        Surge share comes from ${bookingsFor(site.id).length} booking(s) made in this demo.
      </p>
      <div class="row g-actions">
        <button type="button" class="btn btn-primary" data-act="pay">Send payouts via UPI (simulated)</button>
        <span class="sim-tag">Simulated</span>
      </div>
    </section>
  `;
  root.querySelector('[data-act="pay"]').addEventListener('click', () => toast('Payouts queued (simulated)'));
  dirty = false;
}

const soon = debounce(() => { if (visible) render(); else dirty = true; }, 100);

export function mount(el) {
  root = el;
  root.classList.add('insights', 'guardians');
  bus.addEventListener('change', soon);
  bus.addEventListener('site', soon);
}

export function show() {
  visible = true;
  if (dirty) render();
}

export function hide() {
  visible = false;
}
