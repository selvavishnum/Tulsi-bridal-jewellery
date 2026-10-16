/* ─────────────────────────────────────────────
   Visitor analytics — the browser tracker (src/lib/analytics/tracker.js)
   in a minimal fake browser (window / document / navigator / fetch /
   sendBeacon) with mocked timers. The main point: whatever the tracker
   sends must pass the server's parseBatch unchanged, and retries must
   re-send the same (tab, n) so the server can drop duplicates.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '@/lib/analytics/tracker';
import { parseBatch } from '@/lib/analytics/events';

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const env = {};
const realFetch = globalThis.fetch;
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function installBrowser({ href = 'https://tulsi.test/', referrer = '', ua = UA, webdriver = false } = {}) {
  Object.assign(env, { listeners: { window: {}, document: {} }, visibility: 'visible', beacons: [], fetches: [], fetchStatus: 204 });
  const url = new URL(href);
  globalThis.window = {
    location: { href, pathname: url.pathname },
    addEventListener: (t, fn) => { (env.listeners.window[t] ||= []).push(fn); },
  };
  globalThis.document = {
    get visibilityState() { return env.visibility; },
    referrer,
    addEventListener: (t, fn) => { (env.listeners.document[t] ||= []).push(fn); },
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, writable: true,
    value: { userAgent: ua, webdriver, sendBeacon: (u, blob) => { env.beacons.push({ url: u, blob }); return true; } },
  });
  globalThis.fetch = async (u, init) => { env.fetches.push({ url: u, ...init }); return { status: env.fetchStatus }; };
}
const navigate = (href) => { window.location.href = href; window.location.pathname = new URL(href).pathname; };
const fire = (target, type) => { for (const fn of env.listeners[target][type] || []) fn(); };
const settle = () => new Promise((r) => setImmediate(r));
const sent = () => env.fetches.map((f) => JSON.parse(f.body));
const beaconed = () => Promise.all(env.beacons.map(async (b) => JSON.parse(await b.blob.text())));
async function tick(ms) { mock.timers.tick(ms); await settle(); await settle(); }

/** The server accepts it as-is: every event survives parseBatch. */
function assertAccepted(body) {
  const r = parseBatch(body);
  assert.ok(r.batch, `server would reject: ${r.error} ${JSON.stringify(body)}`);
  assert.equal(r.batch.events.length, body.events.length, 'no event dropped by the server schema');
  return r.batch;
}

beforeEach(() => {
  T._reset();
  installBrowser();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.parse('2026-10-16T08:00:00Z') });
});
afterEach(() => {
  T._reset();
  mock.timers.reset();
  globalThis.fetch = realFetch;
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  delete globalThis.window;
  delete globalThis.document;
});

test('tracker: events wait while the mode is pending, then go out in a batch the server accepts', async () => {
  installBrowser({ href: 'https://tulsi.test/?utm_source=ig&utm_medium=story&utm_campaign=diwali&gclid=abc&fbclid=def&other=1', referrer: 'https://www.google.com/' });
  T.start({ cart: () => [] });
  T.trackPageView();
  await tick(10_000);
  assert.equal(env.fetches.length, 0, 'nothing sent before we know it is a shopper');
  T.setMode('on');
  await tick(400);
  assert.equal(env.fetches.length, 1);
  const f = env.fetches[0];
  assert.deepEqual([f.url, f.method, f.keepalive, f.credentials, f.headers['content-type']], ['/api/analytics/track', 'POST', true, 'same-origin', 'text/plain;charset=UTF-8']);
  const body = sent()[0];
  assert.match(body.tab, /^[a-z0-9]{4,16}$/);
  assert.equal(body.n, 0);
  assert.deepEqual(body.cart, { items: [] });
  assert.deepEqual(body.events, [{
    type: 'page_view', path: '/', seq: 0, referrer: 'https://www.google.com/',
    utm: { source: 'ig', medium: 'story', campaign: 'diwali' }, clickIds: { gclid: true, fbclid: true },
  }]);
  assertAccepted(body);
});

test('tracker: only the first page of a page load carries the referrer; batches number up, seq keeps rising', async () => {
  installBrowser({ href: 'https://tulsi.test/', referrer: 'https://www.instagram.com/' });
  T.start();
  T.setMode('on');
  T.trackPageView();
  await tick(400);
  navigate('https://tulsi.test/product/p1');
  T.trackPageView('/product/p1');
  T.track('product_view', { productId: 'p1' });
  T.track('add_to_cart', { productId: 'p1', qty: 1 });
  await tick(400);
  const [a, b] = sent();
  assert.equal(a.events[0].referrer, 'https://www.instagram.com/');
  assert.equal(b.events[0].referrer, undefined);
  assert.equal(b.events[0].utm, undefined);
  assert.deepEqual([a.n, b.n], [0, 1]);
  assert.equal(a.tab, b.tab, 'one tab per page load');
  assert.deepEqual(b.events.map((e) => e.seq), [1, 2, 3]);
  for (const body of sent()) assertAccepted(body);
});

test('tracker: the cart snapshot matches the server schema (ids, quantities, prices clamped)', async () => {
  T.start({
    cart: () => [
      { _id: 'p1', name: 'Temple Jhumka', quantity: 2, price: 2000, discountPrice: 1500 },
      { id: 'p2', name: 'K'.repeat(300), quantity: 150, price: 999 },
      { id: 'bad/id', name: 'x', quantity: 1, price: 1 },
      { id: 'p3', quantity: 0, price: -5 },
    ],
  });
  T.setMode('on');
  T.track('add_to_cart', { productId: 'p1', qty: 1 });
  await tick(400);
  const body = sent()[0];
  assert.deepEqual(body.cart.items.map((i) => [i.id, i.qty, i.price, i.name.length]), [['p1', 2, 1500, 13], ['p2', 99, 999, 120], ['p3', 1, 0, 0]]);
  assertAccepted(body);
});

test('tracker: 15 s heartbeats while visible and active; none once idle for 5 minutes', async () => {
  T.start();
  T.setMode('on');
  const beats = () => sent().flatMap((b) => b.events).filter((e) => e.type === 'heartbeat');
  /* Step the clock beat by beat (a mocked tick jumps the clock first). */
  for (let t = 0; t < 600; t += 15) await tick(15_000); // ten minutes, nobody touches the page
  assert.equal(beats().length, 19, 'one per 15 s until 5 minutes without interaction');
  assert.ok(beats().every((e) => e.active === 15), JSON.stringify(beats()));
  assert.ok(sent().length < 19, 'heartbeat-only batches are grouped');
  for (const body of sent()) assertAccepted(body);

  const before = env.fetches.length;
  for (let i = 0; i < 4; i += 1) await tick(15_000);
  assert.equal(env.fetches.length, before, 'an idle open tab is not a live visitor');
  fire('window', 'pointerdown');
  for (let i = 0; i < 4; i += 1) await tick(15_000);
  assert.ok(beats().length > 19, 'back after an interaction');
  assert.equal(beats().at(-1).active, 15, 'idle time is not counted as active');
});

test('tracker: a 429 or a network error re-sends the very same batch (same tab and n), at most 3 times', async () => {
  T.start();
  T.setMode('on');
  env.fetchStatus = 429;
  T.track('checkout_start');
  await tick(400);
  await tick(10_000);
  await tick(10_000);
  await tick(60_000);
  const first = env.fetches[0].body;
  assert.deepEqual(JSON.parse(first).events.map((e) => e.type), ['checkout_start']);
  assert.equal(env.fetches.filter((f) => f.body === first).length, 3, 'tried 3 times with an identical body → the server drops duplicates');
  env.fetchStatus = 204;
  T.track('add_to_cart', { productId: 'p1', qty: 1 });
  for (let i = 0; i < 5; i += 1) await tick(400); // a pending retry goes first, then the queue
  const later = env.fetches.filter((f) => f.body !== first).map((f) => JSON.parse(f.body));
  assert.ok(later.length >= 1);
  assert.ok(later.every((b) => b.n > 0), 'later batches get new numbers');
  assert.ok(later.some((b) => b.events.some((e) => e.type === 'add_to_cart')));
});

test('tracker: going to the background flushes everything by sendBeacon, ≤ 30 events per batch', async () => {
  T.start();
  T.setMode('on');
  for (let i = 0; i < 45; i += 1) T.track('tryon_tone', { tone: 'fair' });
  env.visibility = 'hidden';
  fire('document', 'visibilitychange');
  const bodies = await beaconed();
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies.map((b) => b.events.length), [30, 15]);
  assert.deepEqual(bodies.map((b) => b.n), [0, 1]);
  assert.equal(env.beacons[0].url, '/api/analytics/track');
  assert.equal(env.beacons[0].blob.type, 'text/plain;charset=utf-8');
  for (const b of bodies) assertAccepted(b);
});

test('tracker: staff/seller pages, mode off and automation send nothing', async () => {
  installBrowser({ href: 'https://tulsi.test/admin/analytics' });
  T.start();
  T.setMode('on');
  T.trackPageView();
  T.track('add_to_cart', { productId: 'p1', qty: 1 });
  fire('window', 'pagehide');
  await tick(60_000);
  assert.deepEqual([env.fetches.length, env.beacons.length], [0, 0], '/admin is never tracked');

  T._reset();
  installBrowser();
  T.start();
  T.track('page_view', { path: '/' });
  T.setMode('off');
  T.track('add_to_cart', { productId: 'p1', qty: 1 });
  fire('window', 'pagehide');
  await tick(60_000);
  assert.deepEqual([env.fetches.length, env.beacons.length], [0, 0], 'off drops the queue and stops the heartbeat');

  T._reset();
  installBrowser({ webdriver: true });
  assert.equal(T.isAutomated(), true);
  /* TrackingProvider's order: start(), then setMode('on') once the
     (guest) session resolves — that must not switch automation back on. */
  T.start();
  T.setMode('on');
  T.trackPageView();
  await tick(60_000);
  fire('window', 'pagehide');
  assert.equal(env.fetches.length + env.beacons.length, 0, 'navigator.webdriver');

  installBrowser({ ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36' });
  assert.equal(T.isAutomated(), true);
});

test('tracker: safe to import and call on the server (no window)', () => {
  delete globalThis.window;
  T.track('page_view', { path: '/' });
  T.trackPageView('/');
  T.start();
  assert.ok(true, 'no throw');
});
