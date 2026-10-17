/* ─────────────────────────────────────────────
   Visitor analytics — the browser side.

   track(type, props) queues an event; the queue is sent to
   POST /api/analytics/track in small batches:
     • every few seconds while the page is open (fetch, keepalive)
     • right away for shopping actions (add to cart, checkout, purchase)
     • on tab hide / page unload (navigator.sendBeacon)
   A 15s heartbeat measures active time while the tab is visible and the
   visitor has interacted in the last few minutes.

   Identity is the server's HttpOnly tj_vid / tj_sid cookies — this file
   never sees or stores a visitor id. A "tab" is one page load: a random id
   plus a batch counter, which lets the server drop retried batches — and,
   until the first response has set the cookies, lets it keep every request
   of this page load on one visitor.

   Safe to import anywhere: nothing touches window until start().
   ───────────────────────────────────────────── */
const ENDPOINT = '/api/analytics/track';
const FLUSH_MS = 5_000;
const SOON_MS = 400;
/* Heartbeat-only batches wait longer: two beats per request keeps the live
   view within 30s and halves the writes for someone just reading. */
const BEAT_FLUSH_MS = 30_000;
const HEARTBEAT_MS = 15_000;
const IDLE_AFTER_MS = 5 * 60_000;
const MAX_BATCH = 30;
const MAX_QUEUE = 300;
const MAX_ATTEMPTS = 3;
const URGENT = new Set(['page_view', 'add_to_cart', 'checkout_start', 'purchase', 'tryon_open']);

/* 'pending' = collect until we know who the visitor is; 'on' = send;
   'off' = staff, seller, automation — drop everything. */
let mode = 'pending';
let started = false;
let tab = '';
let seq = 0;
let batchNo = 0;
let queue = [];
let inflight = null; // { body, attempts }
/* Heartbeat seconds sent since the last final batch: when the tab hides,
   a final batch must follow so the server books them. */
let beatsSinceFinal = false;
let retryBatch = null;
let flushTimer = null;
let flushDue = 0;
let beatTimer = null;
let getCart = () => null;
let firstPageView = true;
let activeMs = 0;
let visibleSince = 0;
let lastInteraction = 0;

const now = () => Date.now();
const randomTab = () => {
  try {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => (b % 36).toString(36)).join('');
  } catch {
    return (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/g, '').padEnd(16, '0').slice(0, 16);
  }
};

/** True for automation and headless browsers (they'd inflate every number). */
export function isAutomated() {
  if (typeof navigator === 'undefined') return true;
  if (navigator.webdriver) return true;
  return /HeadlessChrome|PhantomJS|Lighthouse|Chrome-Lighthouse/i.test(navigator.userAgent || '');
}

/* Staff and seller areas, including the staff sign-in page. */
const staffPath = (p) => /^\/(admin|vendor|admin-portal)(\/|$)/.test(p || '');

/* ── Active time ── */
const idle = () => now() - lastInteraction >= IDLE_AFTER_MS;
/* Called on every beat and when the tab hides (visibilityState already
   says "hidden" by then, so visibleSince is what tells us it was showing). */
function takeActiveSeconds() {
  if (visibleSince && !idle()) activeMs += now() - visibleSince;
  visibleSince = document.visibilityState === 'visible' ? now() : 0;
  const s = Math.min(30, Math.round(activeMs / 1000));
  activeMs = 0;
  return s;
}
function beat() {
  if (mode === 'off') return;
  const active = takeActiveSeconds();
  /* An idle open tab is not a live visitor. */
  /* The page rides along, so a tab resumed after a long pause still shows
     where the shopper is. */
  if (active > 0) push({ type: 'heartbeat', active, path: window.location.pathname.slice(0, 300) });
}

/* ── Queue & send ── */
function push(event) {
  if (mode === 'off') return;
  if (typeof window !== 'undefined' && staffPath(window.location.pathname)) return;
  queue.push({ ...event, seq: seq++ });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  if (mode === 'on') schedule(URGENT.has(event.type) ? SOON_MS : event.type === 'heartbeat' ? BEAT_FLUSH_MS : FLUSH_MS);
}

function schedule(ms) {
  if (!started || mode !== 'on') return;
  if (flushTimer) {
    if (now() + ms >= flushDue) return; // already due sooner
    clearTimeout(flushTimer);
  }
  flushDue = now() + ms;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, ms);
}

function cartSnapshot() {
  try {
    const items = getCart();
    if (!Array.isArray(items)) return undefined;
    return {
      items: items.slice(0, 30).map((i) => ({
        id: String(i._id || i.id || '').slice(0, 64),
        name: String(i.name || '').slice(0, 120),
        qty: Math.max(1, Math.min(99, Math.round(Number(i.quantity) || 1))),
        price: Math.max(0, Number(i.discountPrice || i.price) || 0),
      })).filter((i) => /^[A-Za-z0-9_-]{1,64}$/.test(i.id)),
    };
  } catch {
    return undefined;
  }
}

function nextBody(final = false) {
  if (!queue.length) return null;
  const events = queue.splice(0, MAX_BATCH);
  if (final) beatsSinceFinal = false;
  else if (events.some((e) => e.type === 'heartbeat' && e.active > 0)) beatsSinceFinal = true;
  return JSON.stringify({ tab, n: batchNo++, ...(final && { final: true }), cart: cartSnapshot(), events });
}

async function flush() {
  if (mode !== 'on' || inflight) return;
  /* Sent from a hidden tab (e.g. the answer to an earlier request came back
     after the shopper switched away): the visit may be over — final. */
  const body = retryBatch?.body || nextBody(document.visibilityState === 'hidden');
  if (!body) return;
  inflight = { body, attempts: (retryBatch?.attempts || 0) + 1 };
  retryBatch = null;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      body,
      keepalive: body.length < 60_000,
      credentials: 'same-origin',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
    });
    /* 429 / 5xx: try the same batch again later (same id → no double count). */
    if ((res.status === 429 || res.status >= 500) && inflight.attempts < MAX_ATTEMPTS) retryBatch = inflight;
  } catch {
    if (inflight.attempts < MAX_ATTEMPTS) retryBatch = inflight;
  } finally {
    inflight = null;
  }
  if (queue.length || retryBatch) schedule(retryBatch ? FLUSH_MS * 2 : SOON_MS);
}

/** Page is going away (or to the background): send everything now.
 *  Also while the sign-in check is still loading — the server drops staff
 *  and sellers itself, and these are exactly the quick-bounce visits. A
 *  beacon sent before the first response has set the cookies is fine: the
 *  server keeps every request of this page load (same tab id) on one visitor. */
function flushOnHide() {
  if (mode === 'off') return;
  beat();
  /* Nothing new to say, but heartbeat seconds were sent since the last
     final batch: say "final" so the server books them for the day. */
  if (!queue.length && beatsSinceFinal) {
    queue.push({ type: 'heartbeat', active: 0, path: window.location.pathname.slice(0, 300), seq: seq++ });
  }
  const bodies = [];
  if (retryBatch) { bodies.push(retryBatch.body); retryBatch = null; }
  let b;
  while ((b = nextBody(true))) bodies.push(b);
  for (const body of bodies) {
    let sent = false;
    try {
      sent = navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' })) || false;
    } catch { /* fall through */ }
    if (!sent) {
      try { fetch(ENDPOINT, { method: 'POST', body, keepalive: true, credentials: 'same-origin', headers: { 'content-type': 'text/plain;charset=UTF-8' } }).catch(() => {}); } catch { /* ignore */ }
    }
  }
}

/* ── Public API ── */

/**
 * Starts the tracker once per page load. `cart` returns the current cart
 * items (CartContext) so each batch carries a snapshot for live cart
 * abandonment.
 */
export function start({ cart } = {}) {
  if (typeof cart === 'function') getCart = cart;
  if (started || typeof window === 'undefined') return;
  started = true;
  if (isAutomated()) { setMode('off'); return; }
  tab = randomTab();
  lastInteraction = now();
  visibleSince = document.visibilityState === 'visible' ? now() : 0;

  /* Back from idle: active time restarts now, not from when they left. */
  const touch = () => {
    if (idle() && document.visibilityState === 'visible') visibleSince = now();
    lastInteraction = now();
  };
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove']) {
    window.addEventListener(ev, touch, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide();
    else {
      visibleSince = now();
      lastInteraction = now();
      if (queue.length) schedule(SOON_MS);
    }
  });
  window.addEventListener('pagehide', flushOnHide);
  beatTimer = setInterval(beat, HEARTBEAT_MS);
}

/** 'on' once we know this is a shopper; 'off' for staff/sellers/automation. */
export function setMode(next) {
  /* Automation stays off whatever the page decides once the session loads. */
  if (next === 'on' && isAutomated()) next = 'off';
  if (next === mode) return;
  mode = next;
  if (mode === 'off') {
    queue = [];
    retryBatch = null;
    if (flushTimer) clearTimeout(flushTimer);
    if (beatTimer) clearInterval(beatTimer);
    flushTimer = null;
    beatTimer = null;
  } else if (mode === 'on' && queue.length) {
    schedule(SOON_MS);
  }
}

/** Queue one event (see src/lib/analytics/events.js for the fields). */
export function track(type, props = {}) {
  if (typeof window === 'undefined') return;
  push({ type, ...props });
}

/** A page view: referrer, UTM tags and ad click ids ride on it. */
export function trackPageView(path) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const q = url.searchParams;
  const utm = {};
  for (const k of ['source', 'medium', 'campaign', 'content', 'term']) {
    const v = q.get(`utm_${k}`);
    if (v) utm[k] = v.slice(0, 100);
  }
  const event = { type: 'page_view', path: String(path || url.pathname).slice(0, 300) };
  if (Object.keys(utm).length) event.utm = utm;
  const clickIds = {};
  if (q.has('gclid') || q.has('gbraid') || q.has('wbraid')) clickIds.gclid = true;
  if (q.has('fbclid')) clickIds.fbclid = true;
  if (Object.keys(clickIds).length) event.clickIds = clickIds;
  /* Only the first page of a page load has a meaningful external referrer. */
  if (firstPageView && document.referrer) event.referrer = document.referrer.slice(0, 500);
  firstPageView = false;
  push(event);
}

/** Test hook: back to a fresh state. */
export function _reset() {
  mode = 'pending'; started = false; tab = ''; seq = 0; batchNo = 0; queue = []; inflight = null; retryBatch = null; beatsSinceFinal = false;
  if (flushTimer) clearTimeout(flushTimer);
  if (beatTimer) clearInterval(beatTimer);
  flushTimer = null; beatTimer = null; getCart = () => null; firstPageView = true; activeMs = 0; visibleSince = 0; lastInteraction = 0;
}
