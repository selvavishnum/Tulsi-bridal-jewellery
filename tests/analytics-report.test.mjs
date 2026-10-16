/* ─────────────────────────────────────────────
   Visitor analytics — reporting (src/lib/analytics/report.js): IST ranges,
   rollup merging, the dashboard's range report and live view, and the CSV
   export. Data is produced by the real ingestBatch wherever possible, so
   these tests also pin that what ingestion writes is what reporting reads.

   NOW = 2026-10-16T08:00:00Z = 13:30 IST on 2026-10-16.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeFirestore, INC } from './helpers/fakeFirestore.mjs';

const src = (p) => pathToFileURL(path.resolve('src', p)).href;
let db;
mock.module(src('lib/firebase.js'), {
  namedExports: { getDB: () => db, FieldValue: { increment: (n) => ({ [INC]: n }) } },
});

const { ingestBatch, _resetCaches } = await import(src('lib/analytics/ingest.js'));
const { parseBatch } = await import(src('lib/analytics/events.js'));
const {
  rangeBounds, mergeRollups, readDaily, countOf, liveReport, rangeReport, funnelRows, csvCell, csvLine, toIst, exportCsv, EXPORT_LIMITS,
} = await import(src('lib/analytics/report.js'));

const NOW = new Date('2026-10-16T08:00:00Z');
const TODAY = '2026-10-16';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms, from = NOW) => new Date(from.getTime() + ms);
const iso = (ms = 0, from = NOW) => at(ms, from).toISOString();

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
};
const GEO = {
  TN: { country: 'IN', regionCode: 'TN', region: 'Tamil Nadu', city: 'Madurai', regionKey: 'IN-TN' },
  KA: { country: 'IN', regionCode: 'KA', region: 'Karnataka', city: 'Bengaluru', regionKey: 'IN-KA' },
  US: { country: 'US', regionCode: 'CA', region: 'CA', city: 'San Jose', regionKey: 'US' },
};
const vidOf = (c) => `tj_vid_${c.repeat(22)}`;
const VID = { A: vidOf('A'), B: vidOf('B'), C: vidOf('C'), D: vidOf('D') };
const ORD = (n) => `TBJ17606000000000${n}`;

beforeEach(() => {
  _resetCaches();
  db = fakeFirestore({
    products: {
      p1: { name: 'Temple Jhumka', slug: 'temple-jhumka', category: 'earrings', price: 2000, discountPrice: 1500, images: ['https://img.test/p1.jpg'] },
      p2: { name: 'Kundan Choker', slug: 'kundan-choker', category: 'necklaces', price: 5000, images: [] },
    },
    users: { u1: { name: 'Priya Raman' }, u2: { name: 'Meena K' } },
    orders: {},
  });
});

let n = 0;
function send(events, { vid, sid, user = null, now = NOW, ua = UA.android, geo = GEO.TN, cart } = {}) {
  const r = parseBatch({ tab: 'tab0001', n: n++, ...(cart && { cart }), events: events.map((e, i) => ({ seq: i, ...e })) });
  assert.ok(r.batch, r.error);
  return ingestBatch(db, { vid, sid, user, ctx: { ua, ipMasked: '49.37.x.x', geo, siteHost: 'tulsi.test', now }, batch: r.batch });
}
const pv = (p, extra = {}) => ({ type: 'page_view', path: p, ...extra });
const order = (id, d) => db.store.get('orders').set(id, { status: 'confirmed', userId: null, total: 1000, ...d });

/** Four visitors today (see the assertions for what each did). */
async function seedToday() {
  order('mine', { orderNumber: ORD(1), analyticsVid: VID.A, payment: { method: 'razorpay', status: 'paid' }, total: 3000, createdAt: iso(-5 * MIN) });
  order('phoneCod', { orderNumber: ORD(7), status: 'pending', payment: { method: 'cod', status: 'pending' }, total: 1800, createdAt: iso(-2 * HOUR) });
  order('pendingOnline', { orderNumber: ORD(8), status: 'pending', payment: { method: 'razorpay', status: 'pending' }, total: 9000, createdAt: iso(-1 * HOUR) });
  order('cancelled', { orderNumber: ORD(9), status: 'cancelled', payment: { method: 'razorpay', status: 'paid' }, total: 9000, createdAt: iso(-1 * HOUR) });
  order('lastNight', { orderNumber: ORD(10), payment: { method: 'razorpay', status: 'paid' }, total: 700, createdAt: '2026-10-15T18:29:59.000Z' }); // 23:59:59 IST yesterday
  order('midnight', { orderNumber: ORD(11), payment: { method: 'razorpay', status: 'paid' }, total: 500, createdAt: '2026-10-15T18:30:00.000Z' }); // 00:00 IST today
  /* A — Instagram campaign, phone, tries on, buys. */
  const a = await send([
    pv('/', { utm: { source: 'ig', campaign: 'diwali' } }), pv('/product/p1'),
    { type: 'product_view', productId: 'p1' }, { type: 'tryon_open', productId: 'p1', mode: 'ai' }, { type: 'tryon_tone', tone: 'wheatish' },
    { type: 'add_to_cart', productId: 'p1', qty: 1 }, { type: 'checkout_start' }, { type: 'purchase', orderNumber: ORD(1) },
  ], { vid: VID.A });
  /* B — signed-in customer from Google on a Windows PC, 12:30 IST. */
  const b = await send([
    pv('/shop/necklaces', { referrer: 'https://www.google.co.in/' }),
    { type: 'product_view', productId: 'p2' }, { type: 'product_view', productId: 'p1' }, { type: 'heartbeat', active: 20 },
  ], { vid: VID.B, user: { id: 'u1' }, ua: UA.edge, geo: GEO.KA, now: at(-1 * HOUR) });
  /* C — iPhone in the US, one page, 10:30 IST. */
  const c = await send([pv('/')], { vid: VID.C, ua: UA.iphone, geo: GEO.US, now: at(-3 * HOUR) });
  /* D — Mac, one page, 13:00 IST. */
  const d = await send([pv('/about')], { vid: VID.D, ua: UA.mac, now: at(-30 * MIN) });
  return { a, b, c, d };
}
const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));

/* ── Ranges ── */

test('rangeBounds: IST calendar days for today / yesterday / 7d / 30d', () => {
  const t = rangeBounds('today', NOW);
  assert.deepEqual({ ...t, start: t.start.toISOString(), end: t.end.toISOString() }, {
    range: 'today', label: 'Today', dateKeys: [TODAY], start: '2026-10-15T18:30:00.000Z', end: NOW.toISOString(), includesToday: true,
  });
  const y = rangeBounds('yesterday', NOW);
  assert.deepEqual([y.dateKeys, y.start.toISOString(), y.end.toISOString(), y.includesToday], [['2026-10-15'], '2026-10-14T18:30:00.000Z', '2026-10-15T18:30:00.000Z', false]);
  const w = rangeBounds('7d', NOW);
  assert.deepEqual(w.dateKeys, ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  assert.equal(w.start.toISOString(), '2026-10-09T18:30:00.000Z');
  assert.equal(w.end, NOW);
  const m = rangeBounds('30d', NOW);
  assert.equal(m.dateKeys.length, 30);
  assert.deepEqual([m.dateKeys[0], m.dateKeys[29]], ['2026-09-17', TODAY]);
  assert.equal(m.start.toISOString(), '2026-09-16T18:30:00.000Z');
  assert.equal(new Set(m.dateKeys).size, 30, 'no duplicate or skipped days');
  for (const bad of ['all', '', undefined, '__proto__', 'constructor', 'toString']) assert.equal(rangeBounds(bad, NOW).range, 'today', String(bad));
});

test('rangeBounds: late evening UTC is already the next day in India', () => {
  const lateUtc = new Date('2026-10-16T20:00:00Z'); // 01:30 IST, 17 Oct
  const t = rangeBounds('today', lateUtc);
  assert.deepEqual(t.dateKeys, ['2026-10-17']);
  assert.equal(t.start.toISOString(), '2026-10-16T18:30:00.000Z');
  assert.deepEqual(rangeBounds('yesterday', lateUtc).dateKeys, ['2026-10-16']);
  assert.equal(rangeBounds('yesterday', lateUtc).end.toISOString(), '2026-10-16T18:30:00.000Z');
  const w = rangeBounds('7d', lateUtc);
  assert.deepEqual([w.dateKeys[0], w.dateKeys[6]], ['2026-10-11', '2026-10-17']);
  const justBefore = new Date('2026-10-16T18:29:59Z'); // 23:59:59 IST, 16 Oct
  assert.deepEqual(rangeBounds('today', justBefore).dateKeys, [TODAY]);
});

/* ── Rollups ── */

test('mergeRollups deep-sums numeric leaves and ignores junk', () => {
  const merged = mergeRollups([
    { dateKey: '2026-10-16', sessions: 1, channels: { direct: 1 }, products: { p1: { v: 1, a: 1 } }, hours: { 13: { s: 1 } } },
    { dateKey: '2026-10-16', sessions: 2, channels: { direct: 2, instagram: 1 }, products: { p1: { v: 2 }, p2: { t: 1 } }, hours: { 13: { s: 1, p: 4 } } },
    { sessions: 'lots', channels: 7, weird: [1, 2], when: new Date(), nan: NaN, inf: Infinity, guests: -1 },
    { guests: 2 },
    null,
  ].filter(Boolean));
  assert.deepEqual(merged, {
    sessions: 3, channels: { direct: 3, instagram: 1 }, products: { p1: { v: 3, a: 1 }, p2: { t: 1 } }, hours: { 13: { s: 2, p: 4 } }, guests: 1,
  });
  assert.deepEqual(mergeRollups([]), {});
});

test('readDaily: shards of each day merged, days outside the range ignored', async () => {
  const col = db.store.get('analytics_daily') || db.store.set('analytics_daily', new Map()).get('analytics_daily');
  col.set('2026-10-15_0', { dateKey: '2026-10-15', sessions: 1 });
  col.set('2026-10-15_3', { dateKey: '2026-10-15', sessions: 2 });
  col.set('2026-10-16_1', { dateKey: '2026-10-16', sessions: 4 });
  col.set('2026-10-17_0', { dateKey: '2026-10-17', sessions: 100 });
  col.set('2026-10-14_0', { dateKey: '2026-10-14', sessions: 100 });
  const { days, total } = await readDaily(db, ['2026-10-15', '2026-10-16']);
  assert.deepEqual(days, [{ dateKey: '2026-10-15', sessions: 3 }, { dateKey: '2026-10-16', sessions: 4 }]);
  assert.deepEqual(total, { sessions: 7 });
});

test('countOf: count() aggregation, with a capped-read fallback', async () => {
  for (let i = 0; i < 3; i += 1) await db.collection('analytics_visitors').doc(`v${i}`).set({ lastSeenAt: iso(-i * DAY) });
  assert.deepEqual(await countOf(db.collection('analytics_visitors').where('lastSeenAt', '>=', iso(-1 * DAY))), { n: 2, exact: true });
  const q = db.collection('analytics_visitors');
  const noCount = { limit: (k) => q.limit(k) };
  assert.deepEqual(await countOf(noCount, 2), { n: 2, exact: false }, 'cap reached → not exact');
  assert.deepEqual(await countOf(noCount, 10), { n: 3, exact: true });
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const broken = { count: () => ({ get: async () => { throw new Error('aggregation unavailable'); } }), limit: (k) => q.limit(k) };
    assert.deepEqual(await countOf(broken), { n: 3, exact: true });
  } finally {
    console.error = origError;
  }
  assert.equal(errors.length, 1);
});

test('funnelRows: share of visits, share of the previous step, drop-off', () => {
  const rows = funnelRows({ sessions: 200, product: 80, tryon: 20, cart: 30, checkout: 12, paid: 9 });
  assert.deepEqual(rows.map((r) => [r.key, r.count, r.ofVisits, r.ofPrevious, r.dropOff, r.optional]), [
    ['sessions', 200, 100, 100, 0, false],
    ['product', 80, 40, 40, 120, false],
    ['tryon', 20, 10, 25, 60, true],
    ['cart', 30, 15, 37.5, 50, false],
    ['checkout', 12, 6, 40, 18, false],
    ['paid', 9, 4.5, 75, 3, false],
  ]);
  assert.ok(funnelRows({}).every((r) => r.count === 0 && r.ofVisits === 0 && r.dropOff === 0));
  assert.deepEqual(funnelRows({ sessions: 1, product: 3 })[1].dropOff, 0, 'never a negative drop-off');
});

/* ── Range report ── */

test('rangeReport today: visitors, KPIs, funnel, sources, devices, regions, pages, products, hourly series', async () => {
  await seedToday();
  const r = await rangeReport(db, { range: 'today', now: NOW });
  assert.deepEqual([r.range, r.label, r.from, r.to, r.generatedAt], ['today', 'Today', TODAY, TODAY, NOW.toISOString()]);
  assert.deepEqual(r.visitors, { visitors: 4, registered: 1, guests: 3, newVisitors: 4, exact: true });
  assert.deepEqual(r.kpis, {
    sessions: 4, pageviews: 5, pagesPerSession: 1.3, avgActiveSeconds: 5,
    engagedSessions: 2, bounceRate: 50,
    productViews: 3, tryons: 1, addToCarts: 1, checkouts: 1,
    orders: 3, revenue: 5300, trackedOrders: 1, conversionRate: 75, cartAbandonmentRate: 0,
  });
  assert.deepEqual(r.funnel.map((f) => [f.key, f.count, f.ofPrevious]), [
    ['sessions', 4, 100], ['product', 2, 50], ['tryon', 1, 50], ['cart', 1, 50], ['checkout', 1, 100], ['paid', 1, 100],
  ]);

  const sources = byKey(r.sources);
  assert.equal(r.sources[0].key, 'direct', 'sorted by sessions');
  assert.deepEqual(sources.direct, { key: 'direct', label: 'Direct', count: 2, share: 50, orders: 0, revenue: 0, conversion: 0 });
  assert.deepEqual(sources.instagram, { key: 'instagram', label: 'Instagram', count: 1, share: 25, orders: 1, revenue: 3000, conversion: 100 });
  assert.deepEqual(sources.google_organic, { key: 'google_organic', label: 'Google Organic', count: 1, share: 25, orders: 0, revenue: 0, conversion: 0 });

  assert.deepEqual(byKey(r.devices), { mobile: { key: 'mobile', label: 'mobile', count: 2, share: 50 }, desktop: { key: 'desktop', label: 'desktop', count: 2, share: 50 } });
  assert.deepEqual(r.os.map((o) => o.key).sort(), ['android', 'ios', 'macos', 'windows']);
  assert.deepEqual(r.browsers.map((o) => [o.key, o.count]).sort(), [['chrome', 1], ['edge', 1], ['safari', 2]]);
  assert.equal(r.regions[0].key, 'IN-TN');
  assert.deepEqual(Object.fromEntries(r.regions.map((x) => [x.key, [x.label, x.count]])), { 'IN-TN': ['Tamil Nadu', 2], 'IN-KA': ['Karnataka', 1], US: ['United States', 1] });
  assert.deepEqual(Object.fromEntries(r.pages.map((p) => [p.label, p.count])), { '/': 2, '/product/[id]': 1, '/shop/[category]': 1, '/about': 1 });
  assert.deepEqual(r.tryon, {
    opens: 1,
    modes: [{ key: 'ai', label: 'AI model', count: 1, share: 100 }],
    tones: [{ key: 'wheatish', label: 'Wheatish', count: 1, share: 100 }],
  });
  assert.deepEqual(r.topProducts, [
    { id: 'p1', views: 2, tryons: 1, addToCarts: 1, name: 'Temple Jhumka', image: 'https://img.test/p1.jpg', price: 1500, category: 'earrings', slug: 'temple-jhumka', tryonRate: 50, cartRate: 50 },
    { id: 'p2', views: 1, tryons: 0, addToCarts: 0, name: 'Kundan Choker', image: null, price: 5000, category: 'necklaces', slug: 'kundan-choker', tryonRate: 0, cartRate: 0 },
  ]);

  assert.equal(r.series.unit, 'hour');
  assert.equal(r.series.points.length, 24);
  assert.deepEqual(r.series.points.map((p) => p.key), Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')));
  assert.deepEqual(r.series.points[13], { key: '13', label: '13:00', sessions: 2, pageviews: 3 });
  assert.deepEqual(r.series.points[12], { key: '12', label: '12:00', sessions: 1, pageviews: 1 });
  assert.deepEqual(r.series.points[10], { key: '10', label: '10:00', sessions: 1, pageviews: 1 });
  assert.equal(r.series.points.reduce((a, p) => a + p.sessions, 0), 4);
});

test('rangeReport: a removed product still shows, by id', async () => {
  await send([{ type: 'product_view', productId: 'p2' }]);
  db.store.get('products').delete('p2');
  const r = await rangeReport(db, { range: 'today', now: NOW });
  assert.deepEqual([r.topProducts[0].id, r.topProducts[0].name, r.topProducts[0].price], ['p2', 'Removed product', 0]);
});

test('rangeReport yesterday: that day only; conversion from that day’s real orders', async () => {
  await seedToday();
  const r = await rangeReport(db, { range: 'yesterday', now: NOW });
  assert.deepEqual([r.from, r.to], ['2026-10-15', '2026-10-15']);
  assert.equal(r.kpis.sessions, 0);
  assert.equal(r.kpis.orders, 1, 'the 23:59 IST order belongs to yesterday');
  assert.equal(r.kpis.revenue, 700);
  assert.equal(r.kpis.conversionRate, 0, 'no visitors → 0, not Infinity');
  assert.equal(r.kpis.bounceRate, 0);
  assert.equal(r.series.points.length, 24);
  assert.ok(r.series.points.every((p) => p.sessions === 0));
  assert.deepEqual(r.sources, []);
});

test('rangeReport 7d / 30d: unique visitors are distinct browsers (count() on visitors), not a sum of days', async () => {
  await send([pv('/')], { vid: VID.A, now: at(-6 * DAY) });
  await send([pv('/')], { vid: VID.A, user: { id: 'u1' }, now: at(-3 * DAY) });
  await send([pv('/'), pv('/shop')], { vid: VID.A, now: NOW }); // signed out today, but the browser is a customer's
  await send([pv('/')], { vid: VID.C, now: at(-1 * DAY) });
  await send([pv('/')], { vid: VID.B, now: at(-10 * DAY) });

  const w = await rangeReport(db, { range: '7d', now: NOW });
  assert.deepEqual([w.from, w.to], ['2026-10-10', TODAY]);
  assert.deepEqual(w.visitors, { visitors: 2, registered: 1, guests: 1, newVisitors: 2, exact: true });
  assert.equal(w.series.unit, 'day');
  assert.equal(w.series.points.length, 7);
  assert.deepEqual(w.series.points.map((p) => p.key), ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  assert.equal(w.series.points[0].label, '10-10');
  assert.equal(w.series.points.reduce((a, p) => a + p.visitors, 0), 4, 'the daily sum would say 4');
  assert.deepEqual(w.series.points.map((p) => p.sessions), [1, 0, 0, 1, 0, 1, 1]);
  assert.equal(w.kpis.sessions, 4);
  assert.equal(w.kpis.pageviews, 5);

  const m = await rangeReport(db, { range: '30d', now: NOW });
  assert.equal(m.visitors.visitors, 3);
  assert.equal(m.visitors.newVisitors, 3);
  assert.equal(m.series.points.length, 30);
});

test('rangeReport: conversion counts paid-online and COD orders in the range — not cancelled, not pending online', async () => {
  order('a', { createdAt: iso(-1 * HOUR), payment: { method: 'razorpay', status: 'paid' }, total: 1000 });
  order('b', { createdAt: iso(-2 * HOUR), status: 'pending', payment: { method: 'cod', status: 'pending' }, total: 250.255 });
  order('c', { createdAt: iso(-3 * HOUR), status: 'pending', payment: { method: 'razorpay', status: 'pending' }, total: 5000 });
  order('d', { createdAt: iso(-4 * HOUR), status: 'cancelled', payment: { method: 'cod', status: 'pending' }, total: 5000 });
  order('e', { createdAt: iso(-3 * DAY), payment: { method: 'razorpay', status: 'paid' }, total: 5000 });
  order('f', { createdAt: iso(+1 * MIN), payment: { method: 'razorpay', status: 'paid' }, total: 5000 }); // after `now`
  order('g', { createdAt: iso(-5 * HOUR), status: 'delivered', payment: { method: 'cod', status: 'paid' }, total: 100 });
  for (const c of 'ABCD') await send([pv('/')], { vid: VID[c] });
  const r = await rangeReport(db, { range: 'today', now: NOW });
  assert.equal(r.kpis.orders, 3);
  assert.equal(r.kpis.revenue, 1350.26);
  assert.equal(r.kpis.conversionRate, 75);
  assert.equal(r.kpis.trackedOrders, 0, 'none of them was credited to a visit');
  const w = await rangeReport(db, { range: '7d', now: NOW });
  assert.equal(w.kpis.orders, 4);
});

/* ── Live ── */

test('liveReport: sessions seen in the last 5 minutes; carts split into abandoned vs still shopping', async () => {
  const s = (id, d) => db.collection('analytics_sessions').doc(id).set({
    sid: id, vid: VID.A, dateKey: TODAY, startedAt: iso(-20 * MIN), channel: 'direct', device: 'mobile', os: 'android', browser: 'chrome',
    regionKey: 'IN-TN', region: 'Tamil Nadu', city: 'Madurai', country: 'IN', ipMasked: '49.37.x.x', pageviews: 2, activeSeconds: 40,
    cartItems: 0, cartValue: 0, cartDay: null, userId: null, ...d,
  });
  await s('live1', { vid: VID.A, userId: 'u1', lastSeenAt: iso(-1 * MIN), currentPath: '/product/p1', viewedProduct: true, triedOn: true, channel: 'instagram', campaign: 'diwali' });
  await s('live2', { vid: VID.A, userId: 'u1', lastSeenAt: iso(-2 * MIN) }); // same browser, second tab/session
  await s('live3', { vid: VID.B, lastSeenAt: iso(-4 * MIN - 59_000), regionKey: 'US', region: '', addedToCart: true, channel: 'bogus' });
  await s('gone', { vid: VID.C, lastSeenAt: iso(-5 * MIN - 1000) });
  await s('abandoned', { vid: VID.D, userId: 'u2', lastSeenAt: iso(-45 * MIN), cartItems: 2, cartValue: 5000, cartDay: TODAY });
  await s('abandonedGuest', { vid: vidOf('E'), lastSeenAt: iso(-31 * MIN), cartItems: 1, cartValue: 700.5, cartDay: TODAY });
  await s('shopping', { vid: vidOf('F'), lastSeenAt: iso(-10 * MIN), cartItems: 1, cartValue: 1200, cartDay: TODAY });
  await s('bought', { vid: vidOf('G'), lastSeenAt: iso(-50 * MIN), cartItems: 3, cartValue: 9000, cartDay: TODAY, purchased: true });
  await s('yesterdayCart', { vid: vidOf('H'), dateKey: '2026-10-15', lastSeenAt: iso(-20 * HOUR), cartItems: 4, cartValue: 9999, cartDay: '2026-10-15' });

  const r = await liveReport(db, NOW);
  assert.equal(r.generatedAt, NOW.toISOString());
  assert.equal(r.activeVisitors, 2, 'unique browsers, not sessions');
  assert.equal(r.activeRegistered, 1);
  assert.deepEqual(r.sessions.map((x) => x.sid), ['live1', 'live2', 'live3'], 'most recent first');
  const [first, , third] = r.sessions;
  assert.deepEqual(first, {
    sid: 'live1', visitor: 'AAAAAAAA', ip: '49.37.x.x', registered: true, name: 'Priya Raman',
    city: 'Madurai', region: 'Tamil Nadu', country: 'IN', device: 'mobile', os: 'android', browser: 'chrome',
    channel: 'instagram', channelLabel: 'Instagram', source: '', campaign: 'diwali', landingPath: '', currentPath: '/product/p1',
    pageviews: 2, activeSeconds: 40, durationSeconds: 19 * 60, startedAt: iso(-20 * MIN), lastSeenAt: iso(-1 * MIN),
    cartItems: 0, cartValue: 0, stage: 'tryon',
  });
  assert.deepEqual([third.registered, third.name, third.region, third.stage, third.channelLabel], [false, '', 'United States', 'cart', 'Direct']);
  assert.deepEqual(
    { abandoned: r.carts.abandoned, abandonedValue: r.carts.abandonedValue, open: r.carts.open, openValue: r.carts.openValue },
    { abandoned: 2, abandonedValue: 5700.5, open: 1, openValue: 1200 },
  );
  assert.deepEqual(r.carts.recent.map((x) => [x.sid, x.name, x.cartItems, x.cartValue]), [['abandoned', 'Meena K', 2, 5000], ['abandonedGuest', '', 1, 700.5]]);
});

test('liveReport: an unknown customer id shows as “Customer”, and an empty site is all zeros', async () => {
  let r = await liveReport(db, NOW);
  assert.deepEqual([r.activeVisitors, r.activeRegistered, r.sessions, r.carts.abandoned, r.carts.open, r.carts.recent], [0, 0, [], 0, 0, []]);
  await db.collection('analytics_sessions').doc('x').set({ sid: 'x', vid: VID.A, userId: 'deleted-user', lastSeenAt: iso(-1 * MIN), startedAt: iso(-2 * MIN) });
  r = await liveReport(db, NOW);
  assert.equal(r.sessions[0].name, 'Customer');
  assert.equal(r.sessions[0].stage, 'browsing');
});

test('liveReport reads what ingestion writes', async () => {
  const cart = { items: [{ id: 'p1', name: 'Temple Jhumka', qty: 1, price: 1500 }] };
  await send([pv('/product/p1'), { type: 'add_to_cart', productId: 'p1', qty: 1 }], { vid: VID.A, cart, now: at(-40 * MIN) });
  await send([pv('/cart')], { vid: VID.B, user: { id: 'u1' }, cart, now: at(-2 * MIN) });
  const r = await liveReport(db, NOW);
  assert.equal(r.activeVisitors, 1);
  assert.equal(r.sessions[0].name, 'Priya Raman');
  assert.deepEqual([r.carts.abandoned, r.carts.abandonedValue, r.carts.open, r.carts.openValue], [1, 1500, 1, 1500]);
});

/* ── CSV ── */

test('csvCell: spreadsheet formulas defused; commas, quotes and newlines quoted; numbers left alone', () => {
  assert.equal(csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.equal(csvCell('+91 98765 43210'), "'+91 98765 43210");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@SUM(1)'), "'@SUM(1)");
  assert.equal(csvCell('\t=1'), "'\t=1");
  assert.equal(csvCell('\r=1'), `"'\r=1"`);
  assert.equal(csvCell('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`);
  assert.equal(csvCell('Madurai, TN'), '"Madurai, TN"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(1234.5), '1234.5');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(true), 'yes');
  assert.equal(csvCell(false), 'no');
  assert.equal(csvCell('Tiruchirappalli'), 'Tiruchirappalli');
  assert.equal(csvCell('தஞ்சாவூர்'), 'தஞ்சாவூர்');
  assert.equal(csvLine(['a', 1, '=x', null]), "a,1,'=x,");
});

test('toIst: CSV timestamps in India time', () => {
  assert.equal(toIst('2026-10-16T08:00:00.000Z'), '2026-10-16 13:30:00');
  assert.equal(toIst('2026-10-16T18:35:00Z'), '2026-10-17 00:05:00', 'midnight hour is 00, not 24');
  assert.equal(toIst('nonsense'), '');
  assert.equal(toIst(undefined), '');
});

/** Minimal RFC 4180 parser for checking the export. */
function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const SESSION_HEADER = [
  'session_id', 'visitor_id', 'customer_id', 'visitor_type', 'date', 'started_ist', 'last_seen_ist', 'channel', 'source', 'medium', 'campaign',
  'referrer_host', 'landing_page', 'last_page', 'device', 'os', 'browser', 'city', 'state', 'country', 'ip_masked',
  'pageviews', 'active_seconds', 'duration_seconds', 'viewed_product', 'tried_on', 'added_to_cart', 'reached_checkout', 'purchased',
  'order_numbers', 'revenue', 'cart_items', 'cart_value',
];
const EVENT_HEADER = ['time_ist', 'event', 'visitor_id', 'session_id', 'customer_id', 'page', 'product_id', 'product_name', 'qty', 'tryon_mode', 'skin_tone', 'order_number', 'channel', 'device', 'region'];

test('exportCsv sessions: BOM, header, one row per session in start order, filename', async () => {
  const { a, b } = await seedToday();
  const out = await exportCsv(db, { range: 'today', type: 'sessions', now: NOW });
  assert.equal(out.csv.charCodeAt(0), 0xfeff, 'BOM so Excel reads UTF-8');
  assert.ok(out.csv.endsWith('\r\n'));
  assert.equal(out.filename, 'tulsi-sessions-2026-10-16.csv');
  assert.deepEqual([out.rows, out.truncated], [4, false]);
  const rows = parseCsv(out.csv.slice(1));
  assert.deepEqual(rows[0], SESSION_HEADER);
  assert.equal(rows.length, 5);
  for (const r of rows) assert.equal(r.length, SESSION_HEADER.length);
  const recs = rows.slice(1).map((r) => Object.fromEntries(SESSION_HEADER.map((h, i) => [h, r[i]])));
  assert.deepEqual(recs.map((r) => r.visitor_id), [VID.C, VID.B, VID.D, VID.A], 'sorted by start time');
  const A = recs.find((r) => r.session_id === a.sid);
  assert.deepEqual(
    [A.visitor_type, A.channel, A.campaign, A.started_ist, A.purchased, A.order_numbers, A.revenue, A.tried_on, A.state, A.ip_masked],
    ['guest', 'Instagram', 'diwali', '2026-10-16 13:30:00', 'yes', ORD(1), '3000', 'yes', 'Tamil Nadu', '49.37.x.x'],
  );
  const B = recs.find((r) => r.session_id === b.sid);
  assert.deepEqual(
    [B.customer_id, B.visitor_type, B.channel, B.referrer_host, B.device, B.browser, B.city, B.active_seconds, B.purchased],
    ['u1', 'registered', 'Google Organic', 'google.co.in', 'desktop', 'edge', 'Bengaluru', '20', 'no'],
  );
  assert.ok(!out.csv.includes('priya') && !out.csv.includes('Priya'), 'customers appear by id only');

  const w = await exportCsv(db, { range: '7d', now: NOW });
  assert.equal(w.filename, 'tulsi-sessions-2026-10-10_to_2026-10-16.csv');
  assert.equal(w.rows, 4);
  const y = await exportCsv(db, { range: 'yesterday', now: NOW });
  assert.deepEqual([y.rows, y.filename], [0, 'tulsi-sessions-2026-10-15.csv']);
  assert.equal(parseCsv(y.csv.slice(1)).length, 1, 'header only');
});

test('exportCsv events: header, rows, IST times, region labels', async () => {
  await seedToday();
  const out = await exportCsv(db, { range: 'today', type: 'events', now: NOW });
  assert.equal(out.filename, 'tulsi-events-2026-10-16.csv');
  const stored = [...db.store.get('analytics_events').values()];
  assert.equal(out.rows, stored.length);
  assert.ok(out.rows > 5);
  const rows = parseCsv(out.csv.slice(1));
  assert.deepEqual(rows[0], EVENT_HEADER);
  const recs = rows.slice(1).map((r) => Object.fromEntries(EVENT_HEADER.map((h, i) => [h, r[i]])));
  const times = recs.map((r) => r.time_ist);
  assert.deepEqual(times, [...times].sort(), 'in time order');
  assert.equal(times[0], '2026-10-16 10:30:00');
  const buy = recs.find((r) => r.event === 'purchase');
  assert.deepEqual([buy.order_number, buy.channel, buy.region, buy.visitor_id], [ORD(1), 'Instagram', 'Tamil Nadu', VID.A]);
  const tryon = recs.find((r) => r.event === 'tryon_open');
  assert.deepEqual([tryon.product_id, tryon.product_name, tryon.tryon_mode], ['p1', 'Temple Jhumka', 'ai']);
  assert.ok(recs.some((r) => r.region === 'United States'));
  assert.ok(!recs.some((r) => r.event === 'heartbeat'));
  assert.equal((await exportCsv(db, { range: 'today', type: 'bogus', now: NOW })).filename, 'tulsi-sessions-2026-10-16.csv', 'unknown type → sessions');
});

test('exportCsv: stored text that looks like a formula is defused in the file', async () => {
  await db.collection('analytics_sessions').doc('evil').set({
    sid: 'evil', vid: VID.A, dateKey: TODAY, startedAt: iso(), lastSeenAt: iso(), channel: 'direct',
    city: '=HYPERLINK("http://evil.example","Click")', campaign: '+cmd|calc', landingPath: '@SUM(1)', currentPath: '-1+1',
  });
  const out = await exportCsv(db, { range: 'today', now: NOW });
  const rec = Object.fromEntries(SESSION_HEADER.map((h, i) => [h, parseCsv(out.csv.slice(1))[1][i]]));
  assert.equal(rec.city, `'=HYPERLINK("http://evil.example","Click")`);
  assert.equal(rec.campaign, "'+cmd|calc");
  assert.equal(rec.landing_page, "'@SUM(1)");
  assert.equal(rec.last_page, "'-1+1");
});

test('exportCsv: capped at the export limit, with the truncated flag', async () => {
  const col = db.store.get('analytics_sessions') || db.store.set('analytics_sessions', new Map()).get('analytics_sessions');
  const cap = EXPORT_LIMITS.sessions;
  for (let i = 0; i <= cap; i += 1) col.set(`s${i}`, { sid: `s${i}`, vid: VID.A, dateKey: TODAY, startedAt: iso(-i * 1000), lastSeenAt: iso() });
  const out = await exportCsv(db, { range: 'today', now: NOW });
  assert.equal(out.rows, cap);
  assert.equal(out.truncated, true);
  assert.equal(out.csv.split('\r\n').length - 1, cap + 1, 'header + cap rows');
  col.delete('s0');
  const exact = await exportCsv(db, { range: 'today', now: NOW });
  assert.deepEqual([exact.rows, exact.truncated], [cap, false]);
});

test('liveReport: a cart follows the shopper — an earlier visit of the same browser is not also an abandoned cart', async () => {
  const cart = { items: [{ id: 'p1', name: 'Temple Jhumka', qty: 1, price: 1500 }] };
  /* Visit 1 at 09:30 IST with a cart, then gone for 2 hours. */
  const first = await send([pv('/product/p1'), { type: 'add_to_cart', productId: 'p1' }], { vid: VID.A, now: at(-4 * HOUR), cart });
  /* Visit 2 (new session, same browser) at 13:28 IST, still has the cart. */
  const second = await send([pv('/cart')], { vid: first.vid, sid: first.sid, now: at(-2 * MIN), cart });
  assert.notEqual(second.sid, first.sid, 'idle > 30 min starts a new visit');
  assert.equal(db.store.get('analytics_sessions').get(first.sid).cartDay, null, 'old visit hands its cart over');

  const live = await liveReport(db, NOW);
  assert.equal(live.carts.open, 1, 'the shopper is still shopping');
  assert.equal(live.carts.abandoned, 0, 'and is not counted as abandoned as well');

  /* Belt and braces: two sessions of one browser both marked with today's
     cart (e.g. written before this rule) still count once — the latest. */
  db.store.get('analytics_sessions').get(first.sid).cartDay = TODAY;
  const again = await liveReport(db, NOW);
  assert.equal(again.carts.open + again.carts.abandoned, 1);
  assert.equal(again.carts.open, 1);
});
