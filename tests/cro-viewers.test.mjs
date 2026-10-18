/* Live viewers (src/lib/analytics/viewers.js + GET /api/products/[id]/viewers)
   and the stock badge copy (src/components/product/stockStatus.js). */
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

const { viewersOnPage, _resetViewersCache, VIEWERS_SCAN_LIMIT } = await import(src('lib/analytics/viewers.js'));
const { GET } = await import(src('app/api/products/[id]/viewers/route.js'));
const { stockStatus } = await import(src('components/product/stockStatus.js'));

const NOW = new Date('2026-10-16T08:00:00Z');
const MIN = 60_000;
const iso = (ms) => new Date(NOW.getTime() + ms).toISOString();
const vid = (c) => `tj_vid_${String(c).padEnd(22, 'x')}`;
const sid = (c) => `tj_sid_${String(c).padEnd(22, 'y')}`;
const sess = (s, v, p, ago) => [sid(s), { sid: sid(s), vid: vid(v), currentPath: p, lastSeenAt: iso(-ago) }];

function seed(rows) {
  db = fakeFirestore({ analytics_sessions: Object.fromEntries(rows) });
}

beforeEach(() => { _resetViewersCache(); seed([]); });

test('counts distinct other browsers on the page within 5 minutes', async () => {
  seed([
    sess('a', 'A', '/product/p1', 1 * MIN),
    sess('b', 'B', '/product/p1', 4 * MIN),
    sess('b2', 'B', '/product/p1', 2 * MIN), // same browser, 2nd session
    sess('c', 'C', '/product/p1', 6 * MIN), // too old
    sess('d', 'D', '/product/p2', 1 * MIN), // other product
    sess('e', 'E', '/product/p1/', 1 * MIN), // trailing slash
    sess('f', 'F', '/product/p10', 1 * MIN), // prefix must not match
  ]);
  assert.equal(await viewersOnPage(db, '/product/p1', { now: NOW }), 3); // A, B, E
  assert.equal(await viewersOnPage(db, '/product/p2', { now: NOW }), 1);
  assert.equal(await viewersOnPage(db, '/product/zz', { now: NOW }), 0);
  assert.equal(await viewersOnPage(db, '', { now: NOW }), 0);
});

test("excludes the requester's own session and browser", async () => {
  seed([
    sess('a', 'A', '/product/p1', 1 * MIN),
    sess('a2', 'A', '/product/p1', 2 * MIN), // requester's other session
    sess('b', 'B', '/product/p1', 1 * MIN),
  ]);
  assert.equal(await viewersOnPage(db, '/product/p1', { now: NOW, excludeSid: sid('a') }), 1);
  assert.equal(await viewersOnPage(db, '/product/p1', { now: NOW, excludeVid: vid('B') }), 1);
  assert.equal(await viewersOnPage(db, '/product/p1', { now: NOW, excludeSid: sid('a'), excludeVid: vid('B') }), 0);
  assert.equal(await viewersOnPage(db, '/product/p1', { now: NOW, excludeSid: sid('zz') }), 2);
});

test('one query per 30 s, shared across products; window re-applied from now', async () => {
  seed([sess('a', 'A', '/product/p1', 4.5 * MIN), sess('b', 'B', '/product/p2', 1 * MIN)]);
  let queries = 0;
  const col = db.collection.bind(db);
  db.collection = (name) => { if (name === 'analytics_sessions') queries += 1; return col(name); };
  assert.equal(await viewersOnPage(db, '/product/p1', { now: NOW }), 1);
  assert.equal(await viewersOnPage(db, '/product/p2', { now: NOW }), 1);
  /* 29 s later: cached — but A (now 4 m 59 s ago) still in window. */
  assert.equal(await viewersOnPage(db, '/product/p1', { now: new Date(NOW.getTime() + 29_000) }), 1);
  assert.equal(queries, 1);
  /* Concurrent calls share the in-flight read. */
  _resetViewersCache();
  await Promise.all([1, 2, 3].map(() => viewersOnPage(db, '/product/p1', { now: NOW })));
  assert.equal(queries, 2);
  /* 31 s later: a fresh read, and A (5 m 1 s ago) has dropped out. */
  assert.equal(await viewersOnPage(db, '/product/p1', { now: new Date(NOW.getTime() + 31_000) }), 0);
  assert.equal(queries, 3);
  /* Time going backwards (tests) re-reads. */
  await viewersOnPage(db, '/product/p1', { now: new Date(NOW.getTime() - 1000) });
  assert.equal(queries, 4);
});

test('cached snapshot still drops sessions that age out of the window', async () => {
  seed([sess('a', 'A', '/product/p1', 4 * MIN + 50_000)]); // 4 m 50 s ago
  assert.equal(await viewersOnPage(db, '/product/p1', { now: NOW }), 1);
  assert.equal(await viewersOnPage(db, '/product/p1', { now: new Date(NOW.getTime() + 20_000) }), 0);
});

test('a failed read is not cached', async () => {
  seed([sess('a', 'A', '/product/p1', 1 * MIN)]);
  const col = db.collection.bind(db);
  let fail = true;
  db.collection = (name) => (fail && name === 'analytics_sessions' ? { where: () => { throw new Error('boom'); } } : col(name));
  await assert.rejects(viewersOnPage(db, '/product/p1', { now: NOW }));
  fail = false;
  assert.equal(await viewersOnPage(db, '/product/p1', { now: NOW }), 1);
});

test('query: single-field range + order + limit, projection only', async () => {
  const calls = [];
  const q = {
    where: (...a) => { calls.push(['where', ...a]); return q; },
    orderBy: (...a) => { calls.push(['orderBy', ...a]); return q; },
    select: (...a) => { calls.push(['select', ...a]); return q; },
    limit: (...a) => { calls.push(['limit', ...a]); return q; },
    get: async () => ({ docs: [] }),
  };
  const fake = { collection: (n) => { calls.push(['collection', n]); return q; } };
  await viewersOnPage(fake, '/product/p1', { now: NOW });
  assert.deepEqual(calls, [
    ['collection', 'analytics_sessions'],
    ['where', 'lastSeenAt', '>=', iso(-5 * MIN)],
    ['orderBy', 'lastSeenAt', 'desc'],
    ['select', 'vid', 'sid', 'currentPath', 'lastSeenAt'],
    ['limit', VIEWERS_SCAN_LIMIT],
  ]);
  assert.equal(VIEWERS_SCAN_LIMIT, 500);
});

/* ── Route ── */
const req = (cookie) => new Request('https://tulsi.test/api/products/p1/viewers', { headers: cookie ? { cookie } : {} });
const ctx = (id) => ({ params: Promise.resolve({ id }) });

test('route: counts others, excludes own tj_sid / tj_vid, caches privately', async () => {
  seed([
    [sid('a'), { sid: sid('a'), vid: vid('A'), currentPath: '/product/p1', lastSeenAt: new Date(Date.now() - MIN).toISOString() }],
    [sid('b'), { sid: sid('b'), vid: vid('B'), currentPath: '/product/p1', lastSeenAt: new Date(Date.now() - MIN).toISOString() }],
    [sid('c'), { sid: sid('c'), vid: vid('C'), currentPath: '/product/p1', lastSeenAt: new Date(Date.now() - MIN).toISOString() }],
  ]);
  /* No cookies: the requester may be one of them — one fewer. */
  let res = await GET(req(), ctx('p1'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, max-age=30');
  assert.deepEqual(await res.json(), { success: true, data: { viewing: 2 } });
  res = await GET(req(`tj_vid=${vid('Z')}`), ctx('p1'));
  assert.deepEqual(await res.json(), { success: true, data: { viewing: 3 } });

  res = await GET(req(`tj_sid=${sid('a')}; other=1`), ctx('p1'));
  assert.deepEqual(await res.json(), { success: true, data: { viewing: 2 } });
  res = await GET(req(`tj_vid=${vid('B')}`), ctx('p1'));
  assert.deepEqual(await res.json(), { success: true, data: { viewing: 2 } });
  /* A malformed cookie is ignored (treated as no cookie). */
  res = await GET(req('tj_sid=nope'), ctx('p1'));
  assert.deepEqual(await res.json(), { success: true, data: { viewing: 2 } });
  /* Only the number is returned. */
  const body = JSON.stringify(await (await GET(req(), ctx('p1'))).json());
  assert.ok(!/tj_|product\//.test(body));
});

test('route: invalid id → 400', async () => {
  for (const id of ['', 'a/b', 'x'.repeat(65), '../etc', 'p 1', undefined]) {
    const res = await GET(req(), ctx(id));
    assert.equal(res.status, 400, `id ${id}`);
  }
});

test('route: a failure answers viewing 0, never an error', async () => {
  db = { collection: () => { throw new Error('firestore down'); } };
  const origError = console.error;
  console.error = () => {};
  try {
    const res = await GET(req(), ctx('p1'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, data: { viewing: 0 } });
    assert.equal(res.headers.get('cache-control'), 'no-store');
  } finally { console.error = origError; }
});

/* ── Stock badge copy ── */
test('stockStatus: real stock only', () => {
  assert.deepEqual(stockStatus(0), { tone: 'out', count: 0, label: 'Out of stock' });
  assert.equal(stockStatus(undefined).tone, 'out');
  assert.equal(stockStatus(null).tone, 'out');
  assert.equal(stockStatus(-2).tone, 'out');
  assert.equal(stockStatus('abc').tone, 'out');
  assert.equal(stockStatus(1).label, 'Only 1 left in stock — order soon');
  assert.equal(stockStatus(2).label, 'Only 2 left in stock — order soon');
  assert.equal(stockStatus('3').label, 'Only 3 left in stock — order soon');
  assert.equal(stockStatus(2.7).count, 2);
  assert.deepEqual(stockStatus(4), { tone: 'in', count: 4, label: 'In stock' });
  assert.equal(stockStatus(250).label, 'In stock');
});
