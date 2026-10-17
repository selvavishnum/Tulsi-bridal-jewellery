/* ─────────────────────────────────────────────
   Visitor analytics — pins for the fixes from the adversarial review:
   ingestion (per-batch caps, server-priced carts, finding the previous
   visit without its cookie, midnight attribution, guest vs registered,
   CRM saved cart, saved-up heartbeat seconds, fewer visitor writes,
   heartbeat paths, the transaction retry policy), reporting (orders from
   real orders, the customer-name cache), the cart context's quantity,
   the index exemptions and the precomputed sign-in hash.

   Runs against an instrumented in-memory Firestore: every query, document
   read and committed transaction write is logged, a transaction attempt
   can be made to fail at commit (its writes are discarded), and — as in
   Firestore — a transaction may not read after it has written.

   NOW = 2026-10-16T08:00:00Z = 13:30 IST on 2026-10-16.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { fakeFirestore, INC } from './helpers/fakeFirestore.mjs';

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
const srcText = (p) => readFileSync(path.resolve('src', p), 'utf8');
let db;
mock.module(src('lib/firebase.js'), {
  namedExports: { getDB: () => db, FieldValue: { increment: (n) => ({ [INC]: n }) } },
});

const { ingestBatch, _resetCaches, SHARDS } = await import(src('lib/analytics/ingest.js'));
const { parseBatch } = await import(src('lib/analytics/events.js'));
const { liveReport, cartsReport, rangeReport, exportCsv, _resetReportCaches } = await import(src('lib/analytics/report.js'));

/* ── Clock ── */
const NOW = new Date('2026-10-16T08:00:00Z');
const TODAY = '2026-10-16';
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms, from = NOW) => new Date(from.getTime() + ms);
const iso = (ms = 0, from = NOW) => at(ms, from).toISOString();

/* ── Visitors ── */
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const GEO_TN = { country: 'IN', regionCode: 'TN', region: 'Tamil Nadu', city: 'Madurai', regionKey: 'IN-TN' };
const U1 = { id: 'u1' };
const vidOf = (c) => `tj_vid_${c.repeat(22)}`;
const VID_A = vidOf('A');
const VID_B = vidOf('B');
const VID_C = vidOf('C');
const ORD = (n) => `TBJ17606000000000${n}`;

const seed = () => ({
  products: {
    p1: { name: 'Temple Jhumka', slug: 'temple-jhumka', category: 'earrings', price: 2000, discountPrice: 1500, images: ['https://img.test/p1.jpg'] },
    p2: { name: 'Kundan Choker', slug: 'kundan-choker', category: 'necklaces', price: 5000, images: [] },
  },
  users: {
    u1: { name: 'Priya Raman', email: 'priya@x.test', sessionCount: 4 },
    u2: { name: 'Meena K', email: 'meena@x.test' },
  },
  orders: {},
});

/** The in-memory Firestore, instrumented (see the header). */
function instrumented(seedData) {
  const base = fakeFirestore(seedData);
  const log = { queries: [], reads: [], sets: [], updates: [], attempts: 0, options: [] };
  const failNext = [];
  const wrapQuery = (q, col, filters) => ({
    where: (f, op, v) => wrapQuery(q.where(f, op, v), col, [...filters, [f, op, v]]),
    orderBy: (f, dir) => wrapQuery(q.orderBy(f, dir), col, [...filters, [f, 'orderBy', dir]]),
    limit: (n) => wrapQuery(q.limit(n), col, filters),
    select: (...a) => wrapQuery(q.select(...a), col, filters),
    count: () => ({ get: () => { log.queries.push({ col, filters, count: true }); return q.count().get(); } }),
    get: () => { log.queries.push({ col, filters }); return q.get(); },
  });
  const wrapDoc = (ref) => ({ ...ref, get: () => { log.reads.push(`${ref.col}/${ref.id}`); return ref.get(); } });
  return {
    store: base.store,
    log,
    failNext,
    collection: (col) => {
      const c = base.collection(col);
      return { ...wrapQuery(c, col, []), doc: (...a) => wrapDoc(c.doc(...a)), add: c.add };
    },
    /* firebase-admin's batched read: one round trip, snapshots in ref order. */
    getAll: (...refs) => {
      for (const r of refs) log.reads.push(`${r.col}/${r.id}`);
      return Promise.all(refs.map((r) => base.collection(r.col).doc(r.id).get()));
    },
    batch: () => base.batch(),
    async runTransaction(fn, options) {
      log.attempts += 1;
      log.options.push(options);
      const fail = failNext.shift();
      const pending = [];
      let wrote = false;
      const tx = {
        get: (t) => { assert.ok(!wrote, 'Firestore transactions must read before they write'); return t.get(); },
        set: (ref, d, o) => { wrote = true; pending.push(['set', ref, d, o]); },
        update: (ref, d) => { wrote = true; pending.push(['update', ref, d]); },
        delete: (ref) => { wrote = true; pending.push(['delete', ref]); },
      };
      const result = await fn(tx);
      if (fail) throw fail; // the commit failed: nothing is applied
      await base.runTransaction(async (btx) => {
        for (const [kind, ref, d, o] of pending) {
          btx[kind](ref, d, o);
          if (kind !== 'delete') log[kind === 'set' ? 'sets' : 'updates'].push({ path: `${ref.col}/${ref.id}`, data: d, merge: !!o?.merge });
        }
      });
      return result;
    },
  };
}

const grpcError = (code, message = `grpc ${code}`) => Object.assign(new Error(message), { code });

let autoN = 0;
beforeEach(() => {
  _resetCaches();
  _resetReportCaches();
  db = instrumented(seed());
  autoN = 0;
});

/** A batch exactly as the endpoint builds it (through parseBatch). */
function batchOf(events, { tab = 'tab0001', n, cart, final } = {}) {
  const r = parseBatch({ tab, n: n ?? autoN++, ...(final && { final: true }), ...(cart && { cart }), events: events.map((e, i) => ({ seq: i, ...e })) });
  assert.ok(r.batch, `test batch rejected: ${r.error}`);
  return r.batch;
}
function send(events, { vid, sid, user = null, now = NOW, tab, n, cart, final } = {}) {
  return ingestBatch(db, { vid, sid, user, ctx: { ua: UA_ANDROID, ipMasked: '49.37.x.x', geo: GEO_TN, siteHost: 'tulsi.test', now }, batch: batchOf(events, { tab, n, cart, final }) });
}
/** Continue as the same browser with both cookies. */
const as = (prev, extra = {}) => ({ vid: prev.vid, sid: prev.sid, ...extra });
/** Only the long-lived visitor cookie: the 30-minute tj_sid has expired
 *  (or the response that would have set it never arrived). */
const vidOnly = (prev, extra = {}) => ({ vid: prev.vid, ...extra });

/** What one step did to the database. */
async function step(fn) {
  const mark = { q: db.log.queries.length, r: db.log.reads.length, s: db.log.sets.length, u: db.log.updates.length };
  const out = await fn();
  return {
    out,
    queries: db.log.queries.slice(mark.q),
    reads: db.log.reads.slice(mark.r),
    sets: db.log.sets.slice(mark.s),
    updates: db.log.updates.slice(mark.u),
  };
}
const paths = (writes) => writes.map((w) => w.path);
const wroteTo = (writes, prefix) => writes.filter((w) => w.path.startsWith(prefix));

/* ── Reading the fake ── */
const all = (col) => [...(db.store.get(col)?.values() || [])];
const get = (col, id) => db.store.get(col)?.get(id);
function sumDocs(docs) {
  const out = {};
  const add = (t, s) => {
    for (const [k, v] of Object.entries(s)) {
      if (k === 'dateKey') continue;
      if (typeof v === 'number') t[k] = (t[k] || 0) + v;
      else if (v && typeof v === 'object' && !(v instanceof Date)) add((t[k] ||= {}), v);
    }
  };
  for (const d of docs) add(out, d);
  return out;
}
const daily = (dateKey = TODAY) => sumDocs([...(db.store.get('analytics_daily') || new Map())].filter(([id]) => id.startsWith(`${dateKey}_`)).map(([, d]) => d));
const totals = () => sumDocs(all('analytics_totals'));
const pv = (p, extra = {}) => ({ type: 'page_view', path: p, ...extra });
const purchase = (orderNumber) => ({ type: 'purchase', orderNumber });
const order = (id, d) => db.store.get('orders').set(id, { status: 'confirmed', userId: null, total: 1000, ...d });
const cartOf = (...items) => ({ items: items.map(([id, qty = 1, price = 1]) => ({ id, name: `client name ${id}`, qty, price })) });

/* ══ 1. Per-batch caps ══ */

test('caps: 30 views of one product in a batch count once and store one row; try-on mode, tone and checkout once per batch', async () => {
  const a = await send(Array.from({ length: 30 }, () => ({ type: 'product_view', productId: 'p1' })));
  let d = daily();
  assert.equal(d.productViews, 1);
  assert.deepEqual(d.products, { p1: { v: 1 } });
  assert.equal(all('analytics_events').filter((e) => e.type === 'product_view').length, 1);

  await send([
    ...Array.from({ length: 5 }, () => ({ type: 'tryon_mode', mode: 'live' })),
    ...Array.from({ length: 5 }, () => ({ type: 'tryon_tone', tone: 'fair' })),
    ...Array.from({ length: 5 }, () => ({ type: 'checkout_start' })),
    { type: 'tryon_mode', mode: 'ai' },
  ], as(a, { now: at(1 * MIN) }));
  d = daily();
  assert.deepEqual(d.tryonModes, { live: 1, ai: 1 }, 'each mode once per batch');
  assert.deepEqual(d.tones, { fair: 1 });
  assert.equal(d.checkouts, 1);
  const types = all('analytics_events').map((e) => e.type).sort();
  assert.deepEqual(types, ['checkout_start', 'product_view', 'tryon_mode', 'tryon_mode', 'tryon_tone']);

  /* Per batch, not per visit: viewing the product again later is a view. */
  await send([{ type: 'product_view', productId: 'p1' }], as(a, { now: at(2 * MIN) }));
  assert.equal(daily().productViews, 2);
  for (const id of db.store.get('analytics_daily').keys()) assert.match(id, new RegExp(`^${TODAY}_[0-${SHARDS - 1}]$`));
  assert.equal(SHARDS, 8, 'eight shards per day');
});

test('caps: 30 page views in one batch count as 10 (session, day, totals, visitor, hours, pages) and store at most 10 rows', async () => {
  const a = await send(Array.from({ length: 30 }, (_, i) => pv(i % 2 ? '/shop' : '/')));
  const d = daily();
  assert.equal(d.pageviews, 10);
  assert.equal(d.hours[13].p, 10);
  assert.equal(Object.values(d.pages).reduce((x, y) => x + y, 0), 10);
  assert.equal(totals().pageviews, 10);
  assert.equal(get('analytics_sessions', a.sid).pageviews, 10);
  assert.equal(get('analytics_visitors', a.vid).pageviews, 10);
  assert.equal(all('analytics_events').length, 10);
});

test('caps: at most 3 add-to-carts per product per batch (quick real taps still count)', async () => {
  const a = await send([
    ...Array.from({ length: 5 }, () => ({ type: 'add_to_cart', productId: 'p1', qty: 1 })),
    ...Array.from({ length: 4 }, () => ({ type: 'add_to_cart', productId: 'p2', qty: 1 })),
  ]);
  let d = daily();
  assert.equal(d.addToCarts, 6);
  assert.deepEqual(d.products, { p1: { a: 3 }, p2: { a: 3 } });
  assert.equal(all('analytics_events').filter((e) => e.type === 'add_to_cart').length, 6);
  await send([{ type: 'add_to_cart', productId: 'p1', qty: 1 }, { type: 'add_to_cart', productId: 'p1', qty: 1 }], as(a, { now: at(1 * MIN) }));
  d = daily();
  assert.equal(d.addToCarts, 8, 'the next batch counts again');
  assert.equal(d.products.p1.a, 5);
});

test('caps: stored rows stop at 10 per batch — counting does not — and a credited purchase is always stored', async () => {
  order('mine', { orderNumber: ORD(1), analyticsVid: VID_A, status: 'pending', payment: { method: 'cod', status: 'pending' }, total: 2500, createdAt: iso(-5 * MIN) });
  await send([
    ...Array.from({ length: 12 }, () => pv('/')),
    { type: 'product_view', productId: 'p1' },
    { type: 'add_to_cart', productId: 'p1', qty: 1 },
    purchase(ORD(1)),
  ], { vid: VID_A });
  const rows = all('analytics_events');
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.map((e) => e.type).sort(), [...Array(10).fill('page_view'), 'purchase']);
  assert.equal(rows.find((e) => e.type === 'purchase').orderNumber, ORD(1));
  const d = daily();
  assert.deepEqual([d.pageviews, d.productViews, d.addToCarts, d.orders, d.revenue], [10, 1, 1, 1, 2500]);
});

test('caps: 30 purchase events cost at most 2 order lookups; repeats of one number cost one', async () => {
  const distinct = Array.from({ length: 30 }, (_, i) => purchase(`TBJ${1760600000000 + i}`));
  const s1 = await step(() => send(distinct));
  const orderQueries = (s) => s.queries.filter((q) => q.col === 'orders');
  assert.equal(orderQueries(s1).length, 2);
  assert.deepEqual(orderQueries(s1).map((q) => q.filters), [
    [['orderNumber', '==', 'TBJ1760600000000']], [['orderNumber', '==', 'TBJ1760600000001']],
  ], 'the first two distinct numbers, in event order');
  assert.equal(all('analytics_events').length, 0, 'unverified purchases are not stored');

  const s2 = await step(() => send(Array.from({ length: 30 }, () => purchase(ORD(9)))));
  assert.equal(orderQueries(s2).length, 1);

  /* The cap never costs a real purchase: the real tracker sends one. */
  order('mine', { orderNumber: ORD(1), analyticsVid: VID_A, payment: { method: 'razorpay', status: 'paid' }, total: 4000, createdAt: iso(-5 * MIN) });
  await send([purchase(ORD(8)), purchase(ORD(1)), purchase(ORD(1))], { vid: VID_A });
  assert.deepEqual([daily().orders, daily().revenue], [1, 4000]);
});

test('product lookups: one round trip for the distinct products of the events (≤ 10) and the cart; repeats do not use up the budget; cached after', async () => {
  const s1 = await step(() => send([
    ...Array.from({ length: 10 }, () => ({ type: 'add_to_cart', productId: 'p1', qty: 1 })),
    { type: 'product_view', productId: 'p2' },
  ], { cart: cartOf(['p1', 2]) }));
  assert.equal(daily().productViews, 1, 'the product viewed after ten taps on another one is still counted');
  assert.deepEqual(daily().products, { p1: { a: 3 }, p2: { v: 1 } });
  assert.deepEqual(s1.reads.filter((r) => r.startsWith('products/')).sort(), ['products/p1', 'products/p2'], 'each product read once');

  const s2 = await step(() => send([{ type: 'product_view', productId: 'p2' }], { now: at(1 * MIN), cart: cartOf(['p1']) }));
  assert.deepEqual(s2.reads.filter((r) => r.startsWith('products/')), [], 'served from the per-instance cache');

  _resetCaches();
  const many = Array.from({ length: 30 }, (_, i) => ({ type: 'product_view', productId: `x${i}` }));
  const s3 = await step(() => send(many, { cart: { items: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, qty: 1, price: 1 })) } }));
  const lookedUp = s3.reads.filter((r) => r.startsWith('products/'));
  assert.equal(lookedUp.filter((r) => r.startsWith('products/x')).length, 10, 'at most 10 products from the events');
  assert.equal(lookedUp.filter((r) => r.startsWith('products/c')).length, 12, 'at most 12 cart lines are priced');
  assert.equal(new Set(lookedUp).size, lookedUp.length);
});

/* ══ 2. Server-priced cart ══ */

test('cart: priced by the server — unknown ids dropped, client prices and names ignored, in the live cart and the customer’s saved cart', async () => {
  const a = await send([pv('/cart')], {
    user: U1,
    cart: { items: [
      { id: 'p1', name: 'Free gold', qty: 2, price: 1 },
      { id: 'fake9', name: 'Planted', qty: 99, price: 10_000_000 },
      { id: 'p2', name: '<b>x</b>', qty: 1, price: 0 },
    ] },
  });
  const s = get('analytics_sessions', a.sid);
  assert.deepEqual([s.cartItems, s.cartValue, s.cartDay], [3, 2 * 1500 + 5000, TODAY]);
  assert.deepEqual(get('users', 'u1').savedCart, [
    { _id: 'p1', id: 'p1', name: 'Temple Jhumka', quantity: 2, price: 1500 },
    { _id: 'p2', id: 'p2', name: 'Kundan Choker', quantity: 1, price: 5000 },
  ]);

  /* A cart of nothing but made-up products plants nothing. */
  const fake = await send([pv('/')], { vid: VID_B, cart: { items: Array.from({ length: 30 }, (_, i) => ({ id: `fake${i}`, qty: 99, price: 10_000_000 })) } });
  const f = get('analytics_sessions', fake.sid);
  assert.deepEqual([f.cartItems, f.cartValue, f.cartDay], [0, 0, null]);
  const carts = await cartsReport(db, at(2 * HOUR));
  assert.deepEqual([carts.abandoned, carts.abandonedValue], [1, 8000], 'only the real cart');
});

/* ══ 3. The previous visit, found without the tj_sid cookie ══ */

test('previous visit without its cookie (a): back after 40 minutes with only tj_vid, then buys — no abandoned cart', async () => {
  const cart = cartOf(['p1']);
  const first = await send([pv('/product/p1'), { type: 'add_to_cart', productId: 'p1', qty: 1 }], { vid: VID_A, cart });
  assert.equal(get('analytics_sessions', first.sid).cartDay, TODAY);

  const back = await send([pv('/cart')], vidOnly(first, { now: at(40 * MIN), cart }));
  assert.notEqual(back.sid, first.sid, 'idle > 30 min is a new visit');
  assert.equal(get('analytics_sessions', first.sid).cartDay, null, 'the old visit hands its cart over');
  assert.equal(get('analytics_sessions', first.sid).cartItems, 1, 'its history is kept');

  order('cod', { orderNumber: ORD(1), analyticsVid: VID_A, status: 'pending', payment: { method: 'cod', status: 'pending' }, total: 1500, createdAt: iso(41 * MIN) });
  await send([pv('/order-success'), purchase(ORD(1))], as(back, { now: at(42 * MIN), cart }));
  assert.equal(get('analytics_sessions', back.sid).cartDay, null);
  assert.equal(get('analytics_sessions', back.sid).purchased, true);

  const later = at(3 * HOUR);
  const carts = await cartsReport(db, later);
  assert.deepEqual([carts.abandoned, carts.abandonedValue, carts.open, carts.recent], [0, 0, 0, []]);
  assert.equal((await liveReport(db, later)).carts.abandoned, 0);

  /* Same story when the second visit empties the cart instead. */
  const b1 = await send([pv('/product/p2'), { type: 'add_to_cart', productId: 'p2', qty: 1 }], { vid: VID_B, cart: cartOf(['p2']) });
  const b2 = await send([{ type: 'remove_from_cart', productId: 'p2' }, pv('/cart')], vidOnly(b1, { now: at(50 * MIN), cart: { items: [] } }));
  assert.notEqual(b2.sid, b1.sid);
  assert.deepEqual([get('analytics_sessions', b1.sid).cartDay, get('analytics_sessions', b2.sid).cartDay], [null, null]);
  assert.equal((await cartsReport(db, later)).abandoned, 0);
});

test('previous visit without its cookie (b): a returning visitor’s re-sent first batch (response lost, no tj_sid yet) is de-duplicated', async () => {
  const yesterday = await send([pv('/')], { vid: VID_A, now: at(-1 * DAY) });
  const first = await send([pv('/'), { type: 'product_view', productId: 'p1' }], { vid: VID_A, tab: 'tabr1', n: 0 });
  assert.notEqual(first.sid, yesterday.sid);
  const snapshot = () => structuredClone({
    daily: daily(), totals: totals(), events: all('analytics_events').length, sessions: all('analytics_sessions').length,
    s: get('analytics_sessions', first.sid), v: get('analytics_visitors', VID_A),
  });
  const before = snapshot();

  const resent = await send([pv('/'), { type: 'product_view', productId: 'p1' }], { vid: VID_A, tab: 'tabr1', n: 0, now: at(5 * SEC) });
  assert.deepEqual(resent, { vid: VID_A, sid: first.sid, accepted: 0, newSession: false, newVisitor: false });
  assert.deepEqual(snapshot(), before, 'nothing counted twice');

  /* Its next batch (still without the cookie) continues the same visit. */
  const next = await send([pv('/shop')], { vid: VID_A, tab: 'tabr1', n: 1, now: at(10 * SEC) });
  assert.deepEqual([next.sid, next.accepted, next.newSession], [first.sid, 1, false]);
  assert.equal(daily().sessions, 1);
  assert.equal(get('analytics_sessions', first.sid).pageviews, 2);
});

test('previous visit without its cookie (c): a returning visitor within 30 minutes continues the same visit', async () => {
  const a = await send([pv('/')], { vid: VID_A });
  const b = await send([pv('/shop')], vidOnly(a, { now: at(20 * MIN) }));
  assert.deepEqual([b.sid, b.newSession, b.newVisitor], [a.sid, false, false]);
  assert.equal(daily().sessions, 1);
  const c = await send([pv('/cart')], vidOnly(a, { now: at(51 * MIN + 1 * SEC) }));
  assert.notEqual(c.sid, a.sid, 'idle for more than 30 minutes since the last batch');
  assert.equal(get('analytics_visitors', VID_A).lastSessionId, c.sid);
  assert.equal(daily().sessions, 2);
});

/* ══ 4. IST midnight keeps the visit's source ══ */

const LATE = new Date('2026-10-16T18:20:00Z'); // 23:50 IST, 16 Oct
const SOURCE_FIELDS = ['channel', 'source', 'medium', 'campaign', 'content', 'refHost'];
const sourceOf = (s) => Object.fromEntries(SOURCE_FIELDS.map((k) => [k, s[k]]));

test('midnight: a visit split at IST midnight keeps channel / source / medium / campaign; the order after midnight is credited to them', async () => {
  const a = await send([pv('/', { utm: { source: 'ig', medium: 'story', campaign: 'diwali' } })], { vid: VID_A, now: LATE });
  const prev = get('analytics_sessions', a.sid);
  assert.deepEqual([prev.channel, prev.campaign, prev.dateKey], ['instagram', 'diwali', TODAY]);

  /* 00:01 IST: only a heartbeat (no referrer, no tags) — the visit goes on. */
  const b = await send([{ type: 'heartbeat', active: 30, path: '/product/p1' }], as(a, { now: at(11 * MIN, LATE) }));
  assert.notEqual(b.sid, a.sid, 'a new session on the new day');
  const s = get('analytics_sessions', b.sid);
  assert.equal(s.dateKey, '2026-10-17');
  assert.deepEqual(sourceOf(s), sourceOf(prev));
  assert.deepEqual(daily('2026-10-17').channels, { instagram: 1 }, 'not an extra Direct session');

  order('cod', { orderNumber: ORD(1), analyticsVid: VID_A, status: 'pending', payment: { method: 'cod', status: 'pending' }, total: 25_000, createdAt: iso(13 * MIN, LATE) });
  await send([pv('/order-success'), purchase(ORD(1))], as(b, { now: at(15 * MIN, LATE) })); // 00:05 IST
  const d17 = daily('2026-10-17');
  assert.deepEqual([d17.ordersByChannel, d17.revenueByChannel], [{ instagram: 1 }, { instagram: 25_000 }]);
  const attribution = get('orders', 'cod').attribution;
  assert.deepEqual([attribution.channel, attribution.source, attribution.medium, attribution.campaign], [prev.channel, prev.source, prev.medium, 'diwali']);

  const r = await rangeReport(db, { range: 'today', now: at(20 * MIN, LATE) });
  const ig = r.sources.find((x) => x.key === 'instagram');
  assert.deepEqual([ig.orders, ig.revenue], [1, 25_000]);
  assert.equal(r.sources.find((x) => x.key === 'direct'), undefined);
});

test('midnight: a new tagged arrival after midnight takes its own source; a visit idle across midnight does not inherit one', async () => {
  const a = await send([pv('/', { utm: { source: 'ig', campaign: 'diwali' } })], { vid: VID_A, now: LATE });
  const fb = await send([pv('/', { utm: { source: 'facebook', campaign: 'wedding' } })], as(a, { now: at(15 * MIN, LATE) }));
  assert.deepEqual([get('analytics_sessions', fb.sid).channel, get('analytics_sessions', fb.sid).campaign], ['facebook', 'wedding']);

  const early = new Date('2026-10-16T17:50:00Z'); // 23:20 IST
  const c = await send([pv('/', { utm: { source: 'ig', campaign: 'diwali' } })], { vid: VID_C, now: early });
  const idle = await send([{ type: 'heartbeat', active: 15, path: '/shop' }], as(c, { now: at(45 * MIN, early) })); // 00:05 IST, 45 min idle
  const s = get('analytics_sessions', idle.sid);
  assert.deepEqual([s.channel, s.campaign], ['direct', ''], 'a new visit, not a continuation');
  assert.deepEqual(daily('2026-10-17').channels, { facebook: 1, direct: 1 });
});

/* ══ 5. Registered means the same for Today as for 7 days ══ */

test('registered: a browser that signed in days ago, browsing signed out today, is registered for Today as for 7 days', async () => {
  await send([pv('/account')], { vid: VID_A, user: U1, now: at(-3 * DAY) });
  await send([pv('/'), pv('/shop')], { vid: VID_A });
  await send([pv('/')], { vid: VID_B, now: at(1 * MIN) }); // a plain guest
  const today = await rangeReport(db, { range: 'today', now: at(2 * MIN) });
  const week = await rangeReport(db, { range: '7d', now: at(2 * MIN) });
  assert.deepEqual([today.visitors.visitors, today.visitors.registered, today.visitors.guests], [2, 1, 1]);
  assert.deepEqual([week.visitors.visitors, week.visitors.registered, week.visitors.guests], [2, 1, 1]);
  assert.equal(get('analytics_seen', `${TODAY}_${VID_A}`).reg, true);
});

/* ══ 6. CRM saved cart ══ */

test('saved cart: written when it changes, not rewritten when unchanged, left alone by another device, cleared when this browser empties it', async () => {
  const a = await send([pv('/cart')], { vid: VID_A, user: U1, cart: cartOf(['p1', 1]) });
  const saved = () => get('users', 'u1').savedCart;
  assert.deepEqual(saved(), [{ _id: 'p1', id: 'p1', name: 'Temple Jhumka', quantity: 1, price: 1500 }]);
  assert.equal(get('users', 'u1').cartUpdatedAt, iso());

  const same = await step(() => send([{ type: 'heartbeat', active: 15 }], as(a, { user: U1, now: at(1 * MIN), cart: cartOf(['p1', 1, 99]) })));
  const patch = same.updates.find((w) => w.path === 'users/u1').data;
  assert.ok(!('savedCart' in patch) && !('cartUpdatedAt' in patch), 'unchanged cart: no rewrite');
  assert.equal(get('users', 'u1').cartUpdatedAt, iso(), 'cartUpdatedAt is the last cart change, not the last heartbeat');

  await send([{ type: 'add_to_cart', productId: 'p1', qty: 1 }], as(a, { user: U1, now: at(2 * MIN), cart: cartOf(['p1', 2]) }));
  assert.equal(saved()[0].quantity, 2);
  assert.equal(get('users', 'u1').cartUpdatedAt, iso(2 * MIN));

  /* The same customer on a second device whose cart is empty. */
  await send([pv('/')], { vid: VID_B, user: U1, now: at(3 * MIN), cart: { items: [] } });
  assert.equal(saved()[0].quantity, 2, 'another device does not wipe this one’s cart');

  /* This browser empties its cart (or paid by Razorpay without a purchase event). */
  await send([{ type: 'remove_from_cart', productId: 'p1' }], as(a, { user: U1, now: at(4 * MIN), cart: { items: [] } }));
  assert.deepEqual(saved(), []);
  assert.equal(get('users', 'u1').cartUpdatedAt, iso(4 * MIN));
  const again = await step(() => send([pv('/')], as(a, { user: U1, now: at(5 * MIN), cart: { items: [] } })));
  assert.ok(!('savedCart' in again.updates.find((w) => w.path === 'users/u1').data), 'already empty: nothing to write');
});

test('saved cart: a saved cart read back with its fields in another order is still the same cart (Firestore does not keep map key order)', async () => {
  /* As Firestore may return it: keys sorted, not in the order they were written. */
  db.store.get('users').get('u1').savedCart = [{ _id: 'p1', id: 'p1', name: 'Temple Jhumka', price: 1500, quantity: 2 }];
  db.store.get('users').get('u1').cartUpdatedAt = iso(-1 * HOUR);
  const s = await step(() => send([pv('/cart')], { vid: VID_A, user: U1, cart: cartOf(['p1', 2]) }));
  assert.ok(!('savedCart' in s.updates.find((w) => w.path === 'users/u1').data), 'same items, same quantities, same prices');
  assert.equal(get('users', 'u1').cartUpdatedAt, iso(-1 * HOUR));
});

test('saved cart: the next visit (old cookie expired) starting with an empty cart clears it', async () => {
  const a = await send([pv('/cart')], { vid: VID_A, user: U1, cart: cartOf(['p1']) });
  assert.equal(get('users', 'u1').savedCart.length, 1);
  await send([pv('/')], vidOnly(a, { user: U1, now: at(2 * HOUR), cart: { items: [] } }));
  assert.deepEqual(get('users', 'u1').savedCart, []);
});

/* ══ 7. Heartbeat seconds wait on the session ══ */

test('heartbeats: no daily write until 60 s have built up, a batch with other counts, or the tab-hide flush', async () => {
  const a = await send([pv('/'), pv('/shop')]); // engaged already (2 pages)
  const beat = (ms, active, extra = {}) => step(() => send([{ type: 'heartbeat', active }], as(a, { now: at(ms), ...extra })));
  const shardWrites = (s) => wroteTo(s.sets, 'analytics_daily/');
  const pending = () => get('analytics_sessions', a.sid).pendingActive;

  for (const [ms, active, want] of [[20 * SEC, 20, 20], [40 * SEC, 20, 40]]) {
    const s = await beat(ms, active);
    assert.deepEqual(paths(s.sets), [`analytics_sessions/${a.sid}`], `${ms / SEC}s: only the session doc is written`);
    assert.equal(pending(), want);
  }
  assert.equal(daily().activeSeconds, undefined);
  assert.equal(get('analytics_sessions', a.sid).activeSeconds, 40, 'the session itself is always up to date');

  const at60 = await beat(60 * SEC, 20);
  assert.equal(shardWrites(at60).length, 1, '60 s saved up: flushed');
  assert.deepEqual(shardWrites(at60)[0].data.activeSeconds, { [INC]: 60 });
  assert.deepEqual([pending(), daily().activeSeconds], [0, 60]);

  assert.equal(shardWrites(await beat(90 * SEC, 30)).length, 0);
  const withPage = await step(() => send([pv('/cart'), { type: 'heartbeat', active: 10 }], as(a, { now: at(100 * SEC) })));
  assert.equal(shardWrites(withPage).length, 1, 'rides along with a batch that writes the day anyway');
  assert.deepEqual([pending(), daily().activeSeconds], [0, 100]);

  assert.equal(shardWrites(await beat(130 * SEC, 30)).length, 0);
  const hidden = await beat(135 * SEC, 5, { final: true });
  assert.equal(shardWrites(hidden).length, 1, 'the tab-hide flush sends what is saved up');
  assert.deepEqual([pending(), daily().activeSeconds, get('analytics_sessions', a.sid).activeSeconds], [0, 135, 135]);

  /* The tracker's closing "final" heartbeat of 0 s books the rest. */
  await beat(160 * SEC, 20);
  assert.equal(pending(), 20);
  await beat(161 * SEC, 0, { final: true });
  assert.deepEqual([pending(), daily().activeSeconds], [0, 155]);
});

test('heartbeats: when a new visit starts, the previous visit’s saved-up seconds go to that visit’s own day', async () => {
  const late = new Date('2026-10-16T18:10:00Z'); // 23:40 IST
  const a = await send([pv('/'), pv('/shop')], { vid: VID_A, now: late });
  await send([{ type: 'heartbeat', active: 25 }], as(a, { now: at(30 * SEC, late) }));
  await send([{ type: 'heartbeat', active: 25 }], as(a, { now: at(60 * SEC, late) }));
  assert.equal(get('analytics_sessions', a.sid).pendingActive, 50);
  assert.equal(daily(TODAY).activeSeconds, undefined);

  /* 00:30 IST: back after 49 minutes (the session cookie has expired). */
  const b = await send([pv('/')], vidOnly(a, { now: at(50 * MIN, late) }));
  assert.notEqual(b.sid, a.sid);
  assert.equal(daily(TODAY).activeSeconds, 50, 'counted on 16 Oct, where it was spent');
  assert.equal(daily('2026-10-17').activeSeconds, undefined);
  assert.deepEqual([get('analytics_sessions', a.sid).pendingActive, get('analytics_sessions', a.sid).activeSeconds], [0, 50]);
});

test('heartbeats: a visit split at midnight while active hands its saved-up seconds to the old day', async () => {
  const c = await send([pv('/'), pv('/shop')], { vid: VID_C, now: new Date('2026-10-16T18:29:00Z') }); // 23:59 IST
  await send([{ type: 'heartbeat', active: 30 }], as(c, { now: new Date('2026-10-16T18:29:30Z') }));
  const d = await send([{ type: 'heartbeat', active: 30 }], as(c, { now: new Date('2026-10-16T18:30:30Z') })); // 00:00:30 IST
  assert.notEqual(d.sid, c.sid);
  assert.equal(daily(TODAY).activeSeconds, 30);
  assert.equal(daily('2026-10-17').activeSeconds, 30, 'the new visit’s first beat rides with its session counts');
});

/* ══ 8. The visitor doc is rewritten only when something it holds changes ══ */

test('visitor doc: not rewritten by same-day batches of a continuing visit without a page view; rewritten for a page view, a sign-in, a new visit, a new day', async () => {
  const late = new Date('2026-10-16T18:00:00Z'); // 23:30 IST
  const a = await send([pv('/')], { vid: VID_A, now: late });
  const vDoc = `analytics_visitors/${VID_A}`;
  const visitorWritten = async (events, opts) => {
    const s = await step(() => send(events, opts));
    return { out: s.out, wrote: paths(s.sets).includes(vDoc) };
  };

  assert.equal((await visitorWritten([{ type: 'heartbeat', active: 30 }], as(a, { now: at(30 * SEC, late) }))).wrote, false, 'heartbeat');
  assert.equal((await visitorWritten([{ type: 'add_to_cart', productId: 'p1', qty: 1 }], as(a, { now: at(40 * SEC, late) }))).wrote, false, 'add to cart');
  assert.equal(get('analytics_visitors', VID_A).lastSeenAt, late.toISOString(), 'read by day only, so a same-day lag changes nothing');

  assert.equal((await visitorWritten([pv('/shop')], as(a, { now: at(60 * SEC, late) }))).wrote, true, 'page view');
  assert.equal(get('analytics_visitors', VID_A).pageviews, 2);
  assert.equal((await visitorWritten([{ type: 'heartbeat', active: 30 }], as(a, { user: U1, now: at(90 * SEC, late) }))).wrote, true, 'signed in');
  assert.deepEqual([get('analytics_visitors', VID_A).userId, get('analytics_visitors', VID_A).registered], ['u1', true]);
  assert.equal((await visitorWritten([{ type: 'heartbeat', active: 30 }], as(a, { user: U1, now: at(2 * MIN, late) }))).wrote, false, 'signed-in heartbeat');

  const split = await visitorWritten([{ type: 'heartbeat', active: 30 }], as(a, { user: U1, now: at(31 * MIN, late) })); // 00:01 IST
  assert.equal(split.wrote, true, 'new day, new visit');
  const v = get('analytics_visitors', VID_A);
  assert.deepEqual([v.lastSessionId, v.sessions, v.lastSeenAt], [split.out.sid, 2, at(31 * MIN, late).toISOString()]);

  const idle = await visitorWritten([{ type: 'heartbeat', active: 30 }], as(split.out, { user: U1, now: at(2 * HOUR, late) }));
  assert.equal(idle.wrote, true, 'new visit after idle');
  assert.equal(get('analytics_visitors', VID_A).lastSessionId, idle.out.sid);
});

/* ══ 9. A visit that starts with a heartbeat still gets its page ══ */

test('heartbeat path: a visit that starts with a heartbeat (a resumed tab) gets its landing and current page from it', async () => {
  const a = await send([pv('/', { referrer: 'https://www.google.co.in/' })]);
  const resumed = await send([{ type: 'heartbeat', active: 15, path: '/product/p1' }], as(a, { now: at(40 * MIN) }));
  assert.notEqual(resumed.sid, a.sid);
  let s = get('analytics_sessions', resumed.sid);
  assert.deepEqual([s.landingPath, s.currentPath, s.pageviews, s.activeSeconds], ['/product/p1', '/product/p1', 0, 15]);
  await send([pv('/cart')], as(resumed, { now: at(41 * MIN) }));
  s = get('analytics_sessions', resumed.sid);
  assert.deepEqual([s.landingPath, s.currentPath, s.pageviews], ['/product/p1', '/cart', 1]);
  const live = await liveReport(db, at(41 * MIN));
  assert.equal(live.sessions.find((x) => x.sid === resumed.sid).landingPath, '/product/p1');
});

/* ══ 10. Transaction retry policy ══ */

/** Runs `promise` with setTimeout mocked, stepping the clock 10 ms at a
 *  time; returns the result and when each transaction attempt started. */
async function withMockedTimeouts(start) {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const startedAt = [];
    let attempts = db.log.attempts;
    let done = false; let value; let error;
    start().then((v) => { done = true; value = v; }, (e) => { done = true; error = e; });
    for (let elapsed = 0; ; elapsed += 10) {
      await new Promise((r) => { setImmediate(r); });
      while (attempts < db.log.attempts) { attempts += 1; startedAt.push(elapsed); }
      if (done) break;
      assert.ok(elapsed < 5_000, 'stuck');
      mock.timers.tick(10);
    }
    return { value, error, startedAt };
  } finally {
    mock.timers.reset();
  }
}

for (const [code, name] of [[10, 'ABORTED'], [14, 'UNAVAILABLE']]) {
  test(`transaction: one quick retry after ${name} (${code}); nothing from the failed attempt is applied`, async () => {
    db.failNext.push(grpcError(code));
    const { value, error, startedAt } = await withMockedTimeouts(() => send([pv('/'), { type: 'product_view', productId: 'p1' }]));
    assert.equal(error, undefined);
    assert.equal(value.newSession, true);
    assert.equal(db.log.attempts, 2);
    assert.deepEqual(db.log.options, [{ maxAttempts: 1 }, { maxAttempts: 1 }], 'the SDK’s own 5-attempt retry is off');
    const wait = startedAt[1] - startedAt[0];
    assert.ok(wait >= 100 && wait <= 310, `jittered 100–300 ms back-off, got ${wait} ms`);
    const d = daily();
    assert.deepEqual([d.sessions, d.pageviews, d.productViews], [1, 1, 1], 'counted once');
    assert.equal(all('analytics_sessions').length, 1);
    assert.equal(all('analytics_events').length, 2);
  });
}

test('transaction: no retry for other errors, and at most one retry for contention', async () => {
  for (const err of [grpcError(8, 'RESOURCE_EXHAUSTED'), grpcError(3, 'INVALID_ARGUMENT'), grpcError(4, 'DEADLINE_EXCEEDED'), new Error('plain')]) {
    db = instrumented(seed());
    db.failNext.push(err);
    const { error } = await withMockedTimeouts(() => send([pv('/')]));
    assert.equal(error, err, err.message);
    assert.equal(db.log.attempts, 1, `${err.message}: fails fast`);
    assert.equal(all('analytics_sessions').length, 0);
  }
  db = instrumented(seed());
  db.failNext.push(grpcError(10), grpcError(10), grpcError(10));
  const { error } = await withMockedTimeouts(() => send([pv('/')]));
  assert.equal(error?.code, 10, 'gives up after the retry (the route answers 503)');
  assert.equal(db.log.attempts, 2);
  assert.equal(all('analytics_sessions').length, 0);
});

/* ══ 11. Reports: orders from the orders themselves; names cached ══ */

test('report: chart and sources take orders and revenue from real orders by IST day and attribution channel; unattributed ones are untracked', async () => {
  const put = (id, d) => (db.store.get('analytics_daily') || db.store.set('analytics_daily', new Map()).get('analytics_daily')).set(id, d);
  /* Rollups that disagree with the orders on purpose. */
  put(`${TODAY}_0`, { dateKey: TODAY, sessions: 3, channels: { instagram: 2, direct: 1 }, orders: 6, revenue: 99_999, ordersByChannel: { direct: 6 }, revenueByChannel: { direct: 99_999 } });
  put('2026-10-15_3', { dateKey: '2026-10-15', sessions: 2, channels: { facebook: 1, direct: 1 }, orders: 1, ordersByChannel: { facebook: 1 } });
  const paid = { method: 'razorpay', status: 'paid' };
  order('ig1', { createdAt: iso(-1 * HOUR), payment: paid, total: 1000, attribution: { channel: 'instagram' } });
  order('ig2', { createdAt: '2026-10-15T18:29:59.000Z', status: 'pending', payment: { method: 'cod', status: 'pending' }, total: 500, attribution: { channel: 'instagram' } }); // 23:59:59 IST, 15 Oct
  order('igCancelled', { createdAt: iso(-2 * HOUR), status: 'cancelled', payment: paid, total: 7000, attribution: { channel: 'instagram' } });
  order('phone', { createdAt: '2026-10-15T18:30:00.000Z', payment: paid, total: 200 }); // 00:00 IST, 16 Oct; no visit credited
  order('bogus', { createdAt: iso(-3 * HOUR), payment: paid, total: 300, attribution: { channel: '__proto__' } });
  order('fbPending', { createdAt: iso(-4 * HOUR), status: 'pending', payment: { method: 'razorpay', status: 'pending' }, total: 9000, attribution: { channel: 'facebook' } });
  order('old', { createdAt: iso(-9 * DAY), payment: paid, total: 4000, attribution: { channel: 'direct' } });

  const r = await rangeReport(db, { range: '7d', now: NOW });
  const src7 = Object.fromEntries(r.sources.map((x) => [x.key, x]));
  assert.deepEqual([src7.instagram.orders, src7.instagram.revenue, src7.instagram.conversion], [2, 1500, 100]);
  assert.deepEqual([src7.direct.orders, src7.direct.revenue], [0, 0], 'the rollup’s direct orders are not used');
  assert.deepEqual([src7.facebook.orders, src7.facebook.revenue], [0, 0], 'pending online is not an order');
  assert.deepEqual([r.kpis.orders, r.kpis.revenue, r.kpis.trackedOrders, r.kpis.untrackedOrders], [4, 2000, 7, 2]);
  const day = (k) => r.series.points.find((p) => p.key === k);
  assert.deepEqual([day(TODAY).orders, day(TODAY).revenue], [3, 1500]);
  assert.deepEqual([day('2026-10-15').orders, day('2026-10-15').revenue], [1, 500]);
  assert.equal(r.series.points.reduce((a, p) => a + p.orders, 0), r.kpis.orders, 'chart total = Orders KPI');
  assert.equal(r.series.points.reduce((a, p) => a + p.revenue, 0), r.kpis.revenue, 'chart revenue = Revenue KPI');

  const t = await rangeReport(db, { range: 'today', now: NOW });
  assert.deepEqual([t.kpis.orders, t.kpis.untrackedOrders, t.sources.find((x) => x.key === 'instagram').orders], [3, 2, 1]);
});

test('report: customer names for the live list and abandoned carts are read once per 10 minutes', async () => {
  const sessions = db.store.get('analytics_sessions') || db.store.set('analytics_sessions', new Map()).get('analytics_sessions');
  const base = { dateKey: TODAY, channel: 'direct', startedAt: iso(-1 * HOUR), cartItems: 0, cartValue: 0, cartDay: null };
  sessions.set('cart', { ...base, sid: 'cart', vid: VID_B, userId: 'u2', lastSeenAt: iso(-2 * HOUR), cartItems: 1, cartValue: 999, cartDay: TODAY });
  const liveAt = (now) => {
    sessions.set('live', { ...base, sid: 'live', vid: VID_A, userId: 'u1', lastSeenAt: new Date(now.getTime() - MIN).toISOString() });
    sessions.set('ghost', { ...base, sid: 'ghost', vid: VID_C, userId: 'deleted-user', lastSeenAt: new Date(now.getTime() - MIN).toISOString() });
    return liveReport(db, now);
  };
  const userReads = (s) => s.reads.filter((r) => r.startsWith('users/')).sort();
  const names = (r) => [r.sessions.find((x) => x.sid === 'live').name, r.sessions.find((x) => x.sid === 'ghost').name, r.carts.recent[0].name];

  const first = await step(() => liveAt(NOW));
  assert.deepEqual(userReads(first), ['users/deleted-user', 'users/u1', 'users/u2']);
  assert.deepEqual(names(first.out), ['Priya Raman', 'Customer', 'Meena K']);

  db.store.get('users').get('u1').name = 'Priya R';
  const soon = await step(() => liveAt(at(5 * MIN)));
  assert.deepEqual(userReads(soon), [], 'served from the cache (a missing user too)');
  assert.deepEqual(names(soon.out), ['Priya Raman', 'Customer', 'Meena K']);

  const later = await step(() => liveAt(at(11 * MIN)));
  assert.deepEqual(userReads(later), ['users/deleted-user', 'users/u1', 'users/u2'], 'expired after 10 minutes');
  assert.equal(names(later.out)[0], 'Priya R');
});

/* ══ 12. Cart: one add per tap, carrying the quantity ══ */

/** CartContext.js renders JSX, so it can't be imported here; its reducer and
 *  analytics hook are plain JS between these two markers. */
function loadCartLogic() {
  const code = srcText('context/CartContext.js');
  const start = code.indexOf('const initialState');
  const end = code.indexOf('export function CartProvider');
  assert.ok(start > 0 && end > start, 'CartContext.js layout changed: update loadCartLogic');
  const tracked = [];
  const factory = vm.runInThisContext(`(function (track) {\n${code.slice(start, end)}\nreturn { cartReducer, trackCartAction, initialState };\n})`);
  return { ...factory((type, props) => tracked.push([type, props])), tracked };
}

test('cart context: ADD_ITEM with a quantity adds that many pieces and tracks ONE add_to_cart carrying it', async () => {
  const { cartReducer, trackCartAction, initialState, tracked } = loadCartLogic();
  /* What CartProvider's dispatch does: track, then reduce. */
  let state = initialState;
  const dispatch = (action) => { trackCartAction(action, state.items); state = cartReducer(state, action); };
  const product = { _id: 'p1', name: 'Temple Jhumka', price: 2000, discountPrice: 1500 };

  dispatch({ type: 'ADD_ITEM', payload: product, qty: 3 });
  assert.deepEqual(state.items, [{ ...product, quantity: 3 }]);
  assert.deepEqual(tracked, [['add_to_cart', { productId: 'p1', qty: 3 }]], 'one action, not three');
  dispatch({ type: 'ADD_ITEM', payload: product, qty: 2 });
  dispatch({ type: 'ADD_ITEM', payload: product }); // product cards: no qty → 1
  assert.equal(state.items[0].quantity, 6);
  assert.deepEqual(tracked.map(([, p]) => p.qty), [3, 2, 1]);

  for (const [qty, want] of [[0, 1], [-4, 1], [150, 150], ['abc', 1], [2.6, 3]]) {
    let s = initialState;
    s = cartReducer(s, { type: 'ADD_ITEM', payload: { id: 'p2' }, qty });
    assert.equal(s.items[0].quantity, want, `qty ${qty}`);
  }
  /* The cart takes the picked quantity (the picker is bounded by stock);
     only the analytics event is capped at the schema's 99. */
  trackCartAction({ type: 'ADD_ITEM', payload: { id: 'p2' }, qty: 150 }, []);
  assert.deepEqual(tracked.at(-1), ['add_to_cart', { productId: 'p2', qty: 99 }]);
  tracked.pop();

  /* The tracked event passes the server schema and counts as one add. */
  const [type, props] = tracked[0];
  const a = await send([{ type, ...props }]);
  assert.equal(daily().addToCarts, 1);
  assert.deepEqual(daily().products, { p1: { a: 1 } });
  assert.equal(all('analytics_events').find((e) => e.sid === a.sid && e.type === 'add_to_cart').qty, 3);
});

test('product page: Add to cart and Buy now dispatch ADD_ITEM once with the picked quantity (no per-piece loop)', () => {
  const code = srcText('app/product/[id]/ProductDetail.js');
  const adds = code.match(/dispatch\(\{\s*type:\s*'ADD_ITEM'[^}]*\}\)/g) || [];
  assert.equal(adds.length, 2, 'addToCart and buyNow');
  for (const d of adds) assert.match(d, /\bqty\b/, d);
  assert.doesNotMatch(code, /for\s*\([^)]*\)\s*\{?\s*dispatch\(\{\s*type:\s*'ADD_ITEM'/);
});

/* ══ 13. Index exemptions never cover a queried field ══ */

test('firestore.indexes.json: unqueried analytics fields are exempt from indexing; no field the code queries is', async () => {
  const idx = JSON.parse(readFileSync(path.resolve('firestore.indexes.json'), 'utf8'));
  const keys = idx.fieldOverrides.map((o) => `${o.collectionGroup}.${o.fieldPath}`);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate overrides');
  const exempt = new Set(idx.fieldOverrides.filter((o) => Array.isArray(o.indexes) && o.indexes.length === 0).map((o) => `${o.collectionGroup}.${o.fieldPath}`));

  /* Every analytics query the engine makes, observed on the instrumented db. */
  order('o', { orderNumber: ORD(1), analyticsVid: VID_A, payment: { method: 'cod' }, createdAt: iso(-1 * MIN) });
  const a = await send([pv('/'), purchase(ORD(1))], { vid: VID_A, cart: cartOf(['p1']) });
  await send([pv('/')], as(a, { user: U1, now: at(1 * MIN) })); // stitching back-fill queries by vid
  await liveReport(db, at(2 * MIN));
  for (const range of ['today', '7d']) await rangeReport(db, { range, now: at(2 * MIN) });
  for (const type of ['sessions', 'events']) await exportCsv(db, { range: '7d', type, now: at(2 * MIN) });
  const queried = new Set(db.log.queries.filter((q) => q.col.startsWith('analytics_')).flatMap((q) => q.filters.map(([f]) => `${q.col}.${f}`)));
  /* …and the customers page's visitor cards (src/app/api/admin/site-visits). */
  queried.add('analytics_visitors.lastSeenAt');
  for (const must of ['analytics_sessions.lastSeenAt', 'analytics_sessions.cartDay', 'analytics_sessions.vid', 'analytics_sessions.dateKey',
    'analytics_events.dateKey', 'analytics_visitors.lastSeenAtReg', 'analytics_daily.dateKey']) assert.ok(queried.has(must), `observed ${must}`);
  for (const q of queried) assert.ok(!exempt.has(q), `${q} is queried but exempt from indexing`);

  for (const f of ['type', 'at', 'vid', 'sid', 'userId', 'path', 'productId', 'productName', 'qty', 'channel', 'device', 'regionKey']) {
    assert.ok(exempt.has(`analytics_events.${f}`), `analytics_events.${f}`);
  }
  for (const f of ['updatedAt', 'activeSeconds', 'pendingActive', 'events', 'pageviews', 'currentPath', 'landingPath', 'cartItems', 'cartValue', 'triedProducts', 'batchIds', 'revenue', 'ipMasked']) {
    assert.ok(exempt.has(`analytics_sessions.${f}`), `analytics_sessions.${f}`);
  }
});

/* ══ 14. No bcrypt hash at module load ══ */

test('sign-in: the timing-equaliser hash is a precomputed cost-10 bcrypt — nothing is hashed when the module loads', () => {
  const code = srcText('app/api/auth/[...nextauth]/route.js');
  assert.doesNotMatch(code, /hashSync\s*\(/);
  const m = /const DUMMY_HASH = '([^']+)'/.exec(code);
  assert.ok(m, 'DUMMY_HASH constant');
  assert.equal(bcrypt.getRounds(m[1]), 10);
  assert.equal(bcrypt.compareSync('timing-equaliser', m[1]), true, 'a real bcrypt hash, so compare() costs the same as for a real account');
  assert.equal(bcrypt.compareSync('anything else', m[1]), false);
});

/* ══ Second round: what the fix verification found ══ */

test('shopping actions are capped per batch across products, not only per product', async () => {
  const many = {};
  for (let i = 0; i < 30; i += 1) many[`q${i}`] = { name: `Piece ${i}`, price: 1000 + i };
  db = instrumented({ ...seed(), products: { ...seed().products, ...many } });
  const ids = Object.keys(many);
  await send([
    ...ids.map((id) => ({ type: 'product_view', productId: id })),
  ]);
  await send([...ids.map((id) => ({ type: 'tryon_open', productId: id, mode: 'ai' }))], { tab: 'tab0002' });
  await send([...ids.map((id) => ({ type: 'add_to_cart', productId: id, qty: 1 }))], { tab: 'tab0003' });
  const d = daily();
  assert.ok(d.productViews <= 5, `views ${d.productViews}`);
  assert.ok(d.tryons <= 5, `try-ons ${d.tryons}`);
  assert.ok(d.addToCarts <= 6, `adds ${d.addToCarts}`);
});

test('cart pricing: repeated ids are one line, quantities stop at the stock, hidden products do not count, an unchanged cart is not re-priced', async () => {
  db = instrumented({
    ...seed(),
    products: {
      ...seed().products,
      rare: { name: 'Antique Haram', price: 250000, stock: 1 },
      hidden: { name: 'Draft', price: 9000, isActive: false },
      paused: { name: 'Paused seller', price: 9000, showMe: false },
    },
  });
  const crafted = { items: [
    ...Array.from({ length: 10 }, () => ({ id: 'rare', qty: 99, price: 1 })),
    { id: 'hidden', qty: 1, price: 1 },
    { id: 'paused', qty: 1, price: 1 },
    { id: 'p1', qty: 2, price: 1 },
  ] };
  const first = await step(() => send([pv('/cart')], { cart: crafted }));
  const s = get('analytics_sessions', first.out.sid);
  assert.deepEqual([s.cartItems, s.cartValue], [3, 250000 + 2 * 1500], 'one Antique Haram (stock 1) + two Temple Jhumkas');
  assert.ok(first.reads.some((r) => r === 'products/rare'));

  /* Same cart on the next batch (every batch carries it): no product reads. */
  _resetCaches();
  const again = await step(() => send([{ type: 'heartbeat', active: 10 }], as(first.out, { now: at(30 * SEC), cart: crafted })));
  assert.deepEqual(again.reads.filter((r) => r.startsWith('products/')), [], 'unchanged cart: values kept, nothing re-read');
  assert.equal(get('analytics_sessions', first.out.sid).cartValue, 253000);
});

test('a retried batch is dropped even when it lands after IST midnight', async () => {
  const late = new Date('2026-10-16T18:29:50Z'); // 23:59:50 IST
  const a = await send([pv('/')], { vid: VID_A, now: late, n: 0 });
  await send([pv('/shop')], as(a, { now: at(8 * SEC, late), n: 1 })); // 23:59:58
  const retry = await send([pv('/shop')], as(a, { now: at(18 * SEC, late), n: 1 })); // 00:00:08, same (tab, n)
  assert.equal(retry.accepted, 0);
  assert.equal(daily(TODAY).pageviews, 2);
  assert.equal(daily('2026-10-17').pageviews, undefined, 'not counted again on the new day');
});

test('sign-in: unknown customers are compared against a cost-12 dummy hash (customer passwords are cost 12)', () => {
  const code = srcText('app/api/auth/[...nextauth]/route.js');
  const m = /const DUMMY_HASH_CUSTOMER = '([^']+)'/.exec(code);
  assert.ok(m, 'DUMMY_HASH_CUSTOMER constant');
  assert.equal(bcrypt.getRounds(m[1]), 12);
  assert.equal(bcrypt.compareSync('timing-equaliser', m[1]), true);
  assert.match(code, /user\?\.password \|\| DUMMY_HASH_CUSTOMER/);
  assert.match(code, /staff\?\.password \|\| DUMMY_HASH\)/);
  assert.match(srcText('app/api/auth/register/route.js'), /bcrypt\.hash\(password, 12\)/, 'customer cost still 12');
});

test('names: a failed read is not remembered as "no name"', async () => {
  await send([pv('/')], { vid: VID_A, user: U1 });
  const realGetAll = db.getAll;
  /* The users read fails once (UNAVAILABLE), then works. */
  db.getAll = () => Promise.reject(grpcError(14));
  const first = await liveReport(db, at(1 * MIN));
  assert.equal(first.sessions[0].name, 'Customer');
  db.getAll = realGetAll;
  const second = await liveReport(db, at(2 * MIN));
  assert.equal(second.sessions[0].name, 'Priya Raman', 'asked again on the next poll');
  /* A customer who really doesn't exist is remembered (no re-read every poll). */
  db.store.get('users').delete('u1');
  _resetReportCaches();
  await liveReport(db, at(3 * MIN));
  const reads = await step(() => liveReport(db, at(4 * MIN)));
  assert.deepEqual(reads.reads.filter((r) => r.startsWith('users/')), [], 'missing customer cached');
});
