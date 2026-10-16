// Signed entry passes: "VV1.<base64url(JSON payload)>.<base64url(16-byte HMAC-SHA256 tag)>".
// The gate verifies offline: no network needed at the trail head.
//
// DEMO ONLY: the key is hard-coded so the Book and Gate tabs can share it in one
// static page. In production the pass is signed server-side (key never ships to
// the browser) and guides verify with an Ed25519 public key instead.

const DEMO_KEY = 'vanavaani-demo-key-2026-not-a-secret';
const PREFIX = 'VV1';
const TAG_BYTES = 16;

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlFromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- Pure-JS SHA-256 / HMAC fallback --------------------------------------
// crypto.subtle only exists in secure contexts (https or localhost). If the demo
// is opened over plain http on a LAN IP, fall back to this; output is identical.

let K256 = null;
let H256 = null;
function initConstants() {
  K256 = [];
  H256 = [];
  let n = 2;
  let c = 0;
  while (c < 64) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) {
      if (c < 8) H256[c] = (Math.pow(n, 1 / 2) * 4294967296) | 0;
      K256[c] = (Math.pow(n, 1 / 3) * 4294967296) | 0;
      c++;
    }
    n++;
  }
}

function sha256(msg) {
  if (!K256) initConstants();
  const rotr = (x, r) => (x >>> r) | (x << (32 - r));
  const len = msg.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const bitsHi = Math.floor(len / 0x20000000);
  const bitsLo = (len << 3) >>> 0;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bitsHi);
  dv.setUint32(total - 4, bitsLo);
  const H = H256.slice();
  const w = new Int32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  H.forEach((v, i) => odv.setInt32(i * 4, v));
  return out;
}

function hmacSha256Js(keyBytes, msgBytes) {
  let key = keyBytes.length > 64 ? sha256(keyBytes) : keyBytes;
  const k = new Uint8Array(64);
  k.set(key);
  const inner = new Uint8Array(64 + msgBytes.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { inner[i] = k[i] ^ 0x36; outer[i] = k[i] ^ 0x5c; }
  inner.set(msgBytes, 64);
  outer.set(sha256(inner), 64);
  key = null;
  return sha256(outer);
}

// ---- HMAC via WebCrypto when available -------------------------------------

let keyPromise = null;
function subtle() {
  return (globalThis.crypto && globalThis.crypto.subtle) || null;
}

async function hmac(msgBytes) {
  const s = subtle();
  if (s) {
    try {
      if (!keyPromise) {
        keyPromise = s.importKey('raw', enc.encode(DEMO_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      }
      const key = await keyPromise;
      return new Uint8Array(await s.sign('HMAC', key, msgBytes));
    } catch {
      keyPromise = null; // fall through to the JS implementation
    }
  }
  return hmacSha256Js(enc.encode(DEMO_KEY), msgBytes);
}

async function tagFor(body) {
  const full = await hmac(enc.encode(PREFIX + '.' + body));
  return b64urlFromBytes(full.slice(0, TAG_BYTES));
}

// payload: { id, siteId, siteName, date, people, total, iat }
export async function signPass(payload) {
  const clean = {
    id: payload.id,
    siteId: payload.siteId,
    siteName: payload.siteName,
    date: payload.date,
    people: payload.people,
    total: payload.total,
    iat: payload.iat ?? Math.floor(Date.now() / 1000),
  };
  const body = b64urlFromBytes(enc.encode(JSON.stringify(clean)));
  return `${PREFIX}.${body}.${await tagFor(body)}`;
}

// Returns { ok, payload, reason } where reason is null, 'format' or 'signature'.
export async function verifyPass(token) {
  const t = String(token || '').replace(/\s+/g, '');
  const parts = t.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) {
    return { ok: false, payload: null, reason: 'format' };
  }
  let payload = null;
  try {
    payload = JSON.parse(dec.decode(bytesFromB64url(parts[1])));
  } catch {
    return { ok: false, payload: null, reason: 'format' };
  }
  if (!payload || typeof payload !== 'object' || !payload.id || !payload.date) {
    return { ok: false, payload: null, reason: 'format' };
  }
  const expected = await tagFor(parts[1]);
  // Constant-time compare of the two tags.
  let diff = expected.length ^ parts[2].length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (parts[2].charCodeAt(i) || 0);
  if (diff !== 0) return { ok: false, payload, reason: 'signature' };
  return { ok: true, payload, reason: null };
}

// Draws the token as a QR code into `el`. Always dark ink on white with a quiet
// zone (padding comes from .vv-qr in book.css) so phones scan it in dark mode too.
export function renderQR(el, token, size = 220) {
  el.innerHTML = '';
  el.classList.add('vv-qr');
  if (typeof QRCode === 'undefined') {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'QR library did not load. Use the booking code at the gate instead.';
    el.appendChild(p);
    return;
  }
  // eslint-disable-next-line no-new
  new QRCode(el, {
    text: token,
    width: size,
    height: size,
    colorDark: '#0b1a12',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Entry pass QR code');
  // qrcodejs sets a title attribute with the raw token; drop it to avoid a huge tooltip.
  el.removeAttribute('title');
}
