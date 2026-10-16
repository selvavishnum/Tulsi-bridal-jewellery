/* ─────────────────────────────────────────────
   Visitor analytics — ingestion (src/lib/analytics/ingest.js) against the
   in-memory Firestore, with FieldValue.increment mocked so the sharded
   rollup counters are real numbers. Every batch goes through parseBatch
   first, exactly as POST /api/analytics/track does, and every call passes
   a fixed `now` so dates, hours and idle timeouts are deterministic.

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

const { ingestBatch, _resetCaches, VID_RE, SID_RE, SHARDS } = await import(src('lib/analytics/ingest.js'));
const { parseBatch } = await import(src('lib/analytics/events.js'));
const { CHANNELS, encodeKey, routeKey, geoFromHeaders } = await import(src('lib/analytics/classify.js'));

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
const UA_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91';
const GEO_TN = { country: 'IN', regionCode: 'TN', region: 'Tamil Nadu', city: 'Madurai', regionKey: 'IN-TN' };
const U1 = { id: 'u1' };
const VID_A = `tj_vid_${'A'.repeat(22)}`;
const VID_B = `tj_vid_${'B'.repeat(22)}`;

const seed = () => ({
  products: {
    p1: { name: 'Temple Jhumka', slug: 'temple-jhumka', category: 'earrings', price: 2000, discountPrice: 1500, images: ['https://img.test/p1.jpg'] },
    p2: { name: 'Kundan Choker', slug: 'kundan-choker', category: 'necklaces', price: 5000, images: [] },
    p3: { name: 'Odd one', category: 'Bad Category!', price: 100 },
  },
  users: {
    u1: { name: 'Priya', email: 'priya@x.test', sessionCount: 4, categoryInterests: { earrings: 2 }, recentPages: [], visitorIds: ['tj_vid_previousBrowser00000000'] },
    u2: { name: 'Meena', email: 'meena@x.test' },
  },
  orders: {},
});

let autoN = 0;
beforeEach(() => {
  _resetCaches();
  db = fakeFirestore(seed());
  autoN = 0;
});

/** A batch exactly as the endpoint builds it (through parseBatch). */
function batchOf(events, { tab = 'tab0001', n, cart, final } = {}) {
  const r = parseBatch({ tab, n: n ?? autoN++, ...(final && { final: true }), ...(cart && { cart }), events: events.map((e, i) => ({ seq: i, ...e })) });
  assert.ok(r.batch, `test batch rejected: ${r.error}`);
  return r.batch;
}

function send(events, { vid, sid, user = null, now = NOW, ua = UA_ANDROID, geo = GEO_TN, ipMasked = '49.37.x.x', tab, n, cart, final } = {}) {
  return ingestBatch(db, { vid, sid, user, ctx: { ua, ipMasked, geo, siteHost: 'tulsi.test', now }, batch: batchOf(events, { tab, n, cart, final }) });
}
/** Continue as the same browser (the cookies the route would send back). */
const as = (prev, extra = {}) => ({ vid: prev.vid, sid: prev.sid, ...extra });

/* ── Reading the fake ── */
const all = (col) => [...(db.store.get(col)?.values() || [])];
const ids = (col) => [...(db.store.get(col)?.keys() || [])];
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

/* ── First visit ── */

test('first batch creates the visitor, the session, today’s marker and a daily shard', async () => {
  const out = await send([pv('/', { referrer: 'https://www.google.co.in/' }), pv('/shop/necklaces')]);
  assert.match(out.vid, VID_RE);
  assert.match(out.sid, SID_RE);
  assert.deepEqual({ ...out, vid: 'v', sid: 's' }, { vid: 'v', sid: 's', accepted: 2, newSession: true, newVisitor: true });

  const s = get('analytics_sessions', out.sid);
  assert.ok(s.expireAt instanceof Date && s.expireAt.getTime() === NOW.getTime() + 400 * DAY);
  const { expireAt, ...session } = s; void expireAt;
  assert.deepEqual(session, {
    sid: out.sid, vid: out.vid, dateKey: TODAY, userId: null, registered: false, startedAt: iso(),
    channel: 'google_organic', source: 'google', medium: 'organic', campaign: '', content: '', refHost: 'google.co.in',
    landingPath: '/', currentPath: '/shop/necklaces', device: 'mobile', os: 'android', browser: 'chrome',
    city: 'Madurai', region: 'Tamil Nadu', regionKey: 'IN-TN', country: 'IN', ipMasked: '49.37.x.x',
    pageviews: 2, activeSeconds: 0, pendingActive: 0, events: 2,
    viewedProduct: false, triedOn: false, addedToCart: false, reachedCheckout: false, purchased: false, engaged: true,
    triedProducts: [],
    cartItems: 0, cartValue: 0, cartDay: null, orderNumbers: [], revenue: 0, batchIds: ['tab0001:0'],
    lastSeenAt: iso(), updatedAt: iso(),
  });

  const v = get('analytics_visitors', out.vid);
  assert.equal(v.vid, out.vid);
  assert.equal(v.firstSeenAt, iso());
  assert.equal(v.lastSeenAt, iso());
  assert.equal(v.sessions, 1);
  assert.equal(v.pageviews, 2);
  assert.equal(v.userId, null);
  assert.equal(v.registered, false);
  assert.equal(v.lastSeenAtReg, undefined, 'guests never get the registered-visitor field');
  assert.equal(v.lastSessionId, out.sid);
  assert.deepEqual(v.firstTouch, { channel: 'google_organic', source: 'google', medium: 'organic', campaign: '', refHost: 'google.co.in', landingPath: '/' });
  assert.deepEqual(v.lastTouch, { channel: 'google_organic', source: 'google', campaign: '', at: iso() });
  assert.deepEqual([v.device, v.os, v.browser, v.city, v.regionKey, v.ipMasked], ['mobile', 'android', 'chrome', 'Madurai', 'IN-TN', '49.37.x.x']);

  const mark = get('analytics_seen', `${TODAY}_${out.vid}`);
  assert.deepEqual({ ...mark, expireAt: null }, { dateKey: TODAY, vid: out.vid, reg: false, at: iso(), expireAt: null });

  assert.deepEqual(daily(), {
    sessions: 1, visitors: 1, guests: 1, newVisitors: 1, pageviews: 2, engaged: 1,
    hours: { 13: { s: 1, p: 2 } },
    channels: { google_organic: 1 }, devices: { mobile: 1 }, os: { android: 1 }, browsers: { chrome: 1 }, regions: { 'IN-TN': 1 },
    pages: { '|': 1, '|shop|(category)': 1 },
    funnel: { sessions: 1 },
  });
  for (const [id, d] of db.store.get('analytics_daily')) {
    assert.match(id, new RegExp(`^${TODAY}_[0-${SHARDS - 1}]$`));
    assert.equal(d.dateKey, TODAY);
  }
  assert.deepEqual(totals(), { sessions: 1, pageviews: 2, newVisitors: 1 });
  assert.equal(ids('analytics_events').length, 2, 'two page views stored');
});

test('a batch without cookies (or with forged ones) is a brand-new visitor', async () => {
  const a = await send([pv('/')], { vid: 'tj_vid_short', sid: 'tj_sid_../../x' });
  assert.notEqual(a.vid, 'tj_vid_short');
  assert.match(a.vid, VID_RE);
  assert.equal(a.newVisitor, true);
  const b = await send([pv('/')], { vid: VID_A });
  assert.equal(b.vid, VID_A, 'a well-formed id is kept (the route only passes HttpOnly cookie values)');
  assert.equal(b.newVisitor, true);
});

/* ── Sessions ── */

test('a second batch with the cookies continues the same session', async () => {
  const a = await send([pv('/')]);
  const b = await send([pv('/product/p1'), { type: 'product_view', productId: 'p1' }], as(a, { now: at(5 * MIN) }));
  assert.equal(b.vid, a.vid);
  assert.equal(b.sid, a.sid);
  assert.deepEqual([b.accepted, b.newSession, b.newVisitor], [2, false, false]);
  assert.equal(ids('analytics_sessions').length, 1);
  const s = get('analytics_sessions', a.sid);
  assert.deepEqual([s.pageviews, s.events, s.viewedProduct, s.startedAt, s.lastSeenAt, s.landingPath, s.currentPath], [2, 3, true, iso(), iso(5 * MIN), '/', '/product/p1']);
  assert.deepEqual(s.batchIds, ['tab0001:0', 'tab0001:1']);
  const v = get('analytics_visitors', a.vid);
  assert.deepEqual([v.sessions, v.pageviews, v.lastSeenAt], [1, 2, iso(5 * MIN)]);
  assert.deepEqual(daily(), {
    sessions: 1, visitors: 1, guests: 1, newVisitors: 1, pageviews: 2, engaged: 1, productViews: 1,
    hours: { 13: { s: 1, p: 2 } },
    channels: { direct: 1 }, devices: { mobile: 1 }, os: { android: 1 }, browsers: { chrome: 1 }, regions: { 'IN-TN': 1 },
    pages: { '|': 1, '|product|(id)': 1 }, products: { p1: { v: 1 } },
    funnel: { sessions: 1, product: 1 },
  });
});

test('a re-sent (tab, n) batch is dropped whatever order the batches arrive in', async () => {
  const a = await send([pv('/')], { tab: 'tabx1', n: 0 });
  const c = await send([pv('/cart')], as(a, { tab: 'tabx1', n: 2, now: at(1 * MIN) }));
  const b = await send([pv('/shop')], as(a, { tab: 'tabx1', n: 1, now: at(2 * MIN) }));
  assert.equal(c.accepted, 1);
  assert.equal(b.accepted, 1, 'a late n=1 after n=2 is still new');
  const before = structuredClone({ daily: daily(), totals: totals(), s: get('analytics_sessions', a.sid), v: get('analytics_visitors', a.vid), events: ids('analytics_events').length });

  for (const n of [0, 1, 2]) {
    const dup = await send([pv('/shop'), { type: 'add_to_cart', productId: 'p1', qty: 1 }], as(a, { tab: 'tabx1', n, now: at(3 * MIN) }));
    assert.deepEqual(dup, { vid: a.vid, sid: a.sid, accepted: 0, newSession: false, newVisitor: false }, `n=${n}`);
  }
  assert.deepEqual({ daily: daily(), totals: totals(), s: get('analytics_sessions', a.sid), v: get('analytics_visitors', a.vid), events: ids('analytics_events').length }, before);

  const otherTab = await send([pv('/shop')], as(a, { tab: 'taby2', n: 1, now: at(4 * MIN) }));
  assert.equal(otherTab.accepted, 1, 'same n from another tab is a different batch');
  assert.equal(get('analytics_sessions', a.sid).pageviews, 4);
});

test('idle for more than 30 minutes starts a new session (same visitor, same day)', async () => {
  const a = await send([pv('/')]);
  const b = await send([pv('/shop')], as(a, { now: at(31 * MIN) }));
  assert.equal(b.newSession, true);
  assert.equal(b.newVisitor, false);
  assert.notEqual(b.sid, a.sid);
  assert.equal(b.vid, a.vid);
  const c = await send([pv('/cart')], as(b, { now: at(31 * MIN + 29 * MIN) }));
  assert.equal(c.sid, b.sid, '29 minutes idle still continues');
  assert.equal(ids('analytics_sessions').length, 2);
  assert.equal(get('analytics_visitors', a.vid).sessions, 2);
  const d = daily();
  assert.deepEqual([d.sessions, d.visitors, d.guests, d.newVisitors, d.pageviews, d.funnel.sessions], [2, 1, 1, 1, 3, 2]);
  assert.deepEqual(d.hours, { 13: { s: 1, p: 1 }, 14: { s: 1, p: 2 } });
});

test('crossing IST midnight starts a new session on the new day', async () => {
  const late = new Date('2026-10-16T18:25:00Z'); // 23:55 IST
  const a = await send([pv('/')], { now: late });
  const b = await send([pv('/shop')], as(a, { now: at(10 * MIN, late) })); // 00:05 IST, 17 Oct
  assert.equal(b.newSession, true);
  assert.notEqual(b.sid, a.sid);
  assert.equal(get('analytics_sessions', a.sid).dateKey, '2026-10-16');
  assert.equal(get('analytics_sessions', b.sid).dateKey, '2026-10-17');
  assert.deepEqual(daily('2026-10-16'), {
    sessions: 1, visitors: 1, guests: 1, newVisitors: 1, pageviews: 1, hours: { 23: { s: 1, p: 1 } },
    channels: { direct: 1 }, devices: { mobile: 1 }, os: { android: 1 }, browsers: { chrome: 1 }, regions: { 'IN-TN': 1 },
    pages: { '|': 1 }, funnel: { sessions: 1 },
  });
  const d17 = daily('2026-10-17');
  assert.deepEqual([d17.sessions, d17.visitors, d17.guests, d17.newVisitors, d17.hours], [1, 1, 1, undefined, { '00': { s: 1, p: 1 } }], 'a returning visitor is not new on day two');
  assert.ok(get('analytics_seen', `2026-10-17_${a.vid}`));
});

test('a new tagged campaign click mid-session starts a new session; reloads and untagged pages do not', async () => {
  const a = await send([pv('/', { utm: { source: 'ig', campaign: 'diwali' } })]);
  const reload = await send([pv('/', { utm: { source: 'instagram', campaign: 'Diwali' } })], as(a, { now: at(1 * MIN) }));
  assert.equal(reload.sid, a.sid, 'same channel + campaign (after normalising) continues');
  const untagged = await send([pv('/shop', { referrer: 'https://www.google.com/' })], as(a, { now: at(2 * MIN) }));
  assert.equal(untagged.sid, a.sid, 'an untagged page view never splits a session');
  const fb = await send([pv('/', { utm: { source: 'facebook', campaign: 'diwali' } })], as(a, { now: at(3 * MIN) }));
  assert.notEqual(fb.sid, a.sid, 'new channel');
  const fb2 = await send([pv('/', { utm: { source: 'facebook', campaign: 'wedding' } })], as(fb, { now: at(4 * MIN) }));
  assert.notEqual(fb2.sid, fb.sid, 'new campaign');
  const gads = await send([pv('/', { clickIds: { gclid: true } })], as(fb2, { now: at(5 * MIN) }));
  assert.notEqual(gads.sid, fb2.sid, 'ad click');
  assert.equal(get('analytics_sessions', a.sid).channel, 'instagram');
  assert.equal(get('analytics_sessions', a.sid).campaign, 'diwali');
  assert.equal(get('analytics_sessions', fb2.sid).campaign, 'wedding');
  assert.equal(get('analytics_sessions', gads.sid).channel, 'google_ads');
  const d = daily();
  assert.equal(d.sessions, 4);
  assert.equal(d.visitors, 1);
  assert.deepEqual(d.channels, { instagram: 1, facebook: 2, google_ads: 1 });
  assert.deepEqual(get('analytics_visitors', a.vid).firstTouch.channel, 'instagram');
  assert.deepEqual(get('analytics_visitors', a.vid).lastTouch.channel, 'google_ads');
});

/* ── Guests, customers and identity ── */

test('a guest who signs in the same day moves from Guests to Registered without counting twice', async () => {
  const a = await send([pv('/')]);
  assert.deepEqual([daily().visitors, daily().guests, daily().registered], [1, 1, undefined]);
  const b = await send([pv('/product/p1'), { type: 'product_view', productId: 'p1' }], as(a, { user: U1, now: at(2 * MIN) }));
  assert.equal(b.sid, a.sid, 'signing in does not split the visit');
  let d = daily();
  assert.deepEqual([d.visitors, d.guests, d.registered, d.sessions, d.newVisitors], [1, 0, 1, 1, 1]);
  assert.equal(get('analytics_seen', `${TODAY}_${a.vid}`).reg, true);
  const s = get('analytics_sessions', a.sid);
  assert.deepEqual([s.userId, s.registered], ['u1', true]);

  await send([pv('/cart')], as(a, { user: U1, now: at(3 * MIN) }));
  await send([pv('/shop')], as(a, { now: at(4 * MIN) })); // signed out again
  d = daily();
  assert.deepEqual([d.visitors, d.guests, d.registered], [1, 0, 1]);

  /* The same customer on a second browser is a second visitor (per browser). */
  await send([pv('/')], { user: U1, vid: VID_B, ua: UA_EDGE, now: at(5 * MIN) });
  d = daily();
  assert.deepEqual([d.visitors, d.guests, d.registered, d.newVisitors], [2, 0, 2, 2]);
  assert.equal(get('analytics_visitors', VID_B).lastSeenAtReg, iso(5 * MIN));
});

test('signing in stitches the browser’s earlier guest sessions to the customer', async () => {
  const yesterday = new Date('2026-10-15T06:00:00Z');
  const a = await send([pv('/')], { now: yesterday });
  const b = await send([pv('/shop')], as(a, { now: NOW }));
  assert.notEqual(b.sid, a.sid);
  const stranger = await send([pv('/')], { vid: VID_B });
  assert.equal(get('analytics_sessions', a.sid).userId, null);

  await send([pv('/account')], as(b, { user: U1, now: at(2 * MIN) }));
  for (const sid of [a.sid, b.sid]) {
    const s = get('analytics_sessions', sid);
    assert.deepEqual([s.userId, s.registered], ['u1', true], sid);
  }
  assert.equal(get('analytics_sessions', stranger.sid).userId, null, 'another browser is untouched');
  const v = get('analytics_visitors', a.vid);
  assert.deepEqual([v.userId, v.registered, v.lastSeenAtReg, v.sessions], ['u1', true, iso(2 * MIN), 2]);
  assert.deepEqual(get('users', 'u1').visitorIds, ['tj_vid_previousBrowser00000000', a.vid]);
});

test('customer CRM fields: login once per visit, pages, interests, last product with engagement, saved cart', async () => {
  const cart = { items: [{ id: 'p1', name: 'Temple Jhumka', qty: 2, price: 1500 }] };
  const a = await send([
    pv('/product/p1'),
    { type: 'product_view', productId: 'p1' },
    { type: 'product_engagement', productId: 'p1', dwell: 42, scroll: 80, carousel: 3, zoom: 1 },
    { type: 'heartbeat', active: 20 },
  ], { user: U1, cart });
  let u = get('users', 'u1');
  assert.equal(u.name, 'Priya', 'profile fields untouched');
  assert.equal(u.lastLoginAt, iso());
  assert.equal(u.lastLogoutAt, iso());
  assert.equal(u.sessionCount, 5);
  assert.equal(u.totalSessionSeconds, 20);
  assert.deepEqual(u.recentPages, [{ path: '/product/p1', visitedAt: iso() }]);
  assert.deepEqual(u.categoryInterests, { earrings: 3 });
  assert.deepEqual(u.lastSeenProduct, {
    id: 'p1', name: 'Temple Jhumka', slug: 'temple-jhumka', image: 'https://img.test/p1.jpg', price: 1500, category: 'earrings', viewedAt: iso(),
    dwellSeconds: 42, scrollDepthPercentage: 80, carouselClicks: 3, zoomInteractions: 1,
  });
  assert.deepEqual(u.savedCart, [{ _id: 'p1', id: 'p1', name: 'Temple Jhumka', quantity: 2, price: 1500 }]);
  assert.equal(u.cartUpdatedAt, iso());
  assert.deepEqual(u.visitorIds, ['tj_vid_previousBrowser00000000', a.vid]);

  await send([pv('/shop'), { type: 'product_view', productId: 'p2' }], as(a, { user: U1, now: at(1 * MIN) }));
  u = get('users', 'u1');
  assert.equal(u.sessionCount, 5, 'same visit: not counted again');
  assert.equal(u.lastLoginAt, iso());
  assert.equal(u.lastLogoutAt, iso(1 * MIN));
  assert.deepEqual(u.recentPages.map((p) => p.path), ['/product/p1', '/shop']);
  assert.deepEqual(u.categoryInterests, { earrings: 3, necklaces: 1 });
  assert.equal(u.lastSeenProduct.id, 'p2');
  assert.equal(u.lastSeenProduct.dwellSeconds, undefined, 'engagement of another product is not carried over');
  assert.deepEqual(u.savedCart, [{ _id: 'p1', id: 'p1', name: 'Temple Jhumka', quantity: 2, price: 1500 }], 'no cart in the batch → saved cart kept');
  assert.equal(u.visitorIds.length, 2, 'vid not added twice');

  await send([pv('/')], as(a, { user: U1, now: at(45 * MIN) }));
  u = get('users', 'u1');
  assert.equal(u.sessionCount, 6, 'a new visit counts');
  assert.equal(u.lastLoginAt, iso(45 * MIN));
});

test('customer CRM: signing in halfway through a visit counts that visit once', async () => {
  const a = await send([pv('/')]);
  assert.equal(get('users', 'u1').sessionCount, 4, 'guest batches never touch a customer');
  await send([pv('/login')], as(a, { user: U1, now: at(1 * MIN) }));
  assert.equal(get('users', 'u1').sessionCount, 5);
  assert.equal(get('users', 'u1').lastLoginAt, iso(1 * MIN));
  await send([pv('/account')], as(a, { user: U1, now: at(2 * MIN) }));
  await send([pv('/shop')], as(a, { user: U1, now: at(3 * MIN) }));
  assert.equal(get('users', 'u1').sessionCount, 5);
  assert.equal(get('users', 'u1').lastLoginAt, iso(1 * MIN));
});

test('a signed-in customer without a users doc is still tracked (no CRM write)', async () => {
  const a = await send([pv('/')], { user: { id: 'ghost-user' } });
  assert.equal(get('users', 'ghost-user'), undefined);
  assert.equal(get('analytics_sessions', a.sid).userId, 'ghost-user');
  assert.equal(daily().registered, 1);
});

/* ── Products, cart, try-on ── */

test('product rollups only for products that exist; unknown ids get no key', async () => {
  await send([
    pv('/product/ghost'),
    { type: 'product_view', productId: 'ghost' },
    { type: 'product_engagement', productId: 'ghost', dwell: 10 },
    { type: 'tryon_open', productId: 'ghost', mode: 'live' },
    { type: 'add_to_cart', productId: 'ghost', qty: 1 },
    { type: 'product_view', productId: 'p2' },
    { type: 'product_view', productId: 'p3' },
  ], { user: U1 });
  const d = daily();
  assert.deepEqual(d.products, { p2: { v: 1 }, p3: { v: 1 } });
  assert.equal(d.productViews, 2, 'a view of a product that does not exist is not a product view');
  assert.equal(d.tryons, 1);
  assert.deepEqual(d.tryonModes, { live: 1 });
  assert.equal(d.addToCarts, 1);
  const stored = all('analytics_events').filter((e) => e.type !== 'page_view');
  assert.ok(stored.every((e) => e.productId !== 'ghost'), 'unknown ids are not stored either');
  assert.deepEqual(get('users', 'u1').categoryInterests, { earrings: 2, necklaces: 1 }, 'a malformed category is not an interest');
});

test('add-to-cart rollups count add actions, not pieces', async () => {
  await send([
    { type: 'product_view', productId: 'p1' },
    { type: 'add_to_cart', productId: 'p1', qty: 3 },
    { type: 'add_to_cart', productId: 'p1', qty: 1 },
    { type: 'remove_from_cart', productId: 'p1', qty: 1 },
    { type: 'add_to_cart', productId: 'p2', qty: 1 },
  ]);
  const d = daily();
  assert.equal(d.addToCarts, 3);
  assert.deepEqual(d.products, { p1: { v: 1, a: 2 }, p2: { a: 1 } });
  assert.deepEqual(d.funnel, { sessions: 1, product: 1, cart: 1 }, 'each funnel step once per session');
  assert.equal(d.engaged, 1, 'a shopping action is engagement');
  const adds = all('analytics_events').filter((e) => e.type === 'add_to_cart');
  assert.deepEqual(adds.map((e) => e.qty).sort(), [1, 1, 3]);
});

test('try-on: opens, modes and skin tones — one try-on per product per visit', async () => {
  const a = await send([
    { type: 'product_view', productId: 'p1' },
    { type: 'tryon_open', productId: 'p1', mode: 'ai' },
    { type: 'tryon_mode', mode: 'live' },
    { type: 'tryon_tone', tone: 'wheatish' },
    { type: 'tryon_open', productId: 'p1' },
  ]);
  /* The modal closed and reopened on the same product later in the visit. */
  await send([{ type: 'tryon_open', productId: 'p1', mode: 'ai' }], as(a, { now: at(2 * MIN) }));
  const d = daily();
  assert.equal(d.tryons, 1, 'reopening the modal is still the same try-on');
  assert.deepEqual(d.tryonModes, { ai: 1, live: 1 });
  assert.deepEqual(d.tones, { wheatish: 1 });
  assert.deepEqual(d.products, { p1: { v: 1, t: 1 } }, 'try-on % stays ≤ 100');
  assert.equal(d.funnel.tryon, 1);
  /* A different product in the same visit is a new try-on. */
  await send([{ type: 'product_view', productId: 'p2' }, { type: 'tryon_open', productId: 'p2', mode: 'live' }], as(a, { now: at(4 * MIN) }));
  assert.equal(daily().tryons, 2);
  assert.deepEqual(get('analytics_sessions', a.sid).triedProducts, ['p1', 'p2']);
});

test('heartbeats: at most 30 s per beat, and never more than the wall-clock time since the session began', async () => {
  const a = await send([pv('/'), { type: 'heartbeat', active: 3600 }]);
  const active = () => get('analytics_sessions', a.sid).activeSeconds;
  assert.equal(active(), 30, '3600 claimed → 30 counted');
  await send([{ type: 'heartbeat', active: 3600 }, { type: 'heartbeat', active: 3600 }], as(a, { now: at(10 * SEC) }));
  assert.equal(active(), 40, '10 s after the start: 10 s + one beat of grace');
  await send([{ type: 'heartbeat', active: 3600 }, { type: 'heartbeat', active: 3600 }, { type: 'heartbeat', active: 3600 }], as(a, { now: at(5 * MIN) }));
  assert.equal(active(), 130, 'three beats × 30 s');
  await send([{ type: 'heartbeat', active: 0 }, { type: 'heartbeat', active: 7.6 }], as(a, { now: at(6 * MIN) }));
  assert.equal(active(), 138);
  /* Heartbeat-only batches save their seconds on the session (fewer writes
     to the shared daily docs); the first batch's 30 s went with its page view. */
  assert.equal(daily().activeSeconds, 30);
  assert.equal(get('analytics_sessions', a.sid).pendingActive, 108);
  await send([{ type: 'heartbeat', active: 0 }], as(a, { now: at(6 * MIN + 5 * SEC), final: true }));
  assert.equal(daily().activeSeconds, 138, 'the tab-hide flush adds exactly what the session got');
  assert.equal(get('analytics_sessions', a.sid).pendingActive, 0);
  assert.ok(active() <= 6 * 60 + 30);
  assert.equal(all('analytics_events').filter((e) => e.type === 'heartbeat').length, 0, 'heartbeats are never stored');
});

test('heartbeat: 10 s of activity marks the session engaged', async () => {
  const a = await send([pv('/'), { type: 'heartbeat', active: 9 }]);
  assert.equal(get('analytics_sessions', a.sid).engaged, false);
  assert.equal(daily().engaged, undefined);
  await send([{ type: 'heartbeat', active: 9 }], as(a, { now: at(20 * SEC) }));
  assert.equal(get('analytics_sessions', a.sid).engaged, true);
  await send([{ type: 'heartbeat', active: 15 }], as(a, { now: at(40 * SEC) }));
  assert.equal(daily().engaged, 1, 'engaged counted once');
});

test('the cart snapshot sets cartItems / cartValue / cartDay (live cart abandonment), priced by the server', async () => {
  const a = await send([pv('/cart')], {
    cart: { items: [
      { id: 'p1', name: 'Temple Jhumka', qty: 2, price: 1 }, // real price 1500 (discount)
      { id: 'p2', name: 'Free gold', qty: 1, price: 0 }, // real price 5000
      { id: 'fake1', name: 'Planted', qty: 99, price: 10_000_000 }, // not a product: ignored
    ] },
  });
  const s = () => get('analytics_sessions', a.sid);
  assert.deepEqual([s().cartItems, s().cartValue, s().cartDay], [3, 8000, TODAY], 'client prices and unknown ids are ignored');
  await send([{ type: 'heartbeat', active: 5 }], as(a, { now: at(1 * MIN) }));
  assert.deepEqual([s().cartItems, s().cartValue, s().cartDay], [3, 8000, TODAY], 'no snapshot → unchanged');
  await send([{ type: 'remove_from_cart', productId: 'p1' }], as(a, { now: at(2 * MIN), cart: { items: [] } }));
  assert.deepEqual([s().cartItems, s().cartValue, s().cartDay], [0, 0, null], 'emptied cart');
});

/* ── Purchases ── */

const ORD = (n) => `TBJ17606000000000${n}`;
function seedOrders(vid = VID_A) {
  const o = (orderNumber, extra) => ({ orderNumber, status: 'confirmed', total: 1000, createdAt: iso(-10 * MIN), userId: null, ...extra });
  const orders = {
    mine: o(ORD(1), { analyticsVid: vid, payment: { method: 'razorpay', status: 'paid' }, total: 4500 }),
    customerCod: o(ORD(2), { analyticsVid: VID_B, userId: 'u1', status: 'pending', payment: { method: 'cod', status: 'pending' }, total: 1200, createdAt: iso(-1 * HOUR) }),
    someoneElses: o(ORD(3), { analyticsVid: VID_B, userId: 'u9', payment: { method: 'razorpay', status: 'paid' } }),
    pendingOnline: o(ORD(4), { analyticsVid: vid, status: 'pending', payment: { method: 'razorpay', status: 'pending' } }),
    cancelled: o(ORD(5), { analyticsVid: vid, status: 'cancelled', payment: { method: 'razorpay', status: 'paid' } }),
    stale: o(ORD(6), { analyticsVid: vid, payment: { method: 'razorpay', status: 'paid' }, createdAt: iso(-25 * HOUR) }),
  };
  for (const [id, d] of Object.entries(orders)) db.store.get('orders').set(id, d);
}
const purchase = (orderNumber) => ({ type: 'purchase', orderNumber });

test('purchase: credited only for this browser’s fresh, live, paid-or-COD order', async () => {
  seedOrders();
  const out = await send([
    pv('/', { utm: { source: 'ig', campaign: 'diwali' } }),
    { type: 'checkout_start' },
    purchase(ORD(1)), purchase(ORD(1)),
    purchase(ORD(2)), // the customer's COD order — but this browser is not signed in as u1
    purchase(ORD(3)), purchase(ORD(4)), purchase(ORD(5)), purchase(ORD(6)),
    purchase('TBJ9999999999'),
  ], { vid: VID_A, cart: { items: [{ id: 'p1', qty: 1, price: 4500 }] } });

  const d = daily();
  assert.equal(d.orders, 1);
  assert.equal(d.revenue, 4500);
  assert.deepEqual(d.ordersByChannel, { instagram: 1 });
  assert.deepEqual(d.revenueByChannel, { instagram: 4500 });
  assert.deepEqual(d.funnel, { sessions: 1, checkout: 1, paid: 1 });
  assert.deepEqual([totals().orders, totals().revenue], [1, 4500]);

  const s = get('analytics_sessions', out.sid);
  assert.deepEqual([s.purchased, s.reachedCheckout, s.orderNumbers, s.revenue], [true, true, [ORD(1)], 4500]);
  assert.deepEqual([s.cartItems, s.cartValue, s.cartDay], [0, 0, null], 'a purchase empties the live cart');

  assert.deepEqual(ids('analytics_orders'), [ORD(1)]);
  assert.deepEqual(get('analytics_orders', ORD(1)), { orderNumber: ORD(1), vid: VID_A, sid: out.sid, at: iso() });
  assert.deepEqual(get('orders', 'mine').attribution, {
    vid: VID_A, sid: out.sid, channel: 'instagram', source: 'instagram', medium: '', campaign: 'diwali',
    landingPath: '/', device: 'mobile', regionKey: 'IN-TN', city: 'Madurai',
  });
  for (const id of ['customerCod', 'someoneElses', 'pendingOnline', 'cancelled', 'stale']) {
    assert.equal(get('orders', id).attribution, undefined, id);
  }

  const stored = all('analytics_events').filter((e) => e.type === 'purchase');
  assert.deepEqual(stored.map((e) => e.orderNumber), [ORD(1)], 'only the credited purchase is in the raw event log');
});

test('purchase: a signed-in customer’s own COD order counts from another browser; never twice', async () => {
  seedOrders();
  const a = await send([pv('/order-success'), purchase(ORD(2))], { vid: VID_A, user: U1 });
  assert.equal(daily().orders, 1);
  assert.equal(daily().revenue, 1200);
  assert.equal(get('orders', 'customerCod').attribution.vid, VID_A);

  /* order-success reloaded: same session, then a new session, then another browser */
  await send([purchase(ORD(2))], as(a, { user: U1, now: at(1 * MIN) }));
  const later = await send([pv('/order-success'), purchase(ORD(2))], as(a, { user: U1, now: at(2 * HOUR) }));
  assert.equal(later.newSession, true);
  await send([purchase(ORD(2))], { vid: VID_B, user: U1, now: at(3 * HOUR) });
  assert.equal(daily().orders, 1);
  assert.equal(daily().revenue, 1200);
  assert.equal(daily().funnel.paid, 1);
  assert.equal(get('analytics_sessions', later.sid).purchased, false);
  assert.equal(all('analytics_events').filter((e) => e.type === 'purchase').length, 1);
});

test('purchase: clears the customer’s saved cart', async () => {
  seedOrders();
  const cart = { items: [{ id: 'p1', name: 'Temple Jhumka', qty: 1, price: 1200 }] };
  const a = await send([pv('/cart'), { type: 'add_to_cart', productId: 'p1', qty: 1 }], { vid: VID_A, user: U1, cart });
  assert.equal(get('users', 'u1').savedCart.length, 1);
  assert.equal(get('analytics_sessions', a.sid).cartDay, TODAY);
  /* The snapshot can still show the items: the cart empties after the redirect. */
  await send([pv('/order-success'), purchase(ORD(2))], as(a, { user: U1, now: at(2 * MIN), cart }));
  const u = get('users', 'u1');
  assert.deepEqual(u.savedCart, []);
  assert.equal(u.cartUpdatedAt, iso(2 * MIN));
  const s = get('analytics_sessions', a.sid);
  assert.deepEqual([s.cartItems, s.cartValue, s.cartDay, s.purchased], [0, 0, null, true]);
});

/* ── Raw events and totals ── */

test('raw events: meaningful events stored with a TTL; heartbeats and engagement pings are not', async () => {
  const a = await send([
    pv('/product/p1'),
    { type: 'heartbeat', active: 10 },
    { type: 'product_view', productId: 'p1' },
    { type: 'product_engagement', productId: 'p1', dwell: 5 },
    { type: 'tryon_open', productId: 'p1', mode: 'ai' },
    { type: 'tryon_mode', mode: 'live' },
    { type: 'tryon_tone', tone: 'fair' },
    { type: 'add_to_cart', productId: 'p1', qty: 2 },
    { type: 'remove_from_cart', productId: 'p1' },
    { type: 'checkout_start', path: '/checkout' },
  ]);
  const events = all('analytics_events');
  assert.deepEqual(events.map((e) => e.type).sort(), ['add_to_cart', 'checkout_start', 'page_view', 'product_view', 'remove_from_cart', 'tryon_mode', 'tryon_open', 'tryon_tone']);
  for (const e of events) {
    assert.ok(e.expireAt instanceof Date, 'TTL field');
    assert.equal(e.expireAt.getTime(), NOW.getTime() + 180 * DAY);
    assert.deepEqual([e.at, e.dateKey, e.vid, e.sid, e.userId, e.channel, e.device, e.regionKey], [iso(), TODAY, a.vid, a.sid, null, 'direct', 'mobile', 'IN-TN']);
  }
  const byType = Object.fromEntries(events.map((e) => [e.type, e]));
  assert.deepEqual([byType.page_view.path, byType.page_view.productId], ['/product/p1', null]);
  assert.deepEqual([byType.product_view.productId, byType.product_view.productName], ['p1', 'Temple Jhumka']);
  assert.equal(byType.add_to_cart.qty, 2);
  assert.equal(byType.tryon_open.mode, 'ai');
  assert.equal(byType.tryon_tone.tone, 'fair');
  assert.equal(byType.checkout_start.path, '/checkout');
  assert.equal(byType.page_view.orderNumber, null);
});

test('all-time totals add up across days, visitors and purchases', async () => {
  seedOrders();
  const yesterday = new Date('2026-10-15T06:00:00Z');
  await send([pv('/'), pv('/shop')], { vid: VID_A, now: yesterday });
  await send([pv('/'), purchase(ORD(1))], { vid: VID_A });
  await send([pv('/')], { vid: VID_B, now: at(1 * MIN) });
  assert.deepEqual(totals(), { sessions: 3, pageviews: 4, newVisitors: 2, orders: 1, revenue: 4500 });
  for (const [id, d] of db.store.get('analytics_totals')) {
    assert.match(id, new RegExp(`^[0-${SHARDS - 1}]$`));
    for (const k of Object.keys(d)) assert.ok(['sessions', 'pageviews', 'newVisitors', 'orders', 'revenue'].includes(k), k);
  }
});

/* ── Bounded keys ── */

function walkKeys(obj, visit, trail = []) {
  for (const [k, v] of Object.entries(obj)) {
    visit(k, [...trail, k]);
    if (v && typeof v === 'object' && !(v instanceof Date)) walkKeys(v, visit, [...trail, k]);
  }
}

test('crafted paths, UTMs, geo and ids cannot create unbounded rollup keys', async () => {
  const crafted = [
    pv('/a.b/c'), pv('https://evil.example/x'), pv('/product/../../etc/passwd'), pv('/<svg onload=alert(1)>'),
    pv('/shop/' + 'x'.repeat(250)), pv('/__proto__/constructor'), pv('/' + 'seg/'.repeat(60)), pv(''),
    { type: 'product_view', productId: 'x'.repeat(64) }, { type: 'add_to_cart', productId: '__proto__', qty: 1 },
  ];
  const evilUtms = [
    { source: 'evil.com/$x', medium: 'a.b', campaign: 'c.d/e' },
    { source: 'x'.repeat(100), medium: 'cpc', campaign: '__proto__' },
    { source: '<script>', campaign: 'p.a.t.h' },
    { source: 'google', medium: 'cpc.evil/x' },
  ];
  const geo = geoFromHeaders((h) => ({ 'x-vercel-ip-country': 'X.Y/Z', 'x-vercel-ip-country-region': '../..', 'x-vercel-ip-city': 'a.b/c<d>' })[h] ?? null);
  let prev = null;
  for (const [i, utm] of evilUtms.entries()) {
    prev = await send([pv('/', { utm, referrer: `https://${'sub.'.repeat(i + 1)}evil.example/a.b?c=d` }), ...crafted], { ...(prev && as(prev)), geo, now: at(i * MIN) });
  }
  const d = daily();
  const knownPages = new Set(['/', '/product/[id]', '/shop/[category]', '(other)', '/shop', '/cart'].map(encodeKey));
  for (const k of Object.keys(d.pages)) assert.ok(knownPages.has(k), `page key ${k}`);
  for (const k of Object.keys(d.channels)) assert.ok(Object.hasOwn(CHANNELS, k), `channel ${k}`);
  for (const k of Object.keys(d.regions)) assert.match(k, /^(unknown|IN-[A-Z]{2}|IN-other|[A-Z]{1,2})$/);
  assert.deepEqual(Object.keys(d.products || {}), [], 'no product keys for ids that are not in the catalogue');
  assert.equal(d.pages[encodeKey(routeKey('/a.b/c'))] >= 4, true);
  walkKeys(d, (k, trail) => {
    assert.ok(!k.includes('.') && !k.includes('/'), `key with . or / at ${trail.join(' > ')}`);
    assert.ok(k.length <= 40, `long key ${k}`);
  });
  for (const s of all('analytics_sessions')) {
    assert.ok(Object.hasOwn(CHANNELS, s.channel));
    assert.ok(!/[<>"/]/.test(s.campaign + s.source + s.medium), JSON.stringify([s.campaign, s.source, s.medium]));
    assert.ok(!/[<>/]/.test(s.city), s.city);
  }
});
