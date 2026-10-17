/* ─────────────────────────────────────────────
   Visitor analytics — pins for the review fixes in the browser tracker
   and the two route handlers:
     • tracker (src/lib/analytics/tracker.js) in a minimal fake browser with
       a fetch that can be held in flight, and mocked timers
     • POST /api/analytics/track — 503 on transient storage errors, the
       IPv6 /64 rate-limit bucket
     • GET /api/admin/analytics — carts in the live block, per-instance
       caching with shared in-flight computations, failures not cached
   The route handlers are the real ones; only NextAuth and Firestore (an
   instrumented in-memory fake) are swapped out, as in
   analytics-routes.test.mjs.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore, INC } from './helpers/fakeFirestore.mjs';

process.env.ADMIN_EMAILS = 'owner@tulsi.test';
delete process.env.NEXT_PUBLIC_ADMIN_BYPASS;

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
let session = null;
const getServerSession = async () => session;
mock.module('next-auth', { defaultExport: { getServerSession }, namedExports: { getServerSession } });
mock.module(src('app/api/auth/[...nextauth]/route.js'), { namedExports: { authOptions: {} } });
mock.module(src('lib/firebase.js'), {
  namedExports: { getDB: () => db, FieldValue: { increment: (n) => ({ [INC]: n }) } },
});

const T = await import(src('lib/analytics/tracker.js'));
const { parseBatch } = await import(src('lib/analytics/events.js'));
const trackRoute = await import(src('app/api/analytics/track/route.js'));
const analyticsRoute = await import(src('app/api/admin/analytics/route.js'));
const { _resetCaches } = await import(src('lib/analytics/ingest.js'));
const { _resetReportCaches } = await import(src('lib/analytics/report.js'));
const { istDateKey } = await import(src('lib/siteVisits.js'));

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const MIN = 60_000;
const settle = () => new Promise((r) => { setImmediate(r); });
const quietly = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};
const grpcError = (code) => Object.assign(new Error(`grpc ${code}`), { code });

/** In-memory Firestore that logs queries and can fail a query or a
 *  transaction on demand. */
function instrumented(seedData = {}) {
  const base = fakeFirestore(seedData);
  const log = { queries: [] };
  const hooks = { failQuery: null, failTx: [] };
  const wrapQuery = (q, col, filters) => ({
    where: (f, op, v) => wrapQuery(q.where(f, op, v), col, [...filters, f]),
    orderBy: (...a) => wrapQuery(q.orderBy(...a), col, filters),
    limit: (n) => wrapQuery(q.limit(n), col, filters),
    select: (...a) => wrapQuery(q.select(...a), col, filters),
    count: () => ({ get: () => { log.queries.push(`${col}.${filters.join('+')}#count`); return q.count().get(); } }),
    get: async () => {
      const key = `${col}.${filters.join('+')}`;
      log.queries.push(key);
      if (hooks.failQuery?.(key)) { hooks.failQuery = null; throw new Error(`query failed: ${key}`); }
      return q.get();
    },
  });
  return {
    store: base.store, log, hooks,
    collection: (col) => { const c = base.collection(col); return { ...wrapQuery(c, col, []), doc: c.doc, add: c.add }; },
    batch: () => base.batch(),
    runTransaction: (fn, opts) => {
      const fail = hooks.failTx.shift();
      return fail ? Promise.reject(fail) : base.runTransaction(fn, opts);
    },
  };
}
const queriesOf = (key) => db.log.queries.filter((q) => q === key).length;

beforeEach(() => {
  session = null;
  _resetCaches();
  _resetReportCaches();
  db = instrumented({
    staff: { biz: { email: 'biz@tulsi.test', role: 'BUSINESS_MANAGER', status: 'Active', roleGrantedBy: 'owner@tulsi.test' } },
    products: { p1: { name: 'Temple Jhumka', category: 'earrings', price: 1500 } },
    users: { c1: { name: 'Priya', email: 'priya@x.test', role: 'customer' } },
    orders: {},
  });
});

/* ════════════════ Tracker ════════════════ */

describe('tracker', () => {
  const env = {};
  const realFetch = globalThis.fetch;
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  function installBrowser({ href = 'https://tulsi.test/' } = {}) {
    Object.assign(env, { listeners: { window: {}, document: {} }, visibility: 'visible', beacons: [], fetches: [], held: [], hold: false, status: 204 });
    const url = new URL(href);
    globalThis.window = { location: { href, pathname: url.pathname }, addEventListener: (t, fn) => { (env.listeners.window[t] ||= []).push(fn); } };
    globalThis.document = {
      get visibilityState() { return env.visibility; },
      referrer: '',
      addEventListener: (t, fn) => { (env.listeners.document[t] ||= []).push(fn); },
    };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, writable: true,
      value: { userAgent: UA, webdriver: false, sendBeacon: (u, blob) => { env.beacons.push({ url: u, blob }); return true; } },
    });
    /* env.hold → the request stays in flight until released. */
    globalThis.fetch = (u, init) => {
      env.fetches.push({ url: u, ...init });
      if (env.hold) return new Promise((resolve, reject) => { env.held.push({ resolve, reject }); });
      return Promise.resolve({ status: env.status, ok: env.status >= 200 && env.status < 300 });
    };
  }
  const navigate = (href) => { window.location.href = href; window.location.pathname = new URL(href).pathname; };
  const fire = (target, type) => { for (const fn of env.listeners[target][type] || []) fn(); };
  const hide = () => { env.visibility = 'hidden'; fire('document', 'visibilitychange'); };
  const show = () => { env.visibility = 'visible'; fire('document', 'visibilitychange'); };
  const answer = async (status = 204) => { env.held.shift().resolve({ status, ok: status >= 200 && status < 300 }); await settle(); await settle(); };
  const fetched = () => env.fetches.map((f) => JSON.parse(f.body));
  const beaconed = () => Promise.all(env.beacons.map(async (b) => JSON.parse(await b.blob.text())));
  async function tick(ms) { mock.timers.tick(ms); await settle(); await settle(); }
  /** The server accepts it as-is, `final` flag included. */
  function accepted(body) {
    const r = parseBatch(body);
    assert.ok(r.batch, `server would reject: ${r.error}`);
    assert.equal(r.batch.events.length, body.events.length);
    assert.equal(r.batch.final, body.final === true);
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

  test('tracker: leaving while the sign-in check is still loading still sends what was queued (by beacon, final)', async () => {
    T.start({ cart: () => [] });
    T.trackPageView();
    T.track('product_view', { productId: 'p1' });
    await tick(2_000);
    assert.equal(env.fetches.length, 0, 'pending: nothing goes out by fetch');
    hide();
    const [body, ...rest] = await beaconed();
    assert.equal(rest.length, 0);
    assert.equal(body.final, true);
    assert.deepEqual(body.events.map((e) => e.type), ['page_view', 'product_view', 'heartbeat']);
    assert.deepEqual(body.events[2], { type: 'heartbeat', active: 2, path: '/', seq: 2 });
    accepted(body);
    assert.equal(env.fetches.length, 0);

    /* pagehide too (the in-app browser closed). */
    T._reset();
    installBrowser();
    T.start();
    T.trackPageView();
    fire('window', 'pagehide');
    assert.deepEqual((await beaconed()).map((b) => [b.final, b.events[0].type]), [[true, 'page_view']]);
  });

  test('tracker: a hide while the first request is still in flight beacons at once, from the same page load (the server keeps it on one visitor)', async () => {
    T.start();
    T.setMode('on');
    env.hold = true;
    T.trackPageView();
    await tick(400);
    assert.equal(env.fetches.length, 1, 'first request on its way (it will set the cookies)');
    T.track('add_to_cart', { productId: 'p1', qty: 1 });
    await tick(5_000);
    hide();
    const [beacon, ...more] = await beaconed();
    assert.equal(more.length, 0);
    assert.equal(beacon.final, true);
    assert.equal(beacon.tab, fetched()[0].tab, 'same tab id → the server derives the same visitor without cookies');
    assert.equal(beacon.n, 1);
    assert.deepEqual(beacon.events.map((e) => e.type), ['add_to_cart', 'heartbeat'], 'shopping events are never held back at unload');
    accepted(beacon);
  });

  test('tracker: a failed first batch is resent as the same batch; a hide sends it and the queue from the same page load', async () => {
    T.start();
    T.setMode('on');
    env.hold = true;
    T.trackPageView();
    await tick(400);
    await answer(503); // retried later, same batch
    env.hold = true;
    await tick(10_000);
    assert.equal(env.fetches.length, 2);
    assert.equal(env.fetches[1].body, env.fetches[0].body, 'the same batch again');
    await answer(503);
    T.track('add_to_cart', { productId: 'p1', qty: 1 });
    hide();
    const bodies = await beaconed();
    assert.deepEqual(bodies.map((b) => [b.tab, b.n]), [[fetched()[0].tab, 0], [fetched()[0].tab, 1]], 'the retry keeps its (tab, n); the queue follows');
    assert.ok(bodies[1].final);
    bodies.forEach(accepted);
  });

  test('tracker: a send from a hidden tab is final, and a hide after heartbeats always ends with a final batch', async () => {
    T.start();
    T.setMode('on');
    T.trackPageView();
    await tick(400);
    await tick(15_000); // one heartbeat queued…
    await tick(30_000); // …and sent with the next one (not final)
    const sent = fetched().filter((b) => b.events.some((e) => e.type === 'heartbeat'));
    assert.ok(sent.length >= 1 && sent.every((b) => !b.final));
    /* The shopper stops interacting; beats stop after 5 idle minutes. */
    await tick(6 * MIN);
    const before = env.beacons.length;
    hide();
    const last = (await beaconed()).slice(before);
    assert.equal(last.length, 1, 'nothing new to say, but the saved-up seconds must be booked');
    assert.equal(last[0].final, true);
    assert.deepEqual(last[0].events.map((e) => [e.type, e.active]), [['heartbeat', 0]]);
    accepted(last[0]);

    /* Something tracked while hidden goes out by fetch, marked final. */
    T.track('product_engagement', { productId: 'p1', dwell: 30 });
    await tick(5_000);
    const hiddenSend = fetched().at(-1);
    assert.equal(hiddenSend.final, true);
    assert.deepEqual(hiddenSend.events.map((e) => e.type), ['product_engagement']);
  });

  test('tracker: heartbeats carry the current page', async () => {
    installBrowser({ href: 'https://tulsi.test/product/p1' });
    T.start();
    T.setMode('on');
    await tick(15_000);
    navigate('https://tulsi.test/cart');
    await tick(15_000);
    await tick(15_000);
    hide(); // whatever is still queued goes by beacon
    const bodies = [...fetched(), ...(await beaconed())];
    /* (A final heartbeat with active 0 may close the hide.) */
    const beats = bodies.flatMap((b) => b.events).filter((e) => e.type === 'heartbeat' && e.active > 0);
    assert.deepEqual(beats.map((e) => [e.path, e.active]), [['/product/p1', 15], ['/cart', 15], ['/cart', 15]]);
    for (const b of bodies) assert.deepEqual(accepted(b).events.map((e) => e.path), b.events.map((e) => e.path), 'the server keeps the path');
  });

  test('tracker: the staff sign-in page (/admin-portal) queues nothing', async () => {
    for (const href of ['https://tulsi.test/admin-portal', 'https://tulsi.test/admin-portal/reset?x=1']) {
      T._reset();
      installBrowser({ href });
      T.start();
      T.trackPageView();
      T.track('add_to_cart', { productId: 'p1', qty: 1 });
      fire('window', 'pagehide'); // still pending
      T.setMode('on');
      await tick(60_000);
      hide();
      assert.deepEqual([env.fetches.length, env.beacons.length], [0, 0], href);
    }
    /* A shop page with a similar name is tracked. */
    T._reset();
    installBrowser({ href: 'https://tulsi.test/administration-guide' });
    T.start();
    T.setMode('on');
    T.trackPageView();
    await tick(400);
    assert.equal(env.fetches.length, 1);
  });
});

/* ════════════════ POST /api/analytics/track ════════════════ */

let ipN = 0;
const freshIp = () => { ipN += 1; return `203.0.${Math.floor(ipN / 250)}.${(ipN % 250) + 1}`; };
function trackRequest(body, { ip = freshIp(), cookie } = {}) {
  return new Request('https://tulsi.test/api/analytics/track', {
    method: 'POST',
    headers: {
      'content-type': 'text/plain;charset=UTF-8', 'user-agent': UA, 'accept-language': 'en-IN,en;q=0.9',
      'sec-fetch-site': 'same-origin', origin: 'https://tulsi.test', host: 'tulsi.test', 'x-forwarded-for': `${ip}, 10.0.0.1`,
      ...(cookie && { cookie }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const track = (body, opts) => trackRoute.POST(trackRequest(body, opts));
const batch = (events, n = 0) => ({ tab: 'tab0001', n, events: events.map((e, i) => ({ seq: i, ...e })) });
const PV = (p = '/') => ({ type: 'page_view', path: p });
const cookieHeader = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const docs = (col) => [...(db.store.get(col)?.values() || [])];

test('track: a transient storage error (DEADLINE_EXCEEDED, ABORTED, UNAVAILABLE) → 503 with retry-after so the tracker resends; anything else → 204', async () => {
  for (const code of [4, 10, 14]) {
    db = { collection() { throw grpcError(code); } };
    const res = await quietly(() => track(batch([PV('/')])));
    assert.equal(res.status, 503, `code ${code}`);
    assert.equal(res.headers.get('retry-after'), '10');
    assert.deepEqual(res.headers.getSetCookie(), []);
    assert.equal((await res.json()).success, false);
  }
  for (const err of [grpcError(8), grpcError(3), grpcError(7), new Error('boom')]) {
    db = { collection() { throw err; } };
    const res = await quietly(() => track(batch([PV('/')])));
    assert.equal(res.status, 204, `${err.message}: dropped, never breaks the page`);
  }
});

test('track: contention that outlasts the one retry → 503; the resent batch is then counted once', async () => {
  db.hooks.failTx.push(grpcError(10), grpcError(10));
  mock.timers.enable({ apis: ['setTimeout'] });
  let res;
  try {
    const p = quietly(() => track(batch([PV('/'), PV('/shop')])));
    let done = false;
    p.then((r) => { res = r; done = true; });
    for (let i = 0; !done; i += 1) { assert.ok(i < 500, 'stuck'); await settle(); if (!done) mock.timers.tick(10); }
  } finally {
    mock.timers.reset();
  }
  assert.equal(res.status, 503);
  assert.equal(docs('analytics_sessions').length, 0);

  const resent = await track(batch([PV('/'), PV('/shop')]));
  assert.equal(resent.status, 204);
  const again = await track(batch([PV('/'), PV('/shop')]), { cookie: cookieHeader(resent) });
  assert.equal(again.status, 204);
  assert.equal(docs('analytics_sessions').length, 1);
  assert.equal(docs('analytics_sessions')[0].pageviews, 2, 'the duplicate is dropped');
});

/** 120 requests rotating through `ips`, then one more from `next`. */
async function exhaust(ips, next) {
  for (let i = 0; i < 120; i += 1) {
    const res = await track('{}', { ip: ips[i % ips.length] });
    assert.equal(res.status, 400, `request ${i + 1} (${ips[i % ips.length]}) reaches the schema check`);
  }
  return (await track('{}', { ip: next })).status;
}

test('track: IPv6 addresses in one /64 share a rate-limit bucket, however they are written', async () => {
  const rotate = ['2001:db8:1:2::1', '2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2:0:0:0:3', '2001:db8:1:2:ffff::'];
  assert.equal(await exhaust(rotate, '2001:db8:1:2:1234:5678:9abc:def0'), 429, 'same /64');
  assert.equal((await track('{}', { ip: '2001:db8:1:3::1' })).status, 400, 'the next /64 is another bucket');

  /* A /64 whose own groups are zero: written with "::" inside the prefix. */
  const zeros = ['2001:db8::1:2:3:4', '2001:db8::5:6:7:8', '2001:db8::9', '2001:db8:0:0:a::1'];
  assert.equal(await exhaust(zeros, '2001:db8::ffff:1:2:3'), 429, '2001:db8:0:0::/64');
  assert.equal((await track('{}', { ip: '2001:db8:0:1::1' })).status, 400);
});

test('track: IPv4 (including IPv4-mapped IPv6) is limited per address', async () => {
  assert.equal(await exhaust(['49.37.1.2'], '49.37.1.3'), 400, 'a neighbouring IPv4 address is another bucket');
  assert.equal(await exhaust(['::ffff:49.37.2.2'], '::ffff:49.37.2.3'), 400, 'IPv4 seen through a dual-stack proxy is not one big "::" bucket');
  assert.equal((await track('{}', { ip: '::ffff:49.37.2.2' })).status, 429);
});

/* ════════════════ GET /api/admin/analytics ════════════════ */

describe('admin analytics', () => {
  /* The route caches per instance (module memory) on Date.now(): each test
     runs on its own mocked day, so nothing carries over between tests. */
  let day = 0;
  let t0;
  const clockAt = (ms) => { mock.timers.setTime(t0 + ms); };
  const get = async (query) => {
    const res = await analyticsRoute.GET(new Request(`https://tulsi.test/api/admin/analytics?${query}`));
    return { status: res.status, body: await res.json() };
  };
  const CART_Q = 'analytics_sessions.cartDay';
  const LIVE_Q = 'analytics_sessions.lastSeenAt';
  const ORDERS_Q = 'orders.createdAt+createdAt';
  function seedSessions() {
    const now = Date.now();
    const iso = (ms) => new Date(now + ms).toISOString();
    const today = istDateKey(new Date(now));
    const put = (id, d) => (db.store.get('analytics_sessions') || db.store.set('analytics_sessions', new Map()).get('analytics_sessions')).set(id, {
      sid: id, dateKey: today, startedAt: iso(-60 * MIN), channel: 'direct', cartItems: 0, cartValue: 0, cartDay: null, userId: null, ...d,
    });
    put('shopping', { vid: `tj_vid_${'A'.repeat(22)}`, lastSeenAt: iso(-1 * MIN), cartItems: 1, cartValue: 1500, cartDay: today });
    put('abandoned', { vid: `tj_vid_${'B'.repeat(22)}`, userId: 'c1', lastSeenAt: iso(-45 * MIN), cartItems: 2, cartValue: 5000, cartDay: today });
  }

  beforeEach(() => {
    day += 1;
    t0 = Date.parse('2026-11-01T06:00:00Z') + day * 86_400_000;
    mock.timers.enable({ apis: ['Date'], now: t0 });
    session = { user: { id: 'uid-owner', email: 'owner@tulsi.test' } };
  });
  afterEach(() => { mock.timers.reset(); });

  test('admin analytics: part=live carries today’s carts (and so does the full load)', async () => {
    seedSessions();
    const live = await get('part=live');
    assert.equal(live.status, 200);
    assert.deepEqual(Object.keys(live.body.data), ['live']);
    const { carts, sessions, activeVisitors } = live.body.data.live;
    assert.deepEqual([carts.abandoned, carts.abandonedValue, carts.open, carts.openValue], [1, 5000, 1, 1500]);
    assert.deepEqual(carts.recent.map((r) => [r.sid, r.name, r.cartValue]), [['abandoned', 'Priya', 5000]]);
    assert.deepEqual([activeVisitors, sessions.map((s) => s.sid)], [1, ['shopping']]);
    const full = await get('range=today');
    assert.deepEqual(full.body.data.live.carts, carts);
  });

  test('admin analytics: carts are computed at most once per 2 minutes while the live block refreshes; concurrent requests share one computation', async () => {
    seedSessions();
    const [a, b] = await Promise.all([get('part=live'), get('part=live')]);
    assert.deepEqual([a.status, b.status], [200, 200]);
    assert.deepEqual(a.body, b.body);
    assert.deepEqual([queriesOf(LIVE_Q), queriesOf(CART_Q)], [1, 1], 'two concurrent polls, one computation');

    clockAt(6_000);
    await get('part=live');
    assert.deepEqual([queriesOf(LIVE_Q), queriesOf(CART_Q)], [2, 1], 'live is fresh every 5 s; carts are not re-read');
    clockAt(60_000);
    await Promise.all([get('range=today'), get('part=live')]); // the 60 s full load lands with a 15 s poll
    assert.deepEqual([queriesOf(LIVE_Q), queriesOf(CART_Q), queriesOf(ORDERS_Q)], [3, 1, 1]);
    clockAt(119_000);
    await get('part=live');
    assert.equal(queriesOf(CART_Q), 1);
    clockAt(121_000);
    await get('part=live');
    assert.equal(queriesOf(CART_Q), 2, 'recomputed after 2 minutes');
  });

  test('admin analytics: finished ranges are cached for minutes, today for 30 s', async () => {
    await get('range=yesterday');
    await get('range=7d');
    await get('range=today');
    assert.equal(queriesOf(ORDERS_Q), 3);
    clockAt(29_000);
    await get('range=today');
    assert.equal(queriesOf(ORDERS_Q), 3);
    clockAt(31_000);
    await get('range=today');
    assert.equal(queriesOf(ORDERS_Q), 4, 'today: 30 s');
    clockAt(4 * MIN + 59_000);
    await Promise.all([get('range=7d'), get('range=yesterday')]);
    assert.equal(queriesOf(ORDERS_Q), 4, '7 days and yesterday still cached');
    clockAt(5 * MIN + 1_000);
    await get('range=7d');
    assert.equal(queriesOf(ORDERS_Q), 5, '7 days: 5 minutes');
    clockAt(14 * MIN);
    await get('range=yesterday');
    assert.equal(queriesOf(ORDERS_Q), 5);
    clockAt(15 * MIN + 1_000);
    await get('range=yesterday');
    assert.equal(queriesOf(ORDERS_Q), 6, 'yesterday: 15 minutes');
  });

  test('admin analytics: the range cache follows the IST date — "Yesterday" moves at midnight', async () => {
    /* This test's day starts at 06:00 UTC = 11:30 IST; 23:55 IST is 12 h 25 min later. */
    const dayBefore = (ms) => istDateKey(new Date(t0 + ms - 86_400_000));
    clockAt((12 * 60 + 25) * MIN);
    const before = await get('range=yesterday');
    assert.equal(before.body.data.report.from, dayBefore((12 * 60 + 25) * MIN));
    /* 00:05 IST, ten minutes later (inside the 15-minute TTL). */
    clockAt((12 * 60 + 35) * MIN);
    const after = await get('range=yesterday');
    assert.equal(after.body.data.report.from, istDateKey(new Date(t0)), 'a new day: recomputed, not served from cache');
    assert.notEqual(after.body.data.report.from, before.body.data.report.from);
  });

  test('admin analytics: the Refresh button (fresh=1) recomputes the range at once', async () => {
    await get('range=7d');
    assert.equal(queriesOf(ORDERS_Q), 1);
    clockAt(30_000);
    await get('range=7d');
    assert.equal(queriesOf(ORDERS_Q), 1, 'cached');
    await get('range=7d&fresh=1');
    assert.equal(queriesOf(ORDERS_Q), 2, 'refresh skips the cache');
    await get('range=7d');
    assert.equal(queriesOf(ORDERS_Q), 2, 'and refills it');
  });

  test('admin analytics: a failed computation is not cached — the next request computes again', async () => {
    seedSessions();
    db.hooks.failQuery = (key) => key === CART_Q;
    const failed = await quietly(() => get('part=live'));
    assert.equal(failed.status, 500);
    assert.equal(failed.body.success, false);
    const ok = await get('part=live');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.live.carts.abandoned, 1);
    assert.deepEqual([queriesOf(CART_Q), queriesOf(LIVE_Q)], [2, 1], 'carts computed again; the good live block was reused');
    await get('part=live');
    assert.equal(queriesOf(CART_Q), 2, 'and the good result is cached');
  });
});
