/* ─────────────────────────────────────────────
   Visitor analytics — the REAL route handlers:
     POST /api/analytics/track          (public ingestion)
     GET  /api/admin/analytics          (dashboard data)
     GET  /api/admin/analytics/export   (CSV)
     GET  /api/admin/site-visits        (customers-page visitor cards)

   Only the edges are swapped out (as in api-rbac.test.mjs): the NextAuth
   session, the nextauth route's authOptions, and Firestore (in-memory fake
   with FieldValue.increment mocked so counters are real numbers).

   The track route keeps a per-IP limiter in module memory, so every test
   uses its own x-forwarded-for address.

   Run: npm test
   ───────────────────────────────────────────── */
import { test, beforeEach, mock } from 'node:test';
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

const route = (p) => import(src(`app/api/${p}/route.js`));
const [trackRoute, analyticsRoute, exportRoute, siteVisitsRoute] = await Promise.all([
  route('analytics/track'), route('admin/analytics'), route('admin/analytics/export'), route('admin/site-visits'),
]);
const { analyticsVidFrom, cookieFrom, _resetCaches } = await import(src('lib/analytics/ingest.js'));
const { lastNDateKeys, istDateKey } = await import(src('lib/siteVisits.js'));

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const VID_RE = /^tj_vid_[A-Za-z0-9_-]{20,40}$/;
const SID_RE = /^tj_sid_[A-Za-z0-9_-]{20,40}$/;

const signInAs = (email, extra = {}) => { session = email ? { user: { id: `uid-${email}`, email, ...extra } } : null; };

beforeEach(() => {
  session = null;
  _resetCaches();
  db = fakeFirestore({
    staff: {
      ofs: { email: 'ofs@tulsi.test', role: 'ORDER_FULFILLMENT_STAFF', status: 'Active' },
      biz: { email: 'biz@tulsi.test', role: 'BUSINESS_MANAGER', status: 'Active', roleGrantedBy: 'owner@tulsi.test' },
      vA: { email: 'vendor-a@vendor.test', role: 'VENDOR', vendorId: 'vA', status: 'Active' },
    },
    products: { p1: { name: 'Temple Jhumka', category: 'earrings', price: 1500 } },
    users: { c1: { name: 'Priya', email: 'priya@x.test', role: 'customer' } },
    orders: {},
  });
});

/* ── Track helpers ── */
let ipN = 0;
const freshIp = () => { ipN += 1; return `198.51.${Math.floor(ipN / 250)}.${(ipN % 250) + 1}`; };

function trackRequest(body, { headers = {}, cookie, ip = freshIp(), raw = false } = {}) {
  const h = {
    'content-type': 'text/plain;charset=UTF-8',
    'user-agent': UA_ANDROID,
    'accept-language': 'en-IN,en;q=0.9,ta;q=0.8',
    'sec-fetch-site': 'same-origin',
    origin: 'https://tulsi.test',
    host: 'tulsi.test',
    'x-forwarded-for': `${ip}, 10.0.0.1`,
    'x-vercel-ip-country': 'IN',
    'x-vercel-ip-country-region': 'TN',
    'x-vercel-ip-city': 'Madurai',
    ...(cookie && { cookie }),
    ...headers,
  };
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  return new Request('https://tulsi.test/api/analytics/track', { method: 'POST', headers: h, body: raw ? body : JSON.stringify(body) });
}
const track = (body, opts) => trackRoute.POST(trackRequest(body, opts));
const batch = (events, n = 0, extra = {}) => ({ tab: 'tab0001', n, events: events.map((e, i) => ({ seq: i, ...e })), ...extra });
const PV = (p = '/') => ({ type: 'page_view', path: p });
const cookiesOf = (res) => Object.fromEntries(res.headers.getSetCookie().map((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
const cookieHeader = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const docs = (col) => [...(db.store.get(col)?.values() || [])];
const nothingWritten = () => {
  for (const col of ['analytics_sessions', 'analytics_visitors', 'analytics_daily', 'analytics_events', 'analytics_seen', 'analytics_totals']) {
    assert.equal(docs(col).length, 0, `${col} written`);
  }
};
const quietly = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};

/* ── POST /api/analytics/track ── */

test('track: a valid batch → 204 with HttpOnly visitor and session cookies, and the visit is recorded', async () => {
  const ip = freshIp();
  const res = await track(batch([{ ...PV('/'), referrer: 'https://www.tulsi.test/shop' }, PV('/shop/necklaces')]), { ip });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
  const raw = res.headers.getSetCookie();
  assert.equal(raw.length, 2);
  for (const c of raw) {
    assert.match(c, /; HttpOnly/i);
    assert.match(c, /; SameSite=lax/i);
    assert.match(c, /; Path=\//);
  }
  assert.match(raw.find((c) => c.startsWith('tj_vid=')), /Max-Age=34560000/, '≈400 days');
  assert.match(raw.find((c) => c.startsWith('tj_sid=')), /Max-Age=1800/, '30 minutes');
  const { tj_vid: vid, tj_sid: sid } = cookiesOf(res);
  assert.match(vid, VID_RE);
  assert.match(sid, SID_RE);

  const [s] = docs('analytics_sessions');
  assert.deepEqual([s.sid, s.vid, s.pageviews, s.registered, s.userId], [sid, vid, 2, false, null]);
  assert.equal(s.channel, 'direct', 'own-site referrer (www) is not a source');
  assert.deepEqual([s.regionKey, s.city, s.country], ['IN-TN', 'Madurai', 'IN'], 'geo from the trusted proxy headers');
  assert.equal(s.ipMasked, ip.split('.').slice(0, 2).join('.') + '.x.x', 'first x-forwarded-for hop, masked');
  assert.ok(!JSON.stringify(docs('analytics_sessions')).includes(ip), 'full IP never stored');
  assert.equal(docs('analytics_visitors').length, 1);
  assert.ok(docs('analytics_daily').length >= 1);
});

test('track: the returned cookies continue the same session; a re-sent batch is not counted twice', async () => {
  const ip = freshIp();
  const first = await track(batch([PV('/')], 0), { ip });
  const cookie = cookieHeader(first);
  const second = await track(batch([PV('/shop')], 1), { ip, cookie });
  assert.equal(second.status, 204);
  assert.deepEqual(cookiesOf(second), cookiesOf(first), 'same visitor, same session (sid cookie refreshed)');
  const again = await track(batch([PV('/shop')], 1), { ip, cookie });
  assert.equal(again.status, 204);
  assert.equal(docs('analytics_sessions').length, 1);
  assert.equal(docs('analytics_sessions')[0].pageviews, 2);
  assert.equal(docs('analytics_visitors').length, 1);
});

test('track: forged cookie values are ignored and fresh ids issued', async () => {
  const res = await track(batch([PV('/')]), { cookie: 'tj_vid=tj_vid_..%2F..; tj_sid=admin' });
  const { tj_vid: vid, tj_sid: sid } = cookiesOf(res);
  assert.match(vid, VID_RE);
  assert.match(sid, SID_RE);
  assert.notEqual(vid, 'tj_vid_..%2F..');
});

test('track: bots get 204 and nothing is written', async () => {
  for (const ua of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
    'WhatsApp/2.23.20.0 A',
    'curl/8.4.0',
    '',
  ]) {
    const res = await track(batch([PV('/')]), { headers: { 'user-agent': ua } });
    assert.equal(res.status, 204, ua);
    assert.deepEqual(res.headers.getSetCookie(), [], 'no cookies for bots');
  }
  nothingWritten();
});

test('track: a request without Accept-Language → 204, nothing written', async () => {
  const res = await track(batch([PV('/')]), { headers: { 'accept-language': undefined } });
  assert.equal(res.status, 204);
  assert.deepEqual(res.headers.getSetCookie(), []);
  nothingWritten();
});

test('track: cross-site posts are refused with 403', async () => {
  const cross = await track(batch([PV('/')]), { headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  const noFetchMeta = await track(batch([PV('/')]), { headers: { 'sec-fetch-site': undefined, origin: 'https://evil.example' } });
  assert.equal(noFetchMeta.status, 403, 'Origin of another host, no Sec-Fetch-Site');
  const lookalike = await track(batch([PV('/')]), { headers: { 'sec-fetch-site': undefined, origin: 'https://tulsi.test.evil.example' } });
  assert.equal(lookalike.status, 403);
  const garbage = await track(batch([PV('/')]), { headers: { 'sec-fetch-site': undefined, origin: 'not a url' } });
  assert.equal(garbage.status, 403);
  nothingWritten();

  /* Positive controls: same host (www / port differences), proxy host, no Origin at all. */
  assert.equal((await track(batch([PV('/')]), { headers: { 'sec-fetch-site': undefined, origin: 'https://www.tulsi.test:443' } })).status, 204);
  assert.equal((await track(batch([PV('/')]), { headers: { 'sec-fetch-site': undefined, origin: 'https://shop.example', host: 'internal:3000', 'x-forwarded-host': 'shop.example' } })).status, 204);
  assert.equal((await track(batch([PV('/')]), { headers: { 'sec-fetch-site': undefined, origin: undefined } })).status, 204);
  assert.equal((await track(batch([PV('/')]), { headers: { 'sec-fetch-site': 'same-site' } })).status, 204);
});

test('track: bodies over 16 KB → 413', async () => {
  const big = batch([{ ...PV('/'), referrer: 'x'.repeat(17_000) }]);
  assert.equal((await track(big)).status, 413);
  const declared = await track(batch([PV('/')]), { headers: { 'content-length': String(64 * 1024) } });
  assert.equal(declared.status, 413, 'declared length checked before reading');
  const multiByte = JSON.stringify(batch([{ ...PV('/'), referrer: 'த'.repeat(6000) }])); // < 16k chars, > 16 KB
  assert.ok(multiByte.length < 16 * 1024);
  assert.equal((await track(multiByte, { raw: true })).status, 413, 'bytes, not characters');
  nothingWritten();
});

test('track: invalid JSON or an invalid batch → 400', async () => {
  const bad = await track('{"tab":', { raw: true });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).success, false);
  assert.equal((await track('', { raw: true })).status, 400);
  const shape = await track({ tab: 'NOPE', n: 0, events: [PV('/')] });
  assert.equal(shape.status, 400);
  assert.equal((await shape.json()).message, 'invalid batch');
  const noEvents = await track({ tab: 'abcd12', n: 0, events: [{ type: 'teleport', seq: 0 }] });
  assert.equal((await noEvents.json()).message, 'no valid events');
  nothingWritten();
});

test('track: staff and sellers browsing the shop are not counted', async () => {
  for (const [email, role] of [['owner@tulsi.test', 'admin'], ['ofs@tulsi.test', 'admin'], ['vendor-a@vendor.test', 'vendor']]) {
    signInAs(email, { role });
    const res = await track(batch([PV('/')]));
    assert.equal(res.status, 204, role);
    assert.deepEqual(res.headers.getSetCookie(), [], `${role}: no cookies`);
  }
  nothingWritten();
});

test('track: a signed-in customer’s visit is registered and linked to them', async () => {
  signInAs('priya@x.test', { role: 'customer', id: 'c1' });
  const res = await track(batch([PV('/account')]));
  assert.equal(res.status, 204);
  const [s] = docs('analytics_sessions');
  assert.deepEqual([s.registered, s.userId], [true, 'c1']);
  const user = db.store.get('users').get('c1');
  assert.equal(user.sessionCount, 1);
  assert.deepEqual(user.visitorIds, [cookiesOf(res).tj_vid]);
  const daily = docs('analytics_daily').reduce((a, d) => ({ registered: (a.registered || 0) + (d.registered || 0), guests: (a.guests || 0) + (d.guests || 0) }), {});
  assert.deepEqual(daily, { registered: 1, guests: 0 });
});

test('track: the 121st request from one IP within a minute → 429', async () => {
  const ip = freshIp();
  for (let i = 0; i < 120; i += 1) {
    const res = await track('{}', { ip, raw: true });
    assert.equal(res.status, 400, `request ${i + 1} reaches the schema check`);
  }
  const limited = await track(batch([PV('/')]), { ip });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  nothingWritten();
  assert.equal((await track(batch([PV('/')]))).status, 204, 'another address is unaffected');
});

test('track: a storage failure never breaks the page (204, logged)', async () => {
  db = { collection() { throw new Error('firestore unavailable'); } };
  const res = await quietly(() => track(batch([PV('/')])));
  assert.equal(res.status, 204);
  assert.deepEqual(res.headers.getSetCookie(), []);
});

/* ── analyticsVidFrom / cookieFrom ── */

test('analyticsVidFrom: the visitor id from the HttpOnly cookie, or null when missing or tampered', () => {
  const vid = `tj_vid_${'Ab_-9'.repeat(5)}`;
  const req = (cookie) => new Request('https://tulsi.test/api/orders', { headers: cookie ? { cookie } : {} });
  assert.equal(analyticsVidFrom(req(`theme=dark; tj_vid=${vid}; tj_sid=x`)), vid);
  assert.equal(analyticsVidFrom(req(`tj_vid=${vid}`)), vid);
  assert.equal(analyticsVidFrom({ cookies: { get: (n) => (n === 'tj_vid' ? { value: vid } : undefined) } }), vid, 'NextRequest cookies API');
  for (const bad of ['tj_vid=tj_vid_short', `tj_vid=${vid}.evil`, `tj_vid=${vid.replace('tj_vid_', 'tj_sid_')}`, `tj_vid=x${vid}`, `xtj_vid=${vid}`, 'tj_vid=', `tj_vid=${vid}%3Cscript%3E`, `tj_vid=tj_vid_${'a'.repeat(41)}`, '']) {
    assert.equal(analyticsVidFrom(req(bad)), null, bad);
  }
  assert.equal(analyticsVidFrom(undefined), null);
  assert.equal(cookieFrom(req('a=1; tj_sid=abc; b=2'), 'tj_sid'), 'abc');
  assert.equal(cookieFrom(req('a=1'), 'tj_sid'), '');
});

/* ── GET /api/admin/analytics ── */

const adminGet = async (mod, url) => {
  const res = await mod.GET(new Request(url));
  return { res, status: res.status };
};

test('admin analytics: signed out 401, order staff and sellers 403', async () => {
  assert.equal((await adminGet(analyticsRoute, 'https://tulsi.test/api/admin/analytics')).status, 401);
  signInAs('ofs@tulsi.test');
  assert.equal((await adminGet(analyticsRoute, 'https://tulsi.test/api/admin/analytics')).status, 403);
  assert.equal((await adminGet(analyticsRoute, 'https://tulsi.test/api/admin/analytics?part=live')).status, 403);
  signInAs('vendor-a@vendor.test');
  assert.equal((await adminGet(analyticsRoute, 'https://tulsi.test/api/admin/analytics')).status, 403);
  signInAs('priya@x.test');
  assert.equal((await adminGet(analyticsRoute, 'https://tulsi.test/api/admin/analytics')).status, 403);
});

test('admin analytics: the owner gets the live block and the range report', async () => {
  /* First call of the per-instance cache in this process: seed real data. */
  await track(batch([PV('/'), PV('/product/p1'), { type: 'product_view', productId: 'p1' }]));
  signInAs('owner@tulsi.test');
  const { res, status } = await adminGet(analyticsRoute, 'https://tulsi.test/api/admin/analytics?range=today');
  assert.equal(status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const { success, data } = await res.json();
  assert.equal(success, true);
  assert.deepEqual(Object.keys(data).sort(), ['live', 'report']);
  assert.equal(data.live.activeVisitors, 1);
  assert.equal(data.live.sessions.length, 1);
  assert.equal(data.report.range, 'today');
  assert.equal(data.report.kpis.sessions, 1);
  assert.equal(data.report.kpis.pageviews, 2);
  assert.equal(data.report.topProducts[0].name, 'Temple Jhumka');
  assert.equal(data.report.series.points.length, 24);
});

test('admin analytics: part=live returns only the live block; a business manager may read it', async () => {
  signInAs('biz@tulsi.test');
  const { res, status } = await adminGet(analyticsRoute, 'https://tulsi.test/api/admin/analytics?part=live&range=30d');
  assert.equal(status, 200);
  const { data } = await res.json();
  assert.deepEqual(Object.keys(data), ['live']);
  assert.equal(typeof data.live.activeVisitors, 'number');
  assert.ok(data.live.carts);
  const bogus = await (await analyticsRoute.GET(new Request('https://tulsi.test/api/admin/analytics?range=__proto__'))).json();
  assert.equal(bogus.data.report.range, 'today', 'unknown range → today');
  const week = await (await analyticsRoute.GET(new Request('https://tulsi.test/api/admin/analytics?range=7d'))).json();
  assert.equal(week.data.report.range, '7d');
  assert.equal(week.data.report.series.points.length, 7);
});

/* ── GET /api/admin/analytics/export ── */

test('export: 401 signed out, 403 for staff without reports', async () => {
  assert.equal((await adminGet(exportRoute, 'https://tulsi.test/api/admin/analytics/export')).status, 401);
  signInAs('ofs@tulsi.test');
  assert.equal((await adminGet(exportRoute, 'https://tulsi.test/api/admin/analytics/export')).status, 403);
  signInAs('vendor-a@vendor.test');
  assert.equal((await adminGet(exportRoute, 'https://tulsi.test/api/admin/analytics/export?type=events')).status, 403);
});

test('export: the owner downloads sessions and events as CSV attachments', async () => {
  await track(batch([PV('/'), { type: 'product_view', productId: 'p1' }, { type: 'add_to_cart', productId: 'p1', qty: 1 }]));
  /* A second browser (its own page load / tab id). */
  await track(batch([PV('/cart')], 0, { tab: 'tab0002' }));
  signInAs('owner@tulsi.test');
  const today = istDateKey(new Date());

  const { res, status } = await adminGet(exportRoute, 'https://tulsi.test/api/admin/analytics/export?range=today');
  assert.equal(status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(res.headers.get('content-disposition'), `attachment; filename="tulsi-sessions-${today}.csv"`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-export-rows'), '2');
  assert.equal(res.headers.get('x-export-truncated'), '0');
  /* Raw bytes: Response.text() would silently drop the BOM. */
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM on the wire');
  const body = bytes.subarray(3).toString('utf8');
  assert.ok(body.startsWith('session_id,visitor_id,customer_id,visitor_type,'), body.slice(0, 60));
  assert.equal(body.trim().split('\r\n').length, 3);

  const ev = await adminGet(exportRoute, 'https://tulsi.test/api/admin/analytics/export?range=today&type=events');
  assert.equal(ev.status, 200);
  assert.equal(ev.res.headers.get('content-disposition'), `attachment; filename="tulsi-events-${today}.csv"`);
  const evBody = await ev.res.text();
  assert.ok(evBody.startsWith('time_ist,event,visitor_id,session_id,'));
  assert.equal(ev.res.headers.get('x-export-rows'), '4');
  assert.match(evBody, /,add_to_cart,/);

  const week = await adminGet(exportRoute, 'https://tulsi.test/api/admin/analytics/export?range=7d&type=nonsense');
  assert.match(week.res.headers.get('content-disposition'), /filename="tulsi-sessions-\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.csv"/);
});

/* ── GET /api/admin/site-visits ── */

test('site-visits: 401 signed out, 403 for order staff', async () => {
  assert.equal((await siteVisitsRoute.GET()).status, 401);
  signInAs('ofs@tulsi.test');
  assert.equal((await siteVisitsRoute.GET()).status, 403);
});

test('site-visits: today / last 7 days / all time from the new rollups, legacy counters for older days', async () => {
  const keys = lastNDateKeys(7);
  const today = keys[6];
  const now = Date.now();
  const put = (col, id, d) => (db.store.get(col) || db.store.set(col, new Map()).get(col)).set(id, d);
  put('siteVisits', keys[0], { pageViews: 40, uniqueVisitors: 12 }); // before the switch: legacy only
  put('siteVisits', keys[1], { pageViews: 10, uniqueVisitors: 4 });
  put('siteVisits', today, { pageViews: 999, uniqueVisitors: 999 }); // ignored: today is tracked by the new engine
  put('analytics_daily', `${today}_0`, { dateKey: today, sessions: 3, pageviews: 7, visitors: 2 });
  put('analytics_daily', `${today}_2`, { dateKey: today, sessions: 1, pageviews: 1, visitors: 1 });
  put('analytics_daily', `${keys[5]}_1`, { dateKey: keys[5], sessions: 2, pageviews: 5, visitors: 2 });
  put('siteVisitsMeta', 'allTime', { totalPageViews: 500, totalUniqueVisitors: 100 });
  put('analytics_totals', '0', { pageviews: 9, newVisitors: 3 });
  put('analytics_totals', '3', { pageviews: 4, newVisitors: 1, sessions: 6 });
  put('analytics_visitors', 'v1', { lastSeenAt: new Date(now - 60 * 60_000).toISOString() });
  put('analytics_visitors', 'v2', { lastSeenAt: new Date(now - 2 * 86_400_000).toISOString() });
  put('analytics_visitors', 'v3', { lastSeenAt: new Date(now - 10 * 86_400_000).toISOString() });

  signInAs('owner@tulsi.test');
  const res = await siteVisitsRoute.GET();
  assert.equal(res.status, 200);
  const { success, data } = await res.json();
  assert.equal(success, true);
  assert.deepEqual(data.today, { pageViews: 8, uniqueVisitors: 3 });
  assert.deepEqual(data.last7Days, { pageViews: 40 + 10 + 5 + 8, uniqueVisitors: 2 + 12 + 4 });
  assert.deepEqual(data.allTime, { pageViews: 500 + 13, uniqueVisitors: 100 + 4 });
  assert.equal(data.days.length, 7);
  assert.deepEqual(data.days.map((d) => d.date), keys);
  assert.deepEqual(data.days[0], { date: keys[0], pageViews: 40, uniqueVisitors: 12 });
  assert.deepEqual(data.days[2], { date: keys[2], pageViews: 0, uniqueVisitors: 0 });
  assert.deepEqual(data.days[5], { date: keys[5], pageViews: 5, uniqueVisitors: 2 });
});

test('site-visits: a brand-new store with no data at all is all zeros', async () => {
  signInAs('owner@tulsi.test');
  const { data } = await (await siteVisitsRoute.GET()).json();
  assert.deepEqual([data.today, data.last7Days, data.allTime], [{ pageViews: 0, uniqueVisitors: 0 }, { pageViews: 0, uniqueVisitors: 0 }, { pageViews: 0, uniqueVisitors: 0 }]);
});

test('site-visits reads what the track endpoint writes', async () => {
  await track(batch([PV('/'), PV('/shop')]));
  await track(batch([PV('/')], 0, { tab: 'tab0002' })); // a second browser
  signInAs('owner@tulsi.test');
  const { data } = await (await siteVisitsRoute.GET()).json();
  assert.deepEqual(data.today, { pageViews: 3, uniqueVisitors: 2 });
  assert.deepEqual(data.last7Days, { pageViews: 3, uniqueVisitors: 2 });
  assert.deepEqual(data.allTime, { pageViews: 3, uniqueVisitors: 2 });
});

test('cookie-less requests from one page load are one visitor: a retried first batch is not a second visitor', async () => {
  /* The first response (with Set-Cookie) never reached the browser; the
     tracker resends the same (tab, n) without cookies. */
  const ip = '49.37.10.20';
  const first = await track(batch([PV('/'), PV('/shop')], 0, { tab: 'pageloadaaaa0001' }), { ip });
  const retry = await track(batch([PV('/'), PV('/shop')], 0, { tab: 'pageloadaaaa0001' }), { ip });
  const beacon = await track(batch([{ type: 'heartbeat', active: 12, path: '/shop' }], 1, { tab: 'pageloadaaaa0001', final: true }), { ip });
  assert.equal(cookiesOf(first).tj_vid, cookiesOf(retry).tj_vid, 'same page load → same visitor id');
  assert.equal(cookiesOf(beacon).tj_vid, cookiesOf(first).tj_vid);
  assert.equal(docs('analytics_visitors').length, 1);
  assert.equal(docs('analytics_sessions').length, 1, 'the beacon continues the first visit');
  const day = docs('analytics_daily').reduce((a, d) => ({ visitors: a.visitors + (d.visitors || 0), pageviews: a.pageviews + (d.pageviews || 0), sessions: a.sessions + (d.sessions || 0) }), { visitors: 0, pageviews: 0, sessions: 0 });
  assert.deepEqual(day, { visitors: 1, pageviews: 2, sessions: 1 }, 'the retry is de-duplicated');
  /* Another page load (another tab id) on the same phone is another browser
     until cookies exist — but with cookies it is the same visitor. */
  await track(batch([PV('/about')], 0, { tab: 'pageloadbbbb0002' }), { ip, cookie: cookieHeader(first) });
  assert.equal(docs('analytics_visitors').length, 1);
});
