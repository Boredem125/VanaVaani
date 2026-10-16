// "How it works": the judge-facing explainer. Static apart from a worked
// fee example computed with the app's real pricing rules.

import { siteById } from '../store.js';
import { priceFor, quotaFor, feeSplit } from '../score.js';
import { inr } from '../charts.js';

let root = null;

function moneyExample() {
  const site = siteById('nongriat');
  const score = 60;
  const price = priceFor(site, score);
  const split = feeSplit(site, price);
  return { site, score, price, split, quota: quotaFor(site, score) };
}

export function mount(el) {
  root = el;
  root.classList.add('insights', 'pitch');
  const ex = moneyExample();

  root.innerHTML = `
    <article class="pitch-doc">
      <header class="pitch-hero">
        <span class="eyebrow">How it works</span>
        <h1>Let the forest set the limit.</h1>
        <p class="pitch-lede">VanaVaani turns a minute of birdsong, recorded on a guide's phone, into tomorrow's
        visitor quota and entry fee at a small eco-site, and pays the locals who do the listening.</p>
      </header>

      <section class="pitch-sec">
        <h2><span class="pitch-num">01</span>The problem</h2>
        <p>Small eco-sites in states like Meghalaya, Sikkim and Puducherry now get crowds they were never built for.
        Nongriat's root bridges can see several hundred trekkers on a long weekend, on a trail one village maintains.</p>
        <ul class="pitch-points">
          <li><b>Caps are guesses.</b> Where a limit exists it is a fixed number, set once, blind to whether the forest is coping today.</li>
          <li><b>Damage shows up late.</b> By the time it is visible, birds have left and the trail has eroded.</li>
          <li><b>Locals clean up but earn little.</b> Guides and villagers carry the litter and the noise; the money flows to operators.</li>
        </ul>
      </section>

      <section class="pitch-sec">
        <h2><span class="pitch-num">02</span>The idea</h2>
        <p class="pitch-big">The forest's own sound sets the daily quota and fee, and the surge pays local forest guardians.</p>
        <ol class="flow" aria-label="The VanaVaani loop">
          <li><span class="flow-step">Listen</span><span>A trained local guide records 60 seconds at fixed listening posts, including one off-trail control post.</span></li>
          <li><span class="flow-step">Measure</span><span>The phone computes four ecoacoustic indices and a Forest Health Score from 0 to 100.</span></li>
          <li><span class="flow-step">Decide</span><span>A 3-day average sets tomorrow's quota (full at 85+, down to 25% when critical) and fee.</span></li>
          <li><span class="flow-step">Book</span><span>Visitors book a slot with a QR pass; when the site is stressed they see healthier villages nearby.</span></li>
          <li><span class="flow-step">Pay</span><span>The base fee goes to the village; the surge pays guardians and a restoration fund.</span></li>
        </ol>
      </section>

      <section class="pitch-sec">
        <h2><span class="pitch-num">03</span>The science</h2>
        <p>Soundscape ecology has well-tested indices that track biodiversity and disturbance. We combine four:</p>
        <div class="table-wrap">
          <table class="data pitch-indices">
            <thead><tr><th>Index</th><th>What it measures</th><th>Source</th></tr></thead>
            <tbody>
              <tr><td><b>NDSI</b><br><span class="muted small">Normalized Difference Soundscape Index</span></td>
                <td>Balance of natural sound (2-11 kHz: birds, insects) against human noise (1-2 kHz: voices, engines, speakers).</td>
                <td class="small">Kasten et al. 2012</td></tr>
              <tr><td><b>ACI</b><br><span class="muted small">Acoustic Complexity Index</span></td>
                <td>How much intensity changes from moment to moment, high for birdsong, low for steady hum.</td>
                <td class="small">Pieretti et al. 2011</td></tr>
              <tr><td><b>ADI</b><br><span class="muted small">Acoustic Diversity Index</span></td>
                <td>How evenly sound is spread across frequency bands, a proxy for how many species are calling.</td>
                <td class="small">Villanueva-Rivera et al. 2011</td></tr>
              <tr><td><b>BI</b><br><span class="muted small">Bioacoustic Index</span></td>
                <td>Loudness of the 2-8 kHz band where most birds sing.</td>
                <td class="small">Boelman et al. 2007</td></tr>
            </tbody>
          </table>
        </div>
        <dl class="pitch-dl">
          <dt>Control post</dt>
          <dd>Each site has one post off the trail, in the same forest. The score is trail quality divided by control quality,
          a before-after-control-impact (BACI) style comparison: season, time of day and weather affect both, so what remains is the effect of visitors.</dd>
          <dt>Rain filter</dt>
          <dd>Rain is broadband noise that wrecks every index. Recordings flagged as rain are kept for the record but do not count.</dd>
          <dt>3-day smoothing</dt>
          <dd>Decisions use an exponential moving average over roughly 3 days, so one bad recording cannot swing tomorrow's quota.</dd>
        </dl>
      </section>

      <section class="pitch-sec">
        <h2><span class="pitch-num">04</span>Safeguards</h2>
        <ul class="pitch-points pitch-cols">
          <li><b>GPS lock.</b> A recording only counts if it was made within range of its listening post.</li>
          <li><b>Duplicate check.</b> Each clip gets an acoustic fingerprint; replaying an old recording is rejected.</li>
          <li><b>Rain filter.</b> Weather cannot pass for a crowd, or hide one.</li>
          <li><b>Ground truth.</b> Monthly manual bird counts by guardians and partner naturalists check the scores.</li>
          <li><b>Privacy.</b> Analysis runs on the phone. Raw audio is never uploaded, only the index values.</li>
        </ul>
      </section>

      <section class="pitch-sec">
        <h2><span class="pitch-num">05</span>Where the money goes</h2>
        <div class="money">
          <div class="money-row">
            <span class="money-src">Base fee</span>
            <span class="money-arrow" aria-hidden="true"></span>
            <span class="money-dst"><b>100%</b> village committee</span>
          </div>
          <div class="money-row">
            <span class="money-src">Surge</span>
            <span class="money-arrow" aria-hidden="true"></span>
            <span class="money-dst"><b>70%</b> forest guardians &middot; <b>30%</b> restoration fund</span>
          </div>
        </div>
        <p class="muted">Worked example: ${ex.site.name} at health ${ex.score}. Quota drops to ${ex.quota} of ${ex.site.maxDaily},
        the fee rises from ${inr(ex.site.baseFee)} to ${inr(ex.price)}. Each visitor pays ${inr(ex.split.village)} to the village,
        ${inr(ex.split.guardians)} to guardians and ${inr(ex.split.restoration)} to restoration. Fewer people, same or more money, and the forest gets a rest.</p>
      </section>

      <section class="pitch-sec">
        <h2><span class="pitch-num">06</span>Cost and scale</h2>
        <p><b>&#8377;0 hardware.</b> It runs on the Android phones guides already carry, as a web app that works offline.
        India has more than 1,000 protected areas plus hundreds of community-run eco-sites, sacred groves and wetlands;
        each needs only a few trained guardians and three or four listening posts.</p>
      </section>

      <section class="pitch-sec">
        <h2><span class="pitch-num">07</span>Real vs simulated in this prototype</h2>
        <div class="pitch-real">
          <div>
            <h3>Real</h3>
            <ul>
              <li>Acoustic analysis: FFT and all four indices computed in your browser, from the microphone or an uploaded clip.</li>
              <li>Health score, quota, fee and fee split rules.</li>
              <li>QR passes and gate check.</li>
            </ul>
          </div>
          <div>
            <h3>Simulated <span class="sim-tag">Demo</span></h3>
            <ul>
              <li>30-day site history and the one-year back-test.</li>
              <li>UPI payments and payouts.</li>
              <li>WhatsApp messages.</li>
              <li>Species lists.</li>
            </ul>
          </div>
        </div>
        <h3 class="pitch-road-h">Roadmap</h3>
        <ol class="pitch-road">
          <li>BirdNET species identification on the phone.</li>
          <li>YAMNet alerts for chainsaws and gunshots.</li>
          <li>Real WhatsApp Business booking and UPI payouts.</li>
          <li>A forest-department dashboard across sites.</li>
        </ol>
      </section>
    </article>`;
}

export function show() {}
export function hide() {}
