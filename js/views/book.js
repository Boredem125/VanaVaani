// Book tab: a simulated WhatsApp booking chat. Quota and fee come live from
// the forest health score (store.siteStatus); payment is a simulated UPI sheet;
// the pass is a real HMAC-signed QR that the Gate tab verifies.

import {
  SITES, siteById, siteStatus, addBooking, updateBooking, bookingById, bookingsFor,
  getCurrentSiteId, todayStr, addDays, bus,
} from '../store.js';
import { feeSplit, statusFor, priceFor, quotaFor } from '../score.js';
import { signPass, renderQR } from '../pass.js';
import { openPostcard } from '../postcard.js';

// ---- Strings ---------------------------------------------------------------

const STATUS_HI = { thriving: 'स्वस्थ', stressed: 'दबाव में', critical: 'गंभीर' };

const T = {
  en: {
    chooseSite: 'Which place would you like to visit?',
    siteHint: (name) => `${name} is the site selected at the top of the app.`,
    chooseDate: 'When are you going?',
    today: 'Today',
    tomorrow: 'Tomorrow',
    choosePeople: 'How many people, including you?',
    statusIntro: (site, date) => `Here is the forest reading for ${site} on ${date}:`,
    health: (score) => `Forest health: ${score}/100`,
    slots: (left, quota) => `Visitor slots left: ${left} of ${quota} for the day`,
    fee: (p) => `Entry fee: ₹${p} per person`,
    total: (n, t) => `Total for ${n} ${n === 1 ? 'person' : 'people'}: ₹${t}`,
    splitHead: (p) => `Where each ₹${p} goes:`,
    splitVillage: (v, village) => `₹${v} to ${village}`,
    splitGuard: (g) => `₹${g} to forest guardians (local people who record the forest's sound)`,
    splitRest: (r) => `₹${r} to the restoration fund`,
    stressed: (site, score) => `The forest at ${site} is under stress today (score ${score}/100). Fewer visitors are allowed and the fee is higher. These nearby places are healthier right now:`,
    altLine: (name, km, score, price) => `${name}, ${km} km away: health ${score}/100, ₹${price} per person`,
    bookAnyway: (site) => `Book ${site} anyway`,
    switchTo: (alt) => `Switch to ${alt}`,
    pay: (t) => `Pay ₹${t} with UPI`,
    full: (left, site, date, n) => `Sorry, only ${left} visitor ${left === 1 ? 'slot is' : 'slots are'} left at ${site} for ${date}, and you need ${n}.`,
    fullOptions: 'You can pick another day, a smaller group, or a nearby place.',
    otherDate: 'Try another day',
    smallerGroup: 'Change group size',
    startOver: 'Start over',
    payCancelled: 'Payment cancelled. Nothing was charged. Tap Pay when you are ready.',
    paid: 'Payment received (simulated). Creating your signed entry pass...',
    passTitle: 'Your entry pass',
    passBody: (date) => `Show this QR to the guide at the gate. It works once, on ${date}.`,
    code: 'Booking code',
    date: 'Date',
    people: 'People',
    site: 'Site',
    yourMoney: (t, v, village, g, r) => `Your ₹${t}: ₹${v} to ${village}, ₹${g} to forest guardians, ₹${r} restoration fund.`,
    openGate: 'Open gate scanner',
    postcard: 'Get forest postcard',
    newBooking: 'New booking',
    live: (site, score, price, left) => `Update: a new sound reading just came in for ${site}. Forest health is now ${score}/100, the fee is ₹${price} per person and ${left} slots are left. Here is the new quote.`,
    typed: 'This demo bot understands the buttons only. Please tap one of the replies above.',
    passError: 'Sorry, the pass could not be created. Please start over.',
    statusLabel: (key, label) => label,
  },
  hi: {
    chooseSite: 'आप कौन-सी जगह घूमने जाना चाहेंगे?',
    siteHint: (name) => `ऐप में ऊपर ${name} चुना हुआ है।`,
    chooseDate: 'आप कब जा रहे हैं?',
    today: 'आज',
    tomorrow: 'कल',
    choosePeople: 'आपको मिलाकर कितने लोग जा रहे हैं?',
    statusIntro: (site, date) => `${date} के लिए ${site} के जंगल की स्थिति:`,
    health: (score) => `वन स्वास्थ्य: ${score}/100`,
    slots: (left, quota) => `उस दिन के ${quota} स्लॉट में से ${left} बचे हैं`,
    fee: (p) => `प्रवेश शुल्क: ₹${p} प्रति व्यक्ति`,
    total: (n, t) => `${n} ${n === 1 ? 'व्यक्ति' : 'लोगों'} का कुल: ₹${t}`,
    splitHead: (p) => `हर ₹${p} कहाँ जाता है:`,
    splitVillage: (v, village) => `₹${v} ${village} को`,
    splitGuard: (g) => `₹${g} वन रक्षकों को (स्थानीय लोग जो जंगल की आवाज़ रिकॉर्ड करते हैं)`,
    splitRest: (r) => `₹${r} वन पुनर्स्थापन कोष में`,
    stressed: (site, score) => `आज ${site} का जंगल दबाव में है (स्कोर ${score}/100)। इसलिए कम पर्यटकों को अनुमति है और शुल्क ज़्यादा है। पास की ये जगहें अभी ज़्यादा स्वस्थ हैं:`,
    altLine: (name, km, score, price) => `${name}, ${km} किमी दूर: स्वास्थ्य ${score}/100, ₹${price} प्रति व्यक्ति`,
    bookAnyway: (site) => `फिर भी ${site} बुक करें`,
    switchTo: (alt) => `${alt} चुनें`,
    pay: (t) => `UPI से ₹${t} चुकाएँ`,
    full: (left, site, date, n) => `माफ़ कीजिए, ${date} के लिए ${site} में केवल ${left} स्लॉट बचे हैं, और आपको ${n} चाहिए।`,
    fullOptions: 'आप कोई दूसरा दिन, छोटा समूह या पास की कोई और जगह चुन सकते हैं।',
    otherDate: 'दूसरा दिन चुनें',
    smallerGroup: 'समूह का आकार बदलें',
    startOver: 'फिर से शुरू करें',
    payCancelled: 'भुगतान रद्द हो गया। कोई पैसा नहीं कटा। तैयार हों तो फिर से भुगतान पर टैप करें।',
    paid: 'भुगतान मिल गया (सिम्युलेटेड)। आपका हस्ताक्षरित प्रवेश पास बन रहा है...',
    passTitle: 'आपका प्रवेश पास',
    passBody: (date) => `गेट पर गाइड को यह QR दिखाएँ। यह केवल ${date} को, एक बार मान्य है।`,
    code: 'बुकिंग कोड',
    date: 'तारीख',
    people: 'लोग',
    site: 'जगह',
    yourMoney: (t, v, village, g, r) => `आपके ₹${t} में से: ₹${v} ${village} को, ₹${g} वन रक्षकों को, ₹${r} पुनर्स्थापन कोष में।`,
    openGate: 'गेट स्कैनर खोलें',
    postcard: 'वन पोस्टकार्ड पाएँ',
    newBooking: 'नई बुकिंग',
    live: (site, score, price, left) => `अपडेट: ${site} की नई ध्वनि रीडिंग अभी आई है। वन स्वास्थ्य अब ${score}/100 है, शुल्क ₹${price} प्रति व्यक्ति है और ${left} स्लॉट बचे हैं। नया विवरण यह रहा।`,
    typed: 'यह डेमो बॉट केवल बटन समझता है। कृपया ऊपर दिए गए किसी जवाब पर टैप करें।',
    passError: 'माफ़ कीजिए, पास नहीं बन सका। कृपया फिर से शुरू करें।',
    statusLabel: (key) => STATUS_HI[key] || key,
  },
};

const GREETING = [
  'Namaste! I am the VanaVaani booking assistant. The forest\'s own sound decides how many visitors can come each day and what the entry fee is.',
  'नमस्ते! मैं वनवाणी बुकिंग सहायक हूँ। हर दिन कितने पर्यटक आ सकते हैं और शुल्क कितना होगा, यह जंगल की अपनी आवाज़ तय करती है।',
  'Choose a language / भाषा चुनें',
];

// ---- Module state ----------------------------------------------------------

let root = null;
let logEl = null;
let phoneEl = null;
let inputEl = null;
let sheetEl = null;
let queue = Promise.resolve();
let liveTimer = null;
let session = 0; // bumps on restart so stale async steps stop

const st = {
  lang: 'en',
  step: 'lang',
  siteId: null,
  dateKey: null,
  date: null,
  people: null,
  quote: null, // { siteId, siteName, parentSiteId, price, split, health, statusKey, village }
};

const t = () => T[st.lang];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function h(tag, attrs = {}, ...children) {
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

function clock() {
  return new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

function fmtDate(str, lang = st.lang) {
  const d = new Date(str + 'T12:00:00');
  return d.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function scrollDown() {
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

// ---- Message rendering -----------------------------------------------------

const TICKS = '<svg viewBox="0 0 18 12" aria-hidden="true"><path d="M1 6.5l3 3L10 2.5M7.5 9.5l1 0.5L16.5 2.5"/></svg>';

function bubble(from, content, { extraClass = '' } = {}) {
  const b = h('div', { class: `vv-msg vv-msg-${from} ${extraClass}`.trim() });
  const body = h('div', { class: 'vv-msg-body' });
  if (Array.isArray(content)) {
    for (const line of content) {
      if (line == null) continue;
      body.append(typeof line === 'string' ? h('p', { text: line }) : line);
    }
  } else if (typeof content === 'string') {
    body.append(h('p', { text: content }));
  } else body.append(content);
  const meta = h('span', { class: 'vv-msg-meta' }, clock());
  if (from === 'out') {
    const tick = h('span', { class: 'vv-ticks' });
    tick.innerHTML = TICKS;
    meta.append(tick);
  }
  body.append(meta);
  b.append(body);
  return b;
}

// buttons: [{ label, primary?, run: () => void }]
function quickReplies(buttons) {
  const wrap = h('div', { class: 'vv-quick', role: 'group' });
  const btns = buttons.map((def) => {
    const btn = h('button', { type: 'button', class: 'vv-quick-btn' + (def.primary ? ' is-primary' : '') }, def.label);
    btn.addEventListener('click', () => {
      if (wrap.dataset.used) return;
      wrap.dataset.used = '1';
      btns.forEach((x) => { x.disabled = true; });
      btn.classList.add('is-chosen');
      btn.setAttribute('aria-pressed', 'true');
      if (!def.silent) userSays(def.echo || def.label);
      def.run();
    });
    return btn;
  });
  wrap.append(...btns);
  return wrap;
}

function append(node) {
  logEl.append(node);
  scrollDown();
}

// Queue bot messages with a short typing indicator so they arrive in order.
function bot(content, buttons, opts = {}) {
  const mySession = session;
  queue = queue.then(async () => {
    if (mySession !== session) return;
    const typing = h('div', { class: 'vv-msg vv-msg-in vv-typing', 'aria-hidden': 'true' },
      h('div', { class: 'vv-msg-body' }, h('span'), h('span'), h('span')));
    append(typing);
    await sleep(opts.delay ?? 450);
    typing.remove();
    if (mySession !== session) return;
    const group = h('div', { class: 'vv-turn' });
    group.append(bubble('in', content, opts));
    if (buttons && buttons.length) group.append(quickReplies(buttons));
    append(group);
    if (opts.after) opts.after(group);
  });
  return queue;
}

function userSays(text) {
  append(bubble('out', String(text)));
}

// ---- Flow ------------------------------------------------------------------

function start() {
  session++;
  queue = Promise.resolve();
  closeSheet(false);
  logEl.innerHTML = '';
  Object.assign(st, { lang: 'en', step: 'lang', siteId: null, dateKey: null, date: null, people: null, quote: null });
  append(h('div', { class: 'vv-day', text: 'Today' }));
  append(h('div', { class: 'vv-system', text: 'Simulated chat. No real WhatsApp messages are sent. Payments are simulated; no money moves.' }));
  bot(GREETING, [
    { label: 'English', run: () => { st.lang = 'en'; askSite(); } },
    { label: 'हिंदी (Hindi)', run: () => { st.lang = 'hi'; askSite(); } },
  ], { delay: 300 });
}

function askSite() {
  st.step = 'site';
  const current = getCurrentSiteId();
  const cur = siteById(current);
  bot([t().chooseSite, cur ? t().siteHint(cur.name) : null], SITES.map((s) => ({
    label: s.name,
    primary: s.id === current,
    run: () => { st.siteId = s.id; askDate(); },
  })));
}

function askDate() {
  st.step = 'date';
  const today = todayStr();
  bot(t().chooseDate, [
    { label: `${t().today}, ${fmtDate(today)}`, run: () => { st.dateKey = 'today'; st.date = today; askPeople(); } },
    { label: `${t().tomorrow}, ${fmtDate(addDays(today, 1))}`, run: () => { st.dateKey = 'tomorrow'; st.date = addDays(today, 1); askPeople(); } },
  ]);
}

function askPeople() {
  st.step = 'people';
  bot(t().choosePeople, [1, 2, 4, 6].map((n) => ({ label: String(n), run: () => { st.people = n; quoteMain(); } })));
}

// People already booked for this site on this date (date-specific, so a booking
// for tomorrow does not use up today's slots).
function bookedOn(siteId, date) {
  return bookingsFor(siteId, date).reduce((a, b) => a + (Number(b.people) || 0), 0);
}

function splitLines(price, split, village) {
  const L = t();
  return h('ul', { class: 'vv-split' },
    h('li', { text: L.splitVillage(split.village, village) }),
    h('li', { text: L.splitGuard(split.guardians) }),
    h('li', { text: L.splitRest(split.restoration) }));
}

function quoteBlock(q, left, quota) {
  const L = t();
  const total = q.price * st.people;
  const pillClass = `pill pill-${q.statusKey}`;
  return [
    h('p', { text: L.statusIntro(q.siteName, fmtDate(st.date)) }),
    h('p', { class: 'vv-quote-health' }, h('span', { text: L.health(q.health) }), ' ', h('span', { class: pillClass, text: L.statusLabel(q.statusKey, q.statusLabelEn) })),
    h('p', { text: L.slots(left, quota) }),
    h('p', { text: L.fee(q.price) }),
    h('p', { class: 'vv-quote-total', text: L.total(st.people, total) }),
    h('p', { class: 'vv-split-head', text: L.splitHead(q.price) }),
    splitLines(q.price, q.split, q.village),
  ];
}

function quoteMain() {
  st.step = 'quote';
  const s = siteStatus(st.siteId);
  const site = s.site;
  const q = {
    siteId: site.id,
    siteName: site.name,
    parentSiteId: null,
    price: s.price,
    split: s.split,
    health: s.score,
    statusKey: s.status.key,
    statusLabelEn: s.status.label,
    village: site.village,
  };
  st.quote = q;
  const left = Math.max(0, s.quota - bookedOn(site.id, st.date));
  const L = t();
  const alts = s.alternatives || [];
  const altBtns = alts.map((a) => ({ label: L.switchTo(a.name), run: () => quoteAlt(a) }));

  if (left < st.people) {
    bot(quoteBlock(q, left, s.quota));
    bot([L.full(left, site.name, fmtDate(st.date), st.people), L.fullOptions], [
      { label: L.otherDate, run: askDate },
      { label: L.smallerGroup, run: askPeople },
      ...altsAsFallback(site, alts),
    ]);
    return;
  }
  if (alts.length) {
    bot(quoteBlock(q, left, s.quota));
    const lines = alts.map((a) => h('li', { text: L.altLine(a.name, a.km, a.status.score, a.status.price) }));
    bot([L.stressed(site.name, s.score), h('ul', { class: 'vv-alts' }, ...lines)], [
      { label: L.bookAnyway(site.name), run: () => askPay(q) },
      ...altBtns,
    ]);
    return;
  }
  bot(quoteBlock(q, left, s.quota), payButtons(q));
}

// When the main site is full, offer its alternatives even on a healthy day.
function altsAsFallback(site, shown) {
  const L = t();
  const list = shown.length ? shown : (site.alternatives || []).map((a) => ({
    ...a,
    status: { score: a.seedScore, price: priceFor(a, a.seedScore), quota: quotaFor(a, a.seedScore), status: statusFor(a.seedScore) },
  }));
  return list.map((a) => ({ label: L.switchTo(a.name), run: () => quoteAlt(a) }));
}

function quoteAlt(alt) {
  st.step = 'quote';
  const parent = siteById(st.siteId);
  const price = alt.status.price;
  const status = alt.status.status || statusFor(alt.status.score);
  const q = {
    siteId: alt.id,
    siteName: alt.name,
    parentSiteId: parent.id,
    price,
    split: feeSplit(alt, price),
    health: alt.status.score,
    statusKey: status.key,
    statusLabelEn: status.label,
    village: alt.village || parent.village,
  };
  st.quote = q;
  const quota = alt.status.quota ?? alt.maxDaily;
  const left = Math.max(0, quota - bookedOn(alt.id, st.date));
  if (left < st.people) {
    bot(quoteBlock(q, left, quota));
    bot([t().full(left, alt.name, fmtDate(st.date), st.people), t().fullOptions], [
      { label: t().otherDate, run: askDate },
      { label: t().smallerGroup, run: askPeople },
    ]);
    return;
  }
  bot(quoteBlock(q, left, quota), payButtons(q));
}

function payButtons(q) {
  return [
    { label: t().pay(q.price * st.people), primary: true, run: () => openSheet(q) },
    { label: t().startOver, run: start },
  ];
}

function askPay(q) {
  bot(t().fee(q.price) + ' · ' + t().total(st.people, q.price * st.people), payButtons(q));
}

// ---- Simulated UPI sheet ---------------------------------------------------

let sheetQuote = null;
let sheetOpener = null;

function openSheet(q) {
  st.step = 'pay';
  sheetQuote = q;
  sheetOpener = document.activeElement;
  const total = q.price * st.people;
  sheetEl.innerHTML = '';
  const title = h('h2', { id: 'vv-upi-title', text: 'UPI checkout' });
  const payBtn = h('button', { type: 'button', class: 'btn btn-primary vv-sheet-pay', text: `Pay ₹${total}` });
  const cancelBtn = h('button', { type: 'button', class: 'btn', text: 'Cancel' });
  const status = h('p', { class: 'vv-sheet-status', 'aria-live': 'polite' });
  const panel = h('div', { class: 'vv-sheet-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vv-upi-title' },
    h('div', { class: 'vv-sheet-grab', 'aria-hidden': 'true' }),
    h('div', { class: 'row vv-sheet-head' }, title, h('span', { class: 'sim-tag', text: 'Simulated UPI' })),
    h('p', { class: 'vv-sheet-amount', text: `₹${total}` }),
    h('dl', { class: 'vv-sheet-facts' },
      h('dt', { text: 'Paying to' }), h('dd', { text: 'VanaVaani demo (simulated, no money moves)' }),
      h('dt', { text: 'UPI ID' }), h('dd', { class: 'mono', text: 'demo@vanavaani-sim' }),
      h('dt', { text: 'For' }), h('dd', { text: `${q.siteName}, ${fmtDate(st.date, 'en')}, ${st.people} ${st.people === 1 ? 'person' : 'people'}` })),
    h('p', { class: 'muted small', text: 'This is a mock checkout. No bank, UPI app or card is contacted and no PIN is asked. A real build would hand off to the visitor\'s UPI app.' }),
    status,
    h('div', { class: 'row vv-sheet-actions' }, cancelBtn, payBtn));
  sheetEl.append(panel);
  sheetEl.hidden = false;
  phoneEl.classList.add('has-sheet');
  payBtn.focus();

  cancelBtn.addEventListener('click', () => {
    closeSheet(true);
    bot(t().payCancelled, payButtons(q));
  });
  payBtn.addEventListener('click', async () => {
    const mySession = session;
    payBtn.disabled = true;
    cancelBtn.disabled = true;
    payBtn.innerHTML = '';
    payBtn.append(h('span', { class: 'vv-spinner', 'aria-hidden': 'true' }), 'Processing');
    status.textContent = 'Processing payment (simulated)...';
    await sleep(1200);
    if (mySession !== session) return;
    panel.classList.add('is-done');
    const ok = h('div', { class: 'vv-sheet-ok' });
    ok.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    ok.append(h('span', { text: 'Payment successful (simulated)' }));
    status.replaceChildren(ok);
    payBtn.replaceChildren('Done');
    await sleep(900);
    if (mySession !== session) return;
    closeSheet(false);
    issuePass(sheetQuote);
  });
}

function closeSheet(restoreFocus) {
  if (!sheetEl || sheetEl.hidden) return;
  sheetEl.hidden = true;
  sheetEl.innerHTML = '';
  phoneEl.classList.remove('has-sheet');
  if (restoreFocus && sheetOpener && document.contains(sheetOpener)) sheetOpener.focus();
  else if (inputEl) inputEl.focus({ preventScroll: true });
}

// ---- Booking and pass ------------------------------------------------------

async function issuePass(q) {
  st.step = 'done';
  const mySession = session;
  const total = q.price * st.people;
  userSays(`UPI ₹${total} · demo@vanavaani-sim`);
  bot(t().paid, null, { delay: 300 });
  let booking;
  try {
    booking = addBooking({
      siteId: q.siteId,
      siteName: q.siteName,
      parentSiteId: q.parentSiteId,
      date: st.date,
      people: st.people,
      pricePerHead: q.price,
      total,
      split: { ...q.split },
      lang: st.lang,
      healthAtBooking: q.health,
    });
    const token = await signPass({
      id: booking.id,
      siteId: q.siteId,
      siteName: q.siteName,
      date: st.date,
      people: st.people,
      total,
      iat: Math.floor(Date.now() / 1000),
    });
    updateBooking(booking.id, { token });
  } catch (err) {
    console.error(err);
    bot(t().passError, [{ label: t().startOver, run: start }]);
    return;
  }
  if (mySession !== session) return;
  sendPass(bookingById(booking.id) || booking, q);
}

function sendPass(b, q) {
  const L = t();
  const people = b.people;
  const v = q.split.village * people;
  const g = q.split.guardians * people;
  const r = q.split.restoration * people;
  const qr = h('div', { class: 'vv-pass-qr' });
  const card = h('div', { class: 'vv-pass' },
    h('p', { class: 'vv-pass-title', text: L.passTitle }),
    qr,
    h('p', { class: 'vv-pass-code mono', text: b.id }),
    h('dl', { class: 'vv-pass-facts' },
      h('dt', { text: L.site }), h('dd', { text: b.siteName }),
      h('dt', { text: L.date }), h('dd', { text: fmtDate(b.date) }),
      h('dt', { text: L.people }), h('dd', { text: String(people) })));
  const content = [
    card,
    h('p', { text: L.passBody(fmtDate(b.date)) }),
    h('p', { class: 'vv-money', text: L.yourMoney(b.total, v, q.village, g, r) }),
  ];
  bot(content, [
    { label: L.openGate, primary: true, silent: true, run: () => { location.hash = '#gate'; reenable(); } },
    { label: L.postcard, silent: true, run: () => { openPostcard(bookingById(b.id) || b); reenable(); } },
    { label: L.newBooking, run: () => askSite() },
  ], {
    extraClass: 'vv-msg-pass',
    delay: 600,
    after: (group) => {
      renderQR(qr, b.token, 256);
      lastPassButtons = group.querySelector('.vv-quick');
    },
  });
}

// The pass message's buttons stay usable (gate / postcard can be opened again).
let lastPassButtons = null;
function reenable() {
  const wrap = lastPassButtons;
  if (!wrap) return;
  setTimeout(() => {
    delete wrap.dataset.used;
    wrap.querySelectorAll('button').forEach((b) => { b.disabled = false; b.classList.remove('is-chosen'); b.removeAttribute('aria-pressed'); });
  }, 50);
}

// ---- Live readings (Judge mode) --------------------------------------------

function onLive(e) {
  const id = e.detail && e.detail.siteId;
  if (st.step !== 'quote' || !st.quote || st.quote.parentSiteId || id !== st.siteId) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    if (st.step !== 'quote' || st.quote.parentSiteId) return;
    // Freeze old buttons so the earlier quote cannot be paid at a stale price.
    logEl.querySelectorAll('.vv-quick:not([data-used])').forEach((w) => {
      w.dataset.used = '1';
      w.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    });
    const s = siteStatus(st.siteId);
    const left = Math.max(0, s.quota - bookedOn(st.siteId, st.date));
    bot(t().live(s.site.name, s.score, s.price, left), null);
    quoteMain();
  }, 900);
}

// ---- Typed input -----------------------------------------------------------

function onSend(e) {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  userSays(text);
  if (/^(restart|start over|hi|hello|namaste)$/i.test(text)) { start(); return; }
  const n = parseInt(text, 10);
  if (st.step === 'people' && n >= 1 && n <= 20 && String(n) === text) {
    logEl.querySelectorAll('.vv-quick:not([data-used])').forEach((w) => {
      w.dataset.used = '1';
      w.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    });
    st.people = n;
    quoteMain();
    return;
  }
  bot(t().typed, null, { delay: 350 });
}

// ---- View ------------------------------------------------------------------

export function mount(r) {
  root = r;
  root.innerHTML = '';
  root.classList.add('vv-book-view');

  const head = h('header', { class: 'view-head' },
    h('p', { class: 'eyebrow', text: 'Visitor booking' }),
    h('h1', { text: 'Book on WhatsApp' }),
    h('p', { text: 'Visitors book through a chat they already use. Today\'s quota and fee come straight from the forest health score, and the pass is a signed QR the guide checks at the gate.' }));

  const restart = h('button', { type: 'button', class: 'vv-restart', text: 'Restart chat' });
  restart.addEventListener('click', () => start());

  const avatar = h('span', { class: 'vv-avatar', 'aria-hidden': 'true' });
  avatar.innerHTML = '<svg viewBox="0 0 32 32"><path d="M3 18c3-9 5-9 7 0s4 9 6 0 4-9 6 0 4 9 7 0"/></svg>';
  const chatHead = h('div', { class: 'vv-chat-head' },
    avatar,
    h('div', { class: 'vv-chat-title' },
      h('strong', { text: 'VanaVaani Bookings' }),
      h('span', { class: 'vv-chat-sub', text: 'Business account' })),
    h('span', { class: 'sim-tag vv-chat-sim', text: 'Simulated WhatsApp' }));

  logEl = h('div', { class: 'vv-chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Booking chat' });

  inputEl = h('input', { type: 'text', class: 'vv-chat-input', placeholder: 'Type a message', 'aria-label': 'Type a message', autocomplete: 'off', maxlength: '200' });
  const sendBtn = h('button', { type: 'submit', class: 'vv-chat-send', 'aria-label': 'Send' });
  sendBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20l18-8L3 4v6l12 2-12 2z"/></svg>';
  const form = h('form', { class: 'vv-chat-compose' }, inputEl, sendBtn);
  form.addEventListener('submit', onSend);

  sheetEl = h('div', { class: 'vv-sheet', hidden: true });
  sheetEl.addEventListener('click', (e) => {
    if (e.target === sheetEl && !sheetEl.querySelector('.vv-sheet-pay[disabled]')) {
      closeSheet(true);
      if (sheetQuote) bot(t().payCancelled, payButtons(sheetQuote));
    }
  });
  sheetEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheetEl.querySelector('.vv-sheet-pay[disabled]')) {
      e.stopPropagation();
      closeSheet(true);
      if (sheetQuote) bot(t().payCancelled, payButtons(sheetQuote));
    }
  });

  phoneEl = h('div', { class: 'vv-phone' }, chatHead, logEl, form, sheetEl);

  const phoneCol = h('div', { class: 'vv-phone-col' }, phoneEl, h('div', { class: 'vv-under' }, restart));
  const note = h('aside', { class: 'card vv-book-note', 'aria-label': 'What you are seeing' },
    h('p', { class: 'eyebrow', text: 'What you are seeing' }),
    h('ul', { class: 'stack' },
      h('li', { text: 'A WhatsApp-style booking bot in English or Hindi. No app to install, which matters for domestic tourists on budget phones.' }),
      h('li', { text: 'The quota, fee and fee split are read live from the forest health score. Open Judge mode and stress the forest mid-chat: the bot posts a new quote.' }),
      h('li', { text: 'On a stressed day the bot suggests healthier places nearby, spreading visitors out.' }),
      h('li', { text: 'WhatsApp and UPI are simulated and no money moves. The QR pass is really signed (HMAC-SHA256) and the Gate tab really verifies it, offline.' })));

  root.append(head, h('div', { class: 'vv-book' }, phoneCol, note));
  bus.addEventListener('live', onLive);
  start();
}

export function show() {
  scrollDown();
}

export function hide() {
  clearTimeout(liveTimer);
}
